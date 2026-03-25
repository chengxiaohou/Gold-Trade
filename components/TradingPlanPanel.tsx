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
    extremeSplitCount: '1',
    arithmeticGramsIncrement: '1',
    equalBuyGrams: '',
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
    let finalValue = value;
    
    // Enforce basic numeric constraints on typing
    const num = parseFloat(value);
    if (!isNaN(num)) {
      if (field === 'extremeSplitCount') {
        finalValue = Math.max(1, Math.min(100, Math.floor(num))).toString();
      } else if (field === 'stepValue') {
        finalValue = Math.max(1, Math.min(params.stepType === 'percentage' ? 50 : 1000, Math.floor(num))).toString();
      } else if (field === 'equalBuyGrams') {
        finalValue = Math.max(1, Math.floor(num)).toString();
      } else if (num < 0) {
        finalValue = '0';
      }
    }
    
    setParams(prev => ({ ...prev, [field]: finalValue }));
  };

  const currentFundsVal = parseFloat(params.totalFunds) || 0;
  const currentMarketPriceVal = parseFloat(marketPrice) || 0;

  const planPrices = useMemo(() => {
    const start = currentMarketPriceVal;
    const target = parseFloat(params.targetPrice);
    const step = parseFloat(params.stepValue);
    
    if (!target || (!start || !step || start <= target || step <= 0)) {
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
    return prices;
  }, [currentMarketPriceVal, params.targetPrice, params.stepValue, params.stepType]);

  const maxEqualGrams = useMemo(() => {
    if (planPrices.length === 0) return Math.floor(currentFundsVal / (currentMarketPriceVal || 1));
    const sumPi = planPrices.reduce((a, b) => a + b, 0);
    return Math.floor(currentFundsVal / sumPi);
  }, [planPrices, currentFundsVal, currentMarketPriceVal]);

  const maxArithmeticIncrement = useMemo(() => {
    if (planPrices.length === 0) return 100;
    const sumIPi = planPrices.reduce((a, b, i) => a + i * b, 0);
    return sumIPi > 0 ? Math.floor(currentFundsVal / sumIPi) : 100;
  }, [planPrices, currentFundsVal]);

  const generatedTrades = useMemo(() => {
    const start = currentMarketPriceVal;
    const target = parseFloat(params.targetPrice);
    const funds = currentFundsVal;
    const step = parseFloat(params.stepValue);
    const splitCount = parseInt(params.extremeSplitCount) || 1;
    const arithmeticGramsIncrement = parseFloat(params.arithmeticGramsIncrement) || 0;
    const equalBuyGrams = parseFloat(params.equalBuyGrams) || 0;

    if (!target || !funds || (params.strategy !== 'extreme' && (!start || !step || start <= target || step <= 0))) {
      return [];
    }

    const now = Date.now();

    if (params.strategy === 'extreme') {
      const fundsToUse = params.totalFunds ? parseFloat(params.totalFunds) : availableFunds;
      const fundsPerSplit = fundsToUse / splitCount;
      const trades: TradeRecord[] = [];
      const priceDiff = start - target;
      const priceInterval = priceDiff / splitCount;
      
      let remainingFunds = fundsToUse;
      
      for (let i = 0; i < splitCount; i++) {
        const executionPrice = start - (i + 1) * priceInterval;
        let grams = Math.floor(fundsPerSplit / executionPrice);
        
        if (grams * executionPrice > remainingFunds) {
          grams = Math.floor(remainingFunds / executionPrice);
        }
        
        if (grams > 0) {
          remainingFunds -= grams * executionPrice;
          trades.push({
            id: `plan-${now}-${i}`,
            type: 'BUY',
            price: Number(executionPrice.toFixed(2)),
            grams,
            timestamp: now + i,
            isPlan: true,
            tag: '极限'
          });
        }
      }
      return trades;
    }

    const prices = planPrices;
    if (prices.length === 0) return [];

    const N = prices.length;
    const trades: TradeRecord[] = [];

    if (params.strategy === 'equal') {
      const defaultFundsPerStep = funds / N;
      let remainingFunds = funds;
      
      prices.forEach((p, index) => {
        let grams = equalBuyGrams > 0 ? equalBuyGrams : Math.floor(defaultFundsPerStep / p);
        
        if (grams * p > remainingFunds) {
          grams = Math.floor(remainingFunds / p);
        }
        
        if (grams > 0) {
          remainingFunds -= grams * p;
          trades.push({
            id: `plan-${now}-${index}`,
            type: 'BUY',
            price: Number(p.toFixed(2)),
            grams,
            timestamp: now + index,
            isPlan: true,
            tag: '等额'
          });
        }
      });
    } else if (params.strategy === 'arithmetic') {
      const sumPi = prices.reduce((a, b) => a + b, 0);
      const sumIPi = prices.reduce((a, b, i) => a + i * b, 0);
      
      let actualIncrement = arithmeticGramsIncrement;
      if (actualIncrement * sumIPi > funds) {
        actualIncrement = sumIPi > 0 ? funds / sumIPi : 0;
      }
      
      const totalIncrementCost = actualIncrement * sumIPi;
      const baseGrams = sumPi > 0 ? (funds - totalIncrementCost) / sumPi : 0;
      
      let remainingFunds = funds;
      
      prices.forEach((p, index) => {
        let stepGrams = Math.max(0, Math.floor(baseGrams + index * actualIncrement));
        
        if (stepGrams * p > remainingFunds) {
          stepGrams = Math.floor(remainingFunds / p);
        }
        
        if (stepGrams > 0) {
          remainingFunds -= stepGrams * p;
          trades.push({
            id: `plan-${now}-${index}`,
            type: 'BUY',
            price: Number(p.toFixed(2)),
            grams: stepGrams,
            timestamp: now + index,
            isPlan: true,
            tag: '等差'
          });
        }
      });
    }

    return trades;
  }, [currentMarketPriceVal, params, currentFundsVal, availableFunds, planPrices]);

  const handleApply = () => {
    if (generatedTrades.length > 0) {
      if (hasPlan) {
        onClearPlan();
      }
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
              label="参考市价" 
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
              step={priceStep}
              min={1}
              max={marketPrice ? parseFloat(marketPrice) - 0.01 : 1000}
              touchMode={touchMode}
            />
          </div>

          <div className="flex flex-col gap-2 p-3 bg-app-input/30 rounded-xl border border-app-border">
            <div className="relative">
              <InputGroup 
                label="计划动用资金" 
                value={params.totalFunds} 
                onChange={(v) => handleParamChange('totalFunds', v)} 
                placeholder={availableFunds.toFixed(2)} 
                min={0}
                max={availableFunds > 0 ? availableFunds : 1000000}
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
            
            {availableFunds > 0 && (
              <div className="px-1 flex items-center gap-3">
                <input 
                  type="range"
                  min="0"
                  max={availableFunds}
                  step="1"
                  value={parseFloat(params.totalFunds) || 0}
                  onChange={(e) => handleParamChange('totalFunds', e.target.value)}
                  className="flex-1 h-1.5 bg-app-input rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
                <span className="text-[10px] font-mono text-app-subtext w-8 text-right">
                  {availableFunds > 0 ? Math.round(((parseFloat(params.totalFunds) || 0) / availableFunds) * 100) : 0}%
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 p-3 bg-app-input/30 rounded-xl border border-app-border">
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

            {params.strategy === 'equal' && (
              <div className="grid grid-cols-2 gap-3 animate-in fade-in slide-in-from-top-1 duration-200">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between pr-1">
                    <label className="text-[10px] text-app-subtext font-medium ml-1">触发跌幅</label>
                    <select 
                      value={params.stepType}
                      onChange={(e) => handleParamChange('stepType', e.target.value as any)}
                      className="bg-transparent text-[10px] font-bold text-indigo-400 outline-none cursor-pointer"
                    >
                      <option value="amount">元</option>
                      <option value="percentage">%</option>
                    </select>
                  </div>
                  <InputGroup 
                    value={params.stepValue}
                    onChange={(v) => handleParamChange('stepValue', v)}
                    placeholder="10"
                    step={1}
                    min={1}
                    max={params.stepType === 'percentage' ? 50 : 1000}
                    touchMode={touchMode}
                    className="!py-2 text-sm"
                  />
                </div>

                <InputGroup 
                  label="购入克数"
                  value={params.equalBuyGrams}
                  onChange={(v) => handleParamChange('equalBuyGrams', v)}
                  placeholder="1"
                  step={1}
                  min={1}
                  max={maxEqualGrams}
                  touchMode={touchMode}
                  className="!py-2 text-sm"
                />
              </div>
            )}

            {params.strategy === 'arithmetic' && (
              <div className="grid grid-cols-2 gap-3 animate-in fade-in slide-in-from-top-1 duration-200">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between pr-1">
                    <label className="text-[10px] text-app-subtext font-medium ml-1">触发跌幅</label>
                    <select 
                      value={params.stepType}
                      onChange={(e) => handleParamChange('stepType', e.target.value as any)}
                      className="bg-transparent text-[10px] font-bold text-indigo-400 outline-none cursor-pointer"
                    >
                      <option value="amount">元</option>
                      <option value="percentage">%</option>
                    </select>
                  </div>
                  <InputGroup 
                    value={params.stepValue}
                    onChange={(v) => handleParamChange('stepValue', v)}
                    placeholder="10"
                    step={1}
                    min={1}
                    max={params.stepType === 'percentage' ? 50 : 1000}
                    touchMode={touchMode}
                    className="!py-2 text-sm"
                  />
                </div>

                <InputGroup 
                  label="递增克数"
                  value={params.arithmeticGramsIncrement}
                  onChange={(v) => handleParamChange('arithmeticGramsIncrement', v)}
                  placeholder="1"
                  step={1}
                  min={0}
                  max={maxArithmeticIncrement}
                  touchMode={touchMode}
                  className="!py-2 text-sm"
                />
              </div>
            )}

            {params.strategy === 'extreme' && (
              <div className="grid grid-cols-2 gap-3 animate-in fade-in slide-in-from-top-1 duration-200">
                <InputGroup 
                  label="抄底次数"
                  value={params.extremeSplitCount}
                  onChange={(v) => handleParamChange('extremeSplitCount', v)}
                  placeholder="1"
                  step={1}
                  min={1}
                  max={50}
                  touchMode={touchMode}
                  className="!py-2 text-sm"
                />
              </div>
            )}
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
