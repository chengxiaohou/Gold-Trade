import type { BollKline } from './bollService';
import { DEFAULT_TAG_PARAMS } from '../types';
import type { TagParams, BacktestRule, BacktestStrategy, BacktestTrade, BacktestResult, BacktestTagGroup } from '../types';
import { analyzeKlinePatterns, analyzeMarketConditions, analyzeEnvironment, envHasCondition, buildBreakExplainLines, classifyPositionAt, classifyVolumeAt, analyzeStabilizeAt } from './tagAnalyzers';
import type { EnvResult } from './tagAnalyzers';

// ─────────────────────────────────────────────────────────────
// 回测引擎
// 输入历史日线 K 线（BollKline[]，date 升序）+ 用户规则（触发标签→方向→仓位），
// 逐日因果扫描（仅用当日及之前信息），生成买卖点、成交记录与资金统计。
// ⚠️ 触发标签完全复用 services/tagAnalyzers.ts 的判断逻辑（弹窗同一套），回测自身不定义独立信号判断。
// ─────────────────────────────────────────────────────────────

export interface BacktestParams {
  feeRate?: number; // 单边手续费比例（默认 0）
  lotSize?: number; // 每手股数（默认 100，整百股成交）
}

// 触发标签目录：把回测 UI 可选标签映射到"弹窗同一标签判断逻辑"的匹配值。
// 与股息页标签弹窗"每日类"信号（位置/量能/形态/破位/企稳）严格同步——
// 每新增一个弹窗每日信号，都必须在此登记一行（用 tagAnalyzers 同一判定函数产出）。
// 每日信号(MACD量大)、风系加/减、综合周期/量价在弹窗已注释，回测同样不收录。
export interface BacktestTagDef {
  key: string;
  label: string;            // UI 展示名 / 成交记录触发标签名
  abbr: string;             // 预览/单元格单字缩写
  group: BacktestTagGroup;
  source: 'pattern' | 'break' | 'volume' | 'position' | 'stabilize';
  signalName?: string;      // 各 source 用其判定函数返回的 label 匹配（pattern=analyzeKlinePatterns 的 label；break=固定 token；volume=classifyVolumeAt；position=classifyPositionAt；stabilize=analyzeStabilizeAt 的 label）
  action: 'buy' | 'sell';   // 语义方向提示（执行仍以规则 action 为准）
  color: string;            // 标签主题色：买=砖红、卖=蓝（与 B/S 买卖标签同一套）
}
export const BACKTEST_TAG_CATALOG: BacktestTagDef[] = [
  // K 线形态（signalName = analyzeKlinePatterns 的 label，弹窗形态 chip 同一来源）
  { key: 'pattern-doji', label: '十字星', abbr: '十', group: 'pattern', source: 'pattern', signalName: '十字星', action: 'sell', color: '#4A90D9' },
  { key: 'pattern-hammer', label: '金针探底', abbr: '针', group: 'pattern', source: 'pattern', signalName: '金针探底', action: 'buy', color: '#C44A3D' },
  { key: 'pattern-boosted-hammer', label: '放量金针', abbr: '针', group: 'pattern', source: 'pattern', signalName: '放量金针', action: 'buy', color: '#C44A3D' },
  { key: 'pattern-hanging', label: '吊颈线', abbr: '吊', group: 'pattern', source: 'pattern', signalName: '吊颈线', action: 'sell', color: '#4A90D9' },
  { key: 'pattern-shooting', label: '射击之星', abbr: '射', group: 'pattern', source: 'pattern', signalName: '射击之星', action: 'sell', color: '#4A90D9' },
  { key: 'pattern-inverted-hammer', label: '倒锤子线', abbr: '倒', group: 'pattern', source: 'pattern', signalName: '倒锤子线', action: 'buy', color: '#C44A3D' },
  // 破位事件（source=break，走弹窗 analyzeMarketConditions 破位事件；signalName 为固定 token）
  { key: 'break-event', label: '破位', abbr: '破', group: 'break', source: 'break', signalName: 'break-event', action: 'sell', color: '#4A90D9' },
  // 每日量能（source=volume，signalName = classifyVolumeAt 返回值）
  { key: 'volume-up', label: '放量', abbr: '放', group: 'volume', source: 'volume', signalName: '放量', action: 'buy', color: '#C44A3D' },
  { key: 'volume-down', label: '缩量', abbr: '缩', group: 'volume', source: 'volume', signalName: '缩量', action: 'sell', color: '#4A90D9' },
  { key: 'volume-flat', label: '平量', abbr: '平', group: 'volume', source: 'volume', signalName: '平量', action: 'buy', color: '#C44A3D' },
  // 位置（source=position，signalName = classifyPositionAt 返回值；中位为中性默认，不入可选列表）
  { key: 'position-high', label: '高位', abbr: '高', group: 'position', source: 'position', signalName: '高位', action: 'sell', color: '#4A90D9' },
  { key: 'position-low', label: '低位', abbr: '低', group: 'position', source: 'position', signalName: '低位', action: 'buy', color: '#C44A3D' },
  // 底部企稳（source=stabilize，signalName = analyzeStabilizeAt 的 label）
  { key: 'stabilize-confirm', label: '有效企稳', abbr: '效', group: 'stabilize', source: 'stabilize', signalName: '有效企稳', action: 'buy', color: '#C44A3D' },
  { key: 'stabilize-stable', label: '缩量企稳', abbr: '稳', group: 'stabilize', source: 'stabilize', signalName: '缩量企稳', action: 'buy', color: '#C44A3D' },
  { key: 'stabilize-retrace', label: '缩量回踩', abbr: '回', group: 'stabilize', source: 'stabilize', signalName: '缩量回踩', action: 'sell', color: '#4A90D9' },
];

// 策略编辑器下拉的分组中文名（<optgroup> 标签）
export const BT_GROUP_LABEL: Record<BacktestTagGroup, string> = {
  'pattern': 'K线形态', 'break': '破位', 'volume': '量能', 'position': '位置', 'stabilize': '企稳',
  'feng-add': '风系·加仓', 'feng-reduce': '风系·减仓', 'env': '环境', 'daily': '每日信号',
};

const fmtP = (v: number) => v.toFixed(2);
export const fmtDay = (d: string) => d;
export const fmtShort = (d: string) => d.slice(5).replace('-', '/');

// 收集某交易日（win=klines[0..i] 末根=当日）命中的标签名 + 当日环境状态。
// 逐日因果：win 已是"当日及之前"的前缀，不含未来数据 → 无未来泄漏。
function collectSignalsOnDay(win: BollKline[], i: number, cfg: TagParams): { hits: Set<string>; env: EnvResult | null } {
  const hits = new Set<string>();
  const last = win[win.length - 1];
  // K 线形态：直接用 analyzeKlinePatterns 的 label（弹窗同一套）
  for (const p of analyzeKlinePatterns(win, fmtP, cfg)) if (p.date === last.date) hits.add(p.label);
  // 破位事件：复用弹窗 analyzeMarketConditions，只看当日（lastDays=1）
  for (const ev of analyzeMarketConditions(win, 1)) if (ev.date === last.date && ev.brokenCount > 0) hits.add('break-event');
  // 每日量能：classifyVolumeAt 当日（弹窗 volday chip 同源）
  hits.add(classifyVolumeAt(win, win.length - 1, cfg));
  // 位置：classifyPositionAt 当日（中位为中性默认，不入命中集合，避免被目录误匹配）
  const pos = classifyPositionAt(win, win.length - 1, cfg);
  if (pos !== '中位') hits.add(pos);
  // 底部企稳：analyzeStabilizeAt 当日（弹窗企稳 chip 同源）；历史已收盘 → allowVol=true
  const st = analyzeStabilizeAt(win, win.length - 1, fmtP, true, cfg);
  if (st) hits.add(st.label);
  // 环境状态：仅当 K 线足够长（≥130，环境判断需要 120 日均线）才计算，供规则 envCondition 门控判定
  const env = win.length >= 130 ? analyzeEnvironment(win, fmtP, true, cfg) : null;
  void i;
  return { hits, env };
}

// 引擎主函数：支持加仓/减仓、初始资金基准仓位、先卖后买、每日收盘后结算
export function runBacktest(k: BollKline[], s: BacktestStrategy, p: BacktestParams = {}): BacktestResult {
  // 简化版费用：仅"最低佣金"（固定每笔费用），费率/印花税已从 UI 隐藏，不参与计算。
  const commissionMin = s.commissionMin ?? 5; // 单笔固定佣金（默认 5 元）
  const buyFee = (amt: number) => commissionMin;
  const sellFee = (amt: number) => commissionMin;
  const lotSize = p.lotSize ?? 100;
  const cfg = DEFAULT_TAG_PARAMS;
  const klines = [...k].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const n = klines.length;
  const enabledRules = (s.rules || []).filter(r => r.enabled);
  const initCap = s.initialCapital;

  let cash = initCap;
  let shares = 0;
  let avgCost = 0;
  const trades: BacktestTrade[] = [];
  // 回撤：逐日记录收盘权益
  let peak = initCap;
  let maxDD = 0;

  for (let i = 30; i < n; i++) {
    const win = klines.slice(0, i + 1);
    const { hits, env } = collectSignalsOnDay(win, i, cfg);

    // 命中标签里，选已启用规则中仓位最高的一条（且环境前提成立）
    let chosen: BacktestRule | null = null;
    for (const r of enabledRules) {
      const def = BACKTEST_TAG_CATALOG.find(d => d.key === r.tagKey && d.label === r.label);
      if (!def) continue;
      const matched = def.signalName != null && hits.has(def.signalName);
      if (!matched) continue;
      // 环境前提门控：规则指定了 envCondition 时，当日环境状态必须命中该 key 才允许动作
      if (r.envCondition?.key && !envHasCondition(env, r.envCondition.key)) continue;
      if (!chosen || r.pct > chosen.pct) chosen = r;
    }

    if (chosen) {
      const def = BACKTEST_TAG_CATALOG.find(d => d.key === chosen!.tagKey && d.label === chosen!.label);
      if (def) {
        const price = klines[i].close;
        const date = klines[i].date;
        // 仓位基准：固定按初始资金 × pct% 计算目标交易金额（加仓不被剩余现金挤没、卖出对称）
        const targetAmount = initCap * (chosen.pct / 100);

        if (chosen.action === 'buy') {
          const maxAmount = cash;
          const amount = Math.min(targetAmount, maxAmount);
          let qty = Math.floor(amount / price / lotSize) * lotSize;
          if (qty >= lotSize && qty * price + buyFee(qty * price) <= cash) {
            const tradeAmount = qty * price;
            const fee = buyFee(tradeAmount);
            cash -= tradeAmount + fee;
            // 加权均价：加仓时更新
            avgCost = shares > 0
              ? (avgCost * shares + tradeAmount) / (shares + qty)
              : price;
            shares += qty;
            trades.push({
              id: `${date}-B-${i}`, date, barIndex: i, tagKey: def.key, tagName: def.label,
              action: 'buy', price, shares: qty, amount: tradeAmount,
              cashAfter: cash, sharesAfter: shares, avgCostAfter: avgCost, realizedPnl: undefined,
            });
          }
        } else if (chosen.action === 'sell' && shares > 0) {
          let qty = Math.floor(targetAmount / price / lotSize) * lotSize;
          if (qty === 0 && shares > 0) qty = shares;  // 目标太小：全卖
          else if (qty > shares) qty = shares;        // 超过持仓：全卖
          if (qty > 0) {
            const tradeAmount = qty * price;
            const fee = sellFee(tradeAmount);
            const realized = tradeAmount - fee - qty * avgCost;
            cash += tradeAmount - fee;
            shares -= qty;
            if (shares === 0) avgCost = 0;
            trades.push({
              id: `${date}-S-${i}`, date, barIndex: i, tagKey: def.key, tagName: def.label,
              action: 'sell', price, shares: qty, amount: tradeAmount,
              cashAfter: cash, sharesAfter: shares, avgCostAfter: avgCost, realizedPnl: realized,
            });
          }
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
  const totalReturnPct = initCap > 0 ? ((finalValue - initCap) / initCap) * 100 : 0;

  return {
    trades, finalValue, totalReturnPct,
    winRate: closed.length > 0 ? wins / closed.length : 0,
    maxDrawdownPct: maxDD * 100,
    tradeCount: trades.length,
  };
}

// 预览：扫描某标签在某段完整历史 K 线中命中位置（复用弹窗判定逻辑，不独立判断）。
// envKey 可选：指定后仅保留"当日环境状态命中该 key"的位置（与回测门控一致）。
export function scanTagOccurrences(k: BollKline[], tagKey: string, envKey?: string): { date: string; barIndex: number; detail: string[] }[] {
  const def = BACKTEST_TAG_CATALOG.find(d => d.key === tagKey);
  if (!def) return [];
  const cfg = DEFAULT_TAG_PARAMS;
  const klines = [...k].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const n = klines.length;
  const out: { date: string; barIndex: number; detail: string[] }[] = [];
  for (let i = 30; i < n; i++) {
    const win = klines.slice(0, i + 1);
    const last = win[win.length - 1];
    let detail: string[] | null = null;
    if (def.source === 'break') {
      // 破位事件：复用 analyzeMarketConditions + buildBreakExplainLines（与弹窗破位 chip 同一依据）
      const ev = analyzeMarketConditions(win, 1).find(x => x.date === last.date && x.brokenCount > 0);
      if (ev) detail = buildBreakExplainLines(ev, 'event', fmtP, fmtDay, fmtShort);
    } else if (def.source === 'pattern') {
      const p = analyzeKlinePatterns(win, fmtP, cfg).find(x => x.date === last.date && x.label === def.signalName);
      if (p) detail = p.detail;
    } else if (def.source === 'volume') {
      // 每日量能：与弹窗 volday 同源（classifyVolumeAt）；detail 用量比给一个简短依据
      if (classifyVolumeAt(win, win.length - 1, cfg) === def.signalName && def.signalName !== '平量') {
        let ratio = 0;
        let sum = 0;
        for (let j = i - 5; j < i; j++) if (j >= 0) sum += win[j].volume;
        if (sum > 0) ratio = last.volume / (sum / 5);
        detail = [`${fmtShort(last.date)} ${def.signalName}：当日量/前5日均量 = ${ratio.toFixed(2)}`];
      } else if (classifyVolumeAt(win, win.length - 1, cfg) === def.signalName && def.signalName === '平量') {
        detail = [`${fmtShort(last.date)} 平量：当日量/前5日均量处于放量与缩量阈值之间`];
      }
    } else if (def.source === 'position') {
      // 位置：与弹窗组合词条位置 token 同源（classifyPositionAt）
      if (classifyPositionAt(win, win.length - 1, cfg) === def.signalName) {
        detail = def.signalName === '高位'
          ? [`${fmtShort(last.date)} 高位：收盘贴近近20日高点`]
          : [`${fmtShort(last.date)} 低位：收盘贴近近20日低点`];
      }
    } else if (def.source === 'stabilize') {
      // 底部企稳：与弹窗企稳 chip 同源（analyzeStabilizeAt）；detail 复用其判定依据
      const st = analyzeStabilizeAt(win, win.length - 1, fmtP, true, cfg);
      if (st && st.label === def.signalName) detail = st.detail;
    }
    if (!detail) continue;
    // 环境前提：指定了 envKey 时，当日环境状态必须命中该 key 才算命中位置（与 runBacktest 门控一致）
    if (envKey) {
      const env = analyzeEnvironment(win, fmtP, true, cfg);
      if (!envHasCondition(env, envKey)) continue;
    }
    out.push({ date: klines[i].date, barIndex: i, detail });
  }
  return out;
}