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
} from './bollService';
import { getDynamicBollCacheTTL, isTradingHours, formatCacheTime, getMarketStatus } from './cacheService';
import { requestLogService } from './requestLogService';

export interface PriceEntry {
  daily: BollData | null;
  weekly: BollData | null;
  monthly: BollData | null;
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
  return !e.daily && !e.weekly && !e.monthly;
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

  /** 数据部的统一"今日日K线"出口：把实时行情的最新一根 K 线并入缓存的日线，
   *  最新一根 close 由 mergeTodayBarToKlines 统一收敛（未收盘=实时现价，已收盘=以实时行情为准≈收盘价）。
   *  所有需要"含最新一根收盘价"的消费方（股息率曲线/价格浮窗）一律走这里，杜绝各组件自行 merge 造成漂移。
   *  无有效实时行情(price/open<=0)时原样返回缓存日线。 */
  getTodayDailyKlines(code: string, rt: TodayBarInput): BollKline[] {
    const base = store.get(code)?.daily?.klines ?? [];
    return mergeTodayBarToKlines(base, rt, getMarketStatus());
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

  /** 写入单个周期结果（供各处 fetchBollData 现场喂入，保证全项目同一 code 的同一周期同源） */
  absorb(code: string, period: BollPeriod, result: { data: BollData | null }): void {
    const cur = store.get(code) ?? { daily: null, weekly: null, monthly: null };
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
    const cur = store.get(code) ?? { daily: null, weekly: null, monthly: null };
    const next: PriceEntry = { ...cur, [period]: result.data };
    store.set(code, next);
    notify();
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
  ): Promise<void> {
    await ensureBollCacheRestored();
    const trigger = opts.trigger ?? '自动刷新布林线';
    const batchTimestamp = Date.now();

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
      if (code) cachedByCode.set(code, entry);
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
      return;
    }

    // 先把已命中项一次性批量应用，再对缺失项顺序请求
    priceBureau.setEntries(cachedByCode);

    const order = opts.order ?? stocks;
    const targetIds = new Set(stocks.map(s => s.id));
    for (let i = 0; i < order.length; i++) {
      if (opts.cancelCheck?.()) return;
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
      if (opts.cancelCheck?.()) return;
      const code = stock.code;
      const cur = store.get(code) ?? { daily: null, weekly: null, monthly: null };
      store.set(code, {
        daily: dailyR.data ?? cur.daily,
        weekly: weeklyR.data ?? cur.weekly,
        monthly: monthlyR.data ?? cur.monthly,
      });
      notify();

      // 网络请求后等待 250ms 再请求下一只（其间仍可取消）
      if (i < order.length - 1) {
        for (let w = 0; w < 25; w++) {
          await new Promise(resolve => setTimeout(resolve, 10));
          if (opts.cancelCheck?.()) return;
        }
      }
    }
  },
};