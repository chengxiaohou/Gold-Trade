import React, { useMemo, useState, useEffect, useRef } from 'react';
import { TradeRecord } from '../types';
import { Trash2, GripHorizontal } from 'lucide-react';

interface TradeListProps {
  trades: TradeRecord[];
  onDelete: (id: string) => void;
}

type ColumnKey = 'type' | 'price' | 'grams' | 'tradeTotal' | 'historicalAvg' | 'holdingTotal' | 'avgChange';

interface ColumnDef {
  id: ColumnKey;
  label: string;
  render: (trade: TradeRecord & { historicalAvg: number, avgChange: number, holdingTotal: number }) => React.ReactNode;
}

const fmt = (n: number) => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const TradeList: React.FC<TradeListProps> = ({ trades, onDelete }) => {
  // 1. Logic Calculation
  const tradesWithHistory = useMemo(() => {
    let runningGrams = 0;
    let runningTotalCost = 0;
    return trades.map(trade => {
      const avgBefore = runningGrams > 0 ? runningTotalCost / runningGrams : 0;
      if (trade.type === 'BUY') {
        runningTotalCost += trade.price * trade.grams;
        runningGrams += trade.grams;
      } else {
        const currentAvg = runningGrams > 0 ? runningTotalCost / runningGrams : 0;
        const costBasis = trade.grams * currentAvg;
        runningTotalCost -= costBasis;
        runningGrams -= trade.grams;
      }
      if (runningGrams < 0.0001) { runningGrams = 0; runningTotalCost = 0; }
      const avgAfter = runningGrams > 0 ? runningTotalCost / runningGrams : 0;
      let changePercent = avgBefore > 0 ? ((avgAfter - avgBefore) / avgBefore) * 100 : 0;
      return { ...trade, historicalAvg: avgAfter, avgChange: changePercent, holdingTotal: runningTotalCost };
    });
  }, [trades]);

  const COLUMN_DEFS: Record<ColumnKey, ColumnDef> = {
    type: { id: 'type', label: '方向', render: (t) => <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${t.type === 'BUY' ? 'bg-brand-red/10 text-brand-red' : 'bg-brand-green/10 text-brand-green'}`}>{t.type === 'BUY' ? '买入' : '卖出'}</span> },
    price: { id: 'price', label: '价格', render: (t) => <span className="font-mono text-slate-200">{t.price.toFixed(2)}</span> },
    grams: { id: 'grams', label: '数量', render: (t) => <span className="font-mono text-slate-200">{t.grams.toFixed(2)}</span> },
    tradeTotal: { id: 'tradeTotal', label: '交易额', render: (t) => <span className="font-mono text-slate-300">{fmt(t.price * t.grams)}</span> },
    historicalAvg: { id: 'historicalAvg', label: '持仓均价', render: (t) => <span className="font-mono text-brand-yellow/90 font-medium">{t.historicalAvg > 0 ? t.historicalAvg.toFixed(2) : '-'}</span> },
    holdingTotal: { id: 'holdingTotal', label: '持仓总额', render: (t) => <span className="font-mono text-slate-400 text-xs">{t.holdingTotal > 0 ? fmt(t.holdingTotal) : '-'}</span> },
    avgChange: { id: 'avgChange', label: '成本浮动', render: (t) => {
      if (Math.abs(t.avgChange) < 0.001) return <span className="text-slate-600">-</span>;
      return <span className={`font-mono font-medium text-xs ${t.avgChange < 0 ? 'text-brand-green' : 'text-brand-red'}`}>{t.avgChange > 0 ? '+' : ''}{t.avgChange.toFixed(2)}%</span>;
    }}
  };

  // 2. State & Persistence
  const DEFAULT_ORDER: ColumnKey[] = ['type', 'price', 'grams', 'tradeTotal', 'historicalAvg', 'holdingTotal', 'avgChange'];
  const [columnOrder, setColumnOrder] = useState<ColumnKey[]>(() => {
    const saved = localStorage.getItem('gold_trade_list_column_order');
    if (saved) return (JSON.parse(saved) as ColumnKey[]).filter(k => DEFAULT_ORDER.includes(k));
    return DEFAULT_ORDER;
  });

  const [activeId, setActiveId] = useState<ColumnKey | null>(null);
  
  // 3. Performance Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const colRects = useRef<Map<string, { left: number, width: number }>>(new Map());
  const startXRef = useRef(0);
  const currentHoverIdxRef = useRef<number | null>(null);

  useEffect(() => {
    localStorage.setItem('gold_trade_list_column_order', JSON.stringify(columnOrder));
  }, [columnOrder]);

  // 4. Pointer Handlers
  const onPointerDown = (e: React.PointerEvent, id: ColumnKey) => {
    if (e.button !== 0) return;
    
    // Cache positions only once at start
    const rects = new Map();
    columnOrder.forEach(key => {
      const el = containerRef.current?.querySelector(`[data-col="${key}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        rects.set(key, { left: r.left, width: r.width });
      }
    });
    colRects.current = rects;

    const startIdx = columnOrder.indexOf(id);
    setActiveId(id);
    currentHoverIdxRef.current = startIdx;
    startXRef.current = e.clientX;
    
    // Reset all shift variables
    columnOrder.forEach((_, idx) => {
      containerRef.current?.style.setProperty(`--shift-${idx}`, '0px');
    });
    containerRef.current?.style.setProperty('--drag-tx', '0px');
    
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!activeId || !containerRef.current) return;

    const offset = e.clientX - startXRef.current;
    const activeIdx = columnOrder.indexOf(activeId);
    const activeData = colRects.current.get(activeId);
    if (!activeData) return;
    
    // Update dragging column position directly (No React state)
    containerRef.current.style.setProperty('--drag-tx', `${offset}px`);

    // Calculate Hover Index
    const dragCenter = activeData.left + (activeData.width / 2) + offset;
    let newHoverIdx = activeIdx;

    for (let i = 0; i < columnOrder.length; i++) {
      const targetData = colRects.current.get(columnOrder[i]);
      if (!targetData) continue;
      if (dragCenter > targetData.left && dragCenter < targetData.left + targetData.width) {
        newHoverIdx = i;
        break;
      }
    }

    if (newHoverIdx !== currentHoverIdxRef.current) {
      currentHoverIdxRef.current = newHoverIdx;
      
      // Update shifts of other columns via CSS variables (No React state)
      columnOrder.forEach((id, idx) => {
        if (id === activeId) return;
        
        let tx = 0;
        if (newHoverIdx > activeIdx && idx > activeIdx && idx <= newHoverIdx) {
          tx = -activeData.width;
        } else if (newHoverIdx < activeIdx && idx < activeIdx && idx >= newHoverIdx) {
          tx = activeData.width;
        }
        containerRef.current?.style.setProperty(`--shift-${idx}`, `${tx}px`);
      });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (activeId && currentHoverIdxRef.current !== null) {
      const activeIdx = columnOrder.indexOf(activeId);
      if (activeIdx !== currentHoverIdxRef.current) {
        const newOrder = [...columnOrder];
        const item = newOrder.splice(activeIdx, 1)[0];
        newOrder.splice(currentHoverIdxRef.current, 0, item);
        setColumnOrder(newOrder);
      }
    }

    // Reset styles
    if (containerRef.current) {
      columnOrder.forEach((_, idx) => {
        containerRef.current?.style.setProperty(`--shift-${idx}`, '0px');
      });
      containerRef.current.style.setProperty('--drag-tx', '0px');
    }
    
    setActiveId(null);
    currentHoverIdxRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  };

  if (trades.length === 0) {
    return (
      <div className="text-center py-8 text-slate-500 text-sm italic border border-dashed border-app-border rounded-xl">
        暂无交易记录
      </div>
    );
  }

  return (
    <div 
      ref={containerRef}
      className={`overflow-x-auto rounded-xl border border-app-border bg-app-card custom-scrollbar ${activeId ? 'drag-active' : ''}`}
    >
      <style>{`
        /* 1. Base transitions for ALL cells */
        .drag-active th, .drag-active td {
          will-change: transform;
          transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
        }

        /* 2. Special rules for the dragging column */
        ${columnOrder.map((id, idx) => `
          .drag-col-${id} th:nth-child(${idx + 1}),
          .drag-col-${id} td:nth-child(${idx + 1}) {
            transform: translateX(var(--drag-tx));
            transition: none !important;
            z-index: 50;
            position: relative;
            background: rgba(45, 54, 85, 0.95) !important;
            box-shadow: 15px 0 30px rgba(0,0,0,0.4), -15px 0 30px rgba(0,0,0,0.4);
          }
          
          /* Non-dragging columns use their individual shift variable */
          .drag-active th:nth-child(${idx + 1}):not(.dragging-cell),
          .drag-active td:nth-child(${idx + 1}):not(.dragging-cell) {
             transform: translateX(var(--shift-${idx}));
          }
        `).join('\n')}

        /* Ensure operations column stays on top and static */
        .drag-active th:last-child, .drag-active td:last-child {
          transform: none !important;
          z-index: 100;
        }
      `}</style>

      <table className="w-full text-sm text-left border-collapse min-w-[750px]">
        <thead className="text-xs text-slate-400 uppercase bg-app-bg border-b border-app-border">
          <tr className={activeId ? `drag-col-${activeId}` : ''}>
            {columnOrder.map((colKey, idx) => {
              const col = COLUMN_DEFS[colKey];
              const isDragging = activeId === colKey;
              
              return (
                <th 
                  key={colKey}
                  data-col={colKey}
                  onPointerDown={(e) => onPointerDown(e, colKey)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  className={`
                    px-4 py-4 cursor-grab active:cursor-grabbing select-none relative touch-none
                    ${isDragging ? 'dragging-cell text-brand-yellow font-bold' : ''}
                  `}
                >
                  <div className="flex items-center gap-1.5 pointer-events-none">
                    <GripHorizontal size={14} className={isDragging ? 'text-brand-yellow' : 'text-slate-600'} />
                    <span className="whitespace-nowrap">{col.label}</span>
                  </div>
                  {isDragging && <div className="absolute inset-x-0 -bottom-[1px] h-0.5 bg-brand-yellow" />}
                </th>
              );
            })}
            <th className="px-4 py-4 text-right sticky right-0 bg-app-bg border-l border-app-border shadow-[-8px_0_10px_-5px_rgba(0,0,0,0.5)]">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-app-border">
          {tradesWithHistory.map((trade) => (
            <tr key={trade.id} className={`${activeId ? `drag-col-${activeId}` : ''} hover:bg-app-border/30 transition-colors group`}>
              {columnOrder.map((colKey) => (
                <td 
                  key={colKey} 
                  className={`px-4 py-3 whitespace-nowrap ${activeId === colKey ? 'dragging-cell' : ''}`}
                >
                  {COLUMN_DEFS[colKey].render(trade as any)}
                </td>
              ))}
              <td className="px-4 py-3 text-right sticky right-0 bg-app-card group-hover:bg-[#232940] transition-colors border-l border-app-border shadow-[-8px_0_10px_-5px_rgba(0,0,0,0.5)]">
                <button onClick={() => onDelete(trade.id)} className="text-slate-500 hover:text-red-400 transition-colors p-1">
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