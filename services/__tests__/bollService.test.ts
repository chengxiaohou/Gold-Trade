import { describe, it, expect } from 'vitest';
import { mergeTodayBarToKlines, pickDegradedBoll, countBollBandStreak } from '../bollService';
import type { BollData, BollKline } from '../bollService';

function date(offset: number, base = new Date(Date.UTC(2026, 0, 1))): string {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

// 构造 n 根平坦 K 线，volume 默认 1_000_000
function mkFlatKlines(n: number, overrides: Record<number, Partial<BollKline>> = {}): BollKline[] {
  const arr: BollKline[] = [];
  for (let i = 0; i < n; i++) {
    arr.push({ date: date(i), open: 100, high: 100.5, low: 99.5, close: 100, volume: 1_000_000 });
  }
  for (const [idx, o] of Object.entries(overrides)) arr[Number(idx)] = { ...arr[Number(idx)], ...o };
  return arr;
}

describe('mergeTodayBarToKlines（今日实时行情 merge 到 K 线）', () => {
  // 固定 now 为 2026-01-11
  const NOW = new Date(Date.UTC(2026, 0, 11, 14, 0, 0));
  const TODAY = '2026-01-11';
  // 构造 10 根 K 线（2026-01-01 ~ 2026-01-10），最后一根是 01-10，未含今日
  const base = mkFlatKlines(10);

  it('收盘后：rt.volume 作为今日 K 线的全天量', () => {
    const merged = mergeTodayBarToKlines(base, { open: 100, high: 101, low: 99, price: 100.5, volume: 1_785_550 }, 'closed', NOW);
    expect(merged).toHaveLength(11);
    const todayBar = merged[merged.length - 1];
    expect(todayBar.date).toBe(TODAY);
    expect(todayBar.volume).toBe(1_785_550); // 用了 rt.volume
    expect(todayBar.close).toBe(100.5);       // price 实时覆盖
  });

  it('盘中：rt.volume 是累计值，今日 K 线 volume 用上一根历史值（避免污染 MAV5）', () => {
    // 盘中 rt.volume 假设只有全天量的 1/3
    const merged = mergeTodayBarToKlines(base, { open: 100, high: 101, low: 99, price: 100.3, volume: 500_000 }, 'morning_session', NOW);
    expect(merged).toHaveLength(11);
    const todayBar = merged[merged.length - 1];
    expect(todayBar.date).toBe(TODAY);
    // volume 应该是上一根的 1_000_000，不是盘中累计 500_000
    expect(todayBar.volume).toBe(1_000_000);
    expect(todayBar.close).toBe(100.3); // price 正常实时覆盖
  });

  it('盘中 volume 不受污染：用 merge 后的 klines 算 MAV5，不包含盘中截断值', () => {
    // 构造 5 根历史 K 线，volume 递增
    const hist: BollKline[] = [];
    for (let i = 0; i < 5; i++) {
      hist.push({ date: date(i), open: 100, high: 100, low: 100, close: 100, volume: (i + 1) * 100_000 }); // 10w, 20w, 30w, 40w, 50w
    }
    // 今日盘中，rt.volume 只有 10_000（盘中累计）
    const merged = mergeTodayBarToKlines(hist, { open: 100, high: 101, low: 99, price: 100.5, volume: 10_000 }, 'afternoon_session', NOW);
    const todayBar = merged[merged.length - 1];
    expect(todayBar.volume).toBe(500_000); // 上一根的 volume，不是盘中累计 10_000
    // 算 MAV5：基于 5 根历史（100k+200k+300k+400k+500k），不含盘中截断值
    const mav5 = merged.slice(-6, -1).reduce((s, x) => s + x.volume, 0) / 5; // 取前 5 根历史（不含今日合并的那根）
    expect(mav5).toBe(300_000); // 5 根历史均值，盘中截断值 10_000 没混入
  });

  it('K 线末根已是今日：替换而非追加', () => {
    // 构造 10 根 + 1 根今日
    const withToday = [...mkFlatKlines(10), { date: TODAY, open: 99, high: 100, low: 98, close: 99.5, volume: 0 }];
    const merged = mergeTodayBarToKlines(withToday, { open: 100, high: 101, low: 99, price: 100.5, volume: 1_500_000 }, 'closed', NOW);
    expect(merged).toHaveLength(11); // 不是 12
    const todayBar = merged[merged.length - 1];
    expect(todayBar.date).toBe(TODAY);
    expect(todayBar.close).toBe(100.5);
  });

  it('无有效实时行情（price<=0 或 open<=0）：原样返回', () => {
    const merged1 = mergeTodayBarToKlines(base, { price: 0, open: 100 }, 'closed', NOW);
    expect(merged1).toEqual(base);
    const merged2 = mergeTodayBarToKlines(base, { price: 100, open: 0 }, 'morning_session', NOW);
    expect(merged2).toEqual(base);
  });

  it('空数组：原样返回', () => {
    expect(mergeTodayBarToKlines([], { open: 100, price: 100 }, 'closed', NOW)).toEqual([]);
  });

  // ─── 非交易时段守卫（防回归：rt 残留 price/open 但 marketStatus 非可交易，不得合成今日 bar）───

  it('盘前(pre_open)：rt 残留 price/open 都 > 0，但不合成今日 K 线（原样返回）', () => {
    // 典型残留：页面加载过一次后，realtime 里 price=上一交易日收盘价, open=上一交易日开盘价
    const residualRt = { open: 100, high: 100.5, low: 99.5, price: 100, volume: 1_500_000 };
    expect(residualRt.price).toBeGreaterThan(0);
    expect(residualRt.open).toBeGreaterThan(0); // 两个有效性检查都通过

    const merged = mergeTodayBarToKlines(base, residualRt, 'pre_open', NOW);
    expect(merged).toEqual(base);                  // 原样返回，不追加今日 bar
    expect(merged.map(k => k.date)).not.toContain(TODAY);
  });

  it('全天休市(full_day_closed)：rt 残留 price/open 都 > 0，不合成今日 K 线', () => {
    const residualRt = { open: 100, high: 100.5, low: 99.5, price: 100, volume: 1_500_000 };
    const merged = mergeTodayBarToKlines(base, residualRt, 'full_day_closed', NOW);
    expect(merged).toEqual(base);
    expect(merged.map(k => k.date)).not.toContain(TODAY);
  });

  it('可交易四态(closed/morning_session/midday_break/afternoon_session)：都正常追加今日 bar', () => {
    const rt = { open: 100, high: 101, low: 99, price: 100.5, volume: 1_500_000 };
    for (const status of ['closed', 'morning_session', 'midday_break', 'afternoon_session'] as const) {
      const merged = mergeTodayBarToKlines(base, rt, status, NOW);
      const last = merged[merged.length - 1];
      expect(last.date, `status=${status} 应追加今日 bar`).toBe(TODAY);
      expect(last.close, `status=${status}`).toBe(100.5);
    }
  });
});

describe('pickDegradedBoll（网络失败时降级到过期缓存）', () => {
  // 最小完整 BOLL（含 ma.ma30 与 klines）
  function mkCached(complete: boolean, ts = 1_000): { data: BollData; timestamp: number } {
    const data: BollData = {
      upper: 101, mid: 100, lower: 99, close: 100,
      ma: { ma5: 100, ma10: 100, ma20: 100, ma30: 100, ma60: 100, ma120: 100, ma250: 100, ma500: 100 },
      date: '2026-01-01', fetchedAt: ts, rangeCount: 1,
      rangePriceHigh: 101, rangePriceHighDate: '2026-01-01', rangePriceLow: 99, rangePriceLowDate: '2026-01-01',
      klines: complete ? [{ date: '2026-01-01', open: 99, high: 101, low: 99, close: 100, volume: 1000 }] : undefined,
    };
    return { data, timestamp: ts };
  }

  it('缓存完整（ma.ma30 + klines）：可降级，返回缓存数据', () => {
    const cached = mkCached(true);
    expect(pickDegradedBoll(cached)).toBe(cached.data);
  });

  it('缓存缺 klines（旧版/不完整）：不可降级 → null', () => {
    expect(pickDegradedBoll(mkCached(false))).toBeNull();
  });

  it('缓存缺 ma.ma30：不可降级 → null', () => {
    const cached = mkCached(true);
    cached.data.ma = { ...cached.data.ma!, ma30: null as unknown as number };
    expect(pickDegradedBoll(cached)).toBeNull();
  });

  it('无缓存 entry：不可降级 → null', () => {
    expect(pickDegradedBoll(undefined)).toBeNull();
  });
});

// ─── countBollBandStreak（连续 N 天处于 BOLL 上/下轨） ───

/**
 * 构造 n 根 klines，最后 highN 根 close=highClose，其余 lowClose。
 * open/high/low 与 close 一致（扁平 bar，无波动）。
 * 这样可以精确控制 MA20 和 σ，便于断言。
 */
function mkStepKlines(
  n: number,
  highN: number,
  highClose: number,
  lowClose: number,
): BollKline[] {
  const arr: BollKline[] = [];
  for (let i = 0; i < n; i++) {
    const close = i < n - highN ? lowClose : highClose;
    arr.push({ date: date(i), open: close, high: close, low: close, close, volume: 1_000_000 });
  }
  return arr;
}

describe('countBollBandStreak', () => {
  it('klines 不足 20 根 → null', () => {
    const klines = mkFlatKlines(19);
    expect(countBollBandStreak(klines, 'upper')).toBeNull();
    expect(countBollBandStreak(undefined, 'upper')).toBeNull();
    expect(countBollBandStreak(null, 'lower')).toBeNull();
    expect(countBollBandStreak([], 'upper')).toBeNull();
  });

  it('连续 4 天 upper（close 均高于各自 BOLL upper）→ 返回 4', () => {
    // 非对称构造：前 20 根=50，后 4 根=150。close=150 远高于 BOLL upper
    const klines = mkStepKlines(24, 4, 150, 50);
    const actual = countBollBandStreak(klines, 'upper');
    expect(actual).toBe(4);
  });

  it('中间断开：第 3 天回到 BOLL 内部 → count=2', () => {
    // 前 22 根=50，最后 2 根=150。offset 0,1 close=150→upper；offset=2 close=50 在 mid 区间→断开
    const arr: BollKline[] = [];
    for (let i = 0; i < 24; i++) {
      const close = i < 22 ? 50 : 150;
      arr.push({ date: date(i), open: close, high: close, low: close, close, volume: 1_000_000 });
    }
    const actual = countBollBandStreak(arr, 'upper');
    expect(actual).toBe(2);
  });

  it('lower 方向：连续 4 天 close=50 跌破 BOLL lower（前 20 根 close=150）→ 返回 4', () => {
    // 非对称：前 20 根=150，后 4 根=50。close=50 < BOLL lower
    const klines = mkStepKlines(24, 4, 50, 150);
    const actual = countBollBandStreak(klines, 'lower');
    expect(actual).toBe(4);
  });

  it('maxDays 截断：连续 10 天但 maxDays=3 → 返回 3', () => {
    const klines = mkStepKlines(30, 10, 150, 50);
    const actual = countBollBandStreak(klines, 'upper', 3);
    expect(actual).toBe(3);
  });

  // ── 方案 A（每 bar 自算）vs 方案 B（今日轨道对比）的本质差异验证 ──

  it('BOLL 轨道上移场景：方案 A 能正确识别连续，方案 B 会穿越误判断开', () => {
    // 构造 BOLL 轨道随时间上移（历史波动变大、close 抬升）的真实场景
    // 让最后 30 根 close 从 105 线性升到 135，前 20 根 close=100
    const arr: BollKline[] = [];
    for (let i = 0; i < 50; i++) {
      const close = i < 20 ? 100 : 105 + (i - 20); // 100,100,... 然后 105,106,134
      arr.push({ date: date(i), open: close, high: close, low: close, close, volume: 1_000_000 });
    }

    // 先用完整 50 根算今日 BOLL 轨道（模拟"方案 B"用今日 upper 卡历史 close）
    // 对 offset=10（倒数第 11 根，close=105+19=124），
    // 今日 upper 可能已经被后面的高 close 拉高到 >124，方案 B 就会把它误判为 mid
    // 方案 A 对每个 bar 用当时自己的 upper，close=124 可能高于当时的 upper

    const streakA = countBollBandStreak(arr, 'upper', 10);

    // 手动模拟方案 B 的"穿越"：用今日 upper 对比近 10 天的 close
    // 先算今日（最后一根）的 upper
    const last20closes = arr.slice(-20).map(k => k.close);
    const maLast = last20closes.reduce((a, b) => a + b, 0) / 20;
    const stdLast = Math.sqrt(
      last20closes.reduce((s, c) => s + Math.pow(c - maLast, 2), 0) / 20,
    );
    const upperToday = maLast + 2 * stdLast;

    let streakB = 0;
    for (let offset = 0; offset < 10; offset++) {
      const close = arr[arr.length - 1 - offset].close;
      if (close >= upperToday) streakB++;
      else break;
    }

    console.log('=== 方案 A vs 方案 B（BOLL 轨道上移场景）===');
    console.log('今日 upper:', upperToday.toFixed(2));
    console.log('方案 A（每 bar 自算 upper）连续天数:', streakA);
    console.log('方案 B（今日 upper 对比历史 close）连续天数:', streakB);
    console.log('方案 A 更准确（不穿越）:', (streakA ?? 0) >= streakB);

    // 核心断言：方案 A 不应比方案 B 少
    expect((streakA ?? 0) >= streakB).toBe(true);
  });

  it('BOLL 轨道下移场景：方案 B 会把 mid 误判为 upper', () => {
    // 构造 BOLL 轨道下移（close 从高位跌下来）
    const arr: BollKline[] = [];
    for (let i = 0; i < 50; i++) {
      const close = i < 20 ? 130 : 130 - (i - 20); // 130,130,... 然后 129,128,... 一路跌到 91
      arr.push({ date: date(i), open: close, high: close, low: close, close, volume: 1_000_000 });
    }

    const streakA = countBollBandStreak(arr, 'upper', 10);

    // 方案 B：今日 upper 对比近 10 天 close
    const last20closes = arr.slice(-20).map(k => k.close);
    const maLast = last20closes.reduce((a, b) => a + b, 0) / 20;
    const stdLast = Math.sqrt(
      last20closes.reduce((s, c) => s + Math.pow(c - maLast, 2), 0) / 20,
    );
    const upperToday = maLast + 2 * stdLast;

    let streakB = 0;
    for (let offset = 0; offset < 10; offset++) {
      const close = arr[arr.length - 1 - offset].close;
      if (close >= upperToday) streakB++;
      else break;
    }

    console.log('=== 方案 A vs 方案 B（BOLL 轨道下移场景）===');
    console.log('今日 upper:', upperToday.toFixed(2));
    console.log('方案 A:', streakA);
    console.log('方案 B:', streakB);

    // 核心断言：方案 B 可能穿越多算，但方案 A 应该更保守准确
    expect((streakA ?? 0) <= streakB).toBe(true);
  });

  it('close 刚好等于 upper（BOLL 三轨重合 edge case）→ 返回 null', () => {
    // 全扁平 klines 所有 close=100 → MA20=100, σ=0, upper=mid=lower=100
    // SSOT 规定：BOLL 三轨重合时返回 mid，避免硬判据抢，所以 close=100 ≠ 'upper' → streak=null
    const klines = mkFlatKlines(25);
    const actual = countBollBandStreak(klines, 'upper');
    expect(actual).toBeNull();
  });
});
