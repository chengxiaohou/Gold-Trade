
import React from 'react';

interface CostChartProps {
  currentValue: number;
  newValue: number;
}

export const CostChart: React.FC<CostChartProps> = ({ currentValue, newValue }) => {
  const isIncrease = newValue > currentValue;
  const diff = Math.abs(newValue - currentValue);

  const baseValue = isIncrease ? currentValue : newValue;
  const changeValue = diff;

  // Scale reference: The bar represents 100% of the larger value (Post-trade for Buy, Pre-trade for Sell)
  const scaleRef = isIncrease ? newValue : currentValue;
  const safeScale = scaleRef || 1;

  const basePercent = (baseValue / safeScale) * 100;
  const changePercent = (changeValue / safeScale) * 100;

  const fmt = (n: number) => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="w-full mt-3 pt-3 border-t border-app-border/30 select-none">
      {/* Title / Header - Hidden to save space as the context is clear, or can be small caption */}
      {/* <div className="text-[10px] text-app-subtext mb-2 flex justify-between">
         <span>资金结构分布</span>
      </div> */}

      {/* The Bar */}
      <div className="relative h-2 w-full bg-app-input rounded-full overflow-hidden flex">
        {/* Base Segment (Gray) */}
        <div 
          className="h-full bg-app-subtext/30 transition-all duration-500"
          style={{ width: `${basePercent}%` }}
        ></div>
        {/* Change Segment (Color) */}
        <div 
          className={`h-full transition-all duration-500 striped-bar ${isIncrease ? 'bg-brand-red' : 'bg-brand-green opacity-80'}`}
          style={{ width: `${changePercent}%` }}
        ></div>
        
         <style>{`
            .striped-bar {
              background-image: linear-gradient(45deg,rgba(255,255,255,.15) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.15) 50%,rgba(255,255,255,.15) 75%,transparent 75%,transparent);
              background-size: 6px 6px;
            }
          `}</style>
      </div>

      {/* 3-Column Legend & Values */}
      <div className="grid grid-cols-3 mt-2 gap-2">
        
        {/* Left: Base State */}
        <div className="flex flex-col items-start">
           <div className="flex items-center gap-1.5 mb-0.5">
             <div className="w-1.5 h-1.5 rounded-full bg-app-subtext/40"></div>
             <span className="text-[10px] text-app-subtext">{isIncrease ? '原持仓' : '剩余持仓'}</span>
           </div>
           <span className="font-mono text-xs font-bold text-app-text/80">{fmt(isIncrease ? currentValue : newValue)}</span>
        </div>

        {/* Center: Delta */}
        <div className="flex flex-col items-center">
           <div className="flex items-center gap-1.5 mb-0.5">
             <div className={`w-1.5 h-1.5 rounded-full ${isIncrease ? 'bg-brand-red' : 'bg-brand-green'}`}></div>
             <span className="text-[10px] text-app-subtext">{isIncrease ? '新增投入' : '变现成本'}</span>
           </div>
           <span className={`font-mono text-xs font-bold ${isIncrease ? 'text-brand-red' : 'text-brand-green'}`}>
             {isIncrease ? '+' : '-'}{fmt(diff)}
           </span>
        </div>

        {/* Right: Final State */}
        <div className="flex flex-col items-end">
           <div className="flex items-center justify-end gap-1.5 mb-0.5">
             <span className="text-[10px] text-app-subtext">{isIncrease ? '预计总持仓' : '原持仓总额'}</span>
           </div>
           <span className="font-mono text-xs font-bold text-app-text">{fmt(isIncrease ? newValue : currentValue)}</span>
        </div>
      </div>
    </div>
  );
};
