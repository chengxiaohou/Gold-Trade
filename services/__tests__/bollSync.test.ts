import { describe, it, expect } from 'vitest';
import { isBollFresh, planBollCacheUse, BOLL_PERIODS, type BollPeriod, type BollAdjust } from '../bollSync';
import { getLastTradingClose, getMarketStatus } from '../cacheService';
import type { BollData } from '../bollService';
import type { ApiSource } from '../../types';

// ---- 时间工厂：local 时间，便于按市场状态构造 ----
const D = (s: string) => new Date(`${s}:00`);
// 周五 2024-01-05 各时段
const MORNING_OPEN_MS = D('2024-01-05T10:30').getTime(); // 盘中 上午
const AFTERNOON_MS = D('2024-01-05T14:00').getTime(); // 盘中 下午
const MIDDAY_MS = D('2024-01-05T12:00').getTime(); // 午休
const CLOSED_MS = D('2024-01-05T16:00').getTime(); // 盘后
const PREOPEN_MS = D('2024-01-05T09:15').getTime(); // 盘前
const FULL_DAY_CLOSED_MS = D('2024-01-06T10:00').getTime(); // 周六 全天休市

// 新鲜度唯一口径：缓存时间 >= 最近一次"已落定收盘时点"（交易日 15:01）
function fresh(cachedAt: number | null, nowMs: number, hasCompleteData = true): boolean {
  return isBollFresh({
    cachedAt,
    lastCloseMs: getLastTradingClose(new Date(nowMs)).getTime(),
    hasCompleteData,
  });
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
  codes, now, cache, adjust = ADJUST, api = API,
  hidden = new Set<string>(), force = false,
}: {
  codes: string[];
  now: Date;
  cache: Map<string, { data: BollData; timestamp: number }>;
  adjust?: BollAdjust;
  api?: ApiSource;
  hidden?: Set<string>;
  force?: boolean;
}) {
  const stocks = codes.map(code => ({ id: code, code, bollHidden: hidden.has(code) ? true : undefined }));
  return planBollCacheUse({
    stocks, adjust, apiSource: api, now, force,
    cacheGet: k => cache.get(k),
    cacheKeyFor: (stock, period) => kf(stock.code, period, adjust, api),
  });
}

// ============================================================
// 第一类：缓存使用 / 新鲜度 —— 盘中·午休·盘后·盘前 各状态
// ============================================================
describe('isBollFresh：各市场状态下的新鲜度判定（唯一口径 = 最近已落定收盘时点）', () => {
  it('盘中(morning_session)：昨日收盘后拉的缓存即新鲜，昨日收盘前拉的过期', () => {
    // 昨日 15:10 拉 → >= 昨日 15:01 → 新鲜，盘中不再因为缓存年龄重复全量拉取
    expect(fresh(D('2024-01-04T15:10').getTime(), MORNING_OPEN_MS)).toBe(true);
    // 昨日 15:01（落定时点）→ 新鲜
    expect(fresh(D('2024-01-04T15:01').getTime(), MORNING_OPEN_MS)).toBe(true);
    // 昨日 15:00（收盘瞬间，数据尚未落定）→ 过期
    expect(fresh(D('2024-01-04T15:00').getTime(), MORNING_OPEN_MS)).toBe(false);
    // 昨日 10:00 → 过期
    expect(fresh(D('2024-01-04T10:00').getTime(), MORNING_OPEN_MS)).toBe(false);
    // 今日 9:40 盘中拉取的 → >= 昨日 15:01 → 新鲜（直到今日收盘后才会失效）
    expect(fresh(D('2024-01-05T09:40').getTime(), MORNING_OPEN_MS)).toBe(true);
  });

  it('盘中下午(afternoon_session)：口径与上午一致', () => {
    expect(fresh(D('2024-01-05T09:40').getTime(), AFTERNOON_MS)).toBe(true);
    expect(fresh(D('2024-01-04T14:00').getTime(), AFTERNOON_MS)).toBe(false);
  });

  it('盘中：缓存时间为空/null → 视为过期', () => {
    expect(fresh(null, MORNING_OPEN_MS)).toBe(false);
  });

  it('午休(midday_break)：基准是上一交易日 15:01，不再看当天 11:31', () => {
    expect(fresh(D('2024-01-04T15:10').getTime(), MIDDAY_MS)).toBe(true);
    expect(fresh(D('2024-01-05T11:20').getTime(), MIDDAY_MS)).toBe(true); // 当天上午拉的也算新鲜
    expect(fresh(D('2024-01-04T14:00').getTime(), MIDDAY_MS)).toBe(false);
  });

  it('盘后(closed)：落定时点=当天 15:01，15:01 前拉的缓存判过期', () => {
    expect(fresh(D('2024-01-05T10:00').getTime(), CLOSED_MS)).toBe(false);
    expect(fresh(D('2024-01-05T14:00').getTime(), CLOSED_MS)).toBe(false);
    expect(fresh(D('2024-01-05T15:00').getTime(), CLOSED_MS)).toBe(false); // 收盘瞬间仍未落定
    expect(fresh(D('2024-01-05T15:01').getTime(), CLOSED_MS)).toBe(true);
    expect(fresh(D('2024-01-05T15:10').getTime(), CLOSED_MS)).toBe(true);
    // 前一交易日 15:30 → < 今天 15:01 → 过期
    expect(fresh(D('2024-01-04T15:30').getTime(), CLOSED_MS)).toBe(false);
  });

  it('盘后 15:00–15:01：视为尚未落定，基准退回上一交易日 15:01（不发起拉取）', () => {
    const WINDOW_MS = D('2024-01-05T15:00').getTime() + 30 * 1000; // 15:00:30
    expect(getMarketStatus(new Date(WINDOW_MS))).toBe('closed');
    // 当天上午拉的也算新鲜 → 命中缓存，不会在 15:01 前重复拉取
    expect(fresh(D('2024-01-05T10:00').getTime(), WINDOW_MS)).toBe(true);
    expect(fresh(D('2024-01-04T15:10').getTime(), WINDOW_MS)).toBe(true);
    expect(fresh(D('2024-01-04T10:00').getTime(), WINDOW_MS)).toBe(false);
  });

  it('盘前(pre_open)：落定时点=前一交易日 15:01', () => {
    expect(fresh(D('2024-01-04T10:00').getTime(), PREOPEN_MS)).toBe(false);
    expect(fresh(D('2024-01-04T15:10').getTime(), PREOPEN_MS)).toBe(true);
    expect(fresh(D('2024-01-03T15:10').getTime(), PREOPEN_MS)).toBe(false);
  });

  it('全天休市(full_day_closed，周六)：落定时点=周五 15:01，整周末复用', () => {
    expect(fresh(D('2024-01-05T10:00').getTime(), FULL_DAY_CLOSED_MS)).toBe(false);
    expect(fresh(D('2024-01-05T15:10').getTime(), FULL_DAY_CLOSED_MS)).toBe(true);
    expect(fresh(D('2024-01-04T15:30').getTime(), FULL_DAY_CLOSED_MS)).toBe(false);
  });

  it('缓存字段不完整（缺 ma.ma30）→ 视为过期', () => {
    expect(fresh(D('2024-01-05T15:10').getTime(), CLOSED_MS, false)).toBe(false);
  });
});

// ============================================================
// 第二类：请求 / 不请求决策 —— staleCount、allCached、toFetch
// ============================================================
describe('planBollCacheUse：请求决策', () => {
  it('盘后 + 当天上午所有缓存新鲜 → allCached=true、staleCount=0、无需请求（用户最关心的场景）', () => {
    const cache = seedAll(['sh600000', 'sz000001'], D('2024-01-05T15:10').getTime());
    const plan = runPlan({ codes: ['sh600000', 'sz000001'], now: new Date(CLOSED_MS), cache });
    expect(getMarketStatus(new Date(CLOSED_MS))).toBe('closed');
    expect(plan.allCached).toBe(true);
    expect(plan.staleCount).toBe(0);
    expect(plan.visibleTotal).toBe(6); // 2 只股票 × 3 周期
    expect(plan.toFetch).toEqual([]);
    expect(plan.hitKeys).toHaveLength(6);
  });

  it('盘后：部分股票缓存缺失 → 该股票进入 toFetch、allCached=false', () => {
    const cache = seedAll(['sh600000'], D('2024-01-05T15:10').getTime());
    const plan = runPlan({ codes: ['sh600000', 'sz000001'], now: new Date(CLOSED_MS), cache });
    expect(plan.allCached).toBe(false);
    expect(plan.staleCount).toBe(3);
    expect(plan.visibleTotal).toBe(6);
    expect(plan.toFetch).toHaveLength(1);
    expect(plan.toFetch[0].code).toBe('sz000001');
    expect(plan.toFetch[0].periods).toEqual(BOLL_PERIODS);
  });

  it('盘后：单只某周期过期 → 仅该周期待请求、staleCount 反映该周期', () => {
    const cache = seedAll(['sh600000'], D('2024-01-05T15:10').getTime());
    // 仅摘掉 weekly 使其缺失
    cache.delete(kf('sh600000', 'weekly'));
    const plan = runPlan({ codes: ['sh600000'], now: new Date(CLOSED_MS), cache });
    expect(plan.allCached).toBe(false);
    expect(plan.staleCount).toBe(1);
    expect(plan.visibleTotal).toBe(3);
    expect(plan.toFetch[0].code).toBe('sh600000');
    expect(plan.toFetch[0].periods).toEqual(['weekly']);
  });

  it('盘中：昨日收盘后拉的缓存 → 命中不重拉；昨日收盘前拉的缓存 → 过期需重拉', () => {
    // 昨日 15:10 拉取 → 大于等于昨日 15:01 → 新鲜，盘中不再全量重拉
    const freshPlan = runPlan({
      codes: ['sh600000'],
      now: new Date(MORNING_OPEN_MS),
      cache: seedAll(['sh600000'], D('2024-01-04T15:10').getTime()),
    });
    expect(getMarketStatus(new Date(MORNING_OPEN_MS))).toBe('morning_session');
    expect(freshPlan.allCached).toBe(true);
    expect(freshPlan.toFetch).toEqual([]);

    // 昨日 10:00 拉取 → 早于昨日 15:01 → 过期，需重拉
    const stalePlan = runPlan({
      codes: ['sh600000'],
      now: new Date(MORNING_OPEN_MS),
      cache: seedAll(['sh600000'], D('2024-01-04T10:00').getTime()),
    });
    expect(stalePlan.allCached).toBe(false);
    expect(stalePlan.toFetch[0].code).toBe('sh600000');
  });

  it('强制刷新(force)：即使全部缓存新鲜也全部进入 toFetch、无命中', () => {
    const cache = seedAll(['sh600000'], D('2024-01-05T15:10').getTime());
    const plan = runPlan({ codes: ['sh600000'], now: new Date(CLOSED_MS), cache, force: true });
    expect(plan.allCached).toBe(false);
    expect(plan.staleCount).toBe(3);
    expect(plan.hitKeys).toEqual([]);
    expect(plan.toFetch[0].periods).toEqual(BOLL_PERIODS);
  });

  it('过期缓存：进入 staleData（供先展示后覆盖），不进 cachedData', () => {
    // 昨日 10:00 拉的 → 过期
    const cache = seedAll(['sh600000'], D('2024-01-04T10:00').getTime());
    const plan = runPlan({ codes: ['sh600000'], now: new Date(MORNING_OPEN_MS), cache });
    expect(plan.allCached).toBe(false);
    // 旧数据被保留下来，UI 可以先展示（并标记为过期样式）
    const stale = plan.staleData.get('sh600000')!;
    expect(stale.daily).not.toBeNull();
    expect(stale.weekly).not.toBeNull();
    expect(stale.monthly).not.toBeNull();
    // 新鲜命中集合里没有它
    const fresh = plan.cachedData.get('sh600000')!;
    expect(fresh.daily).toBeNull();
    // 同时仍要请求这三个周期
    expect(plan.toFetch[0].periods).toEqual(BOLL_PERIODS);
  });

  it('隐藏布林线的股票不计入 visibleTotal/staleCount、不进 toFetch', () => {
    const cache = seedAll(['sh600000'], D('2024-01-05T15:10').getTime());
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
    const cache = seedAll(['sh600000'], D('2024-01-05T15:10').getTime());
    const plan = runPlan({ codes: ['sh600000'], now: new Date(CLOSED_MS), cache });
    const cd = plan.cachedData.get('sh600000')!;
    expect(cd.daily).not.toBeNull();
    expect(cd.weekly).not.toBeNull();
    expect(cd.monthly).not.toBeNull();
    expect(plan.toFetch).toHaveLength(0);
  });

  it('部分命中：命中项进入批量集合(cachedData)、缺失项进入待请求集合(toFetch)', () => {
    const cache = seedAll(['sh600000'], D('2024-01-05T15:10').getTime());
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
    const cache = seedAll(['sh600000', 'sz000858'], D('2024-01-05T15:10').getTime());
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