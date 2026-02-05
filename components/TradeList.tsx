import React, { useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { TradeRecord } from '../types';
import { Trash2, Edit2, X } from 'lucide-react';

interface TradeListProps {
  trades: TradeRecord[];
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<TradeRecord>) => void;
}

type ColumnKey = 'type' | 'price' | 'grams' | 'tradeTotal' | 'historicalAvg' | 'holdingTotal' | 'avgChange';

interface ColumnDef {
  id: ColumnKey;
  label: string;
  render: (trade: TradeRecord & { historicalAvg: number, avgChange: number, holdingTotal: number }) => React.ReactNode;
}

const fmt = (n: number) => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface EditBubbleProps {
  trade: TradeRecord;
  onUpdate: (id: string, updates: Partial<TradeRecord>) => void;
  onClose: () => void;
  position: { top: number, left: number };
}

const EditBubble: React.FC<EditBubbleProps> = ({ trade, onUpdate, onClose, position }) => {
  // Use local state to handle string input allowing decimals during typing
  // Initialize with the current trade values
  const [priceStr, setPriceStr] = useState(trade.price.toString());
  const [gramsStr, setGramsStr] = useState(trade.grams.toString());

  // Handle Price Change
  const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    // Allow digits and one decimal point
    if (!/^\d*\.?\d*$/.test(val)) return;
    setPriceStr(val);
    
    const num = parseFloat(val);
    // Real-time update if valid number
    if (!isNaN(num) && num >= 0) {
      onUpdate(trade.id, { price: num });
    }
  };

  // Handle Grams Change
  const handleGramsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!/^\d*\.?\d*$/.test(val)) return;
    setGramsStr(val);
    
    const num = parseFloat(val);
    if (!isNaN(num) && num >= 0) {
      onUpdate(trade.id, { grams: num });
    }
  };
  
  // Calculate bubble positioning style
  const style: React.CSSProperties = {
    top: position.top,
    left: position.left,
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onClick={onClose} />
      <div 
        className="fixed z-[9999] bg-[#1e2333] border border-brand-yellow/30 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.7)] rounded-xl p-4 w-60 animate-in fade-in zoom-in-95 duration-200"
        style={style}
      >
        <div className="flex justify-between items-center mb-3 pb-2 border-b border-white/5">
          <h4 className="text-xs font-bold text-brand-yellow uppercase tracking-wider">编辑交易</h4>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X size={14} />
          </button>
        </div>
        
        <div className="space-y-3">
          <div className="space-y-1">
             <label className="text-[10px] text-slate-400">成交价格 (元/克)</label>
             <input
               type="text"
               value={priceStr}
               onChange={handlePriceChange}
               className="w-full bg-[#11131f] border border-app-border rounded px-2 py-1.5 text-sm text-white font-mono focus:border-brand-yellow focus:outline-none focus:ring-1 focus:ring-brand-yellow/50"
             />
          </div>
          <div className="space-y-1">
             <label className="text-[10px] text-slate-400">交易数量 (克)</label>
             <input
               type="text"
               value={gramsStr}
               onChange={handleGramsChange}
               className="w-full bg-[#11131f] border border-app-border rounded px-2 py-1.5 text-sm text-white font-mono focus:border-brand-yellow focus:outline-none focus:ring-1 focus:ring-brand-yellow/50"
             />
          </div>
          
          <div className="pt-1 flex justify-between items-center text-xs">
             <span className="text-slate-500">小计:</span>
             <span className="text-slate-300 font-mono">
               ¥ {fmt((parseFloat(priceStr) || 0) * (parseFloat(gramsStr) || 0))}
             </span>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
};

export const TradeList: React.FC<TradeListProps> = ({ trades, onDelete, onUpdate }) => {
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
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as ColumnKey[];
        // 1. Keep saved items that are still valid columns
        const validSaved = parsed.filter(k => DEFAULT_ORDER.includes(k));
        // 2. Find any new columns that are in DEFAULT but not in saved
        const missing = DEFAULT_ORDER.filter(k => !validSaved.includes(k));
        // 3. Merge: Saved order first, then append new columns
        return [...validSaved, ...missing];
      } catch (e) {
        return DEFAULT_ORDER;
      }
    }
    return DEFAULT_ORDER;
  });

  const [activeId, setActiveId] = useState<ColumnKey | null>(null);
  
  // Edit State
  const [editState, setEditState] = useState<{ id: string, top: number, left: number } | null>(null);

  // 3. Performance Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const colRects = useRef<Map<string, { left: number, width: number }>>(new Map());
  const startXRef = useRef(0);
  const currentHoverIdxRef = useRef<number | null>(null);

  useEffect(() => {
    localStorage.setItem('gold_trade_list_column_order', JSON.stringify(columnOrder));
  }, [columnOrder]);

  // 4. Pointer Handlers (Drag & Drop)
  const onPointerDown = (e: React.PointerEvent, id: ColumnKey) => {
    if (e.button !== 0) return;
    
    // Cache positions
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
    
    // Reset shifts
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
    
    containerRef.current.style.setProperty('--drag-tx', `${offset}px`);

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

  // Edit Click Handler
  const handleEditClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    
    // Position bubble: 
    // Default: Top-right of bubble aligns with bottom-right of button area
    // Just move it a bit left to not overflow screen
    const width = 240; 
    let left = rect.right - width;
    let top = rect.bottom + 8;
    
    // Collision check
    if (left < 10) left = 10; // Ensure not off-screen left
    
    // If close to bottom, show above
    if (top + 200 > window.innerHeight) {
        top = rect.top - 210;
    }

    setEditState({ id, top, left });
  };

  if (trades.length === 0) {
    return (
      <div className="text-center py-8 text-slate-500 text-sm italic border border-dashed border-app-border rounded-xl">
        暂无交易记录
      </div>
    );
  }

  // Find the trade currently being edited
  const editingTrade = editState ? trades.find(t => t.id === editState.id) : null;

  return (
    <>
      <div 
        ref={containerRef}
        className={`overflow-x-auto rounded-xl border border-app-border bg-app-card custom-scrollbar ${activeId ? 'drag-active' : ''}`}
      >
        <style>{`
          .drag-active th, .drag-active td {
            will-change: transform;
            transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
          }
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
            .drag-active th:nth-child(${idx + 1}):not(.dragging-cell),
            .drag-active td:nth-child(${idx + 1}):not(.dragging-cell) {
               transform: translateX(var(--shift-${idx}));
            }
          `).join('\n')}
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
                  <div className="flex justify-end gap-1">
                    <button 
                      onClick={(e) => handleEditClick(e, trade.id)} 
                      className={`p-1 transition-colors ${editState?.id === trade.id ? 'text-brand-yellow' : 'text-slate-500 hover:text-brand-yellow'}`}
                      title="编辑"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button onClick={() => onDelete(trade.id)} className="text-slate-500 hover:text-red-400 transition-colors p-1" title="删除">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editingTrade && editState && (
        <EditBubble 
          trade={editingTrade} 
          onUpdate={onUpdate} 
          onClose={() => setEditState(null)} 
          position={{ top: editState.top, left: editState.left }}
        />
      )}
    </>
  );
};