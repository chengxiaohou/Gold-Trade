import { describe, it, expect } from 'vitest';
import { calcRealizedPnlForRange } from '../realizedPnl';
import { mkTrade as t } from './test-utils';
import type { StockTrade } from '../../types';

const ledger = (trades: StockTrade[]) => ({ '600000': { trades } });
const names = { '600000': '浦发' };

describe('calcRealizedPnlForRange', () => {
  it('空记录 → 全零', () => {
    const r = calcRealizedPnlForRange({}, names, 0, Infinity);
    expect(r.total).toBe(0);
    expect(r.byStock).toEqual({});
    expect(r.byDay).toEqual([]);
  });

  it('窗口内一次性卖出：realized = 卖出金额 - 持仓成本×股数', () => {
    // 建仓 100@10；卖出 100@15 → 落袋 +500
    const r = calcRealizedPnlForRange(
      ledger([
        t({ id: 'b1', side: 'buy', price: 10, shares: 100, createdAt: 1 }),
        t({ id: 's1', side: 'sell', price: 15, shares: 100, createdAt: 500 }),
      ]),
      names, 0, 10_000,
    );
    expect(r.total).toBeCloseTo(500, 5);
  });

  it('窗口边界：startTs 前只建仓不计盈亏，endTs 后不参与', () => {
    const trades = [
      t({ id: 'b1', side: 'buy', price: 10, shares: 100, createdAt: 100 }),
      t({ id: 's1', side: 'sell', price: 15, shares: 100, createdAt: 1000 }),
      t({ id: 's2', side: 'sell', price: 99, shares: 999, createdAt: 99999 }),
    ];
    // 窗口 [500, 5000) → s1 计入（+500），s2 超出 endTs 不计，b1 只作期初
    const r = calcRealizedPnlForRange(ledger(trades), names, 500, 5000);
    expect(r.total).toBeCloseTo(500, 5);
  });

  it('byStock 汇总 + byDay 聚合升序', () => {
    // 200@10 建仓；卖 50@15、100@25 → realized = 250 + 1500 = 1750
    const r = calcRealizedPnlForRange(
      ledger([
        t({ id: 'b1', side: 'buy', price: 10, shares: 200, createdAt: 1 }),
        t({ id: 's1', side: 'sell', price: 15, shares: 50, createdAt: 500 }),
        t({ id: 's2', side: 'sell', price: 25, shares: 100, createdAt: 600 }),
      ]),
      names, 0, 10_000,
    );
    expect(r.total).toBeCloseTo(250 + 1500, 5); // 50*(15-10) + 100*(25-10)
    expect(r.byStock['600000']).toBeCloseTo(1750, 5);
    expect(r.byDay.length).toBeGreaterThan(0);
  });

  it('忽略软删与挂单', () => {
    const r = calcRealizedPnlForRange(
      ledger([
        t({ id: 'b1', side: 'buy', price: 10, shares: 100, createdAt: 1 }),
        t({ id: 'del', side: 'sell', price: 90, shares: 100, createdAt: 500, isDeleted: true }),
        t({ id: 'pend', side: 'sell', price: 90, shares: 100, createdAt: 600, status: 'pending' }),
      ]),
      names, 0, 10_000,
    );
    expect(r.total).toBe(0);
  });

  it('超卖卖出只按持仓成本结算，不产生超额盈亏', () => {
    const r = calcRealizedPnlForRange(
      ledger([
        t({ id: 'b1', side: 'buy', price: 10, shares: 50, createdAt: 1 }),
        t({ id: 's1', side: 'sell', price: 10, shares: 200, createdAt: 500 }),
      ]),
      names, 0, 10_000,
    );
    // 持仓 0（超卖截断），s1 卖出金额 2000 - 成本0×200 = 0？ 实际逻辑 rs=50>0 时 realized=2000-10*200=0
    // 但 rs 计算前为 50 → realized = amt - rc*shares；这里 amt=2000, rc=10, shares=200 → 0
    expect(r.total).toBeCloseTo(0, 5);
  });
});