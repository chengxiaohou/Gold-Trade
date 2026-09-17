import type { BollKline } from './bollService';
import { DEFAULT_TAG_PARAMS } from '../types';
import type { TagParams, BacktestRule, BacktestStrategy, BacktestTrade, BacktestResult, BacktestTagGroup } from '../types';
import { analyzeKlinePatterns, analyzeDailySignals, analyzeFengSignals, calcMaSeries } from './tagAnalyzers';

// ─────────────────────────────────────────────────────────────
// 回测引擎
// 输入历史日线 K 线（BollKline[]，date 升序）+ 用户规则（触发标签→方向→仓位），
// 逐日因果扫描（仅用当日及之前信息），生成买卖点、成交记录与资金统计。
// 复用 services/tagAnalyzers.ts 的信号判定，保证与原股息页面信号一致。
// ─────────────────────────────────────────────────────────────

export interface BacktestParams {
  feeRate?: number; // 单边手续费比例（默认 0）
  lotSize?: number; // 每手股数（默认 100，整百股成交）
}

// 触发标签目录：把回测 UI 可选标签映射到信号来源与匹配名
export interface BacktestTagDef {
  key: string;
  label: string;            // UI 展示名 / 成交记录触发标签名
  group: BacktestTagGroup;
  source: 'feng' | 'pattern' | 'daily' | 'break';
  signalName?: string;      // analyzer 返回的 name / label / kind 匹配值
  action: 'buy' | 'sell';   // 语义方向提示（执行仍以规则 action 为准）
}
export const BACKTEST_TAG_CATALOG: BacktestTagDef[] = [
  { key: 'feng-low-buy', label: '缩量入场（低位）', group: 'feng-add', source: 'feng', signalName: '缩量入场（低位）', action: 'buy' },
  { key: 'feng-vol-break', label: '放量突破均线', group: 'feng-add', source: 'feng', signalName: '放量突破均线', action: 'buy' },
  { key: 'feng-shrink-rally', label: '缩量急拉', group: 'feng-reduce', source: 'feng', signalName: '无量/缩量急拉', action: 'sell' },
  { key: 'break-fail-recover', label: '放量破位不收复', group: 'break', source: 'break', signalName: '放量破位+2日不收复', action: 'sell' },
  { key: 'pattern-doji', label: '十字星', group: 'pattern', source: 'pattern', signalName: '十字星', action: 'sell' },
  { key: 'pattern-hammer', label: '金针探底', group: 'pattern', source: 'pattern', signalName: '金针探底', action: 'buy' },
  { key: 'macro-macd-gold', label: 'MACD 金叉', group: 'daily', source: 'daily', signalName: 'macd-gold', action: 'buy' },
];

const fmtP = (v: number) => v.toFixed(2);

// 收集某交易日（索引 i，win=klines[0..i] 末根=当日）命中的信号名
function collectSignalsOnDay(win: BollKline[], i: number, cfg: TagParams): Set<string> {
  const hit = new Set<string>();
  const last = win[win.length - 1];
  for (const p of analyzeKlinePatterns(win, fmtP, cfg)) if (p.date === last.date) hit.add(p.label);
  for (const sd of analyzeDailySignals(win, true)) if (sd.date === last.date) hit.add(sd.kind);
  const f = analyzeFengSignals(win, fmtP, true, cfg).latest;
  if (f.date === last.date) {
    for (const a of f.add) hit.add(a.name);
    for (const r of f.reduce) hit.add(r.name);
  }
  void i;
  return hit;
}

// 近5日均量（不含前导不足时用已用天数均值）
function avgVol(klines: BollKline[], i: number): number {
  let s = 0;
  const c = Math.min(5, i + 1);
  for (let j = Math.max(0, i - 4); j <= i; j++) s += klines[j].volume;
  return c > 0 ? s / c : 0;
}

// 放量破位不收复（延迟确认）：执行日 t 收盘后，若 t-2 为"放量跌破MA5且MA10"，且 t-1、t 两日
// 收盘均低于其当日 MA10（未收复），则确认触发。落点在确认日 t，无未来泄漏。
function isBreakConfirmed(klines: BollKline[], t: number, ma5s: (number | null)[], ma10s: (number | null)[]): boolean {
  if (t < 3) return false;
  const d = t - 2;
  const kd = klines[d];
  const ma5d = ma5s[d], ma10d = ma10s[d], ma10a = ma10s[t - 1], ma10b = ma10s[t];
  if (ma5d == null || ma10d == null || ma10a == null || ma10b == null) return false;
  const broke = kd.close < ma5d && kd.close < ma10d && kd.volume >= avgVol(klines, d);
  if (!broke) return false;
  const noRecover = klines[t - 1].close < ma10a && klines[t].close < ma10b;
  return noRecover;
}

// 引擎主函数：单持仓、整百股、先卖后买、每日收盘后结算
export function runBacktest(k: BollKline[], s: BacktestStrategy, p: BacktestParams = {}): BacktestResult {
  const feeRate = p.feeRate ?? 0;
  const lotSize = p.lotSize ?? 100;
  const cfg = DEFAULT_TAG_PARAMS;
  const klines = [...k].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const n = klines.length;
  const ma5s = calcMaSeries(klines, 5);
  const ma10s = calcMaSeries(klines, 10);
  const enabledRules = (s.rules || []).filter(r => r.enabled);

  let cash = s.initialCapital;
  let shares = 0;
  let avgCost = 0;
  const trades: BacktestTrade[] = [];
  // 回撤：逐日记录收盘权益
  let peak = s.initialCapital;
  let maxDD = 0;

  for (let i = 30; i < n; i++) {
    const win = klines.slice(0, i + 1);
    const hits = collectSignalsOnDay(win, i, cfg);

    // 命中标签里，选已启用规则中仓位最高的一条（break 用延迟确认）
    let chosen: BacktestRule | null = null;
    for (const r of enabledRules) {
      const def = BACKTEST_TAG_CATALOG.find(d => d.key === r.tagKey && d.label === r.label);
      if (!def) continue;
      let matched = def.source === 'break'
        ? isBreakConfirmed(klines, i, ma5s, ma10s)
        : def.signalName != null && hits.has(def.signalName);
      if (matched && (!chosen || r.pct > chosen.pct)) chosen = r;
    }

    // 先结算持仓再判定执行，保证"收盘后信号 → 用收盘价成交"、"先卖后买、空仓才买、持仓才卖"
    if (chosen) {
      const def = BACKTEST_TAG_CATALOG.find(d => d.key === chosen!.tagKey && d.label === chosen!.label);
      if (def) {
        const price = klines[i].close;
        const date = klines[i].date;
        if (chosen.action === 'buy' && shares === 0) {
          const qty = Math.floor((cash * (chosen.pct / 100)) / price / lotSize) * lotSize;
          if (qty > 0) {
            const amount = qty * price;
            const fee = amount * feeRate;
            if (amount + fee <= cash) {
              cash -= amount + fee;
              shares = qty;
              avgCost = price;
              trades.push({
                id: `${date}-B-${i}`, date, barIndex: i, tagKey: def.key, tagName: def.label,
                action: 'buy', price, shares: qty, amount,
                cashAfter: cash, sharesAfter: shares, avgCostAfter: avgCost, realizedPnl: undefined,
              });
            }
          }
        } else if (chosen.action === 'sell' && shares > 0) {
          const qty = Math.min(shares, Math.max(lotSize, Math.floor((shares * (chosen.pct / 100)) / lotSize) * lotSize));
          const amount = qty * price;
          const fee = amount * feeRate;
          const realized = amount - fee - qty * avgCost;
          cash += amount - fee;
          shares -= qty;
          if (shares === 0) avgCost = 0;
          trades.push({
            id: `${date}-S-${i}`, date, barIndex: i, tagKey: def.key, tagName: def.label,
            action: 'sell', price, shares: qty, amount,
            cashAfter: cash, sharesAfter: shares, avgCostAfter: avgCost, realizedPnl: realized,
          });
        }
      }
    }

    // 记录当日收盘权益（用实时持仓）
    const eq = cash + shares * klines[i].close;
    if (eq > peak) peak = eq;
    if (peak > 0) maxDD = Math.max(maxDD, (peak - eq) / peak);
  }

  const finalValue = cash + shares * (n > 0 ? klines[n - 1].close : 0);
  const closed = trades.filter(t => t.action === 'sell' && t.realizedPnl != null);
  const wins = closed.filter(t => (t.realizedPnl ?? 0) > 0).length;
  const totalReturnPct = s.initialCapital > 0 ? ((finalValue - s.initialCapital) / s.initialCapital) * 100 : 0;

  return {
    trades, finalValue, totalReturnPct,
    winRate: closed.length > 0 ? wins / closed.length : 0,
    maxDrawdownPct: maxDD * 100,
    tradeCount: trades.length,
  };
}