import React, { useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { TradeRecord } from '../types';
import { Trash2, Edit2, X, Minus, Plus, ArrowUp, ArrowDown, GripHorizontal } from 'lucide-react';

interface TradeListProps {
  trades: TradeRecord[];
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<TradeRecord>) => void;
}

// Removed 'type' from sortable keys as it will be fixed
type ColumnKey = 'price' | 'grams' | 'tradeTotal' | 'historicalAvg' | 'holdingTotal' | 'avgChange';

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
  initialPosition: { top: number, left: number };
}

const EditBubble: React.FC<EditBubbleProps> = ({ trade, onUpdate, onClose, initialPosition }) => {
  // Local state for inputs
  const [priceStr, setPriceStr] = useState(trade.price.toString());
  const [gramsStr, setGramsStr] = useState(trade.grams.toString());

  // We keep track of position in state to preserve it across re-renders (like typing)
  const [position, setPosition] = useState(initialPosition);
  
  // Refs for logic
  const bubbleRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);

  // --- Ultra-Fast Drag Handlers (Pointer Capture) ---

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!bubbleRef.current) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    // Calculate offset from top-left corner
    const rect = bubbleRef.current.getBoundingClientRect();
    dragOffset.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
    
    isDragging.current = true;
    
    // CRITICAL: Lock the pointer to this element. 
    // This ensures we receive move events even if mouse goes outside window or moves super fast.
    e.currentTarget.setPointerCapture(e.pointerId);
    
    // Performance: Disable transitions during drag to prevent "ghosting/lag"
    bubbleRef.current.style.transition = 'none';
    document.body.style.cursor = 'grabbing';
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current || !bubbleRef.current) return;
    
    e.preventDefault();
    e.stopPropagation();

    const newLeft = e.clientX - dragOffset.current.x;
    const newTop = e.clientY - dragOffset.current.y;

    // Direct DOM update for zero-latency (bypassing React Render Cycle)
    bubbleRef.current.style.left = `${newLeft}px`;
    bubbleRef.current.style.top = `${newTop}px`;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current || !bubbleRef.current) return;
    
    isDragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.style.cursor = '';
    
    // Sync final position to React state so it doesn't jump on next render
    const rect = bubbleRef.current.getBoundingClientRect();
    setPosition({ left: rect.left, top: rect.top });
    
    // Re-enable css transitions (if any)
    bubbleRef.current.style.transition = '';
  };

  // Handle Price Change
  const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!/^\d*\.?\d*$/.test(val)) return;
    setPriceStr(val);
    const num = parseFloat(val);
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

  const adjustValue = (
    setter: React.Dispatch<React.SetStateAction<string>>,
    field: 'price' | 'grams',
    currentStr: string,
    delta: number
  ) => {
    const current = parseFloat(currentStr) || 0;
    const newVal = Math.max(0, current + delta);
    const safeVal = parseFloat(newVal.toFixed(4));
    setter(safeVal.toString());
    onUpdate(trade.id, { [field]: safeVal });
  };
  
  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onClick={onClose} />
      <div 
        ref={bubbleRef}
        className="fixed z-[9999] bg-[#1e2333] border border-brand-yellow/30 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.7)] rounded-xl w-72 flex flex-col overflow-hidden"
        // Use inline styles for position to work with the direct DOM manipulation
        style={{ top: position.top, left: position.left }}
      >
        {/* Draggable Header */}
        <div 
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="bg-[#2a3044]/80 backdrop-blur-md p-3 flex justify-between items-center border-b border-white/5 cursor-grab active:cursor-grabbing touch-none select-none group"
        >
          <div className="flex items-center gap-2 text-brand-yellow pointer-events-none">
            <GripHorizontal size={16} className="opacity-80"/>
            <h4 className="text-sm font-bold tracking-wider">编辑交易</h4>
          </div>
          <button 
            onClick={onClose} 
            // Stop propagation to prevent drag start when clicking close
            onPointerDown={(e) => e.stopPropagation()}
            className="text-slate-500 hover:text-white transition-colors bg-white/5 hover:bg-white/10 rounded p-1"
          >
            <X size={16} />
          </button>
        </div>
        
        <div className="p-5 space-y-5 bg-[#1e2333]">
          <div className="space-y-2">
             <label className="text-xs text-slate-400">交易方向</label>
             <div className="grid grid-cols-2 gap-3">
                <button
                   onClick={() => onUpdate(trade.id, { type: 'BUY' })}
                   className={`h-10 text-sm font-bold rounded-lg border transition-all ${
                     trade.type === 'BUY' 
                       ? 'bg-brand-red text-white border-brand-red shadow-[0_4px_12px_rgba(239,68,68,0.3)]' 
                       : 'bg-app-bg border-app-border text-slate-500 hover:border-slate-400'
                   }`}
                >
                  买入
                </button>
                <button
                   onClick={() => onUpdate(trade.id, { type: 'SELL' })}
                   className={`h-10 text-sm font-bold rounded-lg border transition-all ${
                     trade.type === 'SELL' 
                       ? 'bg-brand-green text-white border-brand-green shadow-[0_4px_12px_rgba(16,185,129,0.3)]' 
                       : 'bg-app-bg border-app-border text-slate-500 hover:border-slate-400'
                   }`}
                >
                  卖出
                </button>
             </div>
          </div>

          <div className="space-y-2">
             <label className="text-xs text-slate-400">成交价格 (元/克)</label>
             <div className="flex items-center gap-2">
                <button 
                  type="button"
                  onClick={() => adjustValue(setPriceStr, 'price', priceStr, -5)}
                  className="w-10 h-10 flex-none flex items-center justify-center bg-[#2a3044] hover:bg-[#3b455e] text-slate-200 rounded-lg text-xs font-bold transition-colors active:scale-95 touch-manipulation"
                >
                  -5
                </button>
                <input
                  type="text"
                  value={priceStr}
                  onChange={handlePriceChange}
                  className="w-full min-w-0 bg-[#11131f] border border-app-border rounded-lg px-2 h-10 text-base text-white font-mono text-center focus:border-brand-yellow focus:outline-none focus:ring-1 focus:ring-brand-yellow/50"
                />
                <button 
                  type="button"
                  onClick={() => adjustValue(setPriceStr, 'price', priceStr, 5)}
                  className="w-10 h-10 flex-none flex items-center justify-center bg-[#2a3044] hover:bg-[#3b455e] text-slate-200 rounded-lg text-xs font-bold transition-colors active:scale-95 touch-manipulation"
                >
                  +5
                </button>
             </div>
          </div>

          <div className="space-y-2">
             <label className="text-xs text-slate-400">交易数量 (克)</label>
             <div className="flex items-center gap-2">
                <button 
                  type="button"
                  onClick={() => adjustValue(setGramsStr, 'grams', gramsStr, -1)}
                  className="w-10 h-10 flex-none flex items-center justify-center bg-[#2a3044] hover:bg-[#3b455e] text-slate-200 rounded-lg transition-colors active:scale-95 touch-manipulation"
                >
                  <Minus size={16} />
                </button>
                <input
                  type="text"
                  value={gramsStr}
                  onChange={handleGramsChange}
                  className="w-full min-w-0 bg-[#11131f] border border-app-border rounded-lg px-2 h-10 text-base text-white font-mono text-center focus:border-brand-yellow focus:outline-none focus:ring-1 focus:ring-brand-yellow/50"
                />
                <button 
                  type="button"
                  onClick={() => adjustValue(setGramsStr, 'grams', gramsStr, 1)}
                  className="w-10 h-10 flex-none flex items-center justify-center bg-[#2a3044] hover:bg-[#3b455e] text-slate-200 rounded-lg transition-colors active:scale-95 touch-manipulation"
                >
                  <Plus size={16} />
                </button>
             </div>
          </div>
          
          <div className="pt-3 flex justify-between items-center text-sm border-t border-white/5 mt-2">
             <span className="text-slate-500">小计:</span>
             <span className="text-slate-200 font-mono font-bold tracking-wide">
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
  // 0. Sort State (Persisted)
  const [sortDesc, setSortDesc] = useState(() => {
    const saved = localStorage.getItem('gold_trade_sort_desc');
    return saved === 'true'; // Default to false (Oldest first/Chronological) if not set
  });

  useEffect(() => {
    localStorage.setItem('gold_trade_sort_desc', String(sortDesc));
  }, [sortDesc]);

  // 1. Logic Calculation (Must be Chronological First)
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

  // 1.5. Apply Display Sort
  const displayTrades = useMemo(() => {
    return sortDesc ? [...tradesWithHistory].reverse() : tradesWithHistory;
  }, [tradesWithHistory, sortDesc]);

  const COLUMN_DEFS: Record<ColumnKey, ColumnDef> = {
    // Type is now handled manually
    price: { id: 'price', label: '价格', render: (t) => <span className="font-mono text-slate-200">{t.price.toFixed(2)}</span> },
    grams: { id: 'grams', label: '数量', render: (t) => <span className="font-mono text-slate-200">{t.grams.toFixed(2)}</span> },
    tradeTotal: { id: 'tradeTotal', label: '交易额', render: (t) => <span className="font-mono text-slate-300">{fmt(t.price * t.grams)}</span> },
    historicalAvg: { id: 'historicalAvg', label: '持仓均价', render: (t) => <span className="font-mono text-brand-yellow/90 font-medium">{t.historicalAvg > 0 ? t.historicalAvg.toFixed(2) : '-'}</span> },
    holdingTotal: { id: 'holdingTotal', label: '持仓总额', render: (t) => <span className="font-mono text-slate-400 text-xs">{t.holdingTotal > 0 ? fmt(t.holdingTotal) : '-'}</span> },
    avgChange: { id: 'avgChange', label: '成本浮动', render: (t) => {
      if (Math.abs(t.avgChange) < 0.001) return <span className="text-slate-600">-</span>;
      // Red for Up, Green for Down
      return <span className={`font-mono font-medium text-xs ${t.avgChange > 0 ? 'text-brand-red' : 'text-brand-green'}`}>{t.avgChange > 0 ? '+' : ''}{t.avgChange.toFixed(2)}%</span>;
    }}
  };

  // 2. State & Persistence
  // Removed 'type' from default order
  const DEFAULT_ORDER: ColumnKey[] = ['price', 'grams', 'tradeTotal', 'holdingTotal', 'historicalAvg', 'avgChange'];
  const [columnOrder, setColumnOrder] = useState<ColumnKey[]>(() => {
    const saved = localStorage.getItem('gold_trade_list_column_order_v3'); // Bumped version
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as ColumnKey[];
        const validSaved = parsed.filter(k => DEFAULT_ORDER.includes(k));
        const missing = DEFAULT_ORDER.filter(k => !validSaved.includes(k));
        return [...validSaved, ...missing];
      } catch (e) {
        return DEFAULT_ORDER;
      }
    }
    return DEFAULT_ORDER;
  });

  const [activeId, setActiveId] = useState<ColumnKey | null>(null);
  const [editState, setEditState] = useState<{ id: string, top: number, left: number } | null>(null);

  // 3. Performance Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const colRects = useRef<Map<string, { left: number, width: number }>>(new Map());
  const startXRef = useRef(0);
  const currentHoverIdxRef = useRef<number | null>(null);

  useEffect(() => {
    localStorage.setItem('gold_trade_list_column_order_v3', JSON.stringify(columnOrder));
  }, [columnOrder]);

  // NEW: Manual Shift+Wheel Handler for Horizontal Scroll
  // DEPENDENCY ADDED: [trades.length] ensures this runs when data appears
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      // Check if Shift is pressed for horizontal scrolling behavior
      if (e.shiftKey) {
        // Prevent browser back/forward navigation or default page scroll if captured
        e.preventDefault();
        // Translate vertical delta (mouse wheel) to horizontal scroll
        el.scrollLeft += e.deltaY;
      }
    };

    // Passive: false is required to use preventDefault()
    el.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, [trades.length]); // Re-attach when trades change (e.g. initial load)

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

  const handleEditClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const width = 256; // 64 * 4 (w-64)
    let left = rect.right - width;
    let top = rect.bottom + 8;
    if (left < 10) left = 10;
    if (top + 280 > window.innerHeight) {
        top = rect.top - 290;
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
            .drag-col-${id} th:nth-child(${idx + 2}),
            .drag-col-${id} td:nth-child(${idx + 2}) {
              transform: translateX(var(--drag-tx));
              transition: none !important;
              z-index: 50;
              position: relative;
              background: rgba(45, 54, 85, 0.95) !important;
              box-shadow: 15px 0 30px rgba(0,0,0,0.4), -15px 0 30px rgba(0,0,0,0.4);
            }
            .drag-active th:nth-child(${idx + 2}):not(.dragging-cell),
            .drag-active td:nth-child(${idx + 2}):not(.dragging-cell) {
               transform: translateX(var(--shift-${idx}));
            }
          `).join('\n')}
          /* Type column fixed */
          .drag-active th:first-child, .drag-active td:first-child {
            transform: none !important;
            z-index: 60;
          }
          /* Actions column fixed */
          .drag-active th:last-child, .drag-active td:last-child {
            transform: none !important;
            z-index: 100;
          }
        `}</style>

        <table className="w-full text-sm text-left border-collapse min-w-[750px]">
          <thead className="text-xs text-slate-400 uppercase bg-app-bg border-b border-app-border">
            <tr className={activeId ? `drag-col-${activeId}` : ''}>
              {/* FIXED TYPE COLUMN - COMPACT & OPTIMIZED SHADOW */}
              <th className="p-0 text-center sticky left-0 z-20 bg-app-bg border-b border-r border-app-border w-[40px] shadow-lg">
                 <span className="font-bold">方向</span>
              </th>

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
              {/* Sort Button Header - COMPACT & OPTIMIZED SHADOW */}
              <th className="px-1 py-3 text-center sticky right-0 bg-app-bg border-l border-app-border shadow-lg w-[75px]">
                 <button 
                   onClick={() => setSortDesc(!sortDesc)}
                   className={`
                     flex items-center justify-center gap-0.5 w-full py-1.5 rounded-md transition-all text-[11px] font-bold border
                     ${sortDesc 
                        ? 'bg-brand-green/10 text-brand-green border-brand-green/20 hover:bg-brand-green/20' 
                        : 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20 hover:bg-indigo-500/20'
                     }
                   `}
                   title="切换时间排序"
                 >
                   {sortDesc ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
                   <span>{sortDesc ? "最新" : "最早"}</span>
                 </button>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-app-border">
            {displayTrades.map((trade) => (
              /* REMOVED transition-colors for scroll performance */
              <tr key={trade.id} className={`${activeId ? `drag-col-${activeId}` : ''} hover:bg-app-border/30 group`}>
                {/* FIXED TYPE CELL - COMPACT & OPTIMIZED SHADOW */}
                <td className="p-0 py-3 text-center sticky left-0 z-20 bg-app-card group-hover:bg-[#232940] border-r border-app-border shadow-lg">
                   <span className={`inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold mx-auto ${trade.type === 'BUY' ? 'bg-brand-red/10 text-brand-red' : 'bg-brand-green/10 text-brand-green'}`}>
                     {trade.type === 'BUY' ? '买' : '卖'}
                   </span>
                </td>

                {columnOrder.map((colKey) => (
                  <td 
                    key={colKey} 
                    className={`px-4 py-3 whitespace-nowrap ${activeId === colKey ? 'dragging-cell' : ''}`}
                  >
                    {COLUMN_DEFS[colKey].render(trade as any)}
                  </td>
                ))}
                {/* Actions Cell - COMPACT & OPTIMIZED SHADOW */}
                <td className="px-1 py-3 text-center sticky right-0 bg-app-card group-hover:bg-[#232940] border-l border-app-border shadow-lg">
                  <div className="flex justify-center gap-1">
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
          initialPosition={{ top: editState.top, left: editState.left }}
        />
      )}
    </>
  );
};