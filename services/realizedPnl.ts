import type { StockTrade } from '../types';
import type { StockLedgerMap } from './stockLedgerStore';

// 判断一只股票是否为 ETF/基金（项目中多处复用此规则，集中到一处）
export const isEtf = (name?: string): boolean =>
  !!name && (name.includes('ETF') || name.includes('etf'));

// 单笔交易的税费计算结果
export interface TradeFees {
  commission: number;  // 佣金（固定 5 元，双边）
  otherFees: number;   // 其他费用（股票双边 0.05 元，ETF 无）
  stampDuty: number;   // 印花税（仅股票卖出：成交金额 × 0.05%）
  total: number;       // 三项合计
}

// 计算单笔买卖的税费。ETF 仅 5 元佣金双边；股票额外双边 0.05 其他费，卖出加收 0.05% 印花税。
// 税费基（尤其印花税）统一用 trade.amount ?? price × shares，避免合并记录误差。
export function calcTradeFees(trade: StockTrade, stockName?: string): TradeFees {
  const etf = isEtf(stockName);
  const commission = 5;
  const otherFees = etf ? 0 : 0.05;
  const grossAmount = (trade.amount ?? ((trade.price ?? 0) * (trade.shares ?? 0))) || 0;
  const stampDuty = (!etf && trade.side === 'sell') ? grossAmount * 0.0005 : 0;
  const total = commission + otherFees + stampDuty;
  return { commission, otherFees, stampDuty, total };
}

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
  amount: number;        // 成交金额（withTax 时为含税费的净金额：买入加税费、卖出扣税费）
  grossAmount?: number;  // 原始成交金额 price × shares（不含税费；FeeTip 算印花税基数需要）
  pnl?: number;          // 仅卖出：该笔已实现盈亏
  err?: boolean;         // 仅做T模式：该笔卖出配不满买入（卖超），视为录入有误
  errShares?: number;    // err=true 时：匹配失败的缺口股数（超出此前可用买入的部分）
  pairs?: DtPair[];      // 仅做T模式：该笔卖出匹配到的买入记录明细
  time: number;          // 有效时间（filledAt || createdAt）
  fees?: TradeFees;      // 仅 withTax=true 时：该笔交易的税费明细
}

// 某一天的买卖操作与当天已实现盈亏
export interface PnlDay {
  date: string;         // YYYY-MM-DD
  buys: PnlTx[];
  sells: PnlTx[];
  dayRealized: number;  // 当天卖出实现的盈亏合计
  dayFees?: number;     // 仅 withTax=true 时：当天税费合计
}

export interface RealizedPnlForRange {
  total: number;                            // 窗口内全部已实现盈亏
  byStock: Record<string, number>;          // 各股票已实现盈亏
  byDay: PnlDay[];                          // 逐日明细（按日期升序）
  totalFees?: number;                       // 仅 withTax=true 时：窗口内税费合计
  errStockIds?: Set<string>;                // 窗口内存在卖超（err=true）卖出的股票 id 集合
}

// 做T口径的一条配对明细：某笔卖出占用了哪一笔买入的多少份额
export interface DtPair {
  buyId: string;   // 被匹配买入记录 id
  date: string;    // 买入日期 yyyy-MM-dd
  price: number;   // 买入单价
  shares: number;  // 该笔买入的原始总份额
  take: number;    // 本次卖出占用的份额
  diffPct: number; // 本次做T的差价百分比：(卖出价 − 买入价) / 买入价 × 100
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

// 均价口径的计算结果（与 DtPnlResult 对称，逐笔盈亏 + 挂单预估 + 当前持仓）
export interface AvgPnlResult {
  map: Record<string, number>;       // 每笔卖出已实现盈亏（成交）
  pendingMap: Record<string, number>; // 每笔卖出挂单预估盈亏
  total: number;                       // 累计已实现盈亏
  positionShares: number;              // 当前剩余持仓（均价口径）
  positionCost: number;                // 当前持仓加权均价（每股）
  errIds: Set<string>;                 // 无持仓时卖出（卖超）的记录 id
}

// 均价口径：按成交顺序累加买入、卖出按当时移动加权成本结算已实现盈亏，
// 与做T口径 calcDtPnlForTrades 结构完全对称（返回 map/total/pendingMap/positionShares/positionCost/errIds）。
// 与 StockDividendPage 历史记录里的本地 calcRealizedPnlMap 等价但补齐了 position 字段，
// 时间排序用 effectiveTime（filledAt ?? createdAt），与做T口径/盈利统计窗口口径统一。
// 税费：withTax=true 时，买入税费拉高成本基，卖出税费降低实收。
export function calcAvgPnlForTrades(trades?: StockTrade[], withTax = false, stockName?: string): AvgPnlResult {
  const result: AvgPnlResult = { map: {}, total: 0, pendingMap: {}, positionShares: 0, positionCost: 0, errIds: new Set() };
  if (!trades || trades.length === 0) return result;
  const all = trades
    .filter(t => !t.isDeleted)
    .sort((a, b) => effectiveTime(a) - effectiveTime(b));
  let rs = 0, rc = 0; // 剩余持股、移动加权成本
  for (const t of all) {
    const shares = t.shares ?? 0;
    let amt = (t.amount ?? ((t.price ?? 0) * shares)) || 0;
    if (withTax) {
      const fees = calcTradeFees(t, stockName);
      if (t.side === 'buy') amt += fees.total;       // 买入税费加进成本基
      else amt -= fees.total;                         // 卖出税费从实收里扣
    }
    if (t.side === 'buy') {
      if (t.status !== 'filled') continue; // 买入挂单尚未执行，不占持仓
      const prevRs = rs;
      rs += shares;
      rc = rs > 0 ? (rc * prevRs + amt) / rs : 0;
    } else {
      if (rs <= 0) {
        if (t.status === 'filled') result.errIds.add(t.id);
        continue; // 无持仓时不估算（成交或挂单都一样）
      }
      const pnl = amt - rc * shares;
      if (t.status === 'filled') {
        result.map[t.id] = pnl;
        result.total += pnl;
        const take = Math.min(rs, shares);
        rs -= take;
        if (rs === 0) rc = 0;
      } else {
        // 卖出挂单：同一公式、同一实时成本预结算，仅入预估表（灰色），不扣减真实持仓
        result.pendingMap[t.id] = pnl;
      }
    }
  }
  result.positionShares = rs;
  result.positionCost = rc;
  return result;
}

// 整只股票的「投入 → 现状」摘要（回测页初始态用）：
// 一次扫描同时输出均价口径和做T口径两套 realized/unrealized，外加累计买入/卖出金额、
// 期末市值、总收益率（收益率口径一致：(期末市值 − 累计买入) / 累计买入）。
// SSOT：内部直接调 calcAvgPnlForTrades + calcDtPnlForTrades，以后改匹配逻辑只改 service 一处。
export interface TradeStats {
  buyAmt: number;              // 累计买入金额
  sellAmt: number;             // 累计卖出金额
  tradeCount: number;          // 已成交记录数
  realizedAvg: number;         // 均价口径 已实现盈亏
  unrealizedAvg: number;       // 均价口径 浮动盈亏（剩余持仓 × (现价 − 当前均价)）
  realizedDt: number;          // 做T口径 已实现盈亏
  unrealizedDt: number;        // 做T口径 浮动盈亏
  finalValue: number;          // 期末市值 = 卖出总额 + 剩余持仓 × 现价
  totalReturnPct: number;      // 总收益率（%）
}
export function calcTradeStats(trades: StockTrade[], curPrice: number): TradeStats {
  const filled = trades.filter(t => t.status === 'filled' && !t.isDeleted);
  let buyAmt = 0, sellAmt = 0;
  for (const t of filled) {
    const amt = (t.amount ?? ((t.price ?? 0) * (t.shares ?? 0))) || 0;
    if (t.side === 'buy') buyAmt += amt; else sellAmt += amt;
  }
  const avg = calcAvgPnlForTrades(trades);
  const dt = calcDtPnlForTrades(trades);
  const unrealizedAvg = avg.positionShares * (curPrice - avg.positionCost);
  const unrealizedDt = dt.positionShares * (curPrice - dt.positionCost);
  const finalValue = sellAmt + avg.positionShares * curPrice; // 期末市值口径与均价持仓一致
  const totalReturnPct = buyAmt > 0 ? (finalValue - buyAmt) / buyAmt * 100 : 0;
  return {
    buyAmt, sellAmt, tradeCount: filled.length,
    realizedAvg: avg.total, unrealizedAvg,
    realizedDt: dt.total, unrealizedDt,
    finalValue, totalReturnPct,
  };
}

// 做T匹配过程中的未匹配买入份额（可被后续卖出逐份占用）
interface DtLot {
  id: string;
  time: number;       // 成交/生效时间（filledAt ?? createdAt，用于排序与配对顺序）
  originalCreatedAt: number; // 买入记录的原始创建时间（不受 toggleTradeStatus 覆盖），用于 PairTip 展示真实买入日期
  price: number;
  total: number;   // 该笔买入的原始总份额
  rest: number;    // 仍未被占用的剩余份额
}

// 从最近的未匹配买入开始倒序匹配一笔卖出，返回该卖出的做T已实现盈亏、逐笔配对明细，
// 并扣减已用买入。数量不足时只匹配能覆盖的部分（部分匹配），剩余股数仍配不满即视为卖超（err=true）。
function matchDtSell(lots: DtLot[], sellPrice: number, sellShares: number, sellFeesTotal = 0) {
  let remaining = sellShares, pnl = -sellFeesTotal; // 卖出税费直接从盈亏里扣
  const pairs: DtPair[] = [];
  while (remaining > 0 && lots.length > 0) {
    const lot = lots[lots.length - 1];
    const take = Math.min(remaining, lot.rest);
    pnl += (sellPrice - lot.price) * take;
    lot.rest -= take;
    remaining -= take;
    // 差价百分比同源出自「卖出价 − 买入价」，基准为买入价：与本笔配对的盈亏口径一致（盈亏 = 差价 × take）
    const diffPct = lot.price > 0 ? (sellPrice - lot.price) / lot.price * 100 : 0;
    pairs.push({ buyId: lot.id, date: dateKeyOf(lot.originalCreatedAt), price: lot.price, shares: lot.total, take, diffPct });
    if (lot.rest <= 0) lots.pop();
  }
  return { pnl, pairs, err: remaining > 0 };
}

// 做T口径：按成交顺序把每笔卖出匹配到「最近的一笔未匹配买入」，计算做T已实现盈亏，
// 并得到剩余未匹配买入（即做T口径下的当前持仓）。与均价口径 differ：卖出成本取自所匹配买入价。
// 税费：withTax=true 时，买入税费加进 lot 成本，卖出税费从 pnl 里扣。
export function calcDtPnlForTrades(trades?: StockTrade[], withTax = false, stockName?: string): DtPnlResult {
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
      let buyPrice = t.price ?? 0;
      if (withTax) {
        const fees = calcTradeFees(t, stockName);
        buyPrice += fees.total / shares; // 买入税费摊到每股成本
      }
      lots.push({ id: t.id, time: effectiveTime(t), originalCreatedAt: t.originalCreatedAt ?? t.createdAt, price: buyPrice, total: shares, rest: shares });
    } else if (t.status === 'filled') {
      const sellFeesTotal = withTax ? calcTradeFees(t, stockName).total : 0;
      const { pnl, pairs, err } = matchDtSell(lots, t.price ?? 0, shares, sellFeesTotal);
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
        const sellFeesTotal = withTax ? calcTradeFees(t, stockName).total : 0;
        const { pnl, pairs } = matchDtSell(lots.map(l => ({ ...l })), t.price ?? 0, t.shares ?? 0, sellFeesTotal);
        result.pendingMap[t.id] = pnl;
        result.pairMap[t.id] = pairs;
      }
    }
  }
  return result;
}

// 未落库的卖出挂单（下单预览）收益预估：与已落库的挂卖记录完全同口径——
// 直接复用 calcDtPnlForTrades / calcAvgPnlForTrades，把「这笔假设挂单」并入现有交易后取 pendingMap / pairMap 结果。
// SSOT：不另写近似算法，口径变更只需改上面两个共享函数一处；无持仓或参数不合法时返回 null（不展示）。
export interface PendingSellEstimate {
  pnl: number;     // 预估收益（与「挂卖」记录同一口径，含税费开关）
  pairs: DtPair[]; // 做T口径的配对明细（均价口径无配对概念，为空数组）
}

export function estimatePendingSell(
  trades: StockTrade[] | undefined,
  order: { price: number; shares: number },
  mode: PnlCalcMode = 'avg',
  withTax = false,
  stockName?: string,
): PendingSellEstimate | null {
  if (!trades || trades.length === 0 || !(order.price > 0) || !(order.shares > 0)) return null;
  const id = '__order_preview__';
  // createdAt 取当前时刻：保证这笔假设挂单排在全部历史交易之后，与「新下单」的顺序一致
  const preview: StockTrade = { id, side: 'sell', price: order.price, shares: order.shares, status: 'pending', createdAt: Date.now() };
  if (mode === 'dt') {
    const result = calcDtPnlForTrades([...trades, preview], withTax, stockName);
    const pnl = result.pendingMap[id];
    return pnl === undefined ? null : { pnl, pairs: result.pairMap[id] ?? [] };
  }
  const result = calcAvgPnlForTrades([...trades, preview], withTax, stockName);
  const pnl = result.pendingMap[id];
  return pnl === undefined ? null : { pnl, pairs: [] };
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
// withTax=true：买入税费拉高成本基，卖出税费扣减实收。
export function calcRealizedPnlForRange(
  ledger: StockLedgerMap,
  stockNames: Record<string, string>,
  startTs: number,
  endTs: number,
  mode: PnlCalcMode = 'avg',
  withTax = false,
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
    if (withTax && tx.fees) {
      day.dayFees = (day.dayFees ?? 0) + tx.fees.total;
    }
  };

  let totalFees = 0;
  const errStockIds = new Set<string>();

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
      const shares = t.shares;
      const grossAmt = t.amount ?? t.price * t.shares; // 原始成交金额（price × shares 或合并记录的 amount）
      let amt = grossAmt;
      if (t.side === 'buy') {
        const buyFees = withTax ? calcTradeFees(t, name) : undefined;
        if (withTax) amt += buyFees!.total;
        let buyPrice = t.price;
        if (withTax) buyPrice += buyFees!.total / shares;
        lots.push({ id: t.id, time: eff, originalCreatedAt: t.originalCreatedAt ?? t.createdAt, price: buyPrice, total: shares, rest: shares });
        const prevRs = rs;
        rs += shares;
        rc = rs > 0 ? (rc * prevRs + amt) / rs : 0;
        if (eff >= startTs) {
          if (withTax) totalFees += buyFees!.total;
          addTx(dateKeyOf(eff), { stockId, stockName: name, price: t.price, shares, amount: amt, grossAmount: grossAmt, time: eff, fees: buyFees });
        }
        continue;
      }
      // 卖出
      let pnl: number;
      let err = false;
      let errShares = 0;
      let pairs: DtPair[] | undefined;
      const sellFees = withTax ? calcTradeFees(t, name) : undefined;
      const sellFeesTotal = sellFees?.total ?? 0;
      if (withTax) amt -= sellFeesTotal;
      if (mode === 'dt') {
        // 做T：卖出匹配最近的未匹配买入（含窗口前买入），只计有匹配的部分
        const r = matchDtSell(lots, t.price, shares, sellFeesTotal);
        pnl = r.pnl;
        err = r.err;
        errShares = r.err ? (t.shares ?? 0) - r.pairs.reduce((s, p) => s + p.take, 0) : 0;
        pairs = r.pairs;
      } else {
        // 均价：按移动加权成本结算
        pnl = rs > 0 ? amt - rc * shares : 0;
        if (rs <= 0) { err = true; errShares = shares; }
        else if (rs < shares) { err = true; errShares = shares - rs; }
        rs = Math.max(0, rs - shares);
        if (rs === 0) rc = 0;
      }
      if (eff >= startTs) {
        realized += pnl;
        if (withTax) totalFees += sellFeesTotal;
        if (err) errStockIds.add(stockId);
        addTx(dateKeyOf(eff), { stockId, stockName: name, price: t.price, shares, amount: amt, grossAmount: grossAmt, time: eff, pnl, err: err || undefined, errShares: errShares || undefined, pairs, fees: sellFees });
      }
    }

    if (realized !== 0) byStock[stockId] = (byStock[stockId] || 0) + realized;
  }

  const byDay = Array.from(dayMap.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
  const result: RealizedPnlForRange = { total: byStockTotal(byStock), byStock, byDay };
  if (withTax) result.totalFees = totalFees;
  result.errStockIds = errStockIds;
  return result;
}

function byStockTotal(byStock: Record<string, number>): number {
  return Object.values(byStock).reduce((s, v) => s + v, 0);
}