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

  // Analysis
  let isBetter = false;
  let diff = 0;
  
  // Percent calculation (Signed)
  // (New - Old) / Old
  const percentChange = currentAvg > 0 ? ((newAvg - currentAvg) / currentAvg) * 100 : 0;
  
  if (orderType === 'BUY') {
    isBetter = newAvg < currentAvg;
    diff = currentAvg - newAvg; // Positive diff implies cost went down (Better)
  } else {
    // For Sell, comparing Price vs Cost
    isBetter = newAvg > currentAvg;
    diff = newAvg - currentAvg;
  }

  // Bar Colors
  const currentBarColor = 'bg-slate-600';
  const newBarColor = isBetter ? 'bg-brand-green' : 'bg-brand-red';
  const diffColor = isBetter ? 'text-brand-green' : 'text-brand-red';

  const fmt = (n: number) => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="w-full mt-2 select-none bg-app-input border border-app-border rounded-lg p-4">
      
      {/* Visual Header */}
      <div className="flex justify-between items-end mb-4">
        <div className="flex flex-col">
           <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">差异金额</span>
           <span className={`text-xl font-bold ${diffColor}`}>
             {diff > 0 ? (orderType === 'BUY' ? '-' : '+') : (orderType === 'BUY' ? '+' : '')}{fmt(Math.abs(diff))}
           </span>
        </div>
        <div className="text-right">
           <span className="text-xs text-slate-400 block">影响幅度</span>
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
             <span className="text-slate-400">当前成本</span>
             <span className="text-slate-300 font-mono">{fmt(currentAvg)}</span>
          </div>
          <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
             <div 
               className={`h-full ${currentBarColor} rounded-full transition-all duration-500`}
               style={{ width: `${currentPercent}%` }}
             ></div>
          </div>
          {/* Reference Line Down */}
          <div 
             className="absolute top-5 h-8 border-r border-dashed border-slate-500/40 z-0"
             style={{ left: `${currentPercent}%` }}
          ></div>
        </div>

        {/* New Cost / Price Bar */}
        <div className="relative">
          <div className="flex justify-between text-xs mb-1">
             <span className="text-slate-400">{orderType === 'BUY' ? '预估成本' : '成交价格'}</span>
             <span className={`font-mono font-bold ${diffColor}`}>{fmt(newAvg)}</span>
          </div>
          <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden relative z-10">
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