import React, { useState, useMemo, useEffect } from 'react';
import { ShieldAlert, Trash2, Play, Settings2, Info, ChevronDown } from 'lucide-react';
import { TradeRecord } from '../types';
import { InputGroup } from './InputGroup';

interface TradingPlanPanelProps {
  marketPrice: string;
  onMarketPriceChange: (price: string) => void;
  priceStep: number;
  touchMode: boolean;
  availableFunds: number;
  isExpanded: boolean;
  onToggle: () => void;
  onApplyPlan: (trades: TradeRecord[]) => void;
  onClearPlan: () => void;
  hasPlan: boolean;
}

export function TradingPlanPanel({ 
  marketPrice, 
  onMarketPriceChange, 
  priceStep, 
  touchMode,
  availableFunds, 
  isExpanded, 
  onToggle, 
  onApplyPlan, 
  onClearPlan, 
  hasPlan 
}: TradingPlanPanelProps) {
  const [params, setParams] = useState({
    targetPrice: '',
    totalFunds: '',
    stepType: 'amount' as 'amount' | 'percentage',
    stepValue: '10',
    strategy: 'equal' as 'equal' | 'arithmetic' | 'extreme',
  });

  useEffect(() => {
    if (isExpanded) {
      if (!params.totalFunds && availableFunds > 0) {
        setParams(p => ({ ...p, totalFunds: availableFunds.toFixed(2) }));
      }
      if (!params.targetPrice && marketPrice) {
        const defaultTarget = Math.max(0, parseFloat(marketPrice) - 100);
        setParams(p => ({ ...p, targetPrice: defaultTarget.toString() }));
      }
    }
  }, [isExpanded, availableFunds, marketPrice]);

  const handleParamChange = (field: keyof typeof params, value: string) => {
    setParams(prev => ({ ...prev, [field]: value }));
  };

  const generatedTrades = useMemo(() => {
    const start = parseFloat(marketPrice);
    const target = parseFloat(params.targetPrice);
    const funds = parseFloat(params.totalFunds);
    const step = parseFloat(params.stepValue);

    if (!target || !funds || (params.strategy !== 'extreme' && (!start || !step || start <= target || step <= 0))) {
      return [];
    }

    const now = Date.now();

    if (params.strategy === 'extreme') {
      // 优先使用手动输入的资金，如果没有输入则使用全部可用资金
      const fundsToUse = params.totalFunds ? parseFloat(params.totalFunds) : availableFunds;
      const grams = Math.floor(fundsToUse / target);
      if (grams > 0) {
        return [{
          id: `plan-${now}-0`,
          type: 'BUY',
          price: Number(target.toFixed(2)),
          grams,
          timestamp: now,
          isPlan: true,
          tag: '预案'
        }];
      }
      return [];
    }

    const prices: number[] = [];
    let current = start;

    if (params.stepType === 'amount') {
      current -= step;
      while (current >= target) {
        prices.push(current);
        current -= step;
      }
    } else {
      current = current * (1 - step / 100);
      while (current >= target) {
        prices.push(current);
        current = current * (1 - step / 100);
      }
    }

    if (prices.length === 0) return [];

    const N = prices.length;
    const trades: TradeRecord[] = [];

    if (params.strategy === 'equal') {
      const fundsPerStep = funds / N;
      prices.forEach((p, index) => {
        const grams = Math.floor(fundsPerStep / p);
        if (grams > 0) {
          trades.push({
            id: `plan-${now}-${index}`,
            type: 'BUY',
            price: Number(p.toFixed(2)),
            grams,
            timestamp: now + index,
            isPlan: true,
            tag: '预案'
          });
        }
      });
    } else if (params.strategy === 'arithmetic') {
      const totalParts = (N * (N + 1)) / 2;
      const partValue = funds / totalParts;
      
      prices.forEach((p, index) => {
        const stepFunds = partValue * (index + 1);
        const grams = Math.floor(stepFunds / p);
        if (grams > 0) {
          trades.push({
            id: `plan-${now}-${index}`,
            type: 'BUY',
            price: Number(p.toFixed(2)),
            grams,
            timestamp: now + index,
            isPlan: true,
            tag: '预案'
          });
        }
      });
    }

    return trades;
  }, [marketPrice, params]);

  const handleApply = () => {
    if (generatedTrades.length > 0) {
      onApplyPlan(generatedTrades);
    }
  };

  return (
    <div className="bg-app-card border border-app-border rounded-xl overflow-hidden shadow-2xl flex flex-col">
      <button 
        onClick={onToggle}
        className="flex items-center justify-between p-3 bg-app-input/50 hover:bg-app-hover transition-colors"
      >
        <div className="flex items-center gap-2 text-app-text font-medium text-sm">
          <ShieldAlert size={16} className="text-indigo-400" />
          容灾预案
          {hasPlan && <span className="px-1.5 py-0.5 rounded text-[10px] bg-indigo-500/20 text-indigo-400 ml-2">生效中</span>}
        </div>
        <ChevronDown size={16} className={`text-app-subtext transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
      </button>

      {isExpanded && (
        <div className="p-4 flex flex-col gap-4 border-t border-app-border">
          <div className="grid grid-cols-2 gap-3">
            <InputGroup 
              label="起始价格" 
              value={marketPrice} 
              onChange={onMarketPriceChange} 
              placeholder="当前价格" 
              step={priceStep}
              touchMode={touchMode}
            />
            <InputGroup 
              label="目标底价" 
              value={params.targetPrice} 
              onChange={(v) => handleParamChange('targetPrice', v)} 
              placeholder="400" 
            />
            <div className="relative">
              <InputGroup 
                label="计划动用资金" 
                value={params.totalFunds} 
                onChange={(v) => handleParamChange('totalFunds', v)} 
                placeholder={availableFunds.toFixed(2)} 
                hideControls={true}
              />
              {availableFunds > 0 && params.totalFunds !== availableFunds.toFixed(2) && (
                <button 
                  onClick={() => handleParamChange('totalFunds', availableFunds.toFixed(2))}
                  className="absolute top-0 right-1 text-[10px] font-bold text-indigo-400 hover:underline"
                >
                  全部
                </button>
              )}
            </div>
            
            <div className={`flex flex-col gap-1.5 transition-opacity ${params.strategy === 'extreme' ? 'opacity-30 pointer-events-none' : ''}`}>
              <label className="text-xs font-medium text-app-subtext pl-1">下跌步长</label>
              <div className="flex gap-1">
                <input 
                  type="text" 
                  value={params.stepValue}
                  onChange={(e) => handleParamChange('stepValue', e.target.value.replace(/[^\d.]/g, ''))}
                  placeholder="10"
                  className="w-full bg-app-input border border-app-border rounded-lg px-3 py-2 text-sm text-app-text outline-none focus:border-indigo-500/50 transition-colors"
                />
                <select 
                  value={params.stepType}
                  onChange={(e) => handleParamChange('stepType', e.target.value as any)}
                  className="bg-app-input border border-app-border rounded-lg px-2 py-2 text-sm text-app-text outline-none focus:border-indigo-500/50 transition-colors"
                >
                  <option value="amount">元</option>
                  <option value="percentage">%</option>
                </select>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-app-subtext pl-1">补仓策略</label>
            <div className="grid grid-cols-3 gap-2 p-1 bg-app-input rounded-lg">
              <button 
                onClick={() => handleParamChange('strategy', 'equal')} 
                className={`py-2 rounded-md text-[11px] font-medium transition-all ${params.strategy === 'equal' ? 'bg-app-card text-indigo-400 shadow-sm border border-indigo-500/30' : 'text-app-subtext hover:text-app-text'}`}
              >
                等额买入
              </button>
              <button 
                onClick={() => handleParamChange('strategy', 'arithmetic')} 
                className={`py-2 rounded-md text-[11px] font-medium transition-all ${params.strategy === 'arithmetic' ? 'bg-app-card text-indigo-400 shadow-sm border border-indigo-500/30' : 'text-app-subtext hover:text-app-text'}`}
              >
                等差买入
              </button>
              <button 
                onClick={() => handleParamChange('strategy', 'extreme')} 
                className={`py-2 rounded-md text-[11px] font-medium transition-all ${params.strategy === 'extreme' ? 'bg-app-card text-indigo-400 shadow-sm border border-indigo-500/30' : 'text-app-subtext hover:text-app-text'}`}
              >
                极限抄底
              </button>
            </div>
          </div>

          {generatedTrades.length > 0 && (
            <div className="text-xs text-app-subtext bg-app-input/50 p-2 rounded-lg border border-app-border border-dashed">
              预计分 <span className="text-indigo-400 font-bold">{generatedTrades.length}</span> 笔买入，
              共买入 <span className="text-indigo-400 font-bold">{generatedTrades.reduce((sum, t) => sum + t.grams, 0)}</span> 克
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button 
              onClick={handleApply}
              disabled={generatedTrades.length === 0}
              className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
            >
              <Play size={16} />
              {hasPlan ? '替换当前预案' : '执行预案'}
            </button>
            
            {hasPlan && (
              <button 
                onClick={onClearPlan}
                className="px-4 bg-app-card hover:bg-red-500/10 text-red-400 border border-app-border hover:border-red-500/30 py-2.5 rounded-lg text-sm font-bold flex items-center justify-center transition-colors"
                title="清除预案"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
