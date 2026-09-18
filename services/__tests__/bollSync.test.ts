import { describe, it, expect } from 'vitest';
import { isBollFresh, planBollCacheUse, BOLL_PERIODS, type BollPeriod, type BollAdjust } from '../bollSync';
import { getLastTradingOpen, getMarketStatus } from '../cacheService';
import type { BollData } from '../bollService';
import type { ApiSource, MarketStatus } from '../../types';

// ---- 时间工厂：local 时间，便于按市场状态构造 ----
const D = (s: string) => new Date(`${s}:00`);
// 周五 2024-01-05 各时段
const MORNING_OPEN_MS = D('2024-01-05T10:30').getTime(); // 盘中 上午
const AFTERNOON_MS = D('2024-01-05T14:00').getTime(); // 盘中 下午
const MIDDAY_MS = D('2024-01-05T12:00').getTime(); // 午休
const CLOSED_MS = D('2024-01-05T16:00').getTime(); // 盘后
const PREOPEN_MS = D('2024-01-05T09:15').getTime(); // 盘前
const FULL_DAY_CLOSED_MS = D('2024-01-06T10:00').getTime(); // 周六 全天休市

const TRADING_TTL = 120 * 60 * 1000; // 默认盘中 TTL 2 小时，与线上 bollCacheTTLMinutes=120 一致

function fresh(marketStatus: MarketStatus, cachedAt: number | null, nowMs: number, lastOpenMs: number | null, hasCompleteData = true): boolean {
  return isBollFresh({ marketStatus, cachedAt, nowMs, tradingTTL: TRADING_TTL, lastOpenMs, hasCompleteData });
}

function lastOpen(nowMs: number): number {
  return getLastTradingOpen(new Date(nowMs)).getTime();
}

// ---- 最小完整 BollData（含 ma.ma30） ----
function mkBoll(close: number, ts: number): BollData {
  return {
    upper: close, mid: close, lower: close, close,
    ma: { ma5: close, ma10: null, ma20: null, ma30: close, ma60: null, ma120: null, ma250: null, ma500: null },
    date: '', fetchedAt: ts, rangeCount: 0, rangePriceHigh: 0, rangePriceHighDate: '',
    rangePriceLow: 0, rangePriceLowDate: '',
  };
}

// ---- planBollCacheUse 缓存注入工厂 ----
const ADJUST: BollAdjust = 'qfq';
const API: ApiSource = 'tencent';
const kf = (code: string, period: BollPeriod, adjust: BollAdjust = ADJUST, api: ApiSource = API) =>
  `${code}_${period}_${adjust}_${api}`;

// 为若干股票生成"三周期齐全"的缓存
function seedAll(codes: string[], ts: number, adjust: BollAdjust = ADJUST, api: ApiSource = API) {
  const m = new Map<string, { data: BollData; timestamp: number }>();
  for (const code of codes) {
    for (const p of BOLL_PERIODS) {
      m.set(kf(code, p, adjust, api), { data: mkBoll(1, ts), timestamp: ts });
    }
  }
  return m;
}

function runPlan({
  codes, now, cache, tradingTTL = TRADING_TTL, adjust = ADJUST, api = API,
  hidden = new Set<string>(),
}: {
  codes: string[];
  now: Date;
  cache: Map<string, { data: BollData; timestamp: number }>;
  tradingTTL?: number;
  adjust?: BollAdjust;
  api?: ApiSource;
  hidden?: Set<string>;
}) {
  const stocks = codes.map(code => ({ id: code, code, bollHidden: hidden.has(code) ? true : undefined }));
  return planBollCacheUse({
    stocks, adjust, apiSource: api, now, tradingTTL,
    cacheGet: k => cache.get(k),
    cacheKeyFor: (stock, period) => kf(stock.code, period, adjust, api),
  });
}

// ============================================================
// 第一类：缓存使用 / 新鲜度 —— 盘中·午休·盘后·盘前 各状态
// ============================================================
describe('isBollFresh：各市场状态下的新鲜度判定', () => {
  it('盘中(morning_session)：缓存年龄在 TTL 内为新鲜，超期则过期', () => {
    expect(fresh('morning_session', MORNING_OPEN_MS - 30 * 60 * 1000, MORNING_OPEN_MS, null)).toBe(true);
    expect(fresh('morning_session', MORNING_OPEN_MS - 5 * 3600 * 1000, MORNING_OPEN_MS, null)).toBe(false); // 超 2h
    expect(fresh('morning_session', D('2024-01-05T08:00').getTime(), MORNING_OPEN_MS, null)).toBe(false); // 8:00 拉、10:30 看：150min≥120
    expect(fresh('afternoon_session', AFTERNOON_MS - 60 * 60 * 1000, AFTERNOON_MS, null)).toBe(true);
  });

  it('盘中：缓存时间为空/null → 视为过期', () => {
    expect(fresh('morning_session', null, MORNING_OPEN_MS, null)).toBe(false);
  });

  it('午休(midday_break)：当天上午拉取的缓存为新鲜，昨天缓存过期', () => {
    const lo = lastOpen(MIDDAY_MS); // 当天 9:30
    expect(fresh('midday_break', MIDDAY_MS - 40 * 60 * 1000, MIDDAY_MS, lo)).toBe(true); // 当早 11:20 → >=9:30
    expect(fresh('midday_break', D('2024-01-04T15:00').getTime(), MIDDAY_MS, lo)).toBe(false); // 昨天 → <9:30
  });

  it('盘后(closed)：当天上午缓存视为新鲜（根因修复：基准为当天 9:30 而非 13:00）', () => {
    const lo = lastOpen(CLOSED_MS);
    // 关键回归：上午 10:00 拉的缓存，原逻辑(>=13:00)会误判过期
    expect(fresh('closed', D('2024-01-05T10:00').getTime(), CLOSED_MS, lo)).toBe(true);
    expect(fresh('closed', D('2024-01-05T14:00').getTime(), CLOSED_MS, lo)).toBe(true);
    // 仍在发生变化的上一个工作日缓存 → 需重拉
    expect(fresh('closed', D('2024-01-04T15:00').getTime(), CLOSED_MS, lo)).toBe(false);
  });

  it('盘前(pre_open)：最近一个交易日盘中缓存为新鲜', () => {
    const lo = lastOpen(PREOPEN_MS); // 回溯到周四 9:30
    expect(fresh('pre_open', D('2024-01-04T10:00').getTime(), PREOPEN_MS, lo)).toBe(true);
    expect(fresh('pre_open', D('2024-01-03T10:00').getTime(), PREOPEN_MS, lo)).toBe(false);
  });

  it('全天休市(full_day_closed，周六)：上周五盘中缓存为新鲜', () => {
    const market = 'full_day_closed' as const;
    const lo = lastOpen(FULL_DAY_CLOSED_MS); // 回溯到周五 9:30
    expect(fresh(market, D('2024-01-05T10:00').getTime(), FULL_DAY_CLOSED_MS, lo)).toBe(true);
    expect(fresh(market, D('2024-01-04T15:00').getTime(), FULL_DAY_CLOSED_MS, lo)).toBe(false); // 周四
  });

  it('缓存字段不完整（缺 ma.ma30）→ 视为过期', () => {
    expect(fresh('closed', D('2024-01-05T10:00').getTime(), CLOSED_MS, lastOpen(CLOSED_MS), false)).toBe(false);
  });
});

// ============================================================
// 第二类：请求 / 不请求决策 —— staleCount、allCached、toFetch
// ============================================================
describe('planBollCacheUse：请求决策', () => {
  it('盘后 + 当天上午所有缓存新鲜 → allCached=true、staleCount=0、无需请求（用户最关心的场景）', () => {
    const cache = seedAll(['sh600000', 'sz000001'], D('2024-01-05T10:00').getTime());
    const plan = runPlan({ codes: ['sh600000', 'sz000001'], now: new Date(CLOSED_MS), cache });
    expect(getMarketStatus(new Date(CLOSED_MS))).toBe('closed');
    expect(plan.allCached).toBe(true);
    expect(plan.staleCount).toBe(0);
    expect(plan.visibleTotal).toBe(6); // 2 只股票 × 3 周期
    expect(plan.toFetch).toEqual([]);
    expect(plan.hitKeys).toHaveLength(6);
  });

  it('盘后：部分股票缓存缺失 → 该股票进入 toFetch、allCached=false', () => {
    const cache = seedAll(['sh600000'], D('2024-01-05T10:00').getTime());
    const plan = runPlan({ codes: ['sh600000', 'sz000001'], now: new Date(CLOSED_MS), cache });
    expect(plan.allCached).toBe(false);
    expect(plan.staleCount).toBe(3);
    expect(plan.visibleTotal).toBe(6);
    expect(plan.toFetch).toHaveLength(1);
    expect(plan.toFetch[0].code).toBe('sz000001');
    expect(plan.toFetch[0].periods).toEqual(BOLL_PERIODS);
  });

  it('盘后：单只某周期过期 → 仅该周期待请求、staleCount 反映该周期', () => {
    const cache = seedAll(['sh600000'], D('2024-01-05T10:00').getTime());
    // 仅摘掉 weekly 使其缺失
    cache.delete(kf('sh600000', 'weekly'));
    const plan = runPlan({ codes: ['sh600000'], now: new Date(CLOSED_MS), cache });
    expect(plan.allCached).toBe(false);
    expect(plan.staleCount).toBe(1);
    expect(plan.visibleTotal).toBe(3);
    expect(plan.toFetch[0].code).toBe('sh600000');
    expect(plan.toFetch[0].periods).toEqual(['weekly']);
  });

  it('盘中：缓存超龄 → 判定过期需重拉', () => {
    const cache = seedAll(['sh600000'], MORNING_OPEN_MS - 5 * 3600 * 1000); // 昨晚缓存
    const plan = runPlan({ codes: ['sh600000'], now: new Date(MORNING_OPEN_MS), cache });
    expect(getMarketStatus(new Date(MORNING_OPEN_MS))).toBe('morning_session');
    expect(plan.allCached).toBe(false);
    expect(plan.toFetch[0].code).toBe('sh600000');
  });

  it('隐藏布林线的股票不计入 visibleTotal/staleCount、不进 toFetch', () => {
    const cache = seedAll(['sh600000'], D('2024-01-05T10:00').getTime());
    const plan = runPlan({ codes: ['sh600000', 'sz000001'], now: new Date(CLOSED_MS), cache, hidden: new Set(['sh600000']) });
    expect(plan.visibleTotal).toBe(3); // 只算可见的 sz000001
    expect(plan.staleCount).toBe(3);
    expect(plan.toFetch).toHaveLength(1);
    expect(plan.toFetch[0].code).toBe('sz000001');
  });
});

// ============================================================
// 第三类：批量 vs 逐只 —— cachedData 合并/优先，缺失项进 toFetch
// ============================================================
describe('planBollCacheUse：批量 vs 逐只', () => {
  it('全部命中：一次性合并到 cachedData，toFetch 为空', () => {
    const cache = seedAll(['sh600000'], D('2024-01-05T10:00').getTime());
    const plan = runPlan({ codes: ['sh600000'], now: new Date(CLOSED_MS), cache });
    const cd = plan.cachedData.get('sh600000')!;
    expect(cd.daily).not.toBeNull();
    expect(cd.weekly).not.toBeNull();
    expect(cd.monthly).not.toBeNull();
    expect(plan.toFetch).toHaveLength(0);
  });

  it('部分命中：命中项进入批量集合(cachedData)、缺失项进入待请求集合(toFetch)', () => {
    const cache = seedAll(['sh600000'], D('2024-01-05T10:00').getTime());
    cache.delete(kf('sh600000', 'monthly')); // 缺 monthly
    const plan = runPlan({ codes: ['sh600000'], now: new Date(CLOSED_MS), cache });
    const cd = plan.cachedData.get('sh600000')!;
    // 命中项被一次性合并（含完整数据），缺失项为 null
    expect(cd.daily).not.toBeNull();
    expect(cd.weekly).not.toBeNull();
    expect(cd.monthly).toBeNull();
    // 缺失项进入待请求集合
    expect(plan.toFetch[0].code).toBe('sh600000');
    expect(plan.toFetch[0].periods).toEqual(['monthly']);
  });

  it('多只股票：每只独立判定，命中不进 toFetch、缺失才进', () => {
    const cache = seedAll(['sh600000', 'sz000858'], D('2024-01-05T10:00').getTime());
    cache.delete(kf('sz000858', 'weekly'));
    const plan = runPlan({ codes: ['sh600000', 'sz000858'], now: new Date(CLOSED_MS), cache });
    expect(plan.allCached).toBe(false);
    expect(plan.staleCount).toBe(1);
    // sh600000 全命中 → 不在 toFetch
    expect(plan.toFetch).toHaveLength(1);
    expect(plan.toFetch[0].code).toBe('sz000858');
    expect(plan.toFetch[0].periods).toEqual(['weekly']);
    // sh600000 三周期都有 can被批量应用
    const a = plan.cachedData.get('sh600000')!;
    expect(a.daily).not.toBeNull();
    expect(a.weekly).not.toBeNull();
    expect(a.monthly).not.toBeNull();
  });
});