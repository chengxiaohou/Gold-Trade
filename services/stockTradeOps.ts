import type { StockEntry, StockTrade } from '../types';
import { roundCost } from './realizedPnl';

// 交易记录本地修改操作的结果补丁：新的交易列表与联动后的持仓字段。
// 纯函数——只计算"改了什么"，不负责写存储（持久化由调用方统一执行），便于单测锁定逻辑。
export interface StockTradePatch {
  stockTrades: StockTrade[];
  positionShares: number;
  positionCost: number;
  /** 是否真的发生了修改（记录存在且非合并汇总才为 true） */
  changed: boolean;
  /** 切换后的状态（仅 toggleTradeStatus 使用） */
  status?: 'pending' | 'filled';
}

// 挂单默认有效天数（自然日，首日计 1）
export const PENDING_TTL_DAYS = 5;

// 交易价相对现价的涨跌幅（SSOT）：列表「交易」列挂单/成交下方的百分比、滚动播报的挂单价差共用。
// 以交易价为基准：正数=现价高于该价格，负数=现价低于该价格（挂卖价在上方时为负，挂买价在下方时为正）。
export function tradePriceGapPct(tradePrice: number, curPrice: number): number | null {
  if (!(tradePrice > 0) || !(curPrice > 0)) return null;
  return ((curPrice - tradePrice) / tradePrice) * 100;
}

// 某价格对应的股息率（%，SSOT）：交易弹窗「股息率」行与滚动播报的股息率网格差距共用。
// 口径 = 年分红 ÷ 价格 × 100；分红或价格无效时返回 0（调用方按 0 判无效）。
export function dividendRateAtPrice(dividend: number, price: number): number {
  return dividend > 0 && price > 0 ? (dividend / price) * 100 : 0;
}

// 「股息率%｜与基准股息率之差%」文案（SSOT）：交易弹窗股息率行与滚动播报共用。
// 基准为 0（无有效基准）时只输出股息率本身；差值按百分点取两位，正数带 +。
export function formatDividendRatePair(rate: number, baseRate: number): string {
  if (!(rate > 0)) return '';
  const text = `${rate.toFixed(2)}%`;
  if (!(baseRate > 0)) return text;
  const diff = Math.round((rate - baseRate) * 100) / 100;
  return `${text}｜${diff > 0 ? '+' : ''}${diff.toFixed(2)}%`;
}

// 从起始日到 now 经过了第几个自然日（整天 24h 为一单位，跨零点即 +1）
export function pendingDayIndex(baseTime: number, now: number): number {
  const start = new Date(baseTime); start.setHours(0, 0, 0, 0);
  const end = new Date(now); end.setHours(0, 0, 0, 0);
  if (end.getTime() <= start.getTime()) return 1;
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

// 挂单是否仍在有效期内（过期、已成交、已删除、合并汇总行都不算）
export function isPendingTradeActive(t: StockTrade, now: number = Date.now()): boolean {
  if (t.status !== 'pending' || t.isDeleted || t.isMerged) return false;
  const ttl = t.ttlDays ?? PENDING_TTL_DAYS;
  return pendingDayIndex(t.ttlUpdatedAt ?? t.createdAt, now) < ttl + 1;
}

function tradeExists(trades: StockTrade[], tradeId: string): StockTrade | undefined {
  const trade = trades.find(t => t.id === tradeId);
  return trade && !trade.isMerged ? trade : undefined;
}

// 挂单 ⇄ 已成交 切换：买入加权成本，卖出按当前均价结算已实现盈亏。
// 取消成交（反选）时反向回退持仓并清除已实现盈亏与成交时间。
export function toggleTradeStatus(stock: StockEntry, tradeId: string, now: number = Date.now()): StockTradePatch {
  const trades = stock.stockTrades || [];
  const trade = tradeExists(trades, tradeId);
  if (!trade) return { stockTrades: trades, positionShares: stock.positionShares || 0, positionCost: stock.positionCost || 0, changed: false };

  let shares = stock.positionShares || 0;
  let cost = stock.positionCost || 0;
  let updatedTrade: StockTrade;

  if (trade.status === 'pending') {
    // 标记成交：买入加权成本，卖出回减持仓（已实现盈亏由界面按流水实时重算，不再落库）
    if (trade.side === 'buy') {
      shares = shares + trade.shares;
      cost = shares > 0 ? (cost * (shares - trade.shares) + trade.price * trade.shares) / shares : 0;
    } else {
      shares = Math.max(0, shares - trade.shares);
      if (shares === 0) cost = 0;
    }
    // 标记成交时把时间更改为成交这一刻（createdAt 是记录行展示的时间字段）
    // 但在覆盖 createdAt 之前，先保存原始创建时刻（首次 toggle 时存一次，后续取消/再成交不再更新）
    const prevOriginal = trade.originalCreatedAt ?? trade.createdAt;
    updatedTrade = { ...trade, status: 'filled', createdAt: now, filledAt: now, originalCreatedAt: prevOriginal };
  } else {
    // 取消成交（反选）：回退持仓
    if (trade.side === 'buy') {
      shares = Math.max(0, shares - trade.shares);
      if (shares > 0) cost = (cost * (shares + trade.shares) - trade.price * trade.shares) / shares;
      else cost = 0;
    } else {
      shares = shares + trade.shares;
      // 若此前卖出已清仓（cost 归零），此处成本无法精准恢复，保持当前值，可手动校正
    }
    updatedTrade = { ...trade, status: 'pending', filledAt: undefined };
  }

  return {
    stockTrades: trades.map(t => t.id === tradeId ? updatedTrade : t),
    positionShares: shares,
    positionCost: roundCost(cost),
    changed: true,
    status: updatedTrade.status,
  };
}

// 删除/撤销一条交易记录：挂单直接移除；已成交先回退持仓影响再移除。
export function removeTrade(stock: StockEntry, tradeId: string): StockTradePatch {
  const trades = stock.stockTrades || [];
  const trade = tradeExists(trades, tradeId);
  if (!trade) return { stockTrades: trades, positionShares: stock.positionShares || 0, positionCost: stock.positionCost || 0, changed: false };

  let shares = stock.positionShares || 0;
  let cost = stock.positionCost || 0;
  // 已成交记录删除：回退其持仓影响（与"取消成交"回退逻辑一致）
  if (trade.status === 'filled') {
    if (trade.side === 'buy') {
      shares = Math.max(0, shares - trade.shares);
      if (shares > 0) cost = (cost * (shares + trade.shares) - trade.price * trade.shares) / shares;
      else cost = 0;
    } else {
      shares = shares + trade.shares;
      // 若此前卖出已清仓导致成本归零，此处成本无法精准恢复，保持当前值
    }
  }

  return {
    stockTrades: trades.filter(t => t.id !== tradeId),
    positionShares: shares,
    positionCost: roundCost(cost),
    changed: true,
  };
}