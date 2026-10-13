import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { priceBureau } from '../priceBureau';
import type { BollData } from '../bollService';

// 固定对齐到"周四盘中"（2026-09-24 10:30 上午交易时段）：
// 数据中心 getMarketStatus()/todayStr 都基于当前时间，用 vi.setSystemTime 使其确定性。
const TODAY_MSK = new Date('2026-09-24T10:30:00+08:00');

function daily(klines: BollData['klines']): BollData {
  // 数据中心两形态出口只读 .klines，其余 BollData 聚合字段仅作 TS 占位（测试从简）
  return {
    upper: 110, mid: 105, lower: 100,
    close: 103, date: '2026-09-24', fetchedAt: 0, rangeCount: 3,
    rangePriceHigh: 104, rangePriceHighDate: '2026-09-24',
    rangePriceLow: 98, rangePriceLowDate: '2026-09-22',
    klines: klines ?? [],
  };
}

describe('priceBureau 对外两形态（仅收盘 / 含未收盘）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY_MSK);
    priceBureau.clear();
    priceBureau.setEntry('600000.SH', {
      daily: daily([
        { date: '2026-09-22', open: 100, high: 102, low: 98, close: 101, volume: 1000 },
        { date: '2026-09-23', open: 101, high: 103, low: 99, close: 102, volume: 1200 },
        { date: '2026-09-24', open: 102, high: 104, low: 100, close: 103, volume: 800 },
      ]),
      weekly: null,
      monthly: null,
      realtime: null,
    });
    // 自持实时行情：较今日开盘下行，最高/最低均变化
    priceBureau.setRealtime('600000.SH', {
      code: 'sh600000', name: '浦发银行',
      price: 99.5, changePercent: -2.45, high: 99.8, low: 99.2, open: 102, volume: 900,
    });
  });

  afterEach(() => {
    priceBureau.clear();
    vi.useRealTimers();
  });

  it('形态①【仅收盘】getClosedKlines：盘中剔除今日K线，历史到最近已收盘交易日', () => {
    const closed = priceBureau.getClosedKlines('600000.SH', 'daily');
    expect(closed).not.toBeNull();
    expect(closed!.map(k => k.date)).toEqual(['2026-09-22', '2026-09-23']);
  });

  it('形态②【含未收盘】getTodayDailyKlines：把自持实时合成进今日K线（收盘价/最高/最低跟随实时）', () => {
    const live = priceBureau.getTodayDailyKlines('600000.SH');
    const last = live[live.length - 1];
    expect(live.length).toBe(3);
    expect(last.date).toBe('2026-09-24');
    expect(last.open).toBe(102);      // 今日开盘价用实时
    expect(last.high).toBe(99.8);     // 实时最高
    expect(last.low).toBe(99.2);      // 实时最低
    expect(last.close).toBe(99.5);    // 实时现价
    expect(last.volume).toBe(1200);   // 盘中继承上一根量能，不掺实时累计量
  });

  it('两者共用同一份入参自持数据：未收盘不对外泄露今日价（closed 无 09-24），live 才含', () => {
    const closed = priceBureau.getClosedKlines('600000.SH', 'daily');
    expect(closed!.some(k => k.date === '2026-09-24')).toBe(false);
    const live = priceBureau.getTodayDailyKlines('600000.SH');
    expect(live.some(k => k.date === '2026-09-24')).toBe(true);
  });
});

describe('priceBureau.getTodayBoll：absorb + setRealtime 后 BOLL 三轨跟随实时价', () => {
  // 生成 25 根历史 klines（2026-08-01 ~ 2026-09-03），收盘恒为 100
  // —— 这样 mergeTodayBarToKlines 追加今日 bar 后，buildBollDataFromKlines 的最后 20 根以今日 realtime price 收尾
  function mkHistoricalKlines(): BollData['klines'] {
    const out: BollData['klines'] = [];
    let d = new Date('2026-08-01T09:30:00+08:00');
    const end = new Date('2026-09-04T09:30:00+08:00');
    let idx = 0;
    while (d < end) {
      // 跳过周末
      const dow = d.getDay();
      if (dow === 0 || dow === 6) { d.setDate(d.getDate() + 1); continue; }
      const close = 100 + (idx % 2 === 0 ? 1 : -1) * idx * 0.1;
      out.push({
        date: d.toISOString().slice(0, 10),
        open: close - 0.5,
        high: close + 1,
        low: close - 1,
        close,
        volume: 1000 + idx * 10,
      });
      idx++;
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY_MSK); // 2026-09-24 10:30 盘中
    priceBureau.clear();
  });

  afterEach(() => {
    priceBureau.clear();
    vi.useRealTimers();
  });

  it('absorb + setRealtime 后 getTodayBoll 的 klines 末根跟随实时行情（BOLL 三轨基于合成后的序列重算）', () => {
    const histKlines = mkHistoricalKlines();
    expect(histKlines.length).toBeGreaterThanOrEqual(20);
    // 接口原始 BollData：只有历史 K 线，无今日 09-24（盘中接口行为）
    const rawDaily = {
      upper: 0, mid: 0, lower: 0, close: 0,
      date: histKlines[histKlines.length - 1].date,
      fetchedAt: Date.now(), rangeCount: histKlines.length,
      rangePriceHigh: 0, rangePriceHighDate: '',
      rangePriceLow: 0, rangePriceLowDate: '',
      klines: histKlines,
    };
    priceBureau.absorb('600000.SH', 'daily', { data: rawDaily });
    // 无 realtime → store daily 的 klines 还是原始 histKlines（不追加今日 bar）
    const before = priceBureau.getTodayBoll('600000.SH', 'daily');
    expect(before).not.toBeNull();
    expect(before!.klines![before!.klines!.length - 1].close).not.toBe(95);

    // setRealtime → store daily 同步重算：klines 追加今日 bar，BOLL 三轨基于新序列
    priceBureau.setRealtime('600000.SH', {
      code: 'sh600000', name: '浦发银行',
      price: 95, changePercent: -5, high: 96, low: 94, open: 102, volume: 5000,
    });
    const after = priceBureau.getTodayBoll('600000.SH', 'daily');
    expect(after).not.toBeNull();
    // 核心保证：klines 末根 close/high/low 跟随实时行情
    const last = after!.klines![after!.klines!.length - 1];
    expect(last.close).toBe(95);
    expect(last.high).toBe(96);
    expect(last.low).toBe(94);
    expect(last.date).toBe('2026-09-24');
    // upper/mid/lower/ma 全量字段都非空（buildBollDataFromKlines 已完整重算）
    expect(after!.mid).toBeGreaterThan(0);
    expect(after!.upper).toBeGreaterThan(after!.mid);
    expect(after!.lower).toBeLessThan(after!.mid);
  });
});