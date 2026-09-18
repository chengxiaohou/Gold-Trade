// 共享测试工具：所有单元测试文件的假数据构造器统一放这里，
// 避免各测试文件各自复制 mkTrade / mkStock 造成维护漂移。
import type { StockTrade, StockEntry, BacktestStrategyPreset } from '../../types';

let _seq = 0;
function nextId(): string {
  _seq += 1;
  return `t${_seq}`;
}

// 生成一条交易记录；可覆盖任意字段。
export function mkTrade(over: Partial<StockTrade> = {}): StockTrade {
  const base: StockTrade = {
    id: nextId(),
    side: 'buy',
    price: 10,
    shares: 100,
    status: 'filled',
    createdAt: 1000 + _seq,
  };
  return { ...base, ...over };
}

// 生成一只股票（必填字段齐全）。
export function mkStock(code: string, name: string, over: Partial<StockEntry> = {}): StockEntry {
  const base: StockEntry = {
    id: code,
    code,
    name,
    price: 0,
    changePercent: 0,
    high: 0,
    low: 0,
    dividend2024: 0,
    dividend2025: 0,
    dividendByYear: {},
    dividendRate2025: 0,
    positionShares: 0,
    positionCost: 0,
    priceUpdatedAt: null,
    dividendRates: {},
  };
  return { ...base, ...over };
}

// 生成一个策略组模板（BacktestStrategyPreset）。
export function mkPreset(id: string, over: Partial<BacktestStrategyPreset> = {}): BacktestStrategyPreset {
  const base: BacktestStrategyPreset = {
    id,
    name: id,
    rules: [],
    createdAt: 1000 + _seq,
    updatedAt: 1000 + _seq,
  };
  return { ...base, ...over };
}