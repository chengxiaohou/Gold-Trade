import { describe, it, expect } from 'vitest';
import { mergeTodayBarToKlines, pickDegradedBoll } from '../bollService';
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
