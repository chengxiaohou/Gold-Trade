import { describe, it, expect } from 'vitest';
import { calcPositionFromTrades } from '../realizedPnl';
import { mergeStockFromCloud, mergeCloudStocks, buildUploadStocks, stripStockPriceCache } from '../stockSync';
import { mkTrade as t, mkStock } from './test-utils';
import type { StockLedgerMap } from '../stockLedgerStore';

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

  it('云端同 id 覆盖本地（编辑回传）', () => {
    const cloudStock = mkStock('600000', '浦发');
    const cloudTrade = t({ id: 'same', side: 'buy', price: 20, shares: 100, createdAt: 1 });
    cloudStock.stockTrades = [cloudTrade];
    const localTrade = t({ id: 'same', side: 'buy', price: 5, shares: 100, createdAt: 1 });
    const { stock } = mergeStockFromCloud(cloudStock, [localTrade, t({ id: 'localOnly', side: 'buy', price: 8, shares: 1, createdAt: 2 })]);
    // 本地独有的 localOnly 保留；same 用云端版本（20）
    expect(stock.stockTrades!.some(x => x.id === 'localOnly')).toBe(true);
    const same = stock.stockTrades!.find(x => x.id === 'same')!;
    expect(same.price).toBe(20);
  });

  it('云端新增 id 并入', () => {
    const cloudStock = mkStock('600000', '浦发');
    cloudStock.stockTrades = [t({ id: 'new1', side: 'buy', price: 10, shares: 100, createdAt: 5 })];
    const localTrade = t({ id: 'old1', side: 'buy', price: 8, shares: 100, createdAt: 1 });
    const { stock } = mergeStockFromCloud(cloudStock, [localTrade]);
    expect(stock.stockTrades!.map(x => x.id)).toContain('new1');
    expect(stock.stockTrades!.map(x => x.id)).toContain('old1');
  });

  it('本地独有、云端无 → 保留本地；软删 isDeleted 直接随云端记录传入', () => {
    const cloudStock = mkStock('600000', '浦发');
    const deletedTrade = t({ id: 'del', side: 'buy', price: 10, shares: 100, createdAt: 1, isDeleted: true });
    cloudStock.stockTrades = [deletedTrade];
    const localLive = t({ id: 'localLive', side: 'buy', price: 9, shares: 1, createdAt: 2 });
    const { stock } = mergeStockFromCloud(cloudStock, [localLive]);
    const del = stock.stockTrades!.find(x => x.id === 'del')!;
    expect(del.isDeleted).toBe(true);
    expect(stock.stockTrades!.some(x => x.id === 'localLive')).toBe(true);
  });

  it('合并后按时间升序', () => {
    const cloudStock = mkStock('600000', '浦发');
    cloudStock.stockTrades = [t({ id: 'c2', side: 'buy', price: 10, shares: 10, createdAt: 300 })];
    const local = [
      t({ id: 'l1', side: 'buy', price: 10, shares: 10, createdAt: 100 }),
      t({ id: 'l3', side: 'buy', price: 10, shares: 10, createdAt: 500 }),
    ];
    const { stock } = mergeStockFromCloud(cloudStock, local);
    const ts = stock.stockTrades!.map(x => x.createdAt);
    expect(ts).toEqual([100, 300, 500]);
  });

  it('mergeCloudStocks 批量合并并同步流水账', () => {
    const c1 = mkStock('600000', 'A');
    c1.stockTrades = [t({ id: 'a1', side: 'buy', price: 10, shares: 100, createdAt: 1 })];
    const localLedger: StockLedgerMap = {};
    const { mergedStocks, newLedger } = mergeCloudStocks([c1], localLedger, []);
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
    const { stock } = mergeStockFromCloud(cloud, [], local);
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

  it('mergeCloudStocks 保留本地独有股票（云端没有的不丢失）', () => {
    const c1 = mkStock('600000', 'A');
    c1.stockTrades = [t({ side: 'buy', price: 10, shares: 100 })];
    const localOnly = mkStock('300001', '本地独有', { price: 12.3, priceUpdatedAt: 9 });
    const localLedger: StockLedgerMap = {};
    const { mergedStocks } = mergeCloudStocks([c1], localLedger, [c1, localOnly]);
    expect(mergedStocks.map(s => s.id)).toContain('600000');
    expect(mergedStocks.map(s => s.id)).toContain('300001');
    // 本地独有股票原样保留（含价格缓存）
    const kept = mergedStocks.find(s => s.id === '300001')!;
    expect(kept.price).toBe(12.3);
    expect(kept.name).toBe('本地独有');
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