import type { StockTrade } from '../types';
import type { StockLedgerMap } from './stockLedgerStore';

// 统一的持仓计算结果：剩余持股数 + 移动加权成本
export interface PositionFromTrades {
  shares: number;
  avgCost: number;
}

// 从一组交易记录按「移动加权平均」重算持仓（忽略软删与挂单）。
// 任何时候本地/云端/持久化恢复后需要对齐 positionShares / positionCost，都应调用此函数，
// 避免交易记录已更新但字段未同步导致的"账面持仓与记录对不上"。
export function calcPositionFromTrades(trades?: StockTrade[]): PositionFromTrades {
  if (!trades || trades.length === 0) return { shares: 0, avgCost: 0 };
  const filled = trades
    .filter(t => t.status === 'filled' && !t.isDeleted)
    .sort((a, b) => (a.filledAt ?? a.createdAt) - (b.filledAt ?? b.createdAt));
  let rs = 0; // 剩余持股
  let rc = 0; // 移动加权成本
  for (const t of filled) {
    const amt = (t.amount ?? (t.price ?? 0) * (t.shares ?? 0)) || 0;
    if (t.side === 'buy') {
      const prevRs = rs;
      rs += t.shares ?? 0;
      rc = rs > 0 ? (rc * prevRs + amt) / rs : 0;
    } else {
      rs = Math.max(0, rs - (t.shares ?? 0));
      if (rs === 0) rc = 0;
    }
  }
  return { shares: rs, avgCost: rc };
}

// 一笔窗口内的买/卖操作（供逐日明细展示）
export interface PnlTx {
  stockId: string;
  stockName: string;
  price: number;
  shares: number;
  amount: number;   // 成交金额 = price × shares
  pnl?: number;     // 仅卖出：该笔已实现盈亏
  time: number;     // 有效时间（filledAt || createdAt）
}

// 某一天的买卖操作与当天已实现盈亏
export interface PnlDay {
  date: string;         // YYYY-MM-DD
  buys: PnlTx[];
  sells: PnlTx[];
  dayRealized: number;  // 当天卖出实现的盈亏合计
}

export interface RealizedPnlForRange {
  total: number;                            // 窗口内全部已实现盈亏
  byStock: Record<string, number>;          // 各股票已实现盈亏
  byDay: PnlDay[];                          // 逐日明细（按日期升序）
}

const effectiveTime = (t: StockTrade) => t.filledAt ?? t.createdAt;

const dateKeyOf = (ts: number) => {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

// 统计某时间窗口 [startTs, endTs) 内的已实现盈亏：
// 1. 先按时间顺序扫描窗口前所有成交，建立各股票期初持仓（移动加权成本）；
// 2. 再扫窗口内成交，卖出按 dateKey 归属，realized = 卖出金额 - 持仓成本 × 股数。
// 忽略软删（isDeleted）与挂单（非 filled）记录。
export function calcRealizedPnlForRange(
  ledger: StockLedgerMap,
  stockNames: Record<string, string>,
  startTs: number,
  endTs: number,
): RealizedPnlForRange {
  const byStock: Record<string, number> = {};
  const dayMap = new Map<string, PnlDay>();

  const addTx = (date: string, tx: PnlTx) => {
    let day = dayMap.get(date);
    if (!day) {
      day = { date, buys: [], sells: [], dayRealized: 0 };
      dayMap.set(date, day);
    }
    if (tx.pnl !== undefined) day.sells.push(tx);
    else day.buys.push(tx);
    if (tx.pnl !== undefined) day.dayRealized += tx.pnl;
  };

  for (const [stockId, entry] of Object.entries(ledger)) {
    if (!entry || !entry.trades) continue;
    const name = stockNames[stockId] ?? stockId;
    const trades = entry.trades
      .filter(t => t.status === 'filled' && !t.isDeleted)
      .sort((a, b) => effectiveTime(a) - effectiveTime(b));

    let rs = 0;   // 剩余持股
    let rc = 0;   // 移动加权成本（每股）
    let realized = 0;

    for (const t of trades) {
      const eff = effectiveTime(t);
      if (eff >= endTs) break;               // 窗口之后不再影响窗口内盈亏
      const amt = t.amount ?? t.price * t.shares;
      if (eff < startTs) {
        // 窗口前的成交：仅用于建立期初持仓
        if (t.side === 'buy') {
          const prevRs = rs;
          rs += t.shares;
          rc = rs > 0 ? (rc * prevRs + amt) / rs : 0;
        } else {
          rs = Math.max(0, rs - t.shares);
          if (rs === 0) rc = 0;
        }
        continue;
      }
      // 窗口内成交
      if (t.side === 'buy') {
        const prevRs = rs;
        rs += t.shares;
        rc = rs > 0 ? (rc * prevRs + amt) / rs : 0;
        addTx(dateKeyOf(eff), { stockId, stockName: name, price: t.price, shares: t.shares, amount: amt, time: eff });
      } else {
        const pnl = rs > 0 ? amt - rc * t.shares : 0;
        realized += pnl;
        rs = Math.max(0, rs - t.shares);
        if (rs === 0) rc = 0;
        addTx(dateKeyOf(eff), { stockId, stockName: name, price: t.price, shares: t.shares, amount: amt, time: eff, pnl });
      }
    }

    if (realized !== 0) byStock[stockId] = (byStock[stockId] || 0) + realized;
  }

  const byDay = Array.from(dayMap.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
  return { total: byStockTotal(byStock), byStock, byDay };
}

function byStockTotal(byStock: Record<string, number>): number {
  return Object.values(byStock).reduce((s, v) => s + v, 0);
}