import { describe, it, expect } from 'vitest';
import {
  buildGoldFileFingerprint,
  buildStocksFileFingerprint,
  buildFinancialsFileFingerprint,
  isStockCloudDirty,
  resolveMemoUpdatedAt,
} from '../stockSync';
import { mkTrade as t, mkStock, mkPreset } from './test-utils';
import type { StockSettings, TradeRecord } from '../../types';

// ===== 三文件指纹契约 =====
// gold.json  → buildGoldFileFingerprint({ trades, settings })：黄金交易 + 全局设置
// stocks.json → buildStocksFileFingerprint({ stocks, stockSettings, backtestStrategyPresets })：
//               剔除价格缓存字段、剔除三张财务表、剔除设备特定字段
// financials.json → buildFinancialsFileFingerprint(stocks)：只含三张财务表（按 code 索引）
// 三份指纹必须与“实际上传到对应云端文件的字段”严格一致。

describe('buildStocksFileFingerprint', () => {
  it('相同输入多次调用产生相同指纹（确定性）', () => {
    const input = {
      stocks: [mkStock('600000', '浦发')],
      stockSettings: { visibleColumns: ['code', 'name'], memo: '备忘' } as StockSettings,
      backtestStrategyPresets: [mkPreset('p1')],
    };
    expect(buildStocksFileFingerprint(input)).toBe(buildStocksFileFingerprint(input));
  });

  it('价格缓存字段变化不改变指纹（不产生误报）', () => {
    const base = { stocks: [mkStock('600000', '浦发')] };
    const cached = {
      stocks: [mkStock('600000', '浦发', {
        price: 12.34,
        changePercent: 1.2,
        high: 13,
        low: 11,
        open: 11.5,
        volume: 999,
        priceUpdatedAt: Date.now(),
        dividendRate2025: 0.03,
      })],
    };
    // 现价/涨跌/高低量/更新时间/价格派生股息率均被剔除 → 指纹不变
    expect(buildStocksFileFingerprint(cached)).toBe(buildStocksFileFingerprint(base));
  });

  it('设备特定字段 maxRows/maxWidth/sortMode/autoRefreshInterval 变化不改变指纹', () => {
    const mk = (over: Partial<StockSettings>) => buildStocksFileFingerprint({
      stocks: [mkStock('600000', '浦发')],
      stockSettings: { visibleColumns: ['code'], memo: 'x', ...over } as StockSettings,
    });
    const base = mk({});
    expect(mk({ maxRows: 99 })).toBe(base);
    expect(mk({ maxWidth: 1200 })).toBe(base);
    expect(mk({ sortMode: 'daily' })).toBe(base);
    expect(mk({ autoRefreshInterval: 300 })).toBe(base);
  });

  it('真实持仓数据变化（positionShares）改变指纹', () => {
    const a = buildStocksFileFingerprint({ stocks: [mkStock('600000', '浦发')] });
    const b = buildStocksFileFingerprint({ stocks: [mkStock('600000', '浦发', { positionShares: 100, positionCost: 10 })] });
    expect(b).not.toBe(a);
  });

  it('分红数据（dividendByYear）不改变 stocks 指纹（已拆到 financials）', () => {
    const a = buildStocksFileFingerprint({ stocks: [mkStock('600000', '浦发')] });
    const b = buildStocksFileFingerprint({ stocks: [mkStock('600000', '浦发', { dividendByYear: { 2025: 0.5 } })] });
    expect(b).toBe(a);
  });

  it('交易记录新增/修改/删除均改变指纹', () => {
    const mk = (tradePatch?: Partial<ReturnType<typeof t>>) => {
      const s = mkStock('600000', '浦发');
      if (tradePatch) s.stockTrades = [t(tradePatch)];
      return buildStocksFileFingerprint({ stocks: [s] });
    };
    const empty = mk(); // 无交易
    const added = mk({ side: 'buy', price: 10, shares: 100 });
    expect(added).not.toBe(empty);
    const modified = mk({ side: 'buy', price: 30, shares: 100 });
    expect(modified).not.toBe(added);
    const deleted = mk({ side: 'buy', price: 30, shares: 100, isDeleted: true });
    expect(deleted).not.toBe(modified); // 软删标记也随记录携带
  });

  it('stockSettings 真实字段（memo）变化改变指纹', () => {
    const mk = (memo: string) => buildStocksFileFingerprint({
      stocks: [mkStock('600000', '浦发')],
      stockSettings: { visibleColumns: ['code'], memo } as StockSettings,
    });
    expect(mk('a')).not.toBe(mk('b'));
  });

  it('备忘录 memoUpdatedAt 属于指纹：内容相同但时间不同 → 视为有差异', () => {
    const mk = (memoUpdatedAt: number) => buildStocksFileFingerprint({
      stocks: [mkStock('600000', '浦发')],
      stockSettings: { visibleColumns: ['code'], memo: '基线', memoUpdatedAt } as StockSettings,
    });
    expect(mk(100)).not.toBe(mk(999));
  });

  it('策略组模板 presets 增删/内容变化改变指纹', () => {
    const none = buildStocksFileFingerprint({ stocks: [mkStock('600000', '浦发')] });
    const one = buildStocksFileFingerprint({ stocks: [mkStock('600000', '浦发')], backtestStrategyPresets: [mkPreset('p1')] });
    expect(one).not.toBe(none);
    const two = buildStocksFileFingerprint({ stocks: [mkStock('600000', '浦发')], backtestStrategyPresets: [mkPreset('p1'), mkPreset('p2')] });
    expect(two).not.toBe(one);
    const renamed = buildStocksFileFingerprint({ stocks: [mkStock('600000', '浦发')], backtestStrategyPresets: [mkPreset('p1', { name: '改名' })] });
    expect(renamed).not.toBe(one);
  });

  it('用户自定义信号标签 customTags 变化改变指纹（随云同步）', () => {
    const mk = (customTags: any) => buildStocksFileFingerprint({
      stocks: [mkStock('600000', '浦发')],
      stockSettings: { visibleColumns: ['code'], customTags } as StockSettings,
    });
    const tag = { id: 't1', name: '收盘达MA20', enabled: true, source: 'price', direction: 'up', targetType: 'indicator', targetIndicator: 'ma20', color: 'indigo' };
    expect(mk([tag])).not.toBe(mk(null));
    expect(mk([tag])).not.toBe(mk([{ ...tag, enabled: false }])); // 开关状态也随云同步
    expect(mk([tag])).not.toBe(mk([{ ...tag, targetValue: 99 }])); // 参数变化也随云同步
  });
});

describe('buildFinancialsFileFingerprint', () => {
  it('相同输入多次调用产生相同指纹（确定性）', () => {
    const stocks = [mkStock('600000', '浦发', { dividendByYear: { 2025: 0.5 } })];
    expect(buildFinancialsFileFingerprint(stocks)).toBe(buildFinancialsFileFingerprint(stocks));
  });

  it('分红数据（dividendByYear）变化改变指纹', () => {
    const a = buildFinancialsFileFingerprint([mkStock('600000', '浦发')]);
    const b = buildFinancialsFileFingerprint([mkStock('600000', '浦发', { dividendByYear: { 2025: 0.5 } })]);
    expect(b).not.toBe(a);
  });

  it('非财务字段（持仓/交易）变化不改变 financials 指纹', () => {
    const a = buildFinancialsFileFingerprint([mkStock('600000', '浦发')]);
    const b = buildFinancialsFileFingerprint([mkStock('600000', '浦发', { positionShares: 100, stockTrades: [t({ price: 9 })] })]);
    expect(b).toBe(a);
  });
});

describe('buildGoldFileFingerprint', () => {
  const goldTrade = (over: Partial<TradeRecord> = {}): TradeRecord => ({
    id: 'g1',
    type: 'BUY',
    grams: 1,
    price: 500,
    timestamp: 1000,
    ...over,
  });

  it('全局设置 totalCapital（黄金页总资金）变化改变指纹', () => {
    const mk = (v: number) => buildGoldFileFingerprint({ trades: [], settings: { totalCapital: v } });
    expect(mk(100000)).not.toBe(mk(120000));
  });

  it('全局设置 dividendTotalCapital（分红页总资金）变化改变指纹', () => {
    const mk = (v: number) => buildGoldFileFingerprint({ trades: [], settings: { dividendTotalCapital: v } });
    expect(mk(100000)).not.toBe(mk(120000));
  });

  it('交易记录变化改变指纹', () => {
    const empty = buildGoldFileFingerprint({ trades: [], settings: {} });
    const one = buildGoldFileFingerprint({ trades: [goldTrade()], settings: {} });
    expect(one).not.toBe(empty);
    const changed = buildGoldFileFingerprint({ trades: [goldTrade({ price: 600 })], settings: {} });
    expect(changed).not.toBe(one);
  });

  it('相同输入多次调用产生相同指纹（确定性）', () => {
    const input = { trades: [goldTrade()], settings: { totalCapital: 100000 } };
    expect(buildGoldFileFingerprint(input)).toBe(buildGoldFileFingerprint(input));
  });
});

// ---- 差异判定 isStockCloudDirty ----
describe('isStockCloudDirty', () => {
  it('基线为 null（尚未同步/首次使用）视为有改动', () => {
    expect(isStockCloudDirty(null, 'x')).toBe(true);
  });

  it('基线等于当前 → 无改动', () => {
    const fp = buildStocksFileFingerprint({ stocks: [mkStock('600000', '浦发')] });
    expect(isStockCloudDirty(fp, fp)).toBe(false);
  });

  it('基线不等于当前 → 有改动', () => {
    const a = buildStocksFileFingerprint({ stocks: [mkStock('600000', '浦发')] });
    const b = buildStocksFileFingerprint({ stocks: [mkStock('000001', '平安')] });
    expect(isStockCloudDirty(a, b)).toBe(true);
  });
});

// ---- 备忘录时间戳恢复 resolveMemoUpdatedAt ----
// 与"输入一个字再删回基线 → 上传按钮应消失"的修复对应：
// 内容回到基线时恢复下载/上传时的时间戳，使指纹回到基线、不再被视为有差异。
describe('resolveMemoUpdatedAt', () => {
  it('内容回到基线 → 恢复基线时间戳', () => {
    expect(resolveMemoUpdatedAt('基线', '基线', 12345, 99999)).toBe(12345);
  });

  it('内容偏离基线 → 用当前编辑时间', () => {
    expect(resolveMemoUpdatedAt('基线X', '基线', 12345, 99999)).toBe(99999);
  });

  it('无基线（undefined）且内容非空 → 用当前编辑时间', () => {
    expect(resolveMemoUpdatedAt('有内容', undefined, 0, 777)).toBe(777);
  });

  it('内容为空串且基线为空串 → 恢复基线时间戳', () => {
    expect(resolveMemoUpdatedAt('', '', 12345, 99999)).toBe(12345);
  });
});