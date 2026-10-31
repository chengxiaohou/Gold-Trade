// 股票交易记录的云端同步纯函数（无副作用，便于单元测试）
// 机制：全量上传 + 覆盖式下载（下载以云端为准，本地未上传的交易/股票一律被覆盖丢弃，
// 从而实现跨设备删除传播；软删 isDeleted 只用于交易记录粒度，随记录一起携带）。
import type { StockEntry, StockTrade, StockSettings, BacktestStrategyPreset, TradeRecord, StockFinancialByYear } from '../types';
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

// 用云端某只股票的全量记录覆盖本地，并重算持仓。
// 规则：
//   - 交易记录完全以云端为准：云端没有的本地记录（例如刚挂、尚未上传的单）会被丢弃
//   - 软删 isDeleted 随记录一起被携带，不需要墓碑
//   - 价格类字段（现价/涨跌/高低量/更新时刻/价格派生股息率）是设备本地缓存：
//     下载时一律保留本地值，不用云端残留覆盖
export function mergeStockFromCloud(
  cloudStock: StockEntry,
  localStock?: StockEntry | undefined,
): MergeStockResult {
  const finalTrades = (cloudStock.stockTrades || []).slice().sort(
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

// 把整批云端股票覆盖到本地（批量版），返回覆盖后的股票列表 + 新流水账。
// 语义：下载以云端为准，完整覆盖本地：
//   - 云端有的股票：交易记录取云端全量，本地未上传的记录被丢弃；保留本地价格缓存
//   - 本地有而云端没有的股票条目：从股票列表与流水账中一并剔除（实现跨设备删除传播）
// localStocks 仅用于在下载时保留云端命中的本地价格缓存字段。
export function mergeCloudStocks(
  cloudStocks: StockEntry[],
  localStocks: StockEntry[],
): { mergedStocks: StockEntry[]; newLedger: StockLedgerMap } {
  const newLedger: StockLedgerMap = {};
  const mergedStocks = cloudStocks.map(c => {
    const localStock = localStocks.find(s => s.id === c.id);
    const { stock, ledgerEntry } = mergeStockFromCloud(c, localStock);
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

// ===== 财务三表拆分（stocks → financials.json）=====
// 三张低频财务表按 code 索引抽离到 financials.json 单独同步：
// 公开数据跨设备一致、仅在拉取分红数据时变动，单独成文件可避免每次改交易时重传。
export type StockFinancialField = 'dividendByYear' | 'dividendTotalByYear' | 'parentNetProfitByYear';
// stocks.json 中每只股票的形态：不含三张财务表（转到 financials.json）
export type StocksFileStock = Omit<StockEntry, StockFinancialField>;
// financials.json 顶层：按 code 索引的财务数据
export type FinancialsIndex = Record<string, StockFinancialByYear>;

// 从整批股票抽离三张财务表，返回「不含财务表的股票」与「按 code 索引的财务表」
export function splitFinancialsFromStocks(stocks: StockEntry[]): {
  core: StocksFileStock[];
  financials: FinancialsIndex;
} {
  const financials: FinancialsIndex = {};
  const core: StocksFileStock[] = stocks.map((s) => {
    const fin: StockFinancialByYear = {};
    if (s.dividendByYear) fin.dividendByYear = s.dividendByYear;
    if (s.dividendTotalByYear) fin.dividendTotalByYear = s.dividendTotalByYear;
    if (s.parentNetProfitByYear) fin.parentNetProfitByYear = s.parentNetProfitByYear;
    financials[s.code] = fin;
    const { dividendByYear: _dby, dividendTotalByYear: _dt, parentNetProfitByYear: _np, ...rest } = s;
    return rest;
  });
  return { core, financials };
}

// 把财务表按 code 合回股票列表，得到完整 StockEntry（dividendByYear 必填，缺省给 {}）
export function joinFinancialsToStocks(core: StocksFileStock[], financials?: FinancialsIndex): StockEntry[] {
  return core.map((s) => {
    const fin = financials?.[s.code];
    return {
      ...(s as StockEntry),
      dividendByYear: fin?.dividendByYear ?? {},
      dividendTotalByYear: fin?.dividendTotalByYear,
      parentNetProfitByYear: fin?.parentNetProfitByYear,
    } as StockEntry;
  });
}

// ===== 云端"差异对比"指纹（纯函数，无副作用）=====
// 用于判断本地是否有需要上传到云端的改动：把"会上传到每个文件的字段"序列化成稳定指纹，
// 与"最近一次成功上传/下载时的基线"比较，得到"是否有未同步改动"。
// 三份指纹分别对应三个云端文件（gold.json / stocks.json / financials.json），
// 并各自剔除不该入库的字段：
//   - stocks.json：剔除价格缓存字段（现价/涨跌/高低量/更新时刻/价格派生股息率）与三张财务表，
//     剔除设备特定字段（maxRows/maxWidth/sortMode/autoRefreshInterval）
//   - financials.json：只含三张财务表（按 code 索引）
//   - gold.json：黄金交易 + 全局设置 appSettings
export interface GoldFileFingerprintInput {
  trades: TradeRecord[];
  settings?: Record<string, unknown>;
}
export function buildGoldFileFingerprint({ trades, settings }: GoldFileFingerprintInput): string {
  return stableStringify({ trades, settings });
}

export interface StocksFileFingerprintInput {
  stocks: StockEntry[];
  stockSettings?: StockSettings;
  backtestStrategyPresets?: BacktestStrategyPreset[];
}
export function buildStocksFileFingerprint(input: StocksFileFingerprintInput): string {
  const { stocks, stockSettings, backtestStrategyPresets = [] } = input;
  const cloudStockSettings = stockSettings
    ? { ...stockSettings, maxRows: undefined, maxWidth: undefined, sortMode: undefined, autoRefreshInterval: undefined }
    : undefined;
  const { core } = splitFinancialsFromStocks(stripStockPriceCache(buildUploadStocks(stocks)));
  return stableStringify({
    stocks: core,
    stockSettings: cloudStockSettings,
    backtestStrategyPresets,
  });
}

export function buildFinancialsFileFingerprint(stocks: StockEntry[]): string {
  const { financials } = splitFinancialsFromStocks(stocks);
  return stableStringify({ financials });
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
// 设计目标：以后新增"上云字段"时，本模块无需改动即可自动展示差异。
//   引擎对快照做递归结构比对：对象逐字段、数组按 id 匹配或集合差异、深层嵌套自动下钻。
//   任何新增字段都会自动出现在结果里；下方的 labels / valueLabels / describe / display
//   只是"可选的展示美化"，缺失时自动回退到原始字段名与原始值——因此新增字段无需改这里。
// 输入：基线指纹（上次成功上传/下载时写入的 buildStockCloudFingerprint 结果，本身即一份完整快照 JSON）
//      与当前指纹。输出：人类可读的差异条目；基线缺失/无法解析时返回 null（首次上传，无可对比的历史备份）。
export type CloudDiffKind = 'add' | 'remove' | 'change';
export interface CloudDiffItem {
  kind: CloudDiffKind;
  text: string;
}

type AnyObj = Record<string, unknown>;

/** 展示提示：全部可选，仅用于美化；不提供时引擎仍能自动比对并展示（用原始字段名/原始值） */
interface DiffHints {
  /** 实体名词：用于"新增/删除 X「…」" */
  noun?: string;
  /** 数组匹配键：按该字段匹配元素（缺省按对象数组索引 / 标量数组集合差） */
  idKey?: string;
  /** 实体摘要（拼进「…」）；缺省取 idKey 的值 */
  describe?: (item: AnyObj) => string;
  /** 数组元素内部的字段提示 */
  item?: DiffHints;
  /** 字段中文名（缺失回退原字段名） */
  labels?: Record<string, string>;
  /** 段落前缀：下钻到该字段时直接用此文案作前缀（如"全局设置："），而非拼字段名 */
  sectionPrefix?: string;
  /** 单值展示覆盖（如把长文本折成字数） */
  display?: (v: unknown) => string;
  /** 枚举值中文名 */
  valueLabels?: Record<string, string>;
  /** 子字段提示 */
  fields?: Record<string, DiffHints>;
}

// 空值统一（'' / null / undefined 视为同一语义），避免"空 → 空"这类误报
function norm(v: unknown): unknown {
  return v === undefined || v === null || v === '' ? null : v;
}

// 递归按键排序后序列化：避免对象 key 顺序不同导致误报差异
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as AnyObj;
    return `{${Object.keys(o).sort()
      .map(k => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null) ?? 'null';
}

function sameValue(a: unknown, b: unknown): boolean {
  return stableStringify(norm(a)) === stableStringify(norm(b));
}

function isPlainObject(v: unknown): v is AnyObj {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// 时间戳 → "YYYY-MM-DD HH:mm"
function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  return `${fmtDate(ts)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundIfNearInt(n: number): number {
  if (Math.abs(n - round2(n)) < 1e-9) return round2(n);
  return n;
}

// 差异行里展示的单个值：空值→"空"；布尔→开/关；疑似时间戳→日期时间；长文本→截断；浮点噪声 round 到 2 位
function displayValue(v: unknown): string {
  if (v === undefined || v === null || v === '') return '空';
  if (typeof v === 'boolean') return v ? '开' : '关';
  if (typeof v === 'number') {
    const cleaned = roundIfNearInt(v);
    return Math.abs(v) >= 1e12 ? fmtDateTime(v) : String(cleaned);
  }
  if (typeof v === 'string') return v.length > 60 ? `${v.slice(0, 60)}…（共 ${v.length} 字）` : v;
  if (Array.isArray(v)) return `[${v.length} 项]`;
  if (typeof v === 'object') return '对象';
  return String(v);
}

// 叶子值的最终展示：display 覆盖 > 枚举中文名 > 默认
function leafText(v: unknown, hints: DiffHints): string {
  if (hints.display) return hints.display(v);
  if (hints.valueLabels) {
    const hit = hints.valueLabels[String(v)];
    if (hit !== undefined) return hit;
  }
  return displayValue(v);
}

interface CloudSnapshot {
  stocks?: StockEntry[];
  stockSettings?: AnyObj;
  backtestStrategyPresets?: BacktestStrategyPreset[];
  appSettings?: AnyObj;
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

/** 对比两个同结构对象，返回已加 bullet 的可读差异行（· 字段: 旧 → 新）；
 *  遇到子数组时：若子字段 hints 里带 idKey（实体数组），递归走 diffArray 下钻并嵌套缩进；
 *  否则作为整体给出"已更新"概括 */
function collectFieldChanges(a: AnyObj, b: AnyObj, hints: DiffHints): string[] {
  const out: string[] = [];
  const indent = '  ';
  const bullet = (s: string) => `- ${s}`;

  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const label = hints.labels?.[key] ?? key;
    const child = hints.fields?.[key] ?? {};
    const av = a[key];
    const bv = b[key];
    if (sameValue(av, bv)) continue;
    if (Array.isArray(av) || Array.isArray(bv)) {
      if (child.idKey) {
        const sub: CloudDiffItem[] = [];
        diffArray(Array.isArray(av) ? av : [], Array.isArray(bv) ? bv : [], '', child, sub);
        for (const s of sub) {
          // 子数组的每个条目（新增/删除/合并 change）以减号开头，多行内容整体缩进一层
          const block = s.text.split('\n');
          out.push(bullet(block[0]));
          for (const l of block.slice(1)) out.push(`${indent}${indent}${l}`);
        }
      } else if (Array.isArray(av) && Array.isArray(bv)) {
        if (av.length !== bv.length) out.push(bullet(`${label}: ${av.length} 项 → ${bv.length} 项`));
        else out.push(bullet(`${label}: 内容已更新`));
      } else {
        out.push(bullet(`${label}: 已更新`));
      }
    } else if (isPlainObject(av) || isPlainObject(bv)) {
      out.push(bullet(`${label}: 已更新`));
    } else {
      out.push(bullet(`${label}: ${leafText(av, child)} → ${leafText(bv, child)}`));
    }
  }
  return out;
}

/** 通用递归比对：对象逐字段下钻；数组交 diffArray；标量不同则产出一条差异 */
function diffNode(a: unknown, b: unknown, prefix: string, hints: DiffHints, out: CloudDiffItem[]): void {
  if (isPlainObject(a) || isPlainObject(b)) {
    const ao: AnyObj = isPlainObject(a) ? a : {};
    const bo: AnyObj = isPlainObject(b) ? b : {};
    for (const key of new Set([...Object.keys(ao), ...Object.keys(bo)])) {
      const label = hints.labels?.[key] ?? key;
      const child = hints.fields?.[key] ?? {};
      const av = ao[key];
      const bv = bo[key];
      if (isPlainObject(av) || isPlainObject(bv) || Array.isArray(av) || Array.isArray(bv)) {
        // 复杂子节点：sectionPrefix 直接作段落前缀；label 为空表示顺延当前前缀（如 stockTrades）
        const nextPrefix = child.sectionPrefix
          ? `${prefix}${child.sectionPrefix}`
          : (label ? `${prefix}${label}·` : prefix);
        diffNode(av, bv, nextPrefix, child, out);
      } else if (!sameValue(av, bv)) {
        out.push({ kind: 'change', text: `${prefix}${label} ${leafText(av, child)} → ${leafText(bv, child)}` });
      }
    }
    return;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    diffArray(Array.isArray(a) ? a : [], Array.isArray(b) ? b : [], prefix, hints, out);
    return;
  }
  if (!sameValue(a, b)) out.push({ kind: 'change', text: `${prefix} ${leafText(a, hints)} → ${leafText(b, hints)}` });
}

function diffArray(a: unknown[], b: unknown[], prefix: string, hints: DiffHints, out: CloudDiffItem[]): void {
  const base = prefix.endsWith('·') ? prefix.slice(0, -1) : prefix;
  const noun = hints.noun ?? '';

  // 按 id 匹配的实体数组：识别新增/删除，并对同 id 的元素合并字段差异为一条
  if (hints.idKey) {
    const key = hints.idKey;
    const describe = hints.describe ?? ((o: AnyObj) => String(o[key] ?? ''));
    const itemHints = hints.item ?? {};
    const aMap = new Map<string, AnyObj>();
    const bMap = new Map<string, AnyObj>();
    for (const o of a) if (isPlainObject(o)) aMap.set(String(o[key]), o);
    for (const o of b) if (isPlainObject(o)) bMap.set(String(o[key]), o);

    for (const [k, o] of bMap) if (!aMap.has(k)) out.push({ kind: 'add', text: `${base}新增${noun}「${describe(o)}」` });
    for (const [k, o] of aMap) if (!bMap.has(k)) out.push({ kind: 'remove', text: `${base}删除${noun}「${describe(o)}」` });
    for (const [k, oa] of aMap) {
      const ob = bMap.get(k);
      if (!ob || sameValue(oa, ob)) continue;
      const head = `${base}更新「${describe(ob)}」`;
      const lines = collectFieldChanges(oa, ob, itemHints);
      if (lines.length === 0) {
        out.push({ kind: 'change', text: head });
      } else {
        // 同一条实体里多个字段改动合并成一条，最多展示 8 条明细，超出折叠为"…另有 N 项"
        const MAX_INLINE = 8;
        const inline = lines.slice(0, MAX_INLINE).map(l => `  ${l}`).join('\n');
        const tail = lines.length > MAX_INLINE ? `\n  - …另有 ${lines.length - MAX_INLINE} 项` : '';
        out.push({ kind: 'change', text: `${head}\n${inline}${tail}` });
      }
    }
    return;
  }

  // 标量数组：按集合差异给出新增/移除的具体元素
  const allPrimitive = [...a, ...b].every(v => !isPlainObject(v) && !Array.isArray(v));
  if (allPrimitive) {
    const aSet = new Map(a.map(v => [stableStringify(norm(v)), v]));
    const bSet = new Map(b.map(v => [stableStringify(norm(v)), v]));
    for (const [k, v] of bSet) if (!aSet.has(k)) out.push({ kind: 'add', text: `${base}新增 ${displayValue(v)}` });
    for (const [k, v] of aSet) if (!bSet.has(k)) out.push({ kind: 'remove', text: `${base}移除 ${displayValue(v)}` });
    return;
  }

  // 无匹配键的对象数组：按索引下钻
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (i >= a.length) out.push({ kind: 'add', text: `${base}[${i + 1}] 新增` });
    else if (i >= b.length) out.push({ kind: 'remove', text: `${base}[${i + 1}] 移除` });
    else diffNode(a[i], b[i], `${base}[${i + 1}]`, hints.item ?? {}, out);
  }
}

/** 交易记录的一句话摘要：方向、点位×股数、金额、时间、状态、备注、落袋盈亏 */
function tradeSummary(t: AnyObj): string {
  const side = t.side === 'buy' ? '买入' : t.side === 'sell' ? '卖出' : String(t.side ?? '');
  const price = typeof t.price === 'number' ? t.price : Number(t.price ?? 0);
  const shares = typeof t.shares === 'number' ? t.shares : Number(t.shares ?? 0);
  const amount = typeof t.amount === 'number' ? t.amount : price * shares;
  const parts: string[] = [`${side} ${price}元×${shares}股`, `金额 ${round2(amount)}`];
  const ts = typeof t.filledAt === 'number' ? t.filledAt
    : (typeof t.createdAt === 'number' ? t.createdAt : null);
  if (ts) parts.push(fmtDate(ts));
  if (t.status === 'filled') parts.push('已成交');
  else if (t.status === 'pending') parts.push('挂单中');
  else if (t.status !== undefined) parts.push(String(t.status));
  if (typeof t.realizedPnL === 'number') parts.push(`落袋 ${round2(t.realizedPnL)}`);
  if (t.note) parts.push(`备注：${String(t.note)}`);
  if (t.isMerged) parts.push('合并记录');
  if (t.isDeleted) parts.push('已删除');
  return parts.join('，');
}

function stockLabel(s: AnyObj): string {
  const name = String(s.nickname || s.name || s.code || '');
  const code = s.code === undefined || s.code === null ? '' : String(s.code);
  return code && name !== code ? `${name}(${code})` : name;
}

const TRADE_HINTS: DiffHints = {
  noun: '交易记录',
  idKey: 'id',
  describe: tradeSummary,
  item: {
    labels: {
      side: '方向', price: '点位', shares: '股数', amount: '金额', status: '状态',
      createdAt: '创建时间', originalCreatedAt: '原始创建时间', filledAt: '成交时间',
      note: '备注', realizedPnL: '落袋盈亏', isMerged: '合并记录', isDeleted: '软删',
      ttlDays: '挂单剩余天数', ttlUpdatedAt: '剩余天数生效时间',
    },
    fields: {
      side: { valueLabels: { buy: '买入', sell: '卖出' } },
      status: { valueLabels: { pending: '挂单中', filled: '已成交' } },
    },
  },
};

const STOCK_HINTS: DiffHints = {
  // 文件标题已标明"股票"，实体前缀不再重复"股票"二字
  noun: '',
  idKey: 'id',
  describe: stockLabel,
  item: {
    labels: {
      code: '代码', name: '名称', nickname: '代号',
      positionShares: '持仓股数', positionCost: '持仓成本',
      dividend2024: '2024分红', dividend2025: '2025分红',
      dividendByYear: '历年分红',
      registerDate: '登记日', link: '链接', tag: '标签',
      selectedDividendYear: '选中分红年', bollHidden: '隐藏BOLL',
      stockTrades: '', // 空标签：交易记录数组就地展开，避免"交易记录·交易记录"重复
    },
    fields: { stockTrades: TRADE_HINTS },
  },
};

const PRESET_HINTS: DiffHints = {
  noun: '策略组',
  idKey: 'id',
  describe: (p) => String(p.name ?? ''),
  item: { labels: { name: '名称', rules: '规则', createdAt: '创建时间', updatedAt: '更新时间' } },
};

const STOCK_SETTINGS_HINTS: DiffHints = {
  labels: {
    visibleColumns: '可见列',
    dividendRateColumns: '股息率档位列',
    dividendRateColorRanges: '股息率配色',
    tagColors: '标签颜色',
    memo: '备忘录',
    memoUpdatedAt: '备忘录时间',
    tagParams: '标签参数',
    customTags: '自定义标签',
    buyOrderPlaceholder: '买入占位文字',
    sellOrderPlaceholder: '卖出占位文字',
  },
  fields: {
    // 备忘录是长文本，只展示字数而非全文
    memo: { display: (v) => `（${typeof v === 'string' ? v.length : 0} 字）` },
    customTags: {
      noun: '自定义标签',
      idKey: 'id',
      describe: (r) => String(r.name ?? ''),
      item: {
        labels: {
          name: '名称', enabled: '开关', source: '数据源', direction: '方向',
          targetType: '目标类型', targetValue: '目标值', targetIndicator: '目标指标',
          tolerance: '容差', color: '配色',
        },
        fields: { direction: { valueLabels: { up: '增至', down: '降至', touch: '触达' } } },
      },
    },
  },
};

const APP_SETTINGS_HINTS: DiffHints = {
  labels: {
    priceStep: '价格步进', gramsStep: '克数步进', tagColors: '标签颜色',
    touchMode: '触控模式', priceDisplayMode: '价格显示',
    totalCapital: '黄金页总资金', dividendTotalCapital: '分红页总资金', visibleColumns: '可见列',
    buyTaxFee: '买入税费', sellTaxFee: '卖出税费', apiSource: '行情源',
    cacheTTLMinutes: '行情缓存时长', bollCacheTTLMinutes: 'BOLL缓存时长',
    dividendYearLeft: '左分红年份', dividendYearRight: '右分红年份', manualFxRate: '手动汇率',
  },
};

// 顶层提示：从快照根节点整体递归——新增顶层上云字段（区块）时无需在此登记，
// 也会被自动比对并展示（未登记的字段用原始字段名，已登记的用中文名与段落前缀）。
const ROOT_HINTS: DiffHints = {
  labels: { stocks: '', stockSettings: '', appSettings: '', backtestStrategyPresets: '' },
  fields: {
    stocks: STOCK_HINTS,
    backtestStrategyPresets: PRESET_HINTS,
    stockSettings: { ...STOCK_SETTINGS_HINTS, sectionPrefix: '分红页设置：' },
    appSettings: { ...APP_SETTINGS_HINTS, sectionPrefix: '全局设置：' },
  },
};

export function diffStockCloudSnapshots(baseline: string | null, current: string): CloudDiffItem[] | null {
  const b = parseCloudSnapshot(baseline);
  if (b === null) return null; // 无基线：首次上传，无可对比的历史备份
  const c: CloudSnapshot = parseCloudSnapshot(current) || {};

  const out: CloudDiffItem[] = [];
  diffNode(b, c, '', ROOT_HINTS, out);
  return out;
}

// 黄金文件（gold.json → { trades, settings }）的差异对比：交易记录逐条、全局设置逐字段
interface GoldSnapshot {
  trades?: TradeRecord[];
  settings?: AnyObj;
}
function parseGoldSnapshot(raw: string | null): GoldSnapshot | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? (o as GoldSnapshot) : null;
  } catch {
    return null;
  }
}
const GOLD_ROOT_HINTS: DiffHints = {
  labels: { trades: '', settings: '' },
  fields: {
    trades: TRADE_HINTS,
    settings: { ...APP_SETTINGS_HINTS, sectionPrefix: '黄金设置：' },
  },
};
export function diffGoldSnapshots(baseline: string | null, current: string): CloudDiffItem[] | null {
  const b = parseGoldSnapshot(baseline);
  if (b === null) return null;
  const c: GoldSnapshot = parseGoldSnapshot(current) || {};
  const out: CloudDiffItem[] = [];
  diffNode(b, c, '', GOLD_ROOT_HINTS, out);
  return out;
}

// financials.json 的差异明细：精确到「哪只股票 → 哪些年份 → 三张表中哪几项变了」，
// 并区分新增/删除/更新；连续年份且变化项相同的合并成「1999-2008」年份区间。
// 分红数据量很大，展示颗粒度止于「股票 + 年份区间（含变化项名称）」，不做逐值对比。
export type FinancialsField = 'dividend' | 'dividendTotal' | 'netProfit';
export interface FinancialsYearGroup {
  kind: CloudDiffKind; // 该段年份是整年新增、整年删除，还是已有年份的值更新
  startYear: number;
  endYear: number; // 与 startYear 相同表示只有一年
  fields: FinancialsField[]; // 涉及的三表项
}
export interface FinancialsStockChange {
  code: string;
  kind: CloudDiffKind; // 股票级：新增/删除/更新（增删混合时归为更新）
  groups: FinancialsYearGroup[];
}
export interface FinancialsDiffDetail {
  stocks: FinancialsStockChange[];
}

// 三张财务表与差异展示字段的对应关系
const FINANCIAL_TABLES: Array<{ field: FinancialsField; key: StockFinancialField }> = [
  { field: 'dividend', key: 'dividendByYear' },
  { field: 'dividendTotal', key: 'dividendTotalByYear' },
  { field: 'netProfit', key: 'parentNetProfitByYear' },
];

interface FinancialsYearDelta {
  year: number;
  kind: CloudDiffKind;
  fields: FinancialsField[];
}

// 某只股票某一年的变化：整年只在当前/基线存在 → 新增/删除；两边都有但值不同 → 更新
function diffFinancialsYear(
  pf: StockFinancialByYear,
  nf: StockFinancialByYear,
  year: number,
): FinancialsYearDelta | null {
  const prevVals = FINANCIAL_TABLES.map(t => pf[t.key]?.[year]);
  const nextVals = FINANCIAL_TABLES.map(t => nf[t.key]?.[year]);
  const prevHas = prevVals.some(v => v !== undefined && v !== null);
  const nextHas = nextVals.some(v => v !== undefined && v !== null);
  if (!prevHas && !nextHas) return null;
  if (!prevHas) {
    return { year, kind: 'add', fields: FINANCIAL_TABLES.filter((_, i) => nextVals[i] !== undefined && nextVals[i] !== null).map(t => t.field) };
  }
  if (!nextHas) {
    return { year, kind: 'remove', fields: FINANCIAL_TABLES.filter((_, i) => prevVals[i] !== undefined && prevVals[i] !== null).map(t => t.field) };
  }
  const fields = FINANCIAL_TABLES.filter((_, i) => (prevVals[i] ?? null) !== (nextVals[i] ?? null)).map(t => t.field);
  return fields.length > 0 ? { year, kind: 'change', fields } : null;
}

// 把逐年的变化按「连续年份 + 变化项相同」合并成区间，例如 1999-2008 年合并为一段
function groupFinancialsYears(deltas: FinancialsYearDelta[]): FinancialsYearGroup[] {
  const groups: FinancialsYearGroup[] = [];
  const sorted = deltas.slice().sort((a, b) => a.year - b.year);
  for (const d of sorted) {
    const last = groups[groups.length - 1];
    const sameShape = last && d.year === last.endYear + 1 && d.kind === last.kind
      && d.fields.length === last.fields.length && d.fields.every((f, i) => f === last.fields[i]);
    if (sameShape) last.endYear = d.year;
    else groups.push({ kind: d.kind, startYear: d.year, endYear: d.year, fields: d.fields.slice() });
  }
  return groups;
}

export function diffFinancialsSnapshots(baseline: string | null, current: string): FinancialsDiffDetail | null {
  if (!baseline) return null;
  let prev: FinancialsIndex | undefined;
  let next: FinancialsIndex | undefined;
  try { prev = (JSON.parse(baseline) as { financials?: FinancialsIndex }).financials; } catch { return null; }
  try { next = (JSON.parse(current) as { financials?: FinancialsIndex }).financials; } catch { next = undefined; }
  const p = prev || {}, n = next || {};
  const stocks: FinancialsStockChange[] = [];
  const codes = new Set([...Object.keys(p), ...Object.keys(n)]);
  for (const code of codes) {
    const pf = p[code] || {}, nf = n[code] || {};
    const years = new Set<number>();
    for (const t of FINANCIAL_TABLES) {
      Object.keys(pf[t.key] || {}).forEach(y => years.add(Number(y)));
      Object.keys(nf[t.key] || {}).forEach(y => years.add(Number(y)));
    }
    const deltas: FinancialsYearDelta[] = [];
    for (const y of years) {
      const d = diffFinancialsYear(pf, nf, y);
      if (d) deltas.push(d);
    }
    if (deltas.length === 0) continue;
    // 股票级：整个条目从无到有 → 新增；从有到无 → 删除；否则都是更新（年份段自身再标类型）
    const kind: CloudDiffKind = !p[code] ? 'add' : !n[code] ? 'remove' : 'change';
    stocks.push({ code, kind, groups: groupFinancialsYears(deltas) });
  }
  return { stocks };
}

// 从 stocks.json 快照中提取「code → 名称」：financials.json 本身不含名称，
// 展示分红差异时需要借助股票文件（当前本地股票 + 上次同步的股票基线）来还原股票名称。
export function collectStockNamesFromSnapshot(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw) as { stocks?: Array<{ code?: unknown; name?: unknown; nickname?: unknown }> };
    const names: Record<string, string> = {};
    for (const s of o.stocks || []) {
      const code = typeof s?.code === 'string' ? s.code : '';
      if (!code) continue;
      const name = (typeof s.nickname === 'string' && s.nickname) || (typeof s.name === 'string' ? s.name : '');
      if (name && name !== code) names[code] = name;
    }
    return names;
  } catch {
    return {};
  }
}