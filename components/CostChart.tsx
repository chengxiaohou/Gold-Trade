import React from 'react';

interface CostChartProps {
  currentAvg: number;
  newAvg: number;
  orderType: 'BUY' | 'SELL';
}

export const CostChart: React.FC<CostChartProps> = ({ currentAvg, newAvg, orderType }) => {
  // Logic to determine scale
  const maxVal = Math.max(currentAvg, newAvg) || 1;
  const buffer = maxVal * 0.1; 
  const scaleMax = maxVal + buffer;

  const currentPercent = (currentAvg / scaleMax) * 100;
  const newPercent = (newAvg / scaleMax) * 100;

  let diff = 0;
  
  // Percent calculation (Signed)
  // (New - Old) / Old
  const percentChange = currentAvg > 0 ? ((newAvg - currentAvg) / currentAvg) * 100 : 0;
  
  if (orderType === 'BUY') {
    // Buy affects Avg Cost
    diff = newAvg - currentAvg;
  } else {
    // Sell compares Price to Cost
    diff = newAvg - currentAvg;
  }

  // Color Logic: Red for Up/Rise, Green for Down/Fall
  // For BUY: Cost Up (Red), Cost Down (Green)
  // For SELL: Price > Cost (Red/Profitish), Price < Cost (Green/Lossish)
  // General Rule: Value Higher = Red, Value Lower = Green
  const isUp = newAvg > currentAvg;
  
  const currentBarColor = 'bg-app-subtext';
  const newBarColor = isUp ? 'bg-brand-red' : 'bg-brand-green';
  const diffColor = isUp ? 'text-brand-red' : 'text-brand-green';

  const fmt = (n: number) => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="w-full mt-2 select-none bg-app-input border border-app-border rounded-lg p-4">
      
      {/* Visual Header */}
      <div className="flex justify-between items-end mb-4">
        <div className="flex flex-col">
           <span className="text-[10px] uppercase tracking-wider text-app-subtext font-bold">差异金额</span>
           <span className={`text-xl font-bold ${diffColor}`}>
             {diff > 0 ? '+' : ''}{fmt(diff)}
           </span>
        </div>
        <div className="text-right">
           <span className="text-xs text-app-subtext block">影响幅度</span>
           <span className={`text-xs font-mono font-bold ${diffColor}`}>
             {percentChange > 0 ? '+' : ''}{percentChange.toFixed(2)}%
           </span>
        </div>
      </div>

      {/* Bars Container */}
      <div className="relative space-y-5">
        
        {/* Current Cost Bar */}
        <div className="relative group">
          <div className="flex justify-between text-xs mb-1">
             <span className="text-app-subtext">当前成本</span>
             <span className="text-app-text font-mono">{fmt(currentAvg)}</span>
          </div>
          <div className="h-2 w-full bg-app-border rounded-full overflow-hidden">
             <div 
               className={`h-full ${currentBarColor} rounded-full transition-all duration-500`}
               style={{ width: `${currentPercent}%` }}
             ></div>
          </div>
          {/* Reference Line Down */}
          <div 
             className="absolute top-5 h-8 border-r border-dashed border-app-subtext/40 z-0"
             style={{ left: `${currentPercent}%` }}
          ></div>
        </div>

        {/* New Cost / Price Bar */}
        <div className="relative">
          <div className="flex justify-between text-xs mb-1">
             <span className="text-app-subtext">{orderType === 'BUY' ? '预估成本' : '成交价格'}</span>
             <span className={`font-mono font-bold ${diffColor}`}>{fmt(newAvg)}</span>
          </div>
          <div className="h-2 w-full bg-app-border rounded-full overflow-hidden relative z-10">
             <div 
               className={`h-full ${newBarColor} rounded-full transition-all duration-500 shadow-[0_0_10px_rgba(0,0,0,0.3)]`}
               style={{ width: `${newPercent}%` }}
             ></div>
          </div>
        </div>

      </div>
    </div>
  );
};