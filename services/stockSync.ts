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
  const indentBlock = (text: string): string[] =>
    text.split('\n').map(l => l ? `${indent}${l}` : '');
  const bullet = (s: string) => `· ${s}`;

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
          // 子数组的每个条目（新增/删除/合并 change）统一缩进一层后 push
          // 其中合并 change 本身含多行（head + 内部 · 列表），整体缩进
          for (const l of indentBlock(s.text)) out.push(l);
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
      const head = `${base}${noun}「${describe(ob)}」已修改`;
      const lines = collectFieldChanges(oa, ob, itemHints);
      if (lines.length === 0) {
        out.push({ kind: 'change', text: head });
      } else {
        // 同一条实体里多个字段改动合并成一条，最多展示 8 条明细，超出折叠为"…另有 N 项"
        const MAX_INLINE = 8;
        const inline = lines.slice(0, MAX_INLINE).map(l => `  ${l}`).join('\n');
        const tail = lines.length > MAX_INLINE ? `\n  …另有 ${lines.length - MAX_INLINE} 项` : '';
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
  noun: '股票',
  idKey: 'id',
  describe: stockLabel,
  item: {
    labels: {
      code: '代码', name: '名称', nickname: '代号',
      positionShares: '持仓股数', positionCost: '持仓成本',
      dividend2024: '2024分红', dividend2025: '2025分红',
      dividendByYear: '历年分红', dividendRates: '股息率档位',
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