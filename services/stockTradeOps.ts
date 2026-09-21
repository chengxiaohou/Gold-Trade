import type { StockEntry, StockTrade } from '../types';

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
    // 标记成交
    let realizedPnL: number | undefined;
    if (trade.side === 'buy') {
      shares = shares + trade.shares;
      cost = shares > 0 ? (cost * (shares - trade.shares) + trade.price * trade.shares) / shares : 0;
    } else {
      shares = Math.max(0, shares - trade.shares);
      realizedPnL = cost > 0 ? (trade.price - cost) * trade.shares : 0;
      if (shares === 0) cost = 0;
    }
    updatedTrade = { ...trade, status: 'filled', filledAt: now, realizedPnL };
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
    updatedTrade = { ...trade, status: 'pending', filledAt: undefined, realizedPnL: undefined };
  }

  return {
    stockTrades: trades.map(t => t.id === tradeId ? updatedTrade : t),
    positionShares: shares,
    positionCost: cost,
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
    positionCost: cost,
    changed: true,
  };
}