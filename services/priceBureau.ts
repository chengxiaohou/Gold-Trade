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
  mergeTodayBarToKlines,
  type BollData,
  type BollPeriod,
  type BollAdjust,
  type BollKline,
  type TodayBarInput,
  type BollResult,
} from './bollService';
import { getDynamicBollCacheTTL, isTradingHours, formatCacheTime, getMarketStatus } from './cacheService';
import { requestLogService, type LogBatchContext } from './requestLogService';
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

// 订阅表：任何条目写入都触发全部监听，页面用它回填镜像 state 触发重渲
const listeners = new Set<() => void>();
function notify(): void {
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
    return store.get(code) ?? null;
  },

  getDaily(code: string): BollData | null {
    return store.get(code)?.daily ?? null;
  },
  getWeekly(code: string): BollData | null {
    return store.get(code)?.weekly ?? null;
  },
  getMonthly(code: string): BollData | null {
    return store.get(code)?.monthly ?? null;
  },

  /** 唯一"今日合并日K线"权威：返回该股票的 canonical 日 K 线（bollService 已做盘中 volume 保护）。 */
  getTodayKlines(code: string): BollKline[] | null {
    return store.get(code)?.daily?.klines ?? null;
  },

  /** 自持的当日最新实时行情（未收盘前含当日）。 */
  getRealtime(code: string): RealTimeQuote | null {
    return store.get(code)?.realtime ?? null;
  },

  /** 数据形态①【仅收盘】：未收盘时剔除今日 K 线，历史到最近一个已收盘交易日为止。
   *  给回测引擎、历史股息率等"不掺未收盘实时价"的消费方显式选择。 */
  getClosedKlines(code: string, period: BollPeriod): BollKline[] | null {
    const entry = store.get(code);
    const data = period === 'daily' ? entry?.daily : period === 'weekly' ? entry?.weekly : entry?.monthly;
    return toClosedKlines(data?.klines, getMarketStatus());
  },

  /** 数据形态②【含未收盘】：把自持的最新实时行情合成进今日 K 线。
   *  自包含——优先用本模块自持 realtime 合成；未自持时才用调用方传入的 rt 兜底；
   *  两者皆无有效实时价时退回"仅收盘"序列。所有要"当前/今日实时"的消费方一律走这里。 */
  getTodayDailyKlines(code: string, rt?: TodayBarInput): BollKline[] {
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

  /** 覆盖式写入单只条目（返回 false 表示写的是一个空条目，供调用方决定是否保留） */
  setEntry(code: string, entry: PriceEntry): void {
    if (isEmpty(entry)) {
      store.delete(code);
    } else {
      store.set(code, entry);
    }
    notify();
  },

  /** 写入单个周期结果（供内部喂入，保证全项目同一 code 的同一周期同源） */
  absorb(code: string, period: BollPeriod, result: { data: BollData | null }): void {
    const cur = store.get(code) ?? { daily: null, weekly: null, monthly: null, realtime: null };
    if (result.data) {
      store.set(code, { ...cur, [period]: result.data });
      notify();
    }
  },

  /** 一次性批量写入（用于缓存全命中/初扫） */
  setEntries(entries: Map<string, PriceEntry>): void {
    for (const [code, entry] of entries) {
      if (isEmpty(entry)) {
        store.delete(code);
      } else {
        store.set(code, entry);
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
    if (store.get(code)?.[period]) return;
    await ensureBollCacheRestored();
    const result = await fetchBollData(code, period, adjust, apiSource);
    const cur = store.get(code) ?? { daily: null, weekly: null, monthly: null, realtime: null };
    const next: PriceEntry = { ...cur, [period]: result.data };
    store.set(code, next);
    notify();
  },

  /** 写入单只最新实时行情（供刷新/回填复用），写实会 notify。 */
  setRealtime(code: string, q: TencentQuote): void {
    const cur = store.get(code) ?? { daily: null, weekly: null, monthly: null, realtime: null };
    store.set(code, { ...cur, realtime: { ...q, updatedAt: Date.now() } });
    notify();
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
    if (stocks.length === 0) return;
    const logCtx: LogBatchContext = requestLogService.beginBatch(`${trigger}：${stocks.length} 只股票 · 1 条批量请求`);
    const quotes = await fetchTencentRealtime(stocks.map(s => s.code), logCtx);
    if (cancelCheck?.()) return;
    let changed = false;
    for (const s of stocks) {
      const q = quotes.get(toTencentCode(s.code));
      if (q) {
        if (!changed) changed = true;
        const cur = store.get(s.code) ?? { daily: null, weekly: null, monthly: null, realtime: null };
        store.set(s.code, { ...cur, realtime: { ...q, updatedAt: Date.now() } });
      }
    }
    if (changed) notify();
  },

  /** 逐只刷新实时行情兜底（单个代码解析失败/批量缺失时用）。返回是否成功。 */
  async refreshRealtimeSingle(code: string, trigger = '补拉单只股价'): Promise<boolean> {
    const logCtx: LogBatchContext = requestLogService.beginBatch(`${trigger}：1 只股票 · 1 条请求`);
    const quotes = await fetchTencentRealtime([code], logCtx);
    const q = quotes.get(toTencentCode(code));
    if (q) {
      const cur = store.get(code) ?? { daily: null, weekly: null, monthly: null, realtime: null };
      store.set(code, { ...cur, realtime: { ...q, updatedAt: Date.now() } });
      notify();
      return true;
    }
    return false;
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
    await ensureBollCacheRestored();
    const trigger = opts.trigger ?? '自动刷新布林线';
    const batchTimestamp = Date.now();
    // 是否真正发起过网络请求（全部命中缓存时为 false，供调用方决定是否刷新"全量刷新时间戳"）
    let madeRequest = false;

    const dynamicTTL = getDynamicBollCacheTTL();
    const nowDate = new Date();
    const plan = planBollCache(stocks, adjust, apiSource, nowDate, dynamicTTL);
    const { allCached, cachedData, staleCount, visibleTotal } = plan;

    const cacheTimestamps = getBollCacheTimestamps(stocks, adjust, apiSource);
    // cachedData 按 stock.id 索引，本模块按 stock.code 索引 → 建立 id→code 映射
    const idToCode = new Map<string, string>();
    for (const s of stocks) idToCode.set(s.id, s.code);
    const cachedByCode = new Map<string, PriceEntry>();
    for (const [id, entry] of cachedData) {
      const code = idToCode.get(id);
      const prevRt = store.get(code)?.realtime ?? null;
      if (code) cachedByCode.set(code, { realtime: prevRt, ...entry });
    }
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
      priceBureau.setEntries(cachedByCode);
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
        daily: dailyR.data ?? cur.daily,
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