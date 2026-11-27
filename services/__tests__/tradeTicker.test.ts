import { describe, it, expect } from 'vitest';
import { buildTickerItems, tradeVolumeLabel } from '../tradeTicker';
import { mkStock, mkTrade } from './test-utils';

const mk = (trades: ReturnType<typeof mkTrade>[], price: number, name = '云天化') =>
  mkStock('600096', name, { price, stockTrades: trades });

describe('tradeVolumeLabel', () => {
  it('按成交金额 2500 一档，第一档不显示', () => {
    expect(tradeVolumeLabel(mkTrade({ price: 20, shares: 100 }))).toBe('');   // 2000 → 第一档
    expect(tradeVolumeLabel(mkTrade({ price: 50, shares: 100 }))).toBe('I');  // 5000
    expect(tradeVolumeLabel(mkTrade({ price: 75, shares: 100 }))).toBe('II'); // 7500
  });
});

describe('buildTickerItems', () => {
  it('上涨超过阈值 → up 条目带可领取金额', () => {
    const items = buildTickerItems([mk([mkTrade({ price: 15.54, shares: 100, createdAt: 1 })], 16.35)]);
    expect(items).toHaveLength(1);
    expect(items[0].dir).toBe('up');
    expect(items[0].lots[0].pct).toBeCloseTo(5.2123, 3);
    expect(items[0].lots[0].amount).toBeCloseTo(81, 5);
    expect(items[0].lots[0].statusLabel).toBe('买入');
  });

  it('下跌超过阈值 → down 条目不带金额', () => {
    const items = buildTickerItems([mk([mkTrade({ price: 10, shares: 100, createdAt: 1 })], 9)]);
    expect(items).toHaveLength(1);
    expect(items[0].dir).toBe('down');
    expect(items[0].lots[0].pct).toBeCloseTo(-10, 5);
    expect(items[0].lots[0].amount).toBeNull();
  });

  it('幅度未达阈值不播报', () => {
    const items = buildTickerItems([mk([mkTrade({ price: 10, shares: 100, createdAt: 1 })], 10.2)]);
    expect(items).toHaveLength(0);
  });

  it('部分卖出后按剩余份额算金额；完全卖出的买入不再播报', () => {
    const partial = mkStock('600096', '云天化', {
      price: 12,
      stockTrades: [
        mkTrade({ id: 'b1', side: 'buy', price: 10, shares: 100, createdAt: 1 }),
        mkTrade({ id: 's1', side: 'sell', price: 11, shares: 60, createdAt: 2 }),
      ],
    });
    const items = buildTickerItems([partial]);
    expect(items[0].lots[0].amount).toBeCloseTo(2 * 40, 5);

    const closed = mkStock('600096', '云天化', {
      price: 20,
      stockTrades: [
        mkTrade({ id: 'b1', side: 'buy', price: 10, shares: 100, createdAt: 1 }),
        mkTrade({ id: 's1', side: 'sell', price: 20, shares: 100, createdAt: 2 }),
      ],
    });
    expect(buildTickerItems([closed])).toHaveLength(0);
  });

  it('每股上限生效：按幅度降序截断并给出省略数量', () => {
    const trades = [
      mkTrade({ id: 'b1', price: 10, shares: 100, createdAt: 1 }), // +20%
      mkTrade({ id: 'b2', price: 10.5, shares: 100, createdAt: 2 }), // +14.3%
      mkTrade({ id: 'b3', price: 11, shares: 100, createdAt: 3 }), // +9.1%
      mkTrade({ id: 'b4', price: 11.5, shares: 100, createdAt: 4 }), // +4.3%
    ];
    const items = buildTickerItems([mk(trades, 12)], { maxPerStock: 2 });
    expect(items[0].lots).toHaveLength(2);
    expect(items[0].lots[0].pct).toBeCloseTo(20, 5);
    expect(items[0].hiddenCount).toBe(2);
  });

  it('含税开关打开时成本抬高、涨幅变小', () => {
    const stock = mk([mkTrade({ price: 10, shares: 10000, createdAt: 1 })], 10.5);
    const noTax = buildTickerItems([stock], { threshold: 0, withTax: false })[0];
    const withTax = buildTickerItems([stock], { threshold: 0, withTax: true })[0];
    expect(withTax.lots[0].pct).toBeLessThan(noTax.lots[0].pct ?? NaN);
  });

  it('最近一笔买入跌幅未达阈值（说明已在低位补仓）→ 更早的下跌不再播报', () => {
    const stock = mkStock('600110', '云铝股份', {
      price: 10,
      stockTrades: [
        mkTrade({ id: 'b1', price: 20, shares: 100, createdAt: 1 }),  // 老单 -50%
        mkTrade({ id: 'b2', price: 9.8, shares: 100, createdAt: 2 }),  // 最近补仓 +2% → 截断
      ],
    });
    expect(buildTickerItems([stock]).filter(i => i.dir === 'down')).toHaveLength(0);
  });

  it('下跌条目只取最近连续跌破阈值的买入单（新的在前）', () => {
    const stock = mkStock('600110', '云铝股份', {
      price: 10,
      stockTrades: [
        mkTrade({ id: 'b1', price: 14, shares: 100, createdAt: 1 }),   // -28.6%
        mkTrade({ id: 'b2', price: 10.5, shares: 100, createdAt: 2 }), // -4.8%
      ],
    });
    const down = buildTickerItems([stock]).find(i => i.dir === 'down');
    expect(down?.lots).toHaveLength(2);
    expect(down?.lots[0].pct).toBeCloseTo(-4.7619, 3);
  });

  it('即将成交 / 即将过期的挂单也会播报', () => {
    const now = Date.now();
    const stock = mkStock('600096', '云天化', {
      price: 10.45,
      stockTrades: [
        // 挂卖 10.5，现价 10.45 → 差 0.48% 成交
        mkTrade({ id: 's1', side: 'sell', price: 10.5, shares: 100, status: 'pending', createdAt: now - 1000 }),
        // 挂买 9.5，第 5 个自然日（最后一天）→ 剩 1 天过期
        mkTrade({ id: 'b1', side: 'buy', price: 9.5, shares: 100, status: 'pending', createdAt: now - 4 * 86_400_000 }),
      ],
    });
    const items = buildTickerItems([stock]);
    const near = items.find(i => i.kind === 'nearFill');
    expect(near?.lots[0].statusLabel).toBe('挂卖');
    expect(near?.lots[0].note).toBe('+0.48%成交');
    const expiring = items.find(i => i.kind === 'expiring');
    expect(expiring?.lots[0].note).toBe('当日过期');
  });

  it('已过期或已删除的挂单不播报', () => {
    const now = Date.now();
    const stock = mkStock('600096', '云天化', {
      price: 10.45,
      stockTrades: [
        // 已超过 5 天有效期
        mkTrade({ id: 'b1', side: 'buy', price: 10.4, shares: 100, status: 'pending', createdAt: now - 10 * 86_400_000 }),
        mkTrade({ id: 'b2', side: 'buy', price: 10.4, shares: 100, status: 'pending', createdAt: now, isDeleted: true }),
      ],
    });
    expect(buildTickerItems([stock])).toHaveLength(0);
  });
});
