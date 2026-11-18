// 布林线缓存的"判定 / 使用 / 请求"决策纯函数，无副作用，便于单元测试。
// 真实时间与缓存内容均作为入参注入，函数内部不再 new Date()。
// 缓存新鲜度口径统一由 cacheService 的 getLastTradingClose 注入。
import type { ApiSource } from '../types';
import { getLastTradingClose } from './cacheService';
import type { BollData } from './bollService';

const periods: BollPeriod[] = ['daily', 'weekly', 'monthly'];

export type BollPeriod = 'daily' | 'weekly' | 'monthly';
export type BollAdjust = 'qfq' | 'none';

export const BOLL_PERIODS: BollPeriod[] = periods;

// 与 bollService.BollData 的最小兼容视图（只需判断完整度，便于注入轻量假数据）
export interface BollCacheEntry {
  data: BollData | null;
  timestamp: number;
}

export interface BollStockInput {
  id: string;
  code: string;
  bollHidden?: boolean;
}

export interface BollFreshnessParams {
  cachedAt: number | null; // 缓存时间戳；null 视为无缓存
  lastCloseMs: number; // 最近一次"已落定收盘时点"（交易日 15:01），由调用方从 getLastTradingClose 注入
  hasCompleteData?: boolean; // 是否含完整字段（ma.ma30）；缺失视为过期
}

/**
 * 单条缓存新鲜度（唯一口径）：
 * 只要缓存是在"最近一次已落定收盘时点"之后拉取的即视为新鲜。
 * 即每个交易日收盘后允许全量拉取一次，成功后到下一个交易日收盘前都复用这份数据，
 * 盘中不再因为缓存年龄而重复全量拉取（今日形态由实时价合成）。
 */
export function isBollFresh(p: BollFreshnessParams): boolean {
  if (p.cachedAt == null || p.hasCompleteData === false) return false;
  return p.cachedAt >= p.lastCloseMs;
}

export interface BollPeriodData {
  daily: BollData | null;
  weekly: BollData | null;
  monthly: BollData | null;
}

export interface BollCachePlan {
  allCached: boolean;
  cachedData: Map<string, BollPeriodData>;
  /** 过期但仍存在的缓存数据：用于"边展示旧数据边刷新"（单元格会标记为过期样式） */
  staleData: Map<string, BollPeriodData>;
  staleCount: number; // 过期(需请求)的 股票×周期 项数；隐藏股票不计
  visibleTotal: number; // 可见(未隐藏)股票的 股票×周期 总数
  toFetch: Array<{ id: string; code: string; periods: BollPeriod[] }>; // 缺失/过期的项
  hitKeys: string[]; // 判定为新鲜命中的缓存 key（供请求日志展示）
}

export interface PlanBollCacheInput {
  stocks: BollStockInput[];
  adjust: BollAdjust;
  apiSource: ApiSource;
  now: Date;
  cacheKeyFor: (stock: BollStockInput, period: BollPeriod) => string;
  cacheGet: (key: string) => BollCacheEntry | undefined;
  hasComplete?: (entry: BollCacheEntry) => boolean;
  /** 强制刷新：忽略新鲜度，全部视为需要重新请求（命中项也不再批量应用） */
  force?: boolean;
}

/**
 * 总体"判定 + 批量/逐只"决策：
 * 输出 { allCached, cachedData, staleCount, visibleTotal, toFetch, hitKeys }。
 * - cachedData 为"应一次性批量应用"的命中数据（命中项放入该集合）。
 * - toFetch 为真正缺失/过期、需逐个发请求的项（缺失项放入该集合）。
 * - allCached=true 且 staleCount=0 时无需任何网络请求。
 */
export function planBollCacheUse(input: PlanBollCacheInput): BollCachePlan {
  const lastCloseMs = getLastTradingClose(input.now).getTime();
  const hasComplete = input.hasComplete ?? ((e: BollCacheEntry) => Boolean(e.data?.ma?.ma30));

  const cachedData = new Map<string, BollPeriodData>();
  const staleData = new Map<string, BollPeriodData>();
  const toFetch: Array<{ id: string; code: string; periods: BollPeriod[] }> = [];
  const hitKeys: string[] = [];
  let staleCount = 0;
  let visibleTotal = 0;
  let allCached = true;

  for (const stock of input.stocks) {
    if (stock.bollHidden) {
      cachedData.set(stock.id, { daily: null, weekly: null, monthly: null });
      continue;
    }
    visibleTotal += BOLL_PERIODS.length;

    const data = new Map<BollPeriod, BollData | null>();
    const stale = new Map<BollPeriod, BollData | null>();
    const missing: BollPeriod[] = [];
    for (const period of BOLL_PERIODS) {
      const key = input.cacheKeyFor(stock, period);
      const entry = input.cacheGet(key);
      const fresh = !input.force && entry
        ? isBollFresh({
            cachedAt: entry.timestamp,
            lastCloseMs,
            hasCompleteData: hasComplete(entry),
          })
        : false;
      if (fresh) {
        data.set(period, entry!.data);
        hitKeys.push(key);
      } else {
        // 过期但仍留有数据：单独收集，供"先展示旧数据再逐个覆盖"
        if (entry?.data) stale.set(period, entry.data);
        allCached = false;
        staleCount++;
        missing.push(period);
      }
    }

    cachedData.set(stock.id, {
      daily: data.get('daily') ?? null,
      weekly: data.get('weekly') ?? null,
      monthly: data.get('monthly') ?? null,
    });
    if (stale.size > 0) {
      staleData.set(stock.id, {
        daily: stale.get('daily') ?? null,
        weekly: stale.get('weekly') ?? null,
        monthly: stale.get('monthly') ?? null,
      });
    }
    if (missing.length > 0) {
      toFetch.push({ id: stock.id, code: stock.code, periods: missing });
    }
  }

  return { allCached, cachedData, staleData, staleCount, visibleTotal, toFetch, hitKeys };
}