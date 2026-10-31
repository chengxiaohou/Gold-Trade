import { describe, it, expect } from 'vitest';
import { calcPositionFromTrades } from '../realizedPnl';
import { mergeStockFromCloud, mergeCloudStocks, buildUploadStocks, stripStockPriceCache, diffFinancialsSnapshots, collectStockNamesFromSnapshot } from '../stockSync';
import { mkTrade as t, mkStock } from './test-utils';

// ---- 持仓 calcPositionFromTrades ----
describe('calcPositionFromTrades', () => {
  it('空 / undefined 返回 0 持仓', () => {
    expect(calcPositionFromTrades(undefined)).toEqual({ shares: 0, avgCost: 0 });
    expect(calcPositionFromTrades([])).toEqual({ shares: 0, avgCost: 0 });
  });

  it('单笔买入', () => {
    expect(calcPositionFromTrades([t({ side: 'buy', price: 10, shares: 100 })])).toEqual({
      shares: 100,
      avgCost: 10,
    });
  });

  it('多次买入为移动加权，而非简单平均', () => {
    // 100@10 + 100@30 → 均价 20
    expect(
      calcPositionFromTrades([
        t({ side: 'buy', price: 10, shares: 100, createdAt: 1 }),
        t({ side: 'buy', price: 30, shares: 100, createdAt: 2 }),
      ])
    ).toEqual({ shares: 200, avgCost: 20 });
  });

  it('部分卖出持仓减少但均价不变', () => {
    // 200@20，卖 50 → 持150，均价仍20
    const r = calcPositionFromTrades([
      t({ side: 'buy', price: 10, shares: 100, createdAt: 1 }),
      t({ side: 'buy', price: 30, shares: 100, createdAt: 2 }),
      t({ side: 'sell', price: 25, shares: 50, createdAt: 3 }),
    ]);
    expect(r.shares).toBe(150);
    expect(r.avgCost).toBe(20);
  });

  it('买-卖-买交错（精确复现 23.33 反例）', () => {
    const r = calcPositionFromTrades([
      t({ side: 'buy', price: 10, shares: 100, createdAt: 1 }),
      t({ side: 'sell', price: 20, shares: 50, createdAt: 2 }),
      t({ side: 'buy', price: 30, shares: 100, createdAt: 3 }),
    ]);
    expect(r.shares).toBe(150);
    expect(r.avgCost).toBeCloseTo(23.333, 2);
  });

  it('全部卖出归零', () => {
    expect(
      calcPositionFromTrades([
        t({ side: 'buy', price: 10, shares: 100, createdAt: 1 }),
        t({ side: 'sell', price: 10, shares: 100, createdAt: 2 }),
      ])
    ).toEqual({ shares: 0, avgCost: 0 });
  });

  it('超卖截断到 0 不取负', () => {
    const r = calcPositionFromTrades([
      t({ side: 'buy', price: 10, shares: 50, createdAt: 1 }),
      t({ side: 'sell', price: 10, shares: 200, createdAt: 2 }),
    ]);
    expect(r.shares).toBe(0);
    expect(r.avgCost).toBe(0);
  });

  it('忽略软删记录', () => {
    const r = calcPositionFromTrades([
      t({ side: 'buy', price: 10, shares: 100, createdAt: 1 }),
      t({ id: 'deleted', side: 'buy', price: 99, shares: 500, createdAt: 2, isDeleted: true }),
    ]);
    expect(r.shares).toBe(100);
    expect(r.avgCost).toBe(10);
  });

  it('忽略挂单（非 filled）', () => {
    const r = calcPositionFromTrades([
      t({ side: 'buy', price: 10, shares: 100, createdAt: 1 }),
      t({ side: 'buy', price: 99, shares: 500, createdAt: 2, status: 'pending' }),
    ]);
    expect(r.shares).toBe(100);
    expect(r.avgCost).toBe(10);
  });

  it('amount 优先于 price×shares', () => {
    const r = calcPositionFromTrades([
      t({ side: 'buy', price: 10, shares: 100, amount: 5000, createdAt: 1 }),
    ]);
    expect(r.avgCost).toBe(50); // 5000/100，而非 10
  });

  it('乱序输入按有效时间排序后计算', () => {
    const r = calcPositionFromTrades([
      t({ side: 'buy', price: 30, shares: 100, createdAt: 3 }),
      t({ side: 'buy', price: 10, shares: 100, createdAt: 1 }),
    ]);
    expect(r.shares).toBe(200);
    expect(r.avgCost).toBe(20);
  });
});

// ---- 合并 mergeStockFromCloud ----
describe('mergeStockFromCloud / mergeCloudStocks', () => {
  it('本地空 + 云端有 → 全量并入并重算持仓', () => {
    const cloud = mkStock('600000', '浦发');
    cloud.stockTrades = [t({ side: 'buy', price: 10, shares: 100 })];
    const { stock } = mergeStockFromCloud(cloud, undefined);
    expect(stock.stockTrades).toHaveLength(1);
    expect(stock.positionShares).toBe(100);
    expect(stock.positionCost).toBe(10);
  });

  it('云端残留的价格缓存字段在合并时被剔除', () => {
    const cloud = mkStock('600000', '浦发', {
      price: 999, changePercent: 5, high: 1000, low: 1,
      open: 500, volume: 99999, priceUpdatedAt: 123, dividendRate2025: 66.6,
    });
    cloud.stockTrades = [t({ side: 'buy', price: 10, shares: 100 })];
    const { stock } = mergeStockFromCloud(cloud, undefined);
    expect(stock.price).toBeUndefined();
    expect(stock.changePercent).toBeUndefined();
    expect(stock.high).toBeUndefined();
    expect(stock.low).toBeUndefined();
    expect(stock.open).toBeUndefined();
    expect(stock.volume).toBeUndefined();
    expect(stock.dividendRate2025).toBeUndefined();
    // 持仓仍按交易重算，不受云端残留价影响
    expect(stock.positionShares).toBe(100);
    expect(stock.positionCost).toBe(10);
  });

  it('合并不会用云端过期价覆盖本地现价', () => {
    const cloud = mkStock('600000', '浦发', { price: 1, priceUpdatedAt: 1 });
    const { stock } = mergeStockFromCloud(cloud, undefined);
    expect(stock.price).toBeUndefined();
    expect(stock.priceUpdatedAt).toBeUndefined();
  });

  it('下载时交易记录完全以云端为准：本地未上传的记录（如刚挂的单）被丢弃', () => {
    const cloudStock = mkStock('600000', '浦发');
    const cloudTrade = t({ id: 'same', side: 'buy', price: 20, shares: 100, createdAt: 1 });
    cloudStock.stockTrades = [cloudTrade];
    const localStock = mkStock('600000', '浦发');
    localStock.stockTrades = [
      t({ id: 'same', side: 'buy', price: 5, shares: 100, createdAt: 1 }),
      t({ id: 'localOnly', side: 'buy', price: 8, shares: 1, createdAt: 2 }),
    ];
    const { stock } = mergeStockFromCloud(cloudStock, localStock);
    // 只保留云端记录，本地独有（未上传）的记录被覆盖丢弃
    expect(stock.stockTrades!.map(x => x.id)).toEqual(['same']);
    expect(stock.stockTrades![0].price).toBe(20);
  });

  it('本地未上传的挂单不参与下载后的持仓计算', () => {
    const cloudStock = mkStock('600000', '浦发');
    cloudStock.stockTrades = [t({ id: 'c1', side: 'buy', price: 10, shares: 100, status: 'filled', createdAt: 1 })];
    const localStock = mkStock('600000', '浦发');
    localStock.stockTrades = [
      t({ id: 'p1', side: 'sell', price: 12, shares: 100, status: 'pending', createdAt: 2 }),
    ];
    const { stock } = mergeStockFromCloud(cloudStock, localStock);
    expect(stock.stockTrades!.map(x => x.id)).toEqual(['c1']);
    expect(stock.positionShares).toBe(100);
  });

  it('云端软删 isDeleted 直接随记录传入', () => {
    const cloudStock = mkStock('600000', '浦发');
    const deletedTrade = t({ id: 'del', side: 'buy', price: 10, shares: 100, createdAt: 1, isDeleted: true });
    cloudStock.stockTrades = [deletedTrade];
    const localLive = t({ id: 'localLive', side: 'buy', price: 9, shares: 1, createdAt: 2 });
    const localStock = mkStock('600000', '浦发');
    localStock.stockTrades = [localLive];
    const { stock } = mergeStockFromCloud(cloudStock, localStock);
    const del = stock.stockTrades!.find(x => x.id === 'del')!;
    expect(del.isDeleted).toBe(true);
    expect(stock.stockTrades!.some(x => x.id === 'localLive')).toBe(false);
  });

  it('下载后按时间升序', () => {
    const cloudStock = mkStock('600000', '浦发');
    cloudStock.stockTrades = [
      t({ id: 'c3', side: 'buy', price: 10, shares: 10, createdAt: 500 }),
      t({ id: 'c1', side: 'buy', price: 10, shares: 10, createdAt: 100 }),
      t({ id: 'c2', side: 'buy', price: 10, shares: 10, createdAt: 300 }),
    ];
    const { stock } = mergeStockFromCloud(cloudStock);
    const ts = stock.stockTrades!.map(x => x.createdAt);
    expect(ts).toEqual([100, 300, 500]);
  });

  it('mergeCloudStocks 批量合并并同步流水账', () => {
    const c1 = mkStock('600000', 'A');
    c1.stockTrades = [t({ id: 'a1', side: 'buy', price: 10, shares: 100, createdAt: 1 })];
    const { mergedStocks, newLedger } = mergeCloudStocks([c1], []);
    expect(mergedStocks).toHaveLength(1);
    expect(mergedStocks[0].positionShares).toBe(100);
    expect(newLedger['600000'].trades).toHaveLength(1);
  });

  it('下载合并保留本地价格缓存字段（本地价格不被云端覆盖或清空）', () => {
    const cloud = mkStock('600000', 'A');
    cloud.stockTrades = [t({ side: 'buy', price: 10, shares: 100 })];
    const local = mkStock('600000', 'A', {
      price: 55.5, changePercent: 2.3, high: 60, low: 50, open: 52,
      volume: 999, priceUpdatedAt: 111, dividendRate2025: 7.7,
    });
    const { stock } = mergeStockFromCloud(cloud, local);
    expect(stock.price).toBe(55.5);
    expect(stock.changePercent).toBe(2.3);
    expect(stock.high).toBe(60);
    expect(stock.low).toBe(50);
    expect(stock.open).toBe(52);
    expect(stock.volume).toBe(999);
    expect(stock.priceUpdatedAt).toBe(111);
    expect(stock.dividendRate2025).toBe(7.7);
    // 业务字段仍以云端为准，持仓由交易重算
    expect(stock.name).toBe('A');
    expect(stock.positionShares).toBe(100);
  });

  it('mergeCloudStocks 覆盖模式：云端没有的本地独有股票被剔除（流水账同步剔除）', () => {
    const c1 = mkStock('600000', 'A');
    c1.stockTrades = [t({ side: 'buy', price: 10, shares: 100 })];
    const localOnly = mkStock('300001', '本地独有', { price: 12.3, priceUpdatedAt: 9 });
    const { mergedStocks, newLedger } = mergeCloudStocks([c1], [c1, localOnly]);
    // 云端没有的本地独有票：从股票列表与流水账中一并剔除
    expect(mergedStocks.map(s => s.id)).toContain('600000');
    expect(mergedStocks.map(s => s.id)).not.toContain('300001');
    expect(Object.keys(newLedger)).toContain('600000');
    expect(Object.keys(newLedger)).not.toContain('300001');
  });

  it('mergeCloudStocks 云端命中：仍保留本地价格缓存、业务字段以云端为准', () => {
    const c1 = mkStock('600000', 'A');
    c1.stockTrades = [t({ side: 'buy', price: 10, shares: 100 })];
    const localHit = mkStock('600000', 'A', { price: 12.3, priceUpdatedAt: 9 });
    const { mergedStocks } = mergeCloudStocks([c1], [localHit]);
    expect(mergedStocks).toHaveLength(1);
    expect(mergedStocks[0].id).toBe('600000');
    expect(mergedStocks[0].price).toBe(12.3); // 本地价格缓存保留
    expect(mergedStocks[0].name).toBe('A');   // 业务字段以云端为准
  });
});

// ---- 上传 buildUploadStocks / stripStockPriceCache ----
describe('buildUploadStocks / stripStockPriceCache', () => {
  it('buildUploadStocks 全量携带（含软删），不裁剪', () => {
    const s = mkStock('600000', '浦发');
    s.stockTrades = [
      t({ side: 'buy', price: 10, shares: 100 }),
      t({ side: 'buy', price: 9, shares: 200, isDeleted: true }),
    ];
    const out = buildUploadStocks([s]);
    expect(out[0].stockTrades).toHaveLength(2); // 软删也保留
  });

  it('stripStockPriceCache 剔除价格缓存字段', () => {
    const s = mkStock('600000', '浦发');
    const withCache = { ...s, price: 12.34, changePercent: 1.2, high: 13, low: 11, open: 11.5, volume: 999, priceUpdatedAt: Date.now(), dividendRate2025: 0.03 };
    const out = stripStockPriceCache([withCache])[0];
    expect((out as any).price).toBeUndefined();
    expect((out as any).changePercent).toBeUndefined();
    expect(out.id).toBe('600000'); // 基础字段保留
  });
});

// ---- financials.json 差异明细 ----
// 契约：区分新增/删除/更新；连续年份且变化项相同合并成 1999-2008 区间。
function mkFinancialsSnapshot(index: Record<string, unknown>): string {
  return JSON.stringify({ financials: index });
}

describe('diffFinancialsSnapshots', () => {
  it('整只股票消失 → 标记为删除，并把连续年份合并成区间', () => {
    const baseline = mkFinancialsSnapshot({
      '600096.SH': {
        dividendByYear: { 1999: 0.1, 2000: 0.1, 2001: 0.1, 2003: 0.2 },
        dividendTotalByYear: { 1999: 1, 2000: 1, 2001: 1, 2003: 2 },
        parentNetProfitByYear: { 1999: 10, 2000: 10, 2001: 10, 2003: 20 },
      },
    });
    const current = mkFinancialsSnapshot({});
    const d = diffFinancialsSnapshots(baseline, current)!;
    expect(d.stocks).toHaveLength(1);
    expect(d.stocks[0]).toMatchObject({
      code: '600096.SH',
      kind: 'remove',
      groups: [
        { kind: 'remove', startYear: 1999, endYear: 2001, fields: ['dividend', 'dividendTotal', 'netProfit'] },
        { kind: 'remove', startYear: 2003, endYear: 2003, fields: ['dividend', 'dividendTotal', 'netProfit'] },
      ],
    });
  });

  it('整只股票新增 → 标记为新增', () => {
    const baseline = mkFinancialsSnapshot({});
    const current = mkFinancialsSnapshot({
      '600519.SH': { dividendByYear: { 2024: 20, 2025: 25 } },
    });
    const d = diffFinancialsSnapshots(baseline, current)!;
    expect(d.stocks[0]).toMatchObject({
      code: '600519.SH',
      kind: 'add',
      groups: [{ kind: 'add', startYear: 2024, endYear: 2025, fields: ['dividend'] }],
    });
  });

  it('已有年份的值变化 → 标记为更新，并列出变化项', () => {
    const baseline = mkFinancialsSnapshot({
      '600036.SH': { dividendByYear: { 2024: 2.0 }, dividendTotalByYear: { 2024: 100 } },
    });
    const current = mkFinancialsSnapshot({
      '600036.SH': { dividendByYear: { 2024: 2.1 }, dividendTotalByYear: { 2024: 100 } },
    });
    const d = diffFinancialsSnapshots(baseline, current)!;
    expect(d.stocks[0]).toMatchObject({
      code: '600036.SH',
      kind: 'change',
      groups: [{ kind: 'change', startYear: 2024, endYear: 2024, fields: ['dividend'] }],
    });
  });

  it('整年新增与整年更新混合时，股票级为更新、年份段各自标注类型', () => {
    const baseline = mkFinancialsSnapshot({
      '600036.SH': { dividendByYear: { 2023: 1.9 } },
    });
    const current = mkFinancialsSnapshot({
      '600036.SH': { dividendByYear: { 2023: 1.9, 2025: 2.0 } },
    });
    const d = diffFinancialsSnapshots(baseline, current)!;
    expect(d.stocks[0]).toMatchObject({
      kind: 'change',
      groups: [{ kind: 'add', startYear: 2025, endYear: 2025, fields: ['dividend'] }],
    });
  });

  it('无变化返回空列表；无基线返回 null', () => {
    const same = mkFinancialsSnapshot({ '600036.SH': { dividendByYear: { 2024: 2.0 } } });
    expect(diffFinancialsSnapshots(same, same)!.stocks).toEqual([]);
    expect(diffFinancialsSnapshots(null, same)).toBeNull();
  });
});

describe('collectStockNamesFromSnapshot', () => {
  it('从 stocks.json 快照提取 code → 名称（代号优先）', () => {
    const raw = JSON.stringify({
      stocks: [
        { id: '600036.SH', code: '600036.SH', name: '招商银行', nickname: '招行' },
        { id: '600519.SH', code: '600519.SH', name: '贵州茅台' },
        { id: '600000.SH', code: '600000.SH', name: '' },
      ],
    });
    expect(collectStockNamesFromSnapshot(raw)).toEqual({
      '600036.SH': '招行',
      '600519.SH': '贵州茅台',
    });
    expect(collectStockNamesFromSnapshot(null)).toEqual({});
  });
});