// 股票交易记录的云端同步纯函数（无副作用，便于单元测试）
// 机制：全量上传 + 覆盖式下载合并（下载以云端为准；云端没有而本地独有的股票条目剔除，
// 从而实现跨设备删除传播；软删 isDeleted 只用于交易记录粒度，直接随记录携带）。
import type { StockEntry, StockTrade, StockSettings, BacktestStrategyPreset } from '../types';
import type { StockLedgerMap } from './stockLedgerStore';
import { calcPositionFromTrades } from './realizedPnl';

// 一次合并的结果：合并后的单只股票 + 更新后的流水账条目
export interface MergeStockResult {
  stock: StockEntry;
  ledgerEntry: { trades: StockTrade[] };
}

// 价格类是设备本地缓存：上传不上、下载不覆盖。合并下载时用本地股票保留其价格字段，
// 云端记录（即使残留了价格）不参与覆盖本地现价。
function pickLocalPrice(localStock: StockEntry | undefined): Pick<
  StockEntry,
  'price' | 'changePercent' | 'high' | 'low' | 'open' | 'volume' | 'priceUpdatedAt' | 'dividendRate2025'
> {
  if (!localStock) return {} as never;
  return {
    price: localStock.price,
    changePercent: localStock.changePercent,
    high: localStock.high,
    low: localStock.low,
    open: localStock.open,
    volume: localStock.volume,
    priceUpdatedAt: localStock.priceUpdatedAt,
    dividendRate2025: localStock.dividendRate2025,
  };
}

// 把云端某只股票的全量记录合并到本地流水账，并重算持仓。
// 规则：
//   - 以本地流水账 trades 为基底（union by id）
//   - 云端同 id 覆盖本地（编辑回传 + 软删 isDeleted 同步）
//   - 云端新增 id 并入；本地独有（云端没有）保留
//   - 软删 isDeleted 随记录一起被携带，不需要墓碑
//   - 价格类字段（现价/涨跌/高低量/更新时刻/价格派生股息率）是设备本地缓存：
//     下载时一律保留本地值，不用云端残留覆盖
export function mergeStockFromCloud(
  cloudStock: StockEntry,
  localTrades: StockTrade[] | undefined,
  localStock?: StockEntry | undefined,
): MergeStockResult {
  const cloudTrades = cloudStock.stockTrades || [];
  const baseById = new Map<string, StockTrade>((localTrades || []).map(t => [t.id, t]));
  for (const ct of cloudTrades) baseById.set(ct.id, ct);
  const finalTrades = Array.from(baseById.values()).sort(
    (a, b) => (a.filledAt ?? a.createdAt) - (b.filledAt ?? b.createdAt)
  );
  const { shares, avgCost } = calcPositionFromTrades(finalTrades);
  // 忽略云端的价格类字段（价格不同步；即便有残留也不进本地）
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
      // 本地价格缓存优先保留（云端不含价）
      ...pickLocalPrice(localStock),
    },
    ledgerEntry: { trades: finalTrades },
  };
}

// 把整批云端股票合并到本地流水账（批量版，覆盖模式），返回合并后的股票列表 + 新流水账。
// 语义：下载以云端为准直接覆盖本地股票条目：
//   - 云端有的股票：按 id 合并（union 流水账、云端覆盖本地非价格字段、保留本地价格缓存）
//   - 本地有而云端没有的股票条目：从股票列表与流水账中一并剔除（实现跨设备删除传播）
// localStocks 仅用于在下载时保留云端命中的本地价格缓存字段。
export function mergeCloudStocks(
  cloudStocks: StockEntry[],
  localLedger: StockLedgerMap,
  localStocks: StockEntry[],
): { mergedStocks: StockEntry[]; newLedger: StockLedgerMap } {
  const newLedger: StockLedgerMap = { ...localLedger };
  const mergedStocks = cloudStocks.map(c => {
    const localStock = localStocks.find(s => s.id === c.id);
    const { stock, ledgerEntry } = mergeStockFromCloud(c, localLedger[c.id]?.trades, localStock);
    newLedger[c.id] = ledgerEntry;
    return stock;
  });
  // 覆盖模式：云端没有、本地独有的股票条目 → 从流水账中一并剔除，
  // 避免下载后启动回填从流水账读到旧条目把已覆盖删除的股票"复活"。
  const cloudIds = new Set(cloudStocks.map(c => c.id));
  for (const id of Object.keys(newLedger)) {
    if (!cloudIds.has(id)) delete newLedger[id];
  }
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
//   - appSettings（黄金/股息两页全局设置，含总资金 totalCapital / dividendTotalCapital，上传时整包推送）
export interface StockCloudFingerprintInput {
  stocks: StockEntry[];
  stockSettings?: StockSettings;
  backtestStrategyPresets?: BacktestStrategyPreset[];
  appSettings?: Record<string, unknown>;
}

export function buildStockCloudFingerprint(input: StockCloudFingerprintInput): string {
  const { stocks, stockSettings, backtestStrategyPresets = [], appSettings } = input;
  const cloudStockSettings = stockSettings
    ? { ...stockSettings, maxRows: undefined, maxWidth: undefined, sortMode: undefined, autoRefreshInterval: undefined }
    : undefined;
  return JSON.stringify({
    stocks: stripStockPriceCache(buildUploadStocks(stocks)),
    stockSettings: cloudStockSettings,
    backtestStrategyPresets,
    appSettings,
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

// ===== 上传前"具体差异"对比（纯函数）=====
// 输入：基线指纹（上次成功上传/下载时写入的 buildStockCloudFingerprint 结果，本身即一份完整快照 JSON）
//      与当前指纹。输出：人类可读的差异条目；基线缺失/无法解析时返回 null（首次上传，无可对比的历史备份）。
export type CloudDiffKind = 'add' | 'remove' | 'change';
export interface CloudDiffItem {
  kind: CloudDiffKind;
  text: string;
}

// 空值统一（'' / null / undefined 视为同一语义），避免"空 → 空"这类误报
function norm(v: unknown): unknown {
  return v === undefined || v === null || v === '' ? null : v;
}

// 递归按键排序后序列化：避免对象 key 顺序不同导致误报差异
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort()
      .map(k => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null) ?? 'null';
}

function sameValue(a: unknown, b: unknown): boolean {
  return stableStringify(norm(a)) === stableStringify(norm(b));
}

// 差异行里展示的字段值（空值显示为"空"）
function displayValue(v: unknown): string {
  if (v === undefined || v === null || v === '') return '空';
  if (typeof v === 'boolean') return v ? '开' : '关';
  return String(v);
}

interface CloudSnapshot {
  stocks?: StockEntry[];
  stockSettings?: Record<string, unknown>;
  backtestStrategyPresets?: BacktestStrategyPreset[];
  appSettings?: Record<string, unknown>;
}

function parseCloudSnapshot(raw: string | null): CloudSnapshot | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? (o as CloudSnapshot) : null;
  } catch {
    return null;
  }
}

// 股票标量字段（展示为 旧 → 新）
const STOCK_SCALAR_FIELDS: Array<[string, string]> = [
  ['name', '名称'],
  ['nickname', '代号'],
  ['positionShares', '持仓股数'],
  ['positionCost', '持仓成本'],
  ['dividend2024', '2024分红'],
  ['dividend2025', '2025分红'],
  ['registerDate', '登记日'],
  ['link', '链接'],
  ['tag', '标签'],
  ['selectedDividendYear', '选中分红年'],
  ['bollHidden', '隐藏BOLL'],
];
// 结构较复杂、只提示"已更新"的字段
const STOCK_OBJECT_FIELDS: Array<[string, string]> = [
  ['dividendByYear', '历年分红'],
  ['dividendRates', '股息率档位'],
];

const STOCK_SETTINGS_LABELS: Record<string, string> = {
  visibleColumns: '可见列',
  dividendRateColumns: '股息率档位列',
  dividendRateColorRanges: '股息率配色',
  tagColors: '标签颜色',
  tagParams: '标签参数',
  customTags: '自定义标签',
  buyOrderPlaceholder: '买入占位文字',
  sellOrderPlaceholder: '卖出占位文字',
};

const APP_SETTINGS_LABELS: Record<string, string> = {
  priceStep: '价格步进',
  gramsStep: '克数步进',
  tagColors: '标签颜色',
  touchMode: '触控模式',
  priceDisplayMode: '价格显示',
  totalCapital: '黄金页总资金',
  dividendTotalCapital: '分红页总资金',
  visibleColumns: '可见列',
  buyTaxFee: '买入税费',
  sellTaxFee: '卖出税费',
  apiSource: '行情源',
  cacheTTLMinutes: '行情缓存时长',
  bollCacheTTLMinutes: 'BOLL缓存时长',
  dividendYearLeft: '左分红年份',
  dividendYearRight: '右分红年份',
  manualFxRate: '手动汇率',
};

function stockLabel(s: StockEntry): string {
  const name = s.nickname || s.name || s.code;
  return s.code && name !== s.code ? `${name}(${s.code})` : name;
}

function diffStocks(base: StockEntry[], cur: StockEntry[]): CloudDiffItem[] {
  const out: CloudDiffItem[] = [];
  const bMap = new Map(base.map(s => [s.id, s]));
  const cMap = new Map(cur.map(s => [s.id, s]));

  for (const s of cur) if (!bMap.has(s.id)) out.push({ kind: 'add', text: `新增股票「${stockLabel(s)}」` });
  for (const s of base) if (!cMap.has(s.id)) out.push({ kind: 'remove', text: `删除股票「${stockLabel(s)}」` });

  for (const [id, b] of bMap) {
    const c = cMap.get(id);
    if (!c) continue;
    const label = `「${stockLabel(b)}」`;

    // 交易记录：按 id 统计 增/删/改
    const bt = new Map((b.stockTrades || []).map(t => [t.id, t]));
    const ct = new Map((c.stockTrades || []).map(t => [t.id, t]));
    let added = 0, removed = 0, changed = 0;
    for (const [tid, t] of ct) {
      const o = bt.get(tid);
      if (!o) added++;
      else if (!sameValue(o, t)) changed++;
    }
    for (const tid of bt.keys()) if (!ct.has(tid)) removed++;
    if (added) out.push({ kind: 'add', text: `${label}新增 ${added} 笔交易记录` });
    if (removed) out.push({ kind: 'remove', text: `${label}删除 ${removed} 笔交易记录` });
    if (changed) out.push({ kind: 'change', text: `${label}修改 ${changed} 笔交易记录` });

    for (const [key, name] of STOCK_SCALAR_FIELDS) {
      const bv = (b as unknown as Record<string, unknown>)[key];
      const cv = (c as unknown as Record<string, unknown>)[key];
      if (!sameValue(bv, cv)) out.push({ kind: 'change', text: `${label}${name} ${displayValue(bv)} → ${displayValue(cv)}` });
    }
    for (const [key, name] of STOCK_OBJECT_FIELDS) {
      if (!sameValue((b as unknown as Record<string, unknown>)[key], (c as unknown as Record<string, unknown>)[key])) {
        out.push({ kind: 'change', text: `${label}${name}已更新` });
      }
    }
  }
  return out;
}

function diffSettings(
  base: Record<string, unknown> | undefined,
  cur: Record<string, unknown> | undefined,
  labels: Record<string, string>,
): CloudDiffItem[] {
  const out: CloudDiffItem[] = [];
  const keys = new Set([...Object.keys(base || {}), ...Object.keys(cur || {})]);
  for (const key of keys) {
    const bv = (base || {})[key];
    const cv = (cur || {})[key];
    if (!sameValue(bv, cv)) {
      out.push({ kind: 'change', text: `设置「${labels[key] || key}」${displayValue(bv)} → ${displayValue(cv)}` });
    }
  }
  return out;
}

function diffPresets(base: BacktestStrategyPreset[], cur: BacktestStrategyPreset[]): CloudDiffItem[] {
  const out: CloudDiffItem[] = [];
  const bMap = new Map(base.map(p => [p.id, p]));
  const cMap = new Map(cur.map(p => [p.id, p]));
  for (const p of cur) if (!bMap.has(p.id)) out.push({ kind: 'add', text: `新增策略组「${p.name}」` });
  for (const p of base) if (!cMap.has(p.id)) out.push({ kind: 'remove', text: `删除策略组「${p.name}」` });
  for (const [id, b] of bMap) {
    const c = cMap.get(id);
    if (!c || sameValue(b, c)) continue;
    if (b.name !== c.name) out.push({ kind: 'change', text: `策略组「${b.name}」改名为「${c.name}」` });
    else out.push({ kind: 'change', text: `策略组「${b.name}」已修改` });
  }
  return out;
}

export function diffStockCloudSnapshots(baseline: string | null, current: string): CloudDiffItem[] | null {
  const b = parseCloudSnapshot(baseline);
  if (b === null) return null; // 无基线：首次上传，无可对比的历史备份
  const c: CloudSnapshot = parseCloudSnapshot(current) || {};

  const items: CloudDiffItem[] = [
    ...diffStocks(b.stocks || [], c.stocks || []),
  ];

  // 备忘录单独提示（memoUpdatedAt 属噪声，不展示）
  if (!sameValue((b.stockSettings || {}).memo, (c.stockSettings || {}).memo)) {
    items.push({ kind: 'change', text: '备忘录内容已修改' });
  }
  const bSettings = { ...(b.stockSettings || {}) };
  const cSettings = { ...(c.stockSettings || {}) };
  delete bSettings.memo; delete bSettings.memoUpdatedAt;
  delete cSettings.memo; delete cSettings.memoUpdatedAt;
  items.push(...diffSettings(bSettings, cSettings, STOCK_SETTINGS_LABELS));

  items.push(...diffSettings(b.appSettings, c.appSettings, APP_SETTINGS_LABELS));

  items.push(...diffPresets(b.backtestStrategyPresets || [], c.backtestStrategyPresets || []));

  return items;
}