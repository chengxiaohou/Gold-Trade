import { describe, it, expect } from 'vitest';
import { buildStockCloudFingerprint, isStockCloudDirty, resolveMemoUpdatedAt } from '../stockSync';
import { mkTrade as t, mkStock, mkPreset } from './test-utils';
import type { StockSettings } from '../../types';

// ---- 上传字段指纹 buildStockCloudFingerprint ----
// 核心契约：指纹必须与"实际上传到云端的字段"严格一致——
//   - 剔除价格缓存字段（避免价格刷新误报）
//   - 剔除设备特定字段 maxRows/maxWidth/sortMode（避免设备差异误报）
//   - 纳入策略组模板 backtestStrategyPresets
describe('buildStockCloudFingerprint', () => {
  it('相同输入多次调用产生相同指纹（确定性）', () => {
    const input = {
      stocks: [mkStock('600000', '浦发')],
      stockSettings: { visibleColumns: ['code', 'name'], memo: '备忘' } as StockSettings,
      backtestStrategyPresets: [mkPreset('p1')],
    };
    expect(buildStockCloudFingerprint(input)).toBe(buildStockCloudFingerprint(input));
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
    expect(buildStockCloudFingerprint(cached)).toBe(buildStockCloudFingerprint(base));
  });

  it('设备特定字段 maxRows/maxWidth/sortMode 变化不改变指纹', () => {
    const mk = (over: Partial<StockSettings>) => buildStockCloudFingerprint({
      stocks: [mkStock('600000', '浦发')],
      stockSettings: { visibleColumns: ['code'], memo: 'x', ...over } as StockSettings,
    });
    const base = mk({});
    expect(mk({ maxRows: 99 })).toBe(base);
    expect(mk({ maxWidth: 1200 })).toBe(base);
    expect(mk({ sortMode: 'daily' })).toBe(base);
  });

  it('真实持仓数据变化（positionShares）改变指纹', () => {
    const a = buildStockCloudFingerprint({ stocks: [mkStock('600000', '浦发')] });
    const b = buildStockCloudFingerprint({ stocks: [mkStock('600000', '浦发', { positionShares: 100, positionCost: 10 })] });
    expect(b).not.toBe(a);
  });

  it('分红数据（dividendByYear）变化改变指纹', () => {
    const a = buildStockCloudFingerprint({ stocks: [mkStock('600000', '浦发')] });
    const b = buildStockCloudFingerprint({ stocks: [mkStock('600000', '浦发', { dividendByYear: { 2025: 0.5 } })] });
    expect(b).not.toBe(a);
  });

  it('交易记录新增/修改/删除均改变指纹', () => {
    const mk = (tradePatch?: Partial<ReturnType<typeof t>>) => {
      const s = mkStock('600000', '浦发');
      if (tradePatch) s.stockTrades = [t(tradePatch)];
      return buildStockCloudFingerprint({ stocks: [s] });
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
    const mk = (memo: string) => buildStockCloudFingerprint({
      stocks: [mkStock('600000', '浦发')],
      stockSettings: { visibleColumns: ['code'], memo } as StockSettings,
    });
    expect(mk('a')).not.toBe(mk('b'));
  });

  it('备忘录 memoUpdatedAt 属于指纹：内容相同但时间不同 → 视为有差异', () => {
    const mk = (memoUpdatedAt: number) => buildStockCloudFingerprint({
      stocks: [mkStock('600000', '浦发')],
      stockSettings: { visibleColumns: ['code'], memo: '基线', memoUpdatedAt } as StockSettings,
    });
    expect(mk(100)).not.toBe(mk(999));
  });

  it('策略组模板 presets 增删/内容变化改变指纹', () => {
    const none = buildStockCloudFingerprint({ stocks: [mkStock('600000', '浦发')] });
    const one = buildStockCloudFingerprint({ stocks: [mkStock('600000', '浦发')], backtestStrategyPresets: [mkPreset('p1')] });
    expect(one).not.toBe(none);
    const two = buildStockCloudFingerprint({ stocks: [mkStock('600000', '浦发')], backtestStrategyPresets: [mkPreset('p1'), mkPreset('p2')] });
    expect(two).not.toBe(one);
    const renamed = buildStockCloudFingerprint({ stocks: [mkStock('600000', '浦发')], backtestStrategyPresets: [mkPreset('p1', { name: '改名' })] });
    expect(renamed).not.toBe(one);
  });

  it('无任何变化 → 指纹相等', () => {
    const input = {
      stocks: [mkStock('600000', '浦发'), mkStock('000001', '平安')],
      stockSettings: { visibleColumns: ['code'], memo: 'm' } as StockSettings,
      backtestStrategyPresets: [mkPreset('p1')],
    };
    expect(buildStockCloudFingerprint(input)).toBe(buildStockCloudFingerprint(input));
  });
});

// ---- 差异判定 isStockCloudDirty ----
describe('isStockCloudDirty', () => {
  it('基线为 null（尚未同步/首次使用）视为有改动', () => {
    expect(isStockCloudDirty(null, 'x')).toBe(true);
  });

  it('基线等于当前 → 无改动', () => {
    const fp = buildStockCloudFingerprint({ stocks: [mkStock('600000', '浦发')] });
    expect(isStockCloudDirty(fp, fp)).toBe(false);
  });

  it('基线不等于当前 → 有改动', () => {
    const a = buildStockCloudFingerprint({ stocks: [mkStock('600000', '浦发')] });
    const b = buildStockCloudFingerprint({ stocks: [mkStock('000001', '平安')] });
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