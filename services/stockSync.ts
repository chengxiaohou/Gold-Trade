// 股票交易记录的云端同步纯函数（无副作用，便于单元测试）
// 机制：全量上传 + union-by-id 下载合并（软删 isDeleted 直接随记录携带，无墓碑）。
import type { StockEntry, StockTrade } from '../types';
import type { StockLedgerMap } from './stockLedgerStore';
import { calcPositionFromTrades } from './realizedPnl';

// 一次合并的结果：合并后的单只股票 + 更新后的流水账条目
export interface MergeStockResult {
  stock: StockEntry;
  ledgerEntry: { trades: StockTrade[] };
}

// 把云端某只股票的全量记录合并到本地流水账，并重算持仓。
// 规则：
//   - 以本地流水账 trades 为基底（union by id）
//   - 云端同 id 覆盖本地（编辑回传 + 软删 isDeleted 同步）
//   - 云端新增 id 并入；本地独有（云端没有）保留
//   - 软删 isDeleted 随记录一起被携带，不需要墓碑
export function mergeStockFromCloud(
  cloudStock: StockEntry,
  localTrades: StockTrade[] | undefined,
): MergeStockResult {
  const cloudTrades = cloudStock.stockTrades || [];
  const baseById = new Map<string, StockTrade>((localTrades || []).map(t => [t.id, t]));
  for (const ct of cloudTrades) baseById.set(ct.id, ct);
  const finalTrades = Array.from(baseById.values()).sort(
    (a, b) => (a.filledAt ?? a.createdAt) - (b.filledAt ?? b.createdAt)
  );
  const { shares, avgCost } = calcPositionFromTrades(finalTrades);
  return {
    stock: {
      ...cloudStock,
      stockTrades: finalTrades,
      positionShares: shares,
      positionCost: avgCost,
    },
    ledgerEntry: { trades: finalTrades },
  };
}

// 把整批云端股票合并到本地流水账（批量版），返回合并后的股票列表 + 新流水账。
export function mergeCloudStocks(
  cloudStocks: StockEntry[],
  localLedger: StockLedgerMap,
): { mergedStocks: StockEntry[]; newLedger: StockLedgerMap } {
  const newLedger: StockLedgerMap = { ...localLedger };
  const mergedStocks = cloudStocks.map(c => {
    const { stock, ledgerEntry } = mergeStockFromCloud(c, localLedger[c.id]?.trades);
    newLedger[c.id] = ledgerEntry;
    return stock;
  });
  return { mergedStocks, newLedger };
}

// 构造上传 payload 里的 stocks：全量携带（含软删），剔除本设备价格缓存字段。
export function buildUploadStocks(stocks: StockEntry[]): StockEntry[] {
  return stocks.map(stock => ({
    ...stock,
    stockTrades: stock.stockTrades || [],
  }));
}

// 剔除上传前的设备本地价格缓存字段（现价/涨跌/今开高低量/更新时刻/价格派生的股息率）
export function stripStockPriceCache(list: StockEntry[]): StockEntry[] {
  return list.map(
    ({ price, changePercent, high, low, open, volume, priceUpdatedAt, dividendRate2025, ...rest }) =>
      rest as StockEntry
  );
}