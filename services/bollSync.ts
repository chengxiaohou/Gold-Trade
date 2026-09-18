// 布林线缓存的"判定 / 使用 / 请求"决策纯函数，无副作用，便于单元测试。
// 真实市场状态、当前时间、缓存内容均作为入参注入，函数内部不再 new Date()。
// 盘中/午休/盘后/盘前 的新鲜度口径由调用方从 cacheService 的 getMarketStatus/getLastTradingOpen 注入。
import type { ApiSource, MarketStatus } from '../types';
import { getMarketStatus, getLastTradingOpen } from './cacheService';
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
  marketStatus: MarketStatus;
  cachedAt: number | null; // 缓存时间戳；null 视为无缓存
  nowMs: number;
  tradingTTL: number; // 盘中判定用 TTL(ms)，由调用方从 getDynamicBollCacheTTL 注入
  lastOpenMs: number | null; // 非盘中判定基准"最近一次数据基准开盘时间"，由调用方从 getLastTradingOpen 注入
  hasCompleteData?: boolean; // 是否含完整字段（ma.ma30）；缺失视为过期
}

/**
 * 单条缓存新鲜度：
 * - 盘中(morning/afternoon)：缓存年龄在 TTL 内视为新鲜。
 * - 非盘中(午休/盘后/盘前/全天休市)：K线数据不再变化，只要缓存是在
 *   "最近一次数据基准开盘时间"之后拉取的即视为新鲜（有效期到下次开盘）。
 * 注意：盘后基准用当天 9:30（而非 13:00），否则当天上午拉的缓存会被误判过期。
 */
export function isBollFresh(p: BollFreshnessParams): boolean {
  if (p.cachedAt == null || p.hasCompleteData === false) return false;
  if (p.marketStatus === 'morning_session' || p.marketStatus === 'afternoon_session') {
    return p.nowMs - p.cachedAt < p.tradingTTL;
  }
  if (p.lastOpenMs == null) return false;
  return p.cachedAt >= p.lastOpenMs;
}

export interface BollPeriodData {
  daily: BollData | null;
  weekly: BollData | null;
  monthly: BollData | null;
}

export interface BollCachePlan {
  allCached: boolean;
  cachedData: Map<string, BollPeriodData>;
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
  tradingTTL: number;
  hasComplete?: (entry: BollCacheEntry) => boolean;
}

/**
 * 总体"判定 + 批量/逐只"决策：
 * 输出 { allCached, cachedData, staleCount, visibleTotal, toFetch, hitKeys }。
 * - cachedData 为"应一次性批量应用"的命中数据（命中项放入该集合）。
 * - toFetch 为真正缺失/过期、需逐个发请求的项（缺失项放入该集合）。
 * - allCached=true 且 staleCount=0 时无需任何网络请求。
 */
export function planBollCacheUse(input: PlanBollCacheInput): BollCachePlan {
  const marketStatus = getMarketStatus(input.now);
  const isTrading = marketStatus === 'morning_session' || marketStatus === 'afternoon_session';
  const lastOpenMs = isTrading ? null : getLastTradingOpen(input.now).getTime();
  const nowMs = input.now.getTime();
  const hasComplete = input.hasComplete ?? ((e: BollCacheEntry) => Boolean(e.data?.ma?.ma30));

  const cachedData = new Map<string, BollPeriodData>();
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
    const missing: BollPeriod[] = [];
    for (const period of BOLL_PERIODS) {
      const key = input.cacheKeyFor(stock, period);
      const entry = input.cacheGet(key);
      const fresh = entry
        ? isBollFresh({
            marketStatus,
            cachedAt: entry.timestamp,
            nowMs,
            tradingTTL: input.tradingTTL,
            lastOpenMs,
            hasCompleteData: hasComplete(entry),
          })
        : false;
      if (fresh) {
        data.set(period, entry.data);
        hitKeys.push(key);
      } else {
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
    if (missing.length > 0) {
      toFetch.push({ id: stock.id, code: stock.code, periods: missing });
    }
  }

  return { allCached, cachedData, staleCount, visibleTotal, toFetch, hitKeys };
}