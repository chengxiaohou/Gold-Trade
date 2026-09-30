import type { StockTrade } from '../types';
import type { StockLedgerMap } from './stockLedgerStore';

// 统一持仓计算结果：剩余持股数 + 移动加权成本
export interface PositionFromTrades {
  shares: number;
  avgCost: number;
}

// 盈利计算模式：均价（移动加权） / 做T（最近买入匹配）
export type PnlCalcMode = 'avg' | 'dt';

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
  err?: boolean;    // 仅做T模式：该笔卖出配不满买入（卖超），视为录入有误
  pairs?: DtPair[]; // 仅做T模式：该笔卖出匹配到的买入记录明细
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

// 做T口径的一条配对明细：某笔卖出占用了哪一笔买入的多少份额
export interface DtPair {
  buyId: string;   // 被匹配买入记录 id
  date: string;    // 买入日期 yyyy-MM-dd
  price: number;   // 买入单价
  shares: number;  // 该笔买入的原始总份额
  take: number;    // 本次卖出占用的份额
}

// 做T口径的整只股票计算结果
export interface DtPnlResult {
  map: Record<string, number>;      // 每笔卖出 id → 做T已实现盈亏（只计有买入匹配的部分）
  total: number;                     // 已实现盈亏合计
  pendingMap: Record<string, number>; // 卖出挂单 id → 做T口径预估盈亏（用同一匹配规则在"当前持仓"上预结算）
  pairMap: Record<string, DtPair[]>; // 卖出 id（含挂单）→ 与其配对的买入记录明细
  buyMatchMap: Record<string, { original: number; matched: number }>; // 买入 id → 原始份额 & 累计被卖出匹配份额（original === matched 表示该买入已完全对冲）
  positionShares: number;            // 剩余未匹配买入的持有股数
  positionCost: number;              // 剩余未匹配买入的加权均价（每股）
  errIds: Set<string>;               // 卖超（配不满买入）的卖出记录 id
}

// 做T匹配过程中的未匹配买入份额（可被后续卖出逐份占用）
interface DtLot {
  id: string;
  time: number;
  price: number;
  total: number;   // 该笔买入的原始总份额
  rest: number;    // 仍未被占用的剩余份额
}

// 从最近的未匹配买入开始倒序匹配一笔卖出，返回该卖出的做T已实现盈亏、逐笔配对明细，
// 并扣减已用买入。数量不足时只匹配能覆盖的部分（部分匹配），剩余股数仍配不满即视为卖超（err=true）。
function matchDtSell(lots: DtLot[], sellPrice: number, sellShares: number) {
  let remaining = sellShares, pnl = 0;
  const pairs: DtPair[] = [];
  while (remaining > 0 && lots.length > 0) {
    const lot = lots[lots.length - 1];
    const take = Math.min(remaining, lot.rest);
    pnl += (sellPrice - lot.price) * take;
    lot.rest -= take;
    remaining -= take;
    pairs.push({ buyId: lot.id, date: dateKeyOf(lot.time), price: lot.price, shares: lot.total, take });
    if (lot.rest <= 0) lots.pop();
  }
  return { pnl, pairs, err: remaining > 0 };
}

// 做T口径：按成交顺序把每笔卖出匹配到「最近的一笔未匹配买入」，计算做T已实现盈亏，
// 并得到剩余未匹配买入（即做T口径下的当前持仓）。与均价口径 differ：卖出成本取自所匹配买入价。
export function calcDtPnlForTrades(trades?: StockTrade[]): DtPnlResult {
  const result: DtPnlResult = { map: {}, total: 0, pendingMap: {}, pairMap: {}, buyMatchMap: {}, positionShares: 0, positionCost: 0, errIds: new Set() };
  if (!trades || trades.length === 0) return result;
  const all = trades
    .filter(t => !t.isDeleted)
    .sort((a, b) => effectiveTime(a) - effectiveTime(b));
  const lots: DtLot[] = [];
  for (const t of all) {
    const shares = t.shares ?? 0;
    if (t.side === 'buy') {
      if (t.status !== 'filled') continue; // 买入挂单尚未执行，不进持仓
      lots.push({ id: t.id, time: effectiveTime(t), price: t.price ?? 0, total: shares, rest: shares });
    } else if (t.status === 'filled') {
      const { pnl, pairs, err } = matchDtSell(lots, t.price ?? 0, shares);
      if (err) result.errIds.add(t.id);
      result.map[t.id] = pnl;
      result.pairMap[t.id] = pairs;
      result.total += pnl;
    }
  }
  // 汇总买入被匹配情况：原始份额来自未删除的买入成交记录（已不依赖 lots，因 lots 中 rest 已被消耗）
  for (const t of all) {
    if (t.side === 'buy' && t.status === 'filled') {
      result.buyMatchMap[t.id] = { original: t.shares ?? 0, matched: 0 };
    }
  }
  for (const pairs of Object.values(result.pairMap)) {
    for (const p of pairs) {
      const entry = result.buyMatchMap[p.buyId];
      if (entry) entry.matched += p.take;
    }
  }
  for (const lot of lots) {
    result.positionShares += lot.rest;
    result.positionCost += (lot.price ?? 0) * lot.rest;
  }
  result.positionCost = result.positionShares > 0 ? result.positionCost / result.positionShares : 0;
  // 卖出挂单：用做T同一「最近买入匹配」规则在"当前持仓"上预结算（深拷贝 lots，不真正扣减）。
  if (result.positionShares > 0) {
    for (const t of all) {
      if (t.side === 'sell' && t.status === 'pending' && !t.isDeleted) {
        const { pnl, pairs } = matchDtSell(lots.map(l => ({ ...l })), t.price ?? 0, t.shares ?? 0);
        result.pendingMap[t.id] = pnl;
        result.pairMap[t.id] = pairs;
      }
    }
  }
  return result;
}

const effectiveTime = (t: StockTrade) => t.filledAt ?? t.createdAt;

const dateKeyOf = (ts: number) => {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

// 统计某时间窗口 [startTs, endTs) 内的已实现盈亏：
// 1. 先按时间顺序扫描窗口前所有成交，建立各股票期初状态；
// 2. 再扫窗口内成交，卖出按 dateKey 归属并计算已实现盈亏，忽略软删与挂单。
// mode='avg'：移动加权成本结算（卖出按均价成本）；mode='dt'：做T匹配（卖出匹配最近买入）。
export function calcRealizedPnlForRange(
  ledger: StockLedgerMap,
  stockNames: Record<string, string>,
  startTs: number,
  endTs: number,
  mode: PnlCalcMode = 'avg',
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

    let realized = 0;
    let rs = 0;                                  // avg 模式：剩余持股
    let rc = 0;                                  // avg 模式：移动加权成本（每股）
    const lots: DtLot[] = [];                    // dt 模式：未匹配买入

    for (const t of trades) {
      const eff = effectiveTime(t);
      if (eff >= endTs) break;               // 窗口之后不再影响窗口内盈亏
      const amt = t.amount ?? t.price * t.shares;
      const shares = t.shares;
      if (t.side === 'buy') {
        lots.push({ id: t.id, time: eff, price: t.price, total: shares, rest: shares });
        const prevRs = rs;
        rs += shares;
        rc = rs > 0 ? (rc * prevRs + amt) / rs : 0;
        if (eff >= startTs) {
          addTx(dateKeyOf(eff), { stockId, stockName: name, price: t.price, shares, amount: amt, time: eff });
        }
        continue;
      }
      // 卖出
      let pnl: number;
      let err = false;
      let pairs: DtPair[] | undefined;
      if (mode === 'dt') {
        // 做T：卖出匹配最近的未匹配买入（含窗口前买入），只计有匹配的部分
        const r = matchDtSell(lots, t.price, shares);
        pnl = r.pnl;
        err = r.err;
        pairs = r.pairs;
      } else {
        // 均价：按移动加权成本结算
        pnl = rs > 0 ? amt - rc * shares : 0;
        rs = Math.max(0, rs - shares);
        if (rs === 0) rc = 0;
      }
      if (eff >= startTs) {
        realized += pnl;
        addTx(dateKeyOf(eff), { stockId, stockName: name, price: t.price, shares, amount: amt, time: eff, pnl, err: err || undefined, pairs });
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