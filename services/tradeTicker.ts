import type { StockEntry, StockTrade } from '../types';
import { calcDtPnlForTrades, calcTradeFees } from './realizedPnl';
import { PENDING_TTL_DAYS, pendingDayIndex, isPendingTradeActive } from './stockTradeOps';

// ── 交易体量罗马数字（列表状态标签与滚动播报共用，SSOT）──
// 按成交金额每 2500 元一档并取最接近的档位，但第一档（2500 元）不写罗马数字，
// 从 5000 元起为 I：2500→无、5000→I、7500→II、10000→III（2000 / 3000 仍属第一档，不写）。
// 汇总记录优先用其记录的成交总金额，普通记录用 价格 × 股数。
const TRADE_VOLUME_STEP = 2500;
const toRomanNumeral = (n: number): string => {
  if (!Number.isFinite(n) || n <= 0) return '';
  const table: Array<[number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let rest = Math.floor(n);
  let out = '';
  for (const [value, symbol] of table) {
    while (rest >= value) { out += symbol; rest -= value; }
  }
  return out;
};
export const tradeVolumeLabel = (t: StockTrade): string => {
  const amount = Math.abs(t.amount ?? (t.price ?? 0) * (t.shares ?? 0));
  // 档位从 1 起算；第一档不显示，故减 1 后再转罗马数字（0 → 空串）
  return toRomanNumeral(Math.round(amount / TRADE_VOLUME_STEP) - 1);
};

// ── 滚动播报：持仓买入单的涨跌提醒 ──
// 播报对象固定为「已成交且仍有未卖出份额的买入单」（做T口径配对，avg 口径没有单笔概念）。
// 涨跌幅基准 = 该笔买入的每股成本（含税开关打开时含买入税费），与交易弹窗的做T浮盈同源。
// 「可领取」= (现价 − 每股成本) × 剩余未卖出份额，仅上涨条目展示。
// 下跌条目只提示「最近连续几笔买入都跌破阈值」的情况：只要最近一笔买入没跌破阈值
// （说明近期已在该价位附近补过仓），更早的下跌一律不再播报。
export const TICKER_DEFAULT_THRESHOLD = 3; // 默认触发阈值（%）
export const TICKER_DEFAULT_MAX_PER_STOCK = 3; // 每只股票每个方向最多播报几单
// 挂单播报阈值：挂单价差 ≤1% 视为「即将成交」；剩余有效期 ≤1 天视为「即将过期」
export const PENDING_NEAR_MATCH_PCT = 1;
export const PENDING_EXPIRING_DAYS = 1;

export type TickerKind = 'position' | 'nearFill' | 'expiring';

export interface TickerLot {
  date: number;        // 买入时间戳（成交时间优先）
  statusLabel: string; // 如「买入III」「挂卖II」
  pct: number | null;  // 涨跌幅（%）；挂单条目为 null（改用 note 表达）
  amount: number | null; // 可领取金额（仅上涨条目；其余为 null）
  note?: string | null;  // 挂单条目的补充说明，如「差0.42%成交」「剩1天过期」
}

export interface TickerItem {
  stockId: string;
  stockName: string;
  dir: 'up' | 'down';
  kind: TickerKind;     // position=持仓买入；nearFill=即将成交挂单；expiring=即将过期挂单
  lots: TickerLot[];   // 已按幅度降序排列，最多 maxPerStock 条
  hiddenCount: number; // 超出上限被省略的单数
  leadPct: number;     // 该条目中最强的一单涨跌幅（用于条目间排序）
}

export interface TickerOptions {
  threshold?: number;
  maxPerStock?: number;
  withTax?: boolean;
}

const buyDateOf = (t: StockTrade): number => t.filledAt ?? t.originalCreatedAt ?? t.createdAt ?? 0;
// 挂单剩余有效天数（与列表状态标签同一套口径：ttlDays 优先，从 ttlUpdatedAt 起算）
const pendingRemainingDays = (t: StockTrade, now: number): number => {
  const ttl = t.ttlDays ?? PENDING_TTL_DAYS;
  return Math.max(0, ttl - (pendingDayIndex(t.ttlUpdatedAt ?? t.createdAt, now) - 1));
};
const pendingSideLabel = (t: StockTrade): string => `挂${t.side === 'sell' ? '卖' : '买'}${tradeVolumeLabel(t)}`;

export function buildTickerItems(stocks: StockEntry[], opts: TickerOptions = {}): TickerItem[] {
  const threshold = Math.max(0, opts.threshold ?? TICKER_DEFAULT_THRESHOLD);
  const maxPerStock = Math.max(1, Math.round(opts.maxPerStock ?? TICKER_DEFAULT_MAX_PER_STOCK));
  const withTax = !!opts.withTax;
  const items: TickerItem[] = [];
  const nearFillItems: TickerItem[] = [];
  const expiringItems: TickerItem[] = [];
  const now = Date.now();

  for (const s of stocks) {
    const trades = s.stockTrades;
    const curPrice = s.price;
    if (!trades || trades.length === 0 || !(curPrice > 0)) continue;
    // 做T口径配对：判断每笔买入还剩多少份额没被卖出
    const dt = calcDtPnlForTrades(trades, withTax, s.name);

    // 候选买入单（仍有剩余份额）：先统一收集，再分别按「涨」「跌」规则筛选
    const cand: Array<{ lot: TickerLot; pct: number; date: number; cost: number; rest: number }> = [];
    // 挂单（即将成交 / 即将过期）：按方向分开收集，颜色与买红卖…保持一致
    const nearSell: Array<{ lot: TickerLot; gap: number }> = [];
    const nearBuy: Array<{ lot: TickerLot; gap: number }> = [];
    const expSell: Array<{ lot: TickerLot; days: number }> = [];
    const expBuy: Array<{ lot: TickerLot; days: number }> = [];
    for (const t of trades) {
      if (t.side === 'buy' && t.status === 'filled' && !t.isDeleted) {
        const match = dt.buyMatchMap[t.id];
        if (!match) continue;
        const rest = match.original - match.matched;
        const shares = t.shares ?? 0;
        if (!(rest > 0) || !(shares > 0)) continue;
        const feeTotal = withTax ? calcTradeFees(t, s.name).total : 0;
        const cost = (t.price ?? 0) + feeTotal / shares; // 每股成本（含税摊入）
        if (!(cost > 0)) continue;
        const pct = ((curPrice - cost) / cost) * 100;
        const date = buyDateOf(t);
        cand.push({ lot: { date, statusLabel: `买入${tradeVolumeLabel(t)}`, pct, amount: null }, pct, date, cost, rest });
        continue;
      }
      // 挂单：已过期（超出有效期）的不播报
      if (t.status !== 'pending' || t.isDeleted || t.isMerged) continue;
      if (!isPendingTradeActive(t, now)) continue;
      const orderPrice = t.price ?? 0;
      if (!(orderPrice > 0)) continue;
      // 价差：卖出挂单看现价还差多少涨到挂单价；买入挂单看现价还差多少跌到挂单价
      // 有符号价差（与交易弹窗「挂单价格」括号里的口径一致）：挂卖价在现价之上为正，挂买价在现价之下为负
      const signedGap = ((orderPrice - curPrice) / curPrice) * 100;
      const gap = Math.abs(signedGap);
      if (gap <= PENDING_NEAR_MATCH_PCT) {
        const lot: TickerLot = {
          date: t.createdAt,
          statusLabel: pendingSideLabel(t),
          pct: null,
          amount: null,
          note: `${signedGap > 0 ? '+' : ''}${signedGap.toFixed(2)}%成交`,
        };
        (t.side === 'sell' ? nearSell : nearBuy).push({ lot, gap });
      }
      const days = pendingRemainingDays(t, now);
      if (days <= PENDING_EXPIRING_DAYS) {
        const lot: TickerLot = {
          date: t.createdAt,
          statusLabel: pendingSideLabel(t),
          pct: null,
          amount: null,
          note: days <= 1 ? '当日过期' : `剩${days}天过期`,
        };
        (t.side === 'sell' ? expSell : expBuy).push({ lot, days });
      }
    }

    // 上涨条目：全部达到阈值的买入单（仍持有），按涨幅从大到小
    const ups = cand
      .filter(c => c.pct >= threshold)
      .sort((a, b) => b.pct - a.pct);
    if (ups.length > 0) {
      const lots = ups.slice(0, maxPerStock).map(c => {
        c.lot.amount = (curPrice - c.cost) * c.rest; // 可领取金额（含税口径已摊入成本）
        return c.lot;
      });
      items.push({
        stockId: s.id,
        stockName: s.name,
        dir: 'up',
        kind: 'position',
        lots,
        hiddenCount: Math.max(0, ups.length - maxPerStock),
        leadPct: ups[0].pct,
      });
    }

    // 下跌条目：从最近一笔买入开始逐笔往前看，只有「连续跌破阈值」的才提醒。
    // 一旦遇到一笔跌幅未达阈值的买单，说明近期已在这个价位附近补过仓，更早的下跌不再提示。
    const downs: typeof cand = [];
    for (const c of [...cand].sort((a, b) => b.date - a.date)) {
      if (c.pct <= -threshold) downs.push(c);
      else break;
    }
    if (downs.length > 0) {
      items.push({
        stockId: s.id,
        stockName: s.name,
        dir: 'down',
        kind: 'position',
        lots: downs.slice(0, maxPerStock).map(c => c.lot),
        hiddenCount: Math.max(0, downs.length - maxPerStock),
        leadPct: downs.reduce((min, c) => Math.min(min, c.pct), 0),
      });
    }

    // 挂单条目：同一只股票、同方向、同类型合并为一条，按「最接近成交 / 最先到期」取前 N 条
    const pushPending = (bucket: Array<{ lot: TickerLot }>, dir: 'up' | 'down', kind: TickerKind, target: TickerItem[]) => {
      if (bucket.length === 0) return;
      target.push({
        stockId: s.id,
        stockName: s.name,
        dir,
        kind,
        lots: bucket.slice(0, maxPerStock).map(x => x.lot),
        hiddenCount: Math.max(0, bucket.length - maxPerStock),
        leadPct: 0,
      });
    };
    nearSell.sort((a, b) => a.gap - b.gap);
    nearBuy.sort((a, b) => a.gap - b.gap);
    expSell.sort((a, b) => a.days - b.days);
    expBuy.sort((a, b) => a.days - b.days);
    pushPending(nearSell, 'up', 'nearFill', nearFillItems);
    pushPending(nearBuy, 'down', 'nearFill', nearFillItems);
    pushPending(expSell, 'up', 'expiring', expiringItems);
    pushPending(expBuy, 'down', 'expiring', expiringItems);
  }

  // 持仓播报按「最该处理的」排在前，随后是即将成交的挂单、即将过期的挂单
  const positions = items.sort((a, b) => {
    if (a.dir !== b.dir) return a.dir === 'up' ? -1 : 1;
    return a.dir === 'up' ? b.leadPct - a.leadPct : a.leadPct - b.leadPct;
  });
  return [...positions, ...nearFillItems, ...expiringItems];
}
