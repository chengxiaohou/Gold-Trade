import React, { useMemo, useState, useRef, useEffect } from 'react';
import { TradeRecord } from '../types';
import { Trash2, GripHorizontal } from 'lucide-react';

interface TradeListProps {
  trades: TradeRecord[];
  onDelete: (id: string) => void;
}

// Define available column keys
type ColumnKey = 'type' | 'price' | 'grams' | 'total' | 'historicalAvg' | 'avgChange';

interface ColumnDef {
  id: ColumnKey;
  label: string;
  width?: string;
  render: (trade: TradeRecord & { historicalAvg: number, avgChange: number }) => React.ReactNode;
}

// Helper to format numbers
const fmt = (n: number) => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const TradeList: React.FC<TradeListProps> = ({ trades, onDelete }) => {
  // 1. Calculate History Logic
  const tradesWithHistory = useMemo(() => {
    let runningGrams = 0;
    let runningTotalCost = 0;

    return trades.map(trade => {
      // Snapshot state BEFORE this trade
      const avgBefore = runningGrams > 0 ? runningTotalCost / runningGrams : 0;

      // Process trade
      if (trade.type === 'BUY') {
        runningTotalCost += trade.price * trade.grams;
        runningGrams += trade.grams;
      } else {
        const currentAvg = runningGrams > 0 ? runningTotalCost / runningGrams : 0;
        const costBasis = trade.grams * currentAvg;
        runningTotalCost -= costBasis;
        runningGrams -= trade.grams;
      }

      if (runningGrams < 0.0001) {
        runningGrams = 0;
        runningTotalCost = 0;
      }

      // Snapshot state AFTER this trade
      const avgAfter = runningGrams > 0 ? runningTotalCost / runningGrams : 0;

      // Calculate Change Percentage: (New - Old) / Old
      let changePercent = 0;
      if (avgBefore > 0) {
        changePercent = ((avgAfter - avgBefore) / avgBefore) * 100;
      }

      return {
        ...trade,
        historicalAvg: avgAfter,
        avgChange: changePercent
      };
    });
  }, [trades]);

  // 2. Column Definitions
  const COLUMN_DEFS: Record<ColumnKey, ColumnDef> = {
    type: {
      id: 'type',
      label: '方向',
      render: (t) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
          t.type === 'BUY' 
            ? 'bg-brand-red/10 text-brand-red' 
            : 'bg-brand-green/10 text-brand-green'
        }`}>
          {t.type === 'BUY' ? '买入' : '卖出'}
        </span>
      )
    },
    price: {
      id: 'price',
      label: '价格 (¥)',
      render: (t) => <span className="font-mono text-slate-200">{t.price.toFixed(2)}</span>
    },
    grams: {
      id: 'grams',
      label: '数量 (g)',
      render: (t) => <span className="font-mono text-slate-200">{t.grams.toFixed(2)}</span>
    },
    total: {
      id: 'total',
      label: '总额 (¥)',
      render: (t) => <span className="font-mono text-slate-300">{fmt(t.price * t.grams)}</span>
    },
    historicalAvg: {
      id: 'historicalAvg',
      label: '持仓均价',
      render: (t) => (
        <span className="font-mono text-brand-yellow/90 font-medium">
          {t.historicalAvg > 0 ? t.historicalAvg.toFixed(2) : '-'}
        </span>
      )
    },
    avgChange: {
      id: 'avgChange',
      label: '成本浮动',
      render: (t) => {
        // Show nothing for first trade or negligible change
        if (Math.abs(t.avgChange) < 0.001) return <span className="text-slate-600">-</span>;
        
        // For COST: Lower (Negative) is Green (Good), Higher (Positive) is Red (Bad)
        const isCostDown = t.avgChange < 0;
        const colorClass = isCostDown ? 'text-brand-green' : 'text-brand-red';
        
        return (
          <span className={`font-mono font-medium text-xs ${colorClass}`}>
            {t.avgChange > 0 ? '+' : ''}{t.avgChange.toFixed(2)}%
          </span>
        );
      }
    }
  };

  // 3. Drag & Drop State
  const [columnOrder, setColumnOrder] = useState<ColumnKey[]>(() => {
    const saved = localStorage.getItem('gold_trade_list_column_order');
    const defaultOrder: ColumnKey[] = ['type', 'price', 'grams', 'total', 'historicalAvg', 'avgChange'];
    
    if (saved) {
      const parsed = JSON.parse(saved) as ColumnKey[];
      // Migration: Add new columns if missing in saved state
      if (!parsed.includes('avgChange')) {
        return [...parsed, 'avgChange'];
      }
      return parsed;
    }
    return defaultOrder;
  });

  const [dragItem, setDragItem] = useState<number | null>(null);
  const [dragOverItem, setDragOverItem] = useState<number | null>(null);

  // Save order when changed
  useEffect(() => {
    localStorage.setItem('gold_trade_list_column_order', JSON.stringify(columnOrder));
  }, [columnOrder]);

  // Drag Handlers
  const handleDragStart = (e: React.DragEvent<HTMLTableHeaderCellElement>, index: number) => {
    e.stopPropagation(); // Prevent App level drag handlers
    setDragItem(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragEnter = (e: React.DragEvent<HTMLTableHeaderCellElement>, index: number) => {
    e.preventDefault(); 
    e.stopPropagation();
    setDragOverItem(index);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (dragItem === null || dragOverItem === null) return;
    
    const newOrder = [...columnOrder];
    const draggedCol = newOrder[dragItem];
    newOrder.splice(dragItem, 1);
    newOrder.splice(dragOverItem, 0, draggedCol);
    
    setColumnOrder(newOrder);
    setDragItem(null);
    setDragOverItem(null);
  };

  const handleDragEnd = () => {
    setDragItem(null);
    setDragOverItem(null);
  };


  if (trades.length === 0) {
    return (
      <div className="text-center py-8 text-slate-500 text-sm italic border border-dashed border-app-border rounded-xl">
        暂无交易记录
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-app-border bg-app-card">
      <table className="w-full text-sm text-left border-collapse">
        <thead className="text-xs text-slate-400 uppercase bg-app-bg border-b border-app-border">
          <tr>
            {columnOrder.map((colKey, index) => {
              const col = COLUMN_DEFS[colKey];
              const isDragging = dragItem === index;
              const isOver = dragOverItem === index;
              
              return (
                <th 
                  key={col.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragEnter={(e) => handleDragEnter(e, index)}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onDragEnd={handleDragEnd}
                  className={`
                    px-4 py-3 cursor-move select-none transition-colors relative group
                    ${isDragging ? 'opacity-50 bg-brand-yellow/10' : ''}
                    ${isOver ? 'bg-app-border border-l-2 border-brand-yellow' : ''}
                    ${col.id === 'historicalAvg' ? 'text-brand-yellow/80' : ''}
                  `}
                >
                  <div className="flex items-center gap-1.5">
                    {/* Grip Icon (Visible on hover or mobile) */}
                    <GripHorizontal size={12} className="text-slate-600 group-hover:text-slate-400 transition-colors" />
                    <span>{col.label}</span>
                  </div>
                </th>
              );
            })}
            {/* Fixed Action Column */}
            <th className="px-4 py-3 text-right sticky right-0 bg-app-bg shadow-[-10px_0_10px_-10px_rgba(0,0,0,0.3)]">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-app-border">
          {tradesWithHistory.map((trade) => (
            <tr key={trade.id} className="hover:bg-app-border/30 transition-colors group">
              {columnOrder.map((colKey) => (
                <td key={colKey} className="px-4 py-3 whitespace-nowrap">
                  {COLUMN_DEFS[colKey].render(trade)}
                </td>
              ))}
              <td className="px-4 py-3 text-right sticky right-0 bg-app-card group-hover:bg-[#232940] transition-colors shadow-[-10px_0_10px_-10px_rgba(0,0,0,0.3)]">
                <button 
                  onClick={() => onDelete(trade.id)}
                  className="text-slate-500 hover:text-red-400 transition-colors p-1"
                >
                  <Trash2 size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};