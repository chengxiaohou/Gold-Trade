import { describe, it, expect } from 'vitest';
import { mergeTodayBarToKlines } from '../bollService';
import type { BollKline } from '../bollService';

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
});
