
import React from 'react';

interface CostChartProps {
  currentAvg: number;
  newAvg: number;
  orderType: 'BUY' | 'SELL';
  totalValueChange: number; // 新增：持仓总额变化幅度
}

export const CostChart: React.FC<CostChartProps> = ({ currentAvg, newAvg, orderType, totalValueChange }) => {
  // Logic to determine scale
  const maxVal = Math.max(currentAvg, newAvg) || 1;
  const buffer = maxVal * 0.1; 
  const scaleMax = maxVal + buffer;

  const currentPercent = (currentAvg / scaleMax) * 100;
  const newPercent = (newAvg / scaleMax) * 100;

  let diff = 0;
  
  // 对于下方差值展示，保留均价的绝对值差异计算
  if (orderType === 'BUY') {
    diff = newAvg - currentAvg;
  } else {
    diff = newAvg - currentAvg;
  }

  // 颜色逻辑：增加为红，减少为绿
  const isUp = newAvg > currentAvg;
  
  const currentBarColor = 'bg-app-subtext';
  const newBarColor = isUp ? 'bg-brand-red' : 'bg-brand-green';
  const diffColor = isUp ? 'text-brand-red' : 'text-brand-green';

  const fmt = (n: number) => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="w-full mt-1 select-none bg-app-input border border-app-border rounded-lg p-3">
      
      {/* Visual Header */}
      <div className="flex justify-between items-end mb-2">
        <div className="flex flex-col">
           <span className="text-[10px] uppercase tracking-wider text-app-subtext font-bold">均价差异</span>
           <span className={`text-lg font-bold ${diffColor}`}>
             {diff > 0 ? '+' : ''}{fmt(diff)}
           </span>
        </div>
      </div>

      {/* Bars Container */}
      <div className="relative space-y-4">
        
        {/* Current Cost Bar */}
        <div className="relative group">
          <div className="flex justify-between text-[10px] mb-0.5">
             <span className="text-app-subtext">当前成本</span>
             <span className="text-app-text font-mono">{fmt(currentAvg)}</span>
          </div>
          <div className="h-1.5 w-full bg-app-border rounded-full overflow-hidden">
             <div 
               className={`h-full ${currentBarColor} rounded-full transition-all duration-500`}
               style={{ width: `${currentPercent}%` }}
             ></div>
          </div>
          {/* Reference Line Down */}
          <div 
             className="absolute top-4 h-6 border-r border-dashed border-app-subtext/40 z-0"
             style={{ left: `${currentPercent}%` }}
          ></div>
        </div>

        {/* New Cost / Price Bar */}
        <div className="relative">
          <div className="flex justify-between text-[10px] mb-0.5">
             <span className="text-app-subtext">{orderType === 'BUY' ? '预估成本' : '成交价格'}</span>
             <span className={`font-mono font-bold ${diffColor}`}>{fmt(newAvg)}</span>
          </div>
          <div className="h-1.5 w-full bg-app-border rounded-full overflow-hidden relative z-10">
             <div 
               className={`h-full ${newBarColor} rounded-full transition-all duration-500 shadow-[0_0_8px_rgba(0,0,0,0.3)]`}
               style={{ width: `${newPercent}%` }}
             ></div>
          </div>
        </div>

      </div>
    </div>
  );
};
