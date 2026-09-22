import type { BollKline } from './bollService';
import { DEFAULT_TAG_PARAMS } from '../types';
import type { TagParams, UserTagRule, BacktestRule, BacktestStrategy, BacktestTrade, BacktestResult, BacktestTagGroup } from '../types';
import { analyzeKlinePatterns, analyzeMarketConditions, analyzeEnvironment, envHasCondition, buildBreakExplainLines, classifyVolumeAt, classifyPriceStateAt, volBucket, analyzeUserTagRule, DAILY_SIGNAL_CATALOG } from './tagAnalyzers';
import type { EnvResult, BacktestTagDef } from './tagAnalyzers';

// ─────────────────────────────────────────────────────────────
// 回测引擎
// 输入历史日线 K 线（BollKline[]，date 升序）+ 用户规则（触发标签→方向→仓位），
// 逐日因果扫描（仅用当日及之前信息），生成买卖点、成交记录与资金统计。
// ⚠️ 触发标签完全复用 services/tagAnalyzers.ts 的判断逻辑（弹窗同一套），回测自身不定义独立信号判断。
// ─────────────────────────────────────────────────────────────

export interface BacktestParams {
  feeRate?: number; // 单边手续费比例（默认 0）
  lotSize?: number; // 每手股数（默认 100，整百股成交）
  cfg?: TagParams;  // 标签判定参数：必须与标签弹窗同一份（默认 DEFAULT_TAG_PARAMS），保证两侧信号判定严格一致
  customTags?: UserTagRule[]; // 用户自定义动态信号标签：与弹窗同一份，保证回测与弹窗信号判定严格一致
  dividendPerShare?: number; // 该股每股税前派息（元）：供 dividendRate 数据点自定义标签使用
}

// 回测触发标签目录 = 直接复用 tagAnalyzers 里的【单一数据源】DAILY_SIGNAL_CATALOG。
// 不再在回测里另存一份信号清单——新增弹窗每日信号，只需改 tagAnalyzers 一处，回测自动获得。
export const BACKTEST_TAG_CATALOG: BacktestTagDef[] = DAILY_SIGNAL_CATALOG;
export type { BacktestTagDef } from './tagAnalyzers';

// 策略编辑器下拉的分组中文名（<optgroup> 标签）
export const BT_GROUP_LABEL: Record<BacktestTagGroup, string> = {
  'pattern': 'K线形态', 'break': '破位', 'volume': '量能', 'position': '位置', 'stabilize': '底态·价量组合',
  'feng-add': '风系·加仓', 'feng-reduce': '风系·减仓', 'env': '环境', 'daily': '每日信号', 'custom': '自定义',
};

const fmtP = (v: number) => v.toFixed(2);
export const fmtDay = (d: string) => d;
export const fmtShort = (d: string) => d.slice(5).replace('-', '/');

// 收集某交易日（win=klines[0..i] 末根=当日）命中的标签名 + 当日环境状态。
// 逐日因果：win 已是"当日及之前"的前缀，不含未来数据 → 无未来泄漏。
// dividendPerShare：供 dividendRate 数据点自定义标签使用（该股每股派息），与弹窗同源。
function collectSignalsOnDay(win: BollKline[], i: number, cfg: TagParams, customTags: UserTagRule[] = [], dividendPerShare?: number): { hits: Set<string>; env: EnvResult | null } {
  const hits = new Set<string>();
  const last = win[win.length - 1];
  // K 线形态：直接用 analyzeKlinePatterns 的 label（弹窗同一套）
  for (const p of analyzeKlinePatterns(win, fmtP, cfg)) if (p.date === last.date) hits.add(p.label);
  // 破位事件：复用弹窗 analyzeMarketConditions，只看当日（lastDays=1）
  for (const ev of analyzeMarketConditions(win, 1)) if (ev.date === last.date && ev.brokenCount > 0) hits.add('break-event');
  // 每日量能（source=volume，signalName = classifyVolumeAt 5档返回值；弹窗量能 chip 同源）
  hits.add(classifyVolumeAt(win, win.length - 1, cfg));
  // 价格态×量能 组合信号（source=stabilize，signalName = `${volBucket(量能)}${价格态}`，如 放量企稳）
  // 由量能原子 + 价格态原子组合派生，弹窗参考价值区同源；历史已收盘 → 直接判定
  // 回踩按 sub 分档（健康/弱势）拼入信号名；底部确认作为反弹的强化态直接命中（放量底部确认）
  const ps = classifyPriceStateAt(win, win.length - 1, fmtP, cfg);
  if (ps && ps.name) {
    const vol = classifyVolumeAt(win, win.length - 1, cfg);
    const psName = ps.kind === 'pullback' ? (ps.sub === 'weak' ? '弱势回踩' : '健康回踩') : ps.name;
    hits.add(`${volBucket(vol)}${psName}`);
  }
  // 用户自定义动态信号标签：命中当日即作为可判定信号（label 直接并入 hits；
  // 与弹窗 getDayTagSet 的 collectUserTags 同一判定源 analyzeUserTagRule，保证回测与弹窗一致）
  for (const r of customTags) {
    if (!r.enabled) continue;
    if (analyzeUserTagRule(win, i, r, dividendPerShare)) hits.add(r.name);
  }
  // 环境状态：仅当 K 线足够长（≥130，环境判断需要 120 日均线）才计算，供规则 envCondition 门控判定
  const env = win.length >= 130 ? analyzeEnvironment(win, fmtP, true, cfg) : null;
  void i;
  return { hits, env };
}

// 供回测图"十字线悬浮栏"展示某日命中的信号标签 —— 与 collectSignalsOnDay 同一来源，绝不另算一套。
export function getDaySignalLabels(win: BollKline[], i: number, cfg?: TagParams, customTags?: UserTagRule[], dividendPerShare?: number): string[] {
  return [...collectSignalsOnDay(win, i, cfg ?? DEFAULT_TAG_PARAMS, customTags ?? [], dividendPerShare).hits].sort();
}

// 引擎主函数：支持加仓/减仓、初始资金基准仓位、先卖后买、每日收盘后结算
export function runBacktest(k: BollKline[], s: BacktestStrategy, p: BacktestParams = {}): BacktestResult {
  // 简化版费用：仅"最低佣金"（固定每笔费用），费率/印花税已从 UI 隐藏，不参与计算。
  const commissionMin = s.commissionMin ?? 5; // 单笔固定佣金（默认 5 元）
  const buyFee = (amt: number) => commissionMin;
  const sellFee = (amt: number) => commissionMin;
  const lotSize = p.lotSize ?? 100;
  const cfg = p.cfg ?? DEFAULT_TAG_PARAMS; // ⚠️ 必须与弹窗 tagParams 一致，否则同 K 线两侧判定会漂移
  const customTags = p.customTags ?? []; // 用户自定义动态标签：与弹窗同一份，保证回测与弹窗信号判定严格一致
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
    const { hits, env } = collectSignalsOnDay(win, i, cfg, customTags, p.dividendPerShare);

    // 命中标签里，选已启用规则中仓位最高的一条（且环境前提成立）
    let chosen: BacktestRule | null = null;
    for (const r of enabledRules) {
      // 用户自定义标签用 tagKey='user-<id>'，label=标签名；命中以名称并入 hits（与弹窗同源）
      const isCustomTag = r.tagKey.startsWith('user-');
      const matched = isCustomTag
        ? hits.has(r.label)
        : (() => {
            const def = BACKTEST_TAG_CATALOG.find(d => d.key === r.tagKey && d.label === r.label);
            return !!def && def.signalName != null && hits.has(def.signalName);
          })();
      if (!matched) continue;
      // 环境前提门控：规则指定了 envCondition 时，当日环境状态必须命中该 key 才允许动作
      if (r.envCondition?.key && !envHasCondition(env, r.envCondition.key)) continue;
      if (!chosen || r.pct > chosen.pct) chosen = r;
    }

    if (chosen) {
      const def = BACKTEST_TAG_CATALOG.find(d => d.key === chosen!.tagKey && d.label === chosen!.label);
      if (def || chosen!.tagKey.startsWith('user-')) {
        const tagKey = def ? def.key : chosen!.tagKey;
        const tagName = def ? def.label : chosen!.label;
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
              id: `${date}-B-${i}`, date, barIndex: i, tagKey, tagName,
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
              id: `${date}-S-${i}`, date, barIndex: i, tagKey, tagName,
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
// 用户自定义标签（tagKey='user-<id>'）同样支持预览：按该条规则逐日判定（同弹窗同源）。
export function scanTagOccurrences(k: BollKline[], tagKey: string, envKey?: string, cfg: TagParams = DEFAULT_TAG_PARAMS, customTags: UserTagRule[] = [], dividendPerShare?: number): { date: string; barIndex: number; detail: string[] }[] {
  // 用户自定义标签：按规则逐日判定，命中即记（与弹窗 collectUserTags 同源 analyzeUserTagRule）
  if (tagKey.startsWith('user-')) {
    const rule = customTags.find(r => r.id === tagKey.slice(5));
    if (!rule) return [];
    const klines = [...k].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const n = klines.length;
    const out: { date: string; barIndex: number; detail: string[] }[] = [];
    for (let i = 30; i < n; i++) {
      const win = klines.slice(0, i + 1);
      const detail = analyzeUserTagRule(win, i, rule, dividendPerShare);
      if (!detail) continue;
      // 环境前提门控：指定了 envKey 时仅保留当日环境命中的位置
      if (envKey) {
        const env = win.length >= 130 ? analyzeEnvironment(win, fmtP, true, cfg) : null;
        if (!envHasCondition(env, envKey)) continue;
      }
      out.push({ date: win[win.length - 1].date, barIndex: i, detail });
    }
    return out;
  }
  const def = BACKTEST_TAG_CATALOG.find(d => d.key === tagKey);
  if (!def) return [];
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
    } else if (def.source === 'stabilize') {
      // 价格态×量能 组合信号：与弹窗参考价值区同源（classifyPriceStateAt + volBucket）；detail 复用价格态判定依据
      // 回踩按 sub 分档（健康/弱势）拼入信号名匹配；底部确认（放量底部确认）同样由该分支命中
      const vol = classifyVolumeAt(win, win.length - 1, cfg);
      const st = classifyPriceStateAt(win, win.length - 1, fmtP, cfg);
      if (st && st.name) {
        const stName = st.kind === 'pullback' ? (st.sub === 'weak' ? '弱势回踩' : '健康回踩') : st.name;
        if (`${volBucket(vol)}${stName}` === def.signalName) detail = st.detail;
      }
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