// ─────────────────────────────────────────────────────────────
// 价格数据部 —— 模块级单例（不依赖 React）
// 统一持有 per-stock { daily; weekly; monthly } 价格数据权威缓存，
// 全项目所有 fetchBollData / merge 写入一律经由本模块，消费方只读此处，
// 消除"同一题材在浮窗/弹窗/列表各取一源"导致的当日 volume/close 不一致。
// 取数不作自研：批量/逐只判定与请求全部复用 bollService/cacheService/requestLogService。
// ─────────────────────────────────────────────────────────────
import type { ApiSource } from '../types';
import {
  fetchBollData,
  planBollCache,
  emitBollCacheHits,
  getBollCacheTimestamps,
  ensureBollCacheRestored,
  subscribeBollKlinesHydrated,
  mergeTodayBarToKlines,
  projectBollAsOf,
  buildBollDataFromKlines,
  type BollData,
  type BollPeriod,
  type BollAdjust,
  type BollKline,
  type TodayBarInput,
  type BollResult,
} from './bollService';
import { getDynamicBollCacheTTL, isTradingHours, formatCacheTime, getMarketStatus } from './cacheService';
import { requestLogService, BOOT_DIAG_CTX, type LogBatchContext } from './requestLogService';
import { fetchTencentRealtime } from './realtimeQuote';
import { toTencentCode, type TencentQuote } from './tencentQuote';

export interface RealTimeQuote extends TencentQuote {
  updatedAt: number; // 拉取时刻
}

export interface PriceEntry {
  daily: BollData | null;
  weekly: BollData | null;
  monthly: BollData | null;
  /** 当日最新实时行情（未收盘前可含当日），由本模块自持，对外合成"含未收盘"数据。 */
  realtime: RealTimeQuote | null;
}

function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "仅收盘"投影：未收盘（含盘前/盘中/午休/全天休市）时剔除序列中今日这根 K 线，保证不含当日。 */
function toClosedKlines(klines: BollKline[] | null | undefined, marketStatus: string): BollKline[] | null {
  if (!klines || klines.length === 0) return klines ?? null;
  if (marketStatus === 'closed') return klines; // 已收盘：当日即收盘，原样返回
  const today = todayStr();
  return klines[klines.length - 1]?.date === today ? klines.slice(0, -1) : klines;
}

/** 把自持的实时行情规整为 mergeTodayBarToKlines 所需的 TodayBarInput。 */
function rtFromRealtime(q: RealTimeQuote): TodayBarInput {
  return { price: q.price, open: q.open, high: q.high, low: q.low, volume: q.volume };
}

/** store 里 daily 的唯一写入形态：有有效实时行情时并入今日合成 bar 再重算三轨/均线/区间。
 *  所有写入（缓存批量落地、取数落地、实时行情刷新）都必须经过这里，
 *  否则同一时刻"列表读 store"与"浮窗自行合成"会算出不同数值（如日上 22.25 vs 22.50）。 */
function buildLiveDaily(data: BollData | null, rt: RealTimeQuote | null): BollData | null {
  if (!data) return null;
  if (asOfDate) return data; // 历史模式不掺实时价
  if (!rt || rt.price <= 0 || rt.open <= 0) return data;
  const base = toClosedKlines(data.klines, getMarketStatus()) ?? [];
  const merged = mergeTodayBarToKlines(base, rtFromRealtime(rt), getMarketStatus());
  return buildBollDataFromKlines(merged, data.fetchedAt ?? Date.now()) ?? data;
}

/** 写入某只股票的实时行情并同步重算 store 日线（不 notify，批量场景由调用方统一通知）。 */
function applyRealtimeQuote(code: string, q: TencentQuote): boolean {
  if (asOfDate) return false;
  const cur = store.get(code) ?? { daily: null, weekly: null, monthly: null, realtime: null };
  const realtime: RealTimeQuote = { ...q, updatedAt: Date.now() };
  store.set(code, { ...cur, realtime, daily: buildLiveDaily(cur.daily, realtime) });
  return true;
}

export interface BureauStock {
  id: string;
  code: string;
  bollHidden?: boolean;
}

export interface EnsureBatchOpts {
  trigger?: string;
  /** 顺序请求列表（如页面 sortedStocks）；默认按传入 stocks 顺序 */
  order?: BureauStock[];
  /** 返回 true 时中止本轮（对应页面 fetchVersionRef 取消旧请求） */
  cancelCheck?: () => boolean;
}

// code → 条目（code 沿用 stock.code 原始字符串，与 fetchBollData 同一口径）
const store = new Map<string, PriceEntry>();

// 最近一次批量加载的上下文：K 线缓存后台补齐后，按同一批股票重新落地，
// 让依赖 K 线的标签 / 区间比例自动补上（只补不删，避免把已取到的数据清掉）
let lastBatchContext: { stocks: BureauStock[]; adjust: BollAdjust; apiSource: ApiSource } | null = null;

// 把缓存判定结果转成 store 键（cachedData 按 stock.id 索引，本模块按 stock.code 索引）
function buildCachedByCode(
  cachedData: Map<string, { daily: BollData | null; weekly: BollData | null; monthly: BollData | null }>,
  stocks: BureauStock[],
  onlyComplete = false,
): Map<string, PriceEntry> {
  const idToCode = new Map<string, string>();
  for (const s of stocks) idToCode.set(s.id, s.code);
  const cachedByCode = new Map<string, PriceEntry>();
  for (const [id, entry] of cachedData) {
    const code = idToCode.get(id);
    if (!code) continue;
    // 后台补齐场景：跳过不完整条目，避免把已落地的数据删掉
    if (onlyComplete && (!entry.daily || !entry.weekly || !entry.monthly)) continue;
    const prevRt = store.get(code)?.realtime ?? null;
    cachedByCode.set(code, { realtime: prevRt, ...entry });
  }
  return cachedByCode;
}

// ── 历史展示模式（截止日投影）──
// asOfDate 非空时，本部门对外输出的一切数据都以该日为截止日：K 线截断到该日（含当日），
// BOLL 三轨/均线/区间高低基于截断后的序列重算，实时行情不再参与合成。
// null = 正常实时模式。消费方只需调用 setAsOfDate，之后照常读取，无需关心内部实现。
let asOfDate: string | null = null;
// 投影结果缓存：保证同一 (code, asOfDate) 在两次写入之间返回稳定引用，
// 避免上层以数组引用作缓存键时被反复判为变更。任何写入/切换截止日都清空。
const projectionCache = new Map<string, PriceEntry | null>();
let projectionCacheDate: string | null | undefined = undefined;

function getProjected(code: string): PriceEntry | null {
  if (!asOfDate) return null;
  if (projectionCacheDate !== asOfDate) {
    projectionCache.clear();
    projectionCacheDate = asOfDate;
  }
  if (projectionCache.has(code)) return projectionCache.get(code) ?? null;
  const raw = store.get(code);
  const projected: PriceEntry | null = raw
    ? {
        daily: projectBollAsOf(raw.daily, asOfDate),
        weekly: projectBollAsOf(raw.weekly, asOfDate),
        monthly: projectBollAsOf(raw.monthly, asOfDate),
        realtime: null,
      }
    : null;
  projectionCache.set(code, projected);
  return projected;
}

// 对外统一读入口：历史模式下返回截止日投影，否则返回自持原始条目
function readEntry(code: string): PriceEntry | null {
  return asOfDate ? getProjected(code) : (store.get(code) ?? null);
}

// 订阅表：任何条目写入都触发全部监听，页面用它回填镜像 state 触发重渲
const listeners = new Set<() => void>();
function notify(): void {
  projectionCache.clear();
  for (const cb of listeners) cb();
}

function isEmpty(e: PriceEntry): boolean {
  return !e.daily && !e.weekly && !e.monthly && !e.realtime;
}

export const priceBureau = {
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  },

  getEntry(code: string): PriceEntry | null {
    return readEntry(code);
  },

  getDaily(code: string): BollData | null {
    return readEntry(code)?.daily ?? null;
  },
  getWeekly(code: string): BollData | null {
    return readEntry(code)?.weekly ?? null;
  },
  getMonthly(code: string): BollData | null {
    return readEntry(code)?.monthly ?? null;
  },

  /** 唯一"今日合并日K线"权威：返回该股票的 canonical 日 K 线（bollService 已做盘中 volume 保护）。
   *  历史模式下返回按截止日截断后的序列。 */
  getTodayKlines(code: string): BollKline[] | null {
    return readEntry(code)?.daily?.klines ?? null;
  },

  /** 自持的当日最新实时行情（未收盘前含当日）。历史模式下无实时行情，返回 null。 */
  getRealtime(code: string): RealTimeQuote | null {
    if (asOfDate) return null;
    return store.get(code)?.realtime ?? null;
  },

  /** 数据形态①【仅收盘】：未收盘时剔除今日 K 线，历史到最近一个已收盘交易日为止。
   *  给回测引擎、历史股息率等"不掺未收盘实时价"的消费方显式选择。
   *  历史模式下数据已在数据中心按截止日截断（含当日），不再做"剔除今日"处理。 */
  getClosedKlines(code: string, period: BollPeriod): BollKline[] | null {
    const entry = readEntry(code);
    const data = period === 'daily' ? entry?.daily : period === 'weekly' ? entry?.weekly : entry?.monthly;
    if (asOfDate) return data?.klines ?? null;
    return toClosedKlines(data?.klines, getMarketStatus());
  },

  /** 数据形态②【含未收盘】：把自持的最新实时行情合成进今日 K 线。
   *  自包含——优先用本模块自持 realtime 合成；未自持时才用调用方传入的 rt 兜底；
   *  两者皆无有效实时价时退回"仅收盘"序列。所有要"当前/今日实时"的消费方一律走这里。
   *  历史模式下不合成实时行情，直接返回按截止日截断后的序列。 */
  getTodayDailyKlines(code: string, rt?: TodayBarInput): BollKline[] {
    if (asOfDate) return readEntry(code)?.daily?.klines ?? [];
    const closed = toClosedKlines(store.get(code)?.daily?.klines, getMarketStatus());
    const curRt = store.get(code)?.realtime;
    const marketStatus = getMarketStatus();
    if (curRt && curRt.price > 0 && curRt.open > 0) {
      return mergeTodayBarToKlines(closed ?? [], rtFromRealtime(curRt), marketStatus);
    }
    if (rt && rt.price > 0 && rt.open > 0) {
      return mergeTodayBarToKlines(closed ?? [], rt, marketStatus);
    }
    return closed ?? [];
  },

  /** 取"含未收盘"后今日合成的那一根 K 线（getTodayDailyKlines 的末根）。 */
  getTodayBar(code: string, rt?: TodayBarInput): BollKline | null {
    const lines = priceBureau.getTodayDailyKlines(code, rt);
    return lines && lines.length > 0 ? lines[lines.length - 1] : null;
  },

  /** 含未收盘形态的完整 BOLL 数据（三轨+均线+区间高低+含今日实时价的 klines）。
   *  所有周期统一从 store 取——daily 入 store 前已自动按"含未收盘"形态重算（absorb / setRealtime 都触发），
   *  weekly/monthly 无 realtime merge，store 原始即完整。消费方拿 upper/mid/lower/ma 一律走这里。 */
  getTodayBoll(code: string, period: BollPeriod): BollData | null {
    if (asOfDate) return readEntry(code)?.[period] ?? null;
    return store.get(code)?.[period] ?? null;
  },

  // ── 历史展示模式：对外唯一开关与配套读取 ──
  /** 设置历史截止日（'YYYY-MM-DD'）；传 null 恢复正常实时模式。 */
  setAsOfDate(date: string | null): void {
    if (asOfDate === date) return;
    asOfDate = date;
    projectionCache.clear();
    projectionCacheDate = date;
    notify();
  },
  getAsOfDate(): string | null {
    return asOfDate;
  },

  /** 缓存中所有股票日线覆盖到的交易日（倒序，最新在前），作为历史模式的日期选择来源。
   *  自动剔除"全市场最新那根 K 线日期"——它等价于实时模式（histDate=null），
   *  由顶部「最新（恢复实时）」按钮承担，避免下拉里出现冗余选项。 */
  getAvailableDates(): string[] {
    const dates = new Set<string>();
    let latest = '';
    for (const e of store.values()) {
      for (const k of e.daily?.klines ?? []) {
        dates.add(k.date);
        if (k.date > latest) latest = k.date;
      }
    }
    const sorted = [...dates].sort().reverse();
    // 去掉最新日期（它就是实时模式），但剔除后至少得留一条，否则下拉空了
    if (sorted.length > 1 && sorted[0] === latest) return sorted.slice(1);
    return sorted;
  },

  /** 历史模式的"当日限价数据"：取截止日（或之前最近一个交易日）那根日 K，
   *  收盘价作为现价，涨跌幅相对前一根收盘价。非历史模式返回 null。 */
  getAsOfQuote(code: string): { price: number; changePercent: number; high: number; low: number; open: number; volume: number } | null {
    if (!asOfDate) return null;
    // 直接用自持日线截断到截止日（不依赖 BOLL 投影：K 线不足 20 根也能给出限价数据）
    const sliced = (store.get(code)?.daily?.klines ?? []).filter(k => k.date <= asOfDate);
    if (sliced.length === 0) return null;
    const last = sliced[sliced.length - 1];
    const prev = sliced.length >= 2 ? sliced[sliced.length - 2] : null;
    const changePercent = prev && prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : 0;
    return { price: last.close, changePercent, high: last.high, low: last.low, open: last.open, volume: last.volume };
  },

  /** 覆盖式写入单只条目（返回 false 表示写的是一个空条目，供调用方决定是否保留） */
  setEntry(code: string, entry: PriceEntry): void {
    if (isEmpty(entry)) {
      store.delete(code);
    } else {
      // 日线统一按"含今日实时价"形态落库，避免缓存里的仅收盘序列直接成为列表口径
      store.set(code, { ...entry, daily: buildLiveDaily(entry.daily, entry.realtime) });
    }
    notify();
  },

  /** 写入单个周期结果（供内部喂入，保证全项目同一 code 的同一周期同源） */
  absorb(code: string, period: BollPeriod, result: { data: BollData | null }): void {
    if (!result.data) return;
    const cur = store.get(code) ?? { daily: null, weekly: null, monthly: null, realtime: null };
    // 日线入 store 前统一按"含未收盘"形态重算（与缓存落地、实时刷新同一实现）
    const stored = period === 'daily' ? buildLiveDaily(result.data, cur.realtime) ?? result.data : result.data;
    store.set(code, { ...cur, [period]: stored });
    notify();
  },

  /** 一次性批量写入（用于缓存全命中/初扫） */
  setEntries(entries: Map<string, PriceEntry>): void {
    for (const [code, entry] of entries) {
      if (isEmpty(entry)) {
        store.delete(code);
      } else {
        // 批量落地同样统一按"含今日实时价"形态写入日线（缓存本身只有收盘序列）
        store.set(code, { ...entry, daily: buildLiveDaily(entry.daily, entry.realtime) });
      }
    }
    notify();
  },

  /** 清空全部条目（数据源切换时使用），并通知订阅者 */
  clear(): void {
    store.clear();
    notify();
  },

  /** 单只单周期补齐：缺失时才 fetchBollData 并写回 */
  async ensure(
    code: string,
    period: BollPeriod,
    apiSource: ApiSource,
    adjust: BollAdjust,
  ): Promise<void> {
    if (asOfDate) return; // 历史展示模式：不触网，缺失即缺失（由投影读取层呈现为空）
    if (store.get(code)?.[period]) return;
    await ensureBollCacheRestored();
    const result = await fetchBollData(code, period, adjust, apiSource);
    // 写入统一走 absorb（日线会自动并入今日实时价），避免此处写入"仅收盘"形态
    // 导致后续读取 store 的消费方拿到与列表/浮窗不一致的三轨数值
    priceBureau.absorb(code, period, result);
  },

  /** 写入某只最新的实时行情（供刷新/回填复用），写实会 notify。历史模式下拒绝写入。 */
  setRealtime(code: string, q: TencentQuote): void {
    if (applyRealtimeQuote(code, q)) notify();
  },

  /** 取数 + 写回（对外唯一"重新拉取某周期 K 线"入口）：取数请求统一收在数据中心，
   *  结果写完自持缓存并返回，消费方仅读返回值就地使用，不再直接触网。 */
  async fetchAndAbsorb(
    code: string,
    period: BollPeriod,
    apiSource: ApiSource,
    adjust: BollAdjust,
    logCtx?: LogBatchContext,
  ): Promise<BollResult> {
    // 历史展示模式：不做网络请求，直接返回本部门按截止日投影的数据
    // （K 线截断至截止日、其后行情忽略，BOLL 三轨/均线/区间均基于截断序列重算）。
    // 这样所有消费方（K 线图、布林弹窗、复制指标等）拿到什么就画什么，无需各自适配。
    if (asOfDate) {
      const entry = readEntry(code);
      const data = period === 'daily' ? entry?.daily : period === 'weekly' ? entry?.weekly : entry?.monthly;
      return data ? { data } : { data: null, error: '该历史日期数据不足' };
    }
    await ensureBollCacheRestored();
    const result = await fetchBollData(code, period, adjust, apiSource, undefined, logCtx);
    priceBureau.absorb(code, period, result);
    return result;
  },

  /** 批量刷新实时行情：一次请求多只，写入各自条目并通知。缺失项由调用方逐只 refreshRealtimeSingle 兜底。 */
  async refreshRealtime(
    stocks: BureauStock[],
    trigger = '自动刷新股价',
    cancelCheck?: () => boolean,
  ): Promise<void> {
    if (asOfDate || stocks.length === 0) return;
    const logCtx: LogBatchContext = requestLogService.beginBatch(`${trigger}：${stocks.length} 只股票 · 1 条批量请求`);
    const quotes = await fetchTencentRealtime(stocks.map(s => s.code), logCtx);
    if (cancelCheck?.()) return;
    let changed = false;
    for (const s of stocks) {
      const q = quotes.get(toTencentCode(s.code));
      // 实时行情写入必须同时重算 store 日线，否则列表读到的日线仍是旧形态（如仅收盘），
      // 与浮窗自行合成实时形态产生数值差异
      if (q && applyRealtimeQuote(s.code, q)) changed = true;
    }
    if (changed) notify();
  },

  /** 逐只刷新实时行情兜底（单个代码解析失败/批量缺失时用）。返回是否成功。 */
  async refreshRealtimeSingle(code: string, trigger = '补拉单只股价'): Promise<boolean> {
    if (asOfDate) return false;
    const logCtx: LogBatchContext = requestLogService.beginBatch(`${trigger}：1 只股票 · 1 条请求`);
    const quotes = await fetchTencentRealtime([code], logCtx);
    const q = quotes.get(toTencentCode(code));
    if (q && applyRealtimeQuote(code, q)) {
      notify();
      return true;
    }
    return false;
  },

  /**
   * 只读预判：这批股票是否还有需要网络请求的缓存缺口。
   * 供调用方在批量加载前决定是否需要把列表切到「标签」排序重排；
   * 全部命中有效缓存时不产生任何副作用（判定逻辑与 ensureBatch 同源）。
   */
  async needsFetch(stocks: BureauStock[], apiSource: ApiSource, adjust: BollAdjust): Promise<boolean> {
    if (asOfDate) return false;
    const __t0 = performance.now();
    await ensureBollCacheRestored();
    const __restoreMs = performance.now() - __t0;
    const plan = planBollCache(stocks, adjust, apiSource, new Date(), getDynamicBollCacheTTL());
    requestLogService.cacheHit(`[诊断] needsFetch 等待缓存 ${__restoreMs.toFixed(1)}ms，allCached=${plan.allCached}`, BOOT_DIAG_CTX);
    return !plan.allCached;
  },

  /**
   * 批量加载（等价于原 fetchAllBoll）：
   * 判定缓存→一次应用命中→逐个缺失项顺序请求（含250ms节流），全部写回本模块并通知。
   * 日志语义与既有一致（beginBatch/缓存命中/有效期）。
   */
  async ensureBatch(
    stocks: BureauStock[],
    apiSource: ApiSource,
    adjust: BollAdjust,
    opts: EnsureBatchOpts = {},
  ): Promise<boolean> {
    // 历史展示模式：不发起任何批量拉取（照常读取截止日投影即可）
    if (asOfDate) return false;
    const __batchT0 = performance.now();
    await ensureBollCacheRestored();
    const __restoreMs = performance.now() - __batchT0;
    const trigger = opts.trigger ?? '自动刷新布林线';
    const batchTimestamp = Date.now();
    // 是否真正发起过网络请求（全部命中缓存时为 false，供调用方决定是否刷新"全量刷新时间戳"）
    let madeRequest = false;

    const dynamicTTL = getDynamicBollCacheTTL();
    const nowDate = new Date();
    const plan = planBollCache(stocks, adjust, apiSource, nowDate, dynamicTTL);
    const { allCached, cachedData, staleCount, visibleTotal } = plan;

    const cacheTimestamps = getBollCacheTimestamps(stocks, adjust, apiSource);
    lastBatchContext = { stocks, adjust, apiSource };
    const cachedByCode = buildCachedByCode(cachedData, stocks);
    let cacheInfoStr = '';
    let oldCacheInfoStr = '';
    if (cacheTimestamps.length > 0) {
      const maxTs = Math.max(...cacheTimestamps);
      const nowMs = nowDate.getTime();
      const isTrading = isTradingHours(nowDate);
      const expiryTime = isTrading ? maxTs + dynamicTTL : nowMs + dynamicTTL;
      cacheInfoStr = `（缓存有效期至：${formatCacheTime(expiryTime)}）`;
      oldCacheInfoStr = `（原缓存有效期至 ${formatCacheTime(maxTs + dynamicTTL)}）`;
    }

    const logCtx = requestLogService.beginBatch(
      staleCount === 0
        ? `${trigger}：${visibleTotal} 项缓存均未过期，无需请求${cacheInfoStr}`
        : `${trigger}：${staleCount}/${visibleTotal} 项已过期${oldCacheInfoStr}，重新请求 ${staleCount} 条请求${cacheInfoStr}`
    );
    emitBollCacheHits(plan.hitKeys, logCtx);

    if (allCached) {
      const __applyT0 = performance.now();
      priceBureau.setEntries(cachedByCode);
      requestLogService.cacheHit(`[诊断] ensureBatch 等缓存 ${__restoreMs.toFixed(1)}ms，首次落地 ${(performance.now() - __applyT0).toFixed(1)}ms，共 ${cachedByCode.size} 只`, BOOT_DIAG_CTX);
      return madeRequest;
    }

    // 先把已命中项一次性批量应用，再对缺失项顺序请求
    priceBureau.setEntries(cachedByCode);

    const order = opts.order ?? stocks;
    const targetIds = new Set(stocks.map(s => s.id));
    for (let i = 0; i < order.length; i++) {
      if (opts.cancelCheck?.()) return madeRequest;
      const stock = order[i];
      if (!targetIds.has(stock.id)) continue;
      if (stock.bollHidden) continue;

      const cachedStockData = cachedData.get(stock.id);
      if (cachedStockData?.daily && cachedStockData?.weekly && cachedStockData?.monthly) {
        continue; // 已在循环前批量应用
      }

      const [dailyR, weeklyR, monthlyR] = await Promise.all([
        fetchBollData(stock.code, 'daily', adjust, apiSource, batchTimestamp, logCtx),
        fetchBollData(stock.code, 'weekly', adjust, apiSource, batchTimestamp, logCtx),
        fetchBollData(stock.code, 'monthly', adjust, apiSource, batchTimestamp, logCtx),
      ]);
      madeRequest = true; // 本次确实发起了网络请求
      if (opts.cancelCheck?.()) return madeRequest;
      const code = stock.code;
      const cur = store.get(code) ?? { daily: null, weekly: null, monthly: null, realtime: null };
      store.set(code, {
        // 日线统一按"含今日实时价"形态写入（与 absorb / 实时刷新同一实现）
        daily: buildLiveDaily(dailyR.data ?? cur.daily, cur.realtime),
        weekly: weeklyR.data ?? cur.weekly,
        monthly: monthlyR.data ?? cur.monthly,
        realtime: cur.realtime,
      });
      notify();

      // 网络请求后等待 250ms 再请求下一只（其间仍可取消）
      if (i < order.length - 1) {
        for (let w = 0; w < 25; w++) {
          await new Promise(resolve => setTimeout(resolve, 10));
          if (opts.cancelCheck?.()) return madeRequest;
        }
      }
    }
    return madeRequest;
  },
};

// K 线缓存从 IndexedDB 后台补齐完成后，按最近一次批量加载的股票重新落地一次：
// 首屏只用摘要先把 BOLL 数字画出来，依赖 K 线的标签 / 区间比例在这里补齐。
subscribeBollKlinesHydrated(() => {
  const ctx = lastBatchContext;
  if (!ctx || asOfDate) return;
  const plan = planBollCache(ctx.stocks, ctx.adjust, ctx.apiSource, new Date(), getDynamicBollCacheTTL());
  priceBureau.setEntries(buildCachedByCode(plan.cachedData, ctx.stocks, true));
});