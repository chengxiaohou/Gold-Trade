import { describe, it, expect } from 'vitest';
import { toggleTradeStatus, removeTrade } from '../stockTradeOps';
import { mkTrade, mkStock } from './test-utils';

describe('toggleTradeStatus：挂单 ⇄ 已成交', () => {
  it('买入挂单标记成交：记录变 filled、附成交时间，持仓加权买入', () => {
    const stock = mkStock('600000', '浦发', { stockTrades: [mkTrade({ id: 'P1', side: 'buy', price: 10, shares: 100, status: 'pending' })] });
    const patch = toggleTradeStatus(stock, 'P1', 5000);
    expect(patch.changed).toBe(true);
    expect(patch.stockTrades[0].status).toBe('filled');
    expect(patch.stockTrades[0].filledAt).toBe(5000);
    expect(patch.positionShares).toBe(100);
    expect(patch.positionCost).toBe(10);
  });

  it('卖出挂单标记成交：持仓减少并按均价结算已实现盈亏', () => {
    const stock = mkStock('600000', '浦发', {
      positionShares: 100, positionCost: 10,
      stockTrades: [mkTrade({ id: 'S1', side: 'sell', price: 20, shares: 40, status: 'pending' })],
    });
    const patch = toggleTradeStatus(stock, 'S1');
    expect(patch.positionShares).toBe(60);
    expect(patch.stockTrades[0].realizedPnL).toBe(400); // (20-10)*40
  });

  it('已成交改回挂单：状态回退、成交时间与已实现盈亏清除、持仓回退', () => {
    const base = mkTrade({ id: 'P1', side: 'buy', price: 10, shares: 100, status: 'pending' });
    const stock = mkStock('600000', '浦发', { stockTrades: [base] });
    const filled = toggleTradeStatus(stock, 'P1', 5000); // 先成交
    const back = toggleTradeStatus({ ...stock, ...filled, stockTrades: filled.stockTrades }, 'P1', 9000);
    expect(back.changed).toBe(true);
    expect(back.stockTrades[0].status).toBe('pending');
    expect(back.stockTrades[0].filledAt).toBeUndefined();
    expect(back.stockTrades[0].realizedPnL).toBeUndefined();
    expect(back.positionShares).toBe(0);
    expect(back.positionCost).toBe(0);
  });

  it('记录不存在或已合并汇总 → changed=false，数据原样返回', () => {
    const stock = mkStock('600000', '浦发', { stockTrades: [mkTrade({ id: 'A1', isMerged: true })] });
    expect(toggleTradeStatus(stock, 'A1').changed).toBe(false); // isMerged 视为不可改
    expect(toggleTradeStatus(stock, 'NO_SUCH').changed).toBe(false);
  });
});

describe('removeTrade：撤单 / 删除交易记录', () => {
  it('删除一条挂单：记录从列表消失，且不影响当前持仓', () => {
    const stock = mkStock('600000', '浦发', {
      stockTrades: [mkTrade({ id: 'P1', side: 'buy', price: 10, shares: 100, status: 'pending' })],
    });
    const patch = removeTrade(stock, 'P1');
    expect(patch.changed).toBe(true);
    expect(patch.stockTrades).toEqual([]); // 记录彻底删除（刷新后不会重新出现）
    expect(patch.positionShares).toBe(0);
    expect(patch.positionCost).toBe(0);
  });

  it('删除一笔已成交买入：记录消失并回退持仓', () => {
    const stock = mkStock('600000', '浦发', {
      positionShares: 100, positionCost: 10,
      stockTrades: [mkTrade({ id: 'F1', side: 'buy', price: 10, shares: 100, status: 'filled' })],
    });
    const patch = removeTrade(stock, 'F1');
    expect(patch.stockTrades).toEqual([]);
    expect(patch.positionShares).toBe(0);
    expect(patch.positionCost).toBe(0);
  });

  it('记录不存在或已合并汇总 → changed=false', () => {
    const stock = mkStock('600000', '浦发', { stockTrades: [mkTrade({ id: 'A1', isMerged: true })] });
    expect(removeTrade(stock, 'A1').changed).toBe(false);
    expect(removeTrade(stock, 'NO_SUCH').changed).toBe(false);
  });
});