// 股票交易记录的云端同步纯函数（无副作用，便于单元测试）
// 机制：全量上传 + union-by-id 下载合并（软删 isDeleted 直接随记录携带，无墓碑）。
import type { StockEntry, StockTrade, StockSettings, BacktestStrategyPreset } from '../types';
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
  // 云端记录可能残留本设备的价格缓存字段（旧数据 / 其它设备的旧版本）。
  // 这些字段本就不该通过上传同步，因此下载合并时统一剔除：
  // 既避免旧残留再次进入本地，也避免用云端的过期价覆盖本设备的现价。
  const {
    price, changePercent, high, low, open, volume, priceUpdatedAt, dividendRate2025,
    ...restCloud
  } = cloudStock;
  return {
    stock: {
      ...(restCloud as StockEntry),
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

// ===== 云端"差异对比"指纹（纯函数，无副作用）=====
// 用于判断股息页本地是否有需要上传到云端的改动：把会上传到云端的字段
// （stocks / stockSettings / backtestStrategyPresets）序列化成稳定指纹，
// 与"最近一次成功上传/下载时的基线"比较，即可得到"是否有未同步改动"。
// 与 performStockCloudUpload 的上传规则保持一致：
//   - stocks 剔除价格缓存字段（现价/涨跌/高低量/更新时刻/价格派生股息率），避免价格刷新误报
//   - stockSettings 剔除设备特定字段（maxRows/maxWidth/sortMode/autoRefreshInterval），避免设备差异误报
//   - backtestStrategyPresets（策略组模板）整体纳入
export interface StockCloudFingerprintInput {
  stocks: StockEntry[];
  stockSettings?: StockSettings;
  backtestStrategyPresets?: BacktestStrategyPreset[];
}

export function buildStockCloudFingerprint(input: StockCloudFingerprintInput): string {
  const { stocks, stockSettings, backtestStrategyPresets = [] } = input;
  const cloudStockSettings = stockSettings
    ? { ...stockSettings, maxRows: undefined, maxWidth: undefined, sortMode: undefined, autoRefreshInterval: undefined }
    : undefined;
  return JSON.stringify({
    stocks: stripStockPriceCache(buildUploadStocks(stocks)),
    stockSettings: cloudStockSettings,
    backtestStrategyPresets,
  });
}

// 编辑备忘录后应写入的时间戳：
// 内容重新等于基线（删回下载/上传时的原文）→ 恢复基线时间戳，使指纹回到基线、不再被视为"有改动"；
// 否则 → 当前编辑时间 now。
export function resolveMemoUpdatedAt(
  newMemo: string,
  memoBaseline: string | undefined,
  memoUpdatedAtBaseline: number,
  now: number,
): number {
  return newMemo === memoBaseline ? memoUpdatedAtBaseline : now;
}

// 是否有未同步改动：基线为 null（尚未同步/首次使用）一律视为有改动，便于首次上传建备份
export function isStockCloudDirty(baseline: string | null, current: string): boolean {
  return baseline === null || baseline !== current;
}