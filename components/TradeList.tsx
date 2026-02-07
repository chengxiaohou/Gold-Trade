import React, { useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { TradeRecord, AppSettings } from '../types';
import { Trash2, Edit2, X, GripHorizontal, Eye, EyeOff, ChevronUp, ChevronDown, RotateCcw } from 'lucide-react';

interface TradeListProps {
  trades: TradeRecord[];
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<TradeRecord>) => void;
  settings: AppSettings;
  onSettingsChange: (updates: Partial<AppSettings>) => void;
}

// Added 'tag' to ColumnKey
type ColumnKey = 'tag' | 'price' | 'grams' | 'tradeTotal' | 'historicalAvg' | 'holdingTotal' | 'avgChange';

interface ColumnDef {
  id: ColumnKey;
  label: string;
  render: (trade: TradeRecord & { historicalAvg: number, avgChange: number, holdingTotal: number }) => React.ReactNode;
}

const fmt = (n: number) => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// --- Color Palette for Tags ---
// Removed 'cyan', and 'orange' as requested. Added 'gray' back.
const TAG_PALETTE = [
  { key: 'indigo', label: '默认', bg: 'bg-indigo-500/10', text: 'text-indigo-500', border: 'border-indigo-500/20', hover: 'hover:border-indigo-500/50' },
  { key: 'gray', label: '灰色', bg: 'bg-gray-500/10', text: 'text-gray-500', border: 'border-gray-500/20', hover: 'hover:border-gray-500/50' },
  { key: 'red', label: '红色', bg: 'bg-red-500/10', text: 'text-red-500', border: 'border-red-500/20', hover: 'hover:border-red-500/50' },
  { key: 'green', label: '绿色', bg: 'bg-green-500/10', text: 'text-green-500', border: 'border-green-500/20', hover: 'hover:border-green-500/50' },
  { key: 'blue', label: '蓝色', bg: 'bg-blue-500/10', text: 'text-blue-500', border: 'border-blue-500/20', hover: 'hover:border-blue-500/50' },
  { key: 'purple', label: '紫色', bg: 'bg-purple-500/10', text: 'text-purple-500', border: 'border-purple-500/20', hover: 'hover:border-purple-500/50' },
  { key: 'pink', label: '粉色', bg: 'bg-pink-500/10', text: 'text-pink-500', border: 'border-pink-500/20', hover: 'hover:border-pink-500/50' },
];

// Special neutral style for empty/undefined tags (replaces the old 'slate' option for the "-" state)
// Updated text color to gray-500 for better visibility as "light gray" instead of "white"
const EMPTY_STYLE = { 
  bg: 'bg-white/5', 
  text: 'text-gray-500', 
  border: 'border-white/10', 
  hover: 'group-hover/tag:border-white/20' 
};

const getTagStyle = (colorKey?: string) => {
  return TAG_PALETTE.find(p => p.key === colorKey) || TAG_PALETTE[0];
};

interface EditBubbleProps {
  trade: TradeRecord;
  availableTags: string[]; // List of unique tags for quick select
  onUpdate: (id: string, updates: Partial<TradeRecord>) => void;
  onClose: () => void;
  initialPosition: { top: number, left: number };
  settings: AppSettings;
  mode: 'full' | 'tag'; // 'full' = normal edit, 'tag' = only tag edit
  onTagColorChange: (tag: string, colorKey: string) => void;
}

const EditBubble: React.FC<EditBubbleProps> = ({ 
  trade, availableTags, onUpdate, onClose, initialPosition, settings, mode, onTagColorChange 
}) => {
  // Snapshot initial state for Reset functionality
  const initialSnapshot = useRef({
    price: trade.price,
    grams: trade.grams,
    type: trade.type,
    tag: trade.tag || ''
  });

  // Local state for inputs
  const [priceStr, setPriceStr] = useState(trade.price.toString());
  const [gramsStr, setGramsStr] = useState(trade.grams.toString());
  const [tagStr, setTagStr] = useState(trade.tag || '');
  
  // Tag Color State (Derived from settings but applied locally for preview)
  const currentTagColorKey = settings.tagColors?.[tagStr] || 'indigo';

  // We keep track of position in state to preserve it across re-renders (like typing)
  const [position, setPosition] = useState(initialPosition);
  
  // Refs for logic
  const bubbleRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);
  
  // Input refs for wheel support
  const priceInputRef = useRef<HTMLInputElement>(null);
  const gramsInputRef = useRef<HTMLInputElement>(null);

  // --- Reset Handler ---
  const handleReset = () => {
    const init = initialSnapshot.current;
    if (mode === 'full') {
      onUpdate(trade.id, {
        price: init.price,
        grams: init.grams,
        type: init.type,
        tag: init.tag
      });
      setPriceStr(init.price.toString());
      setGramsStr(init.grams.toString());
    } else {
      onUpdate(trade.id, { tag: init.tag });
    }
    setTagStr(init.tag);
  };

  // --- Drag Handlers (Common) ---
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!bubbleRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = bubbleRef.current.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    isDragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    bubbleRef.current.style.transition = 'none';
    document.body.style.cursor = 'grabbing';
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current || !bubbleRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const newLeft = e.clientX - dragOffset.current.x;
    const newTop = e.clientY - dragOffset.current.y;
    bubbleRef.current.style.left = `${newLeft}px`;
    bubbleRef.current.style.top = `${newTop}px`;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current || !bubbleRef.current) return;
    isDragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.style.cursor = '';
    const rect = bubbleRef.current.getBoundingClientRect();
    setPosition({ left: rect.left, top: rect.top });
    bubbleRef.current.style.transition = '';
  };

  // Handle Updates
  const adjustValue = (
    setter: React.Dispatch<React.SetStateAction<string>>,
    field: 'price' | 'grams',
    currentStr: string,
    delta: number
  ) => {
    const current = parseFloat(currentStr) || 0;
    const newVal = Math.max(0, current + delta);
    const safeVal = Math.round(newVal * 1000) / 1000;
    setter(safeVal.toString());
    onUpdate(trade.id, { [field]: safeVal });
  };

  const handleTagChange = (val: string) => {
    setTagStr(val);
    onUpdate(trade.id, { tag: val });
  };

  const handleColorSelect = (key: string) => {
     if (tagStr.trim()) {
        onTagColorChange(tagStr.trim(), key);
     }
  };

  // Attach Wheel Listeners
  useEffect(() => {
    if (mode === 'tag') return; // No wheel needed in tag mode

    const attachWheel = (
      ref: React.RefObject<HTMLInputElement>, 
      setter: React.Dispatch<React.SetStateAction<string>>,
      field: 'price' | 'grams',
      currentVal: string,
      step: number
    ) => {
      const el = ref.current;
      if (!el) return;
      const handleWheel = (e: WheelEvent) => {
        e.preventDefault();
        const direction = e.deltaY > 0 ? -1 : 1;
        adjustValue(setter, field, currentVal, direction * step);
      };
      el.addEventListener('wheel', handleWheel, { passive: false });
      return () => el.removeEventListener('wheel', handleWheel);
    };

    const cleanupPrice = attachWheel(priceInputRef, setPriceStr, 'price', priceStr, settings.priceStep);
    const cleanupGrams = attachWheel(gramsInputRef, setGramsStr, 'grams', gramsStr, settings.gramsStep);

    return () => { cleanupPrice?.(); cleanupGrams?.(); };
  }, [priceStr, gramsStr, onUpdate, trade.id, settings, mode]);

  // Determine current style for preview: 
  // If empty tag -> EMPTY_STYLE
  // If has tag -> lookup in palette (fallback to indigo)
  const currentStyle = tagStr ? getTagStyle(currentTagColorKey) : EMPTY_STYLE;

  return createPortal(
    <>
      <style>{`
          .no-spinners::-webkit-inner-spin-button,
          .no-spinners::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
          .no-spinners { -moz-appearance: textfield; }
      `}</style>
      <div className="fixed inset-0 z-[9998]" onClick={onClose} />
      <div 
        ref={bubbleRef}
        className="fixed z-[9999] bg-app-card border border-app-border shadow-[0_10px_40px_-10px_rgba(0,0,0,0.7)] rounded-xl w-72 flex flex-col overflow-hidden text-app-text"
        style={{ top: position.top, left: position.left }}
      >
        {/* Header - subtler border */}
        <div 
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="bg-app-bg/80 backdrop-blur-md p-3 flex justify-between items-center border-b border-white/5 cursor-grab active:cursor-grabbing touch-none select-none group"
        >
          <div className="flex items-center gap-2 text-app-subtext pointer-events-none">
            <GripHorizontal size={16} className="opacity-80"/>
            <h4 className="text-sm font-bold tracking-wider">{mode === 'tag' ? '编辑标签' : '编辑交易'}</h4>
          </div>
          
          <div className="flex items-center gap-1">
            <button 
              onClick={handleReset}
              onPointerDown={(e) => e.stopPropagation()}
              className="text-app-subtext hover:text-brand-yellow transition-colors bg-app-text/5 hover:bg-app-text/10 rounded p-1 mr-1"
              title="撤销更改"
            >
              <RotateCcw size={14} />
            </button>
            <button onClick={onClose} onPointerDown={(e) => e.stopPropagation()} className="text-app-subtext hover:text-app-text transition-colors bg-app-text/5 hover:bg-app-text/10 rounded p-1">
              <X size={16} />
            </button>
          </div>
        </div>
        
        <div className="p-5 space-y-5 bg-app-card max-h-[80vh] overflow-y-auto custom-scrollbar">
          
          {mode === 'full' && (
            <>
              <div className="space-y-2">
                 <label className="text-xs text-app-subtext">交易方向</label>
                 <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => onUpdate(trade.id, { type: 'BUY' })} className={`h-10 text-sm font-bold rounded-lg border transition-all ${trade.type === 'BUY' ? 'bg-brand-red text-white border-brand-red' : 'bg-app-bg border-white/5 text-app-subtext'}`}>买入</button>
                    <button onClick={() => onUpdate(trade.id, { type: 'SELL' })} className={`h-10 text-sm font-bold rounded-lg border transition-all ${trade.type === 'SELL' ? 'bg-brand-green text-white border-brand-green' : 'bg-app-bg border-white/5 text-app-subtext'}`}>卖出</button>
                 </div>
              </div>
              <div className="space-y-2">
                 <label className="text-xs text-app-subtext">成交价格</label>
                 <div className="relative w-full group/input">
                    <input ref={priceInputRef} type="text" value={priceStr} onChange={(e) => {setPriceStr(e.target.value); const v=parseFloat(e.target.value); if(!isNaN(v)) onUpdate(trade.id, {price:v})}} className="no-spinners w-full bg-app-input border border-white/5 rounded-lg pl-3 pr-8 h-10 text-app-text font-mono text-center focus:border-brand-yellow focus:outline-none" />
                    <div className="absolute right-1 inset-y-1 flex flex-col justify-center gap-0.5 w-5 opacity-50 group-hover/input:opacity-100"><button onClick={() => adjustValue(setPriceStr, 'price', priceStr, settings.priceStep)} className="flex-1 flex items-center justify-center bg-app-text/5 hover:bg-brand-yellow/20 text-app-subtext hover:text-brand-yellow"><ChevronUp size={10} /></button><button onClick={() => adjustValue(setPriceStr, 'price', priceStr, -settings.priceStep)} className="flex-1 flex items-center justify-center bg-app-text/5 hover:bg-brand-yellow/20 text-app-subtext hover:text-brand-yellow"><ChevronDown size={10} /></button></div>
                 </div>
              </div>
              <div className="space-y-2">
                 <label className="text-xs text-app-subtext">数量</label>
                 <div className="relative w-full group/input">
                    <input ref={gramsInputRef} type="text" value={gramsStr} onChange={(e) => {setGramsStr(e.target.value); const v=parseFloat(e.target.value); if(!isNaN(v)) onUpdate(trade.id, {grams:v})}} className="no-spinners w-full bg-app-input border border-white/5 rounded-lg pl-3 pr-8 h-10 text-app-text font-mono text-center focus:border-brand-yellow focus:outline-none" />
                    <div className="absolute right-1 inset-y-1 flex flex-col justify-center gap-0.5 w-5 opacity-50 group-hover/input:opacity-100"><button onClick={() => adjustValue(setGramsStr, 'grams', gramsStr, settings.gramsStep)} className="flex-1 flex items-center justify-center bg-app-text/5 hover:bg-brand-yellow/20 text-app-subtext hover:text-brand-yellow"><ChevronUp size={10} /></button><button onClick={() => adjustValue(setGramsStr, 'grams', gramsStr, -settings.gramsStep)} className="flex-1 flex items-center justify-center bg-app-text/5 hover:bg-brand-yellow/20 text-app-subtext hover:text-brand-yellow"><ChevronDown size={10} /></button></div>
                 </div>
              </div>
            </>
          )}
          
          <div className="space-y-2">
             <label className="text-xs text-app-subtext">标签 (Tag)</label>
             <div className="relative">
                <input
                  type="text"
                  value={tagStr}
                  onChange={(e) => handleTagChange(e.target.value)}
                  placeholder="如: 短线, 止盈..."
                  className="w-full bg-app-input border border-white/5 rounded-lg pl-3 pr-3 h-10 text-sm text-gray-400 placeholder-app-subtext/50 focus:border-brand-yellow focus:outline-none focus:ring-1 focus:ring-brand-yellow/50 transition-all"
                />
             </div>
             
             {/* Tag Preview & Color Picker */}
             <div className="pt-2 animate-in fade-in slide-in-from-top-1">
                 <div className="flex items-center gap-2 mb-2">
                   <div className="text-[10px] text-app-subtext">预览:</div>
                   <span className={`inline-flex items-center justify-center px-1.5 h-[22px] rounded text-[10px] font-medium min-w-[22px] border ${currentStyle.bg} ${currentStyle.text} ${currentStyle.border}`}>
                     {tagStr || '-'}
                   </span>
                 </div>
                 
                 <div className="flex flex-wrap gap-2">
                   {TAG_PALETTE.map((p) => (
                     <button
                       key={p.key}
                       onClick={() => handleColorSelect(p.key)}
                       className={`w-6 h-6 rounded-full border transition-all flex items-center justify-center ${p.bg} ${p.border} ${
                         currentTagColorKey === p.key ? 'opacity-100 scale-100' : 'hover:scale-105 opacity-60 hover:opacity-100'
                       }`}
                       title={p.label}
                     >
                       {currentTagColorKey === p.key && <div className={`w-2 h-2 rounded-full ${p.text} bg-current shadow-sm`} />}
                     </button>
                   ))}
                 </div>
             </div>

             {availableTags.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5 mt-2">
                   {availableTags.filter(t => t !== tagStr).map(tag => {
                      // Fallback logic for list items: if color is missing/deleted, use default
                      const savedColorKey = settings.tagColors?.[tag];
                      const style = getTagStyle(savedColorKey);
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => handleTagChange(tag)}
                          className={`inline-flex items-center justify-center px-1.5 h-[22px] rounded text-[10px] font-medium min-w-[22px] border transition-all ${style.bg} ${style.border} ${style.text} hover:opacity-80`}
                        >
                          {tag}
                        </button>
                      );
                   })}
                </div>
             )}
          </div>
          
          {mode === 'full' && (
            <div className="pt-3 flex justify-between items-center text-sm border-t border-white/5 mt-2">
               <span className="text-app-subtext">小计:</span>
               <span className="text-app-text font-mono font-bold tracking-wide">
                 ¥ {fmt((parseFloat(priceStr) || 0) * (parseFloat(gramsStr) || 0))}
               </span>
            </div>
          )}
        </div>
      </div>
    </>,
    document.body
  );
};

export const TradeList: React.FC<TradeListProps> = ({ trades, onDelete, onUpdate, settings, onSettingsChange }) => {
  const [sortDesc, setSortDesc] = useState(() => {
    return localStorage.getItem('gold_trade_sort_desc') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('gold_trade_sort_desc', String(sortDesc));
  }, [sortDesc]);

  const [activeId, setActiveId] = useState<ColumnKey | null>(null);
  const [editState, setEditState] = useState<{ id: string, top: number, left: number, mode: 'full' | 'tag' } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const colRects = useRef<Map<string, { left: number, width: number }>>(new Map());
  const startXRef = useRef(0);
  const currentHoverIdxRef = useRef<number | null>(null);

  const handleEditClick = (e: React.MouseEvent, id: string, mode: 'full' | 'tag') => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const width = 256; 
    let left = rect.right - width;
    if (mode === 'tag') {
        // Position relative to tag column better
        left = rect.left;
    } else {
        left = rect.right - width;
    }
    
    let top = rect.bottom + 8;
    
    if (left < 10) left = 10;
    if (left + width > window.innerWidth) left = window.innerWidth - width - 10;
    if (top + 280 > window.innerHeight) {
        top = rect.top - (mode === 'tag' ? 240 : 350); // Adjust height estimate based on mode
    }
    setEditState({ id, top, left, mode });
  };

  const handleTagColorChange = (tag: string, colorKey: string) => {
    const newColors = { ...settings.tagColors, [tag]: colorKey };
    onSettingsChange({ tagColors: newColors });
  };

  const tradesWithHistory = useMemo(() => {
    let runningGrams = 0;
    let runningTotalCost = 0;
    return trades.map(trade => {
      if (trade.isDisabled) {
         return { ...trade, historicalAvg: 0, avgChange: 0, holdingTotal: 0 };
      }
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

  const displayTrades = useMemo(() => {
    return sortDesc ? [...tradesWithHistory].reverse() : tradesWithHistory;
  }, [tradesWithHistory, sortDesc]);
  
  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    trades.forEach(t => { if (t.tag && t.tag.trim()) tags.add(t.tag.trim()); });
    return Array.from(tags).sort();
  }, [trades]);

  const COLUMN_DEFS: Record<ColumnKey, ColumnDef> = {
    tag: { id: 'tag', label: '标签', render: (t) => {
       const displayTag = t.tag || '-';
       
       // Use Empty Style if no tag, otherwise lookup
       let style = EMPTY_STYLE;
       if (t.tag) {
           const colorKey = settings.tagColors?.[t.tag];
           style = getTagStyle(colorKey);
       }
       
       return (
         <div 
           onClick={(e) => handleEditClick(e, t.id, 'tag')}
           className="cursor-pointer group/tag w-full h-full min-h-[24px] flex items-center"
           title="点击编辑标签"
         >
           <span className={`inline-flex items-center justify-center px-1.5 h-[22px] rounded text-[10px] font-medium min-w-[22px] transition-colors border ${style.bg} ${style.text} ${style.border} ${style.hover || ''}`}>
             {displayTag}
           </span>
         </div>
       );
    }},
    price: { id: 'price', label: '价格', render: (t) => <span className="font-mono text-app-text">{t.price.toFixed(2)}</span> },
    grams: { id: 'grams', label: '数量', render: (t) => <span className="font-mono text-app-text">{t.grams.toFixed(2)}</span> },
    tradeTotal: { id: 'tradeTotal', label: '交易额', render: (t) => <span className="font-mono text-app-text/70">{fmt(t.price * t.grams)}</span> },
    historicalAvg: { id: 'historicalAvg', label: '持仓均价', render: (t) => 
       t.isDisabled ? <span className="text-app-subtext select-none">-</span> : <span className="font-mono text-brand-yellow font-medium">{t.historicalAvg > 0 ? t.historicalAvg.toFixed(2) : '-'}</span> 
    },
    holdingTotal: { id: 'holdingTotal', label: '持仓总额', render: (t) => 
       t.isDisabled ? <span className="text-app-subtext select-none">-</span> : <span className="font-mono text-app-subtext text-xs">{t.holdingTotal > 0 ? fmt(t.holdingTotal) : '-'}</span> 
    },
    avgChange: { id: 'avgChange', label: '成本浮动', render: (t) => {
      if (t.isDisabled || Math.abs(t.avgChange) < 0.001) return <span className="text-app-subtext">-</span>;
      return <span className={`font-mono font-medium text-xs ${t.avgChange > 0 ? 'text-brand-red' : 'text-brand-green'}`}>{t.avgChange > 0 ? '+' : ''}{t.avgChange.toFixed(2)}%</span>;
    }}
  };

  // State & Persistence
  const DEFAULT_ORDER: ColumnKey[] = ['tag', 'price', 'grams', 'tradeTotal', 'holdingTotal', 'historicalAvg', 'avgChange'];
  const [columnOrder, setColumnOrder] = useState<ColumnKey[]>(() => {
    const saved = localStorage.getItem('gold_trade_list_column_order_v3');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as ColumnKey[];
        const validSaved = parsed.filter(k => DEFAULT_ORDER.includes(k));
        const missing = DEFAULT_ORDER.filter(k => !validSaved.includes(k));
        return [...validSaved, ...missing];
      } catch (e) { return DEFAULT_ORDER; }
    }
    return DEFAULT_ORDER;
  });

  useEffect(() => {
    localStorage.setItem('gold_trade_list_column_order_v3', JSON.stringify(columnOrder));
  }, [columnOrder]);

  // Drag & Scroll logic omitted for brevity as it remains same, just ensuring references are intact
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.shiftKey) { e.preventDefault(); el.scrollLeft += e.deltaY; }
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [trades.length]);

  const onPointerDown = (e: React.PointerEvent, id: ColumnKey) => {
    if (e.button !== 0) return;
    const rects = new Map();
    columnOrder.forEach(key => {
      const el = containerRef.current?.querySelector(`[data-col="${key}"]`);
      if (el) { const r = el.getBoundingClientRect(); rects.set(key, { left: r.left, width: r.width }); }
    });
    colRects.current = rects;
    setActiveId(id);
    currentHoverIdxRef.current = columnOrder.indexOf(id);
    startXRef.current = e.clientX;
    columnOrder.forEach((_, idx) => containerRef.current?.style.setProperty(`--shift-${idx}`, '0px'));
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
      if (dragCenter > targetData.left && dragCenter < targetData.left + targetData.width) { newHoverIdx = i; break; }
    }
    if (newHoverIdx !== currentHoverIdxRef.current) {
      currentHoverIdxRef.current = newHoverIdx;
      columnOrder.forEach((id, idx) => {
        if (id === activeId) return;
        let tx = 0;
        if (newHoverIdx > activeIdx && idx > activeIdx && idx <= newHoverIdx) { tx = -activeData.width; }
        else if (newHoverIdx < activeIdx && idx < activeIdx && idx >= newHoverIdx) { tx = activeData.width; }
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
      columnOrder.forEach((_, idx) => containerRef.current?.style.setProperty(`--shift-${idx}`, '0px'));
      containerRef.current.style.setProperty('--drag-tx', '0px');
    }
    setActiveId(null);
    currentHoverIdxRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  };

  if (trades.length === 0) {
    return <div className="text-center py-8 text-app-subtext text-sm italic border border-dashed border-app-border rounded-xl">暂无交易记录</div>;
  }

  const editingTrade = editState ? trades.find(t => t.id === editState.id) : null;

  return (
    <>
      <div className="rounded-xl border border-app-border bg-app-card overflow-hidden isolate transition-colors duration-300">
        <div ref={containerRef} className={`overflow-x-auto custom-scrollbar ${activeId ? 'drag-active' : ''}`}>
          <style>{`
            .drag-active th, .drag-active td { will-change: transform; transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1); }
            ${columnOrder.map((id, idx) => `
              .drag-col-${id} th:nth-child(${idx + 2}), .drag-col-${id} td:nth-child(${idx + 2}) { transform: translateX(var(--drag-tx)); transition: none !important; z-index: 50; position: relative; background: var(--drag-bg) !important; box-shadow: 15px 0 30px rgba(0,0,0,0.4), -15px 0 30px rgba(0,0,0,0.4); }
              .drag-active th:nth-child(${idx + 2}):not(.dragging-cell), .drag-active td:nth-child(${idx + 2}):not(.dragging-cell) { transform: translateX(var(--shift-${idx})); }
            `).join('\n')}
            .drag-active th:first-child, .drag-active td:first-child { transform: none !important; z-index: 60; }
            .drag-active th:last-child, .drag-active td:last-child { transform: none !important; z-index: 100; }
          `}</style>

          <table className="w-full text-sm text-left border-separate border-spacing-0 min-w-[550px]">
            <thead className="text-xs text-app-subtext uppercase bg-app-bg">
              <tr className={activeId ? `drag-col-${activeId}` : ''}>
                <th className="p-0 text-center sticky left-0 z-20 bg-app-bg border-b border-r border-app-border w-[40px] min-w-[40px] max-w-[40px] shadow-lg">
                   <span className="font-bold">方向</span>
                </th>
                {columnOrder.map((colKey) => {
                  const col = COLUMN_DEFS[colKey];
                  const isDragging = activeId === colKey;
                  return (
                    <th key={colKey} data-col={colKey} onPointerDown={(e) => onPointerDown(e, colKey)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} className={`px-2 py-3 md:px-4 md:py-4 border-b border-app-border cursor-grab active:cursor-grabbing select-none relative touch-none ${isDragging ? 'dragging-cell text-brand-yellow font-bold' : ''}`}>
                      <div className="flex items-center gap-1.5 pointer-events-none"><span className="whitespace-nowrap">{col.label}</span></div>
                      {isDragging && <div className="absolute inset-x-0 -bottom-[1px] h-0.5 bg-brand-yellow" />}
                    </th>
                  );
                })}
                <th className="px-1 py-3 md:py-4 text-center sticky right-0 z-20 bg-app-bg border-l border-b border-app-border shadow-lg w-[90px]">
                   <button onClick={() => setSortDesc(!sortDesc)} className={`flex items-center justify-center gap-1 w-full py-1.5 rounded-md transition-all text-[11px] font-bold border ${sortDesc ? 'bg-brand-green/10 text-brand-green border-brand-green/20 hover:bg-brand-green/20' : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20 hover:bg-indigo-500/20'}`} title="切换时间排序">
                     <span>{sortDesc ? "最新→最早" : "最早→最新"}</span>
                   </button>
                </th>
              </tr>
            </thead>
            <tbody className="">
              {displayTrades.map((trade) => (
                <tr key={trade.id} className={`${activeId ? `drag-col-${activeId}` : ''} hover:bg-app-hover group transition-colors ${trade.isDisabled ? 'opacity-40 grayscale decoration-app-subtext' : ''}`}>
                  <td className="p-0 py-2.5 md:py-3 text-center sticky left-0 z-20 bg-app-card group-hover:bg-app-hover border-r border-b border-app-border shadow-lg transition-colors w-[40px] min-w-[40px] max-w-[40px]">
                     <span className={`inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold mx-auto ${trade.type === 'BUY' ? 'bg-brand-red/10 text-brand-red' : 'bg-brand-green/10 text-brand-green'}`}>{trade.type === 'BUY' ? '买' : '卖'}</span>
                  </td>
                  {columnOrder.map((colKey) => (
                    <td key={colKey} className={`px-2 py-2.5 md:px-4 md:py-3 whitespace-nowrap border-b border-app-border ${activeId === colKey ? 'dragging-cell' : ''}`}>{COLUMN_DEFS[colKey].render(trade as any)}</td>
                  ))}
                  <td className="px-1 py-2.5 md:py-3 text-center sticky right-0 z-20 bg-app-card group-hover:bg-app-hover border-l border-b border-app-border shadow-lg transition-colors">
                    <div className="flex justify-center gap-1">
                      <button onClick={(e) => handleEditClick(e, trade.id, 'full')} className={`p-1 transition-colors ${editState?.id === trade.id && editState.mode === 'full' ? 'text-brand-yellow' : 'text-app-subtext hover:text-brand-yellow'}`} title="编辑">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => onUpdate(trade.id, { isDisabled: !trade.isDisabled })} className={`p-1 transition-colors ${trade.isDisabled ? 'text-app-subtext hover:text-app-subtext/70' : 'text-app-subtext hover:text-indigo-400'}`} title={trade.isDisabled ? "恢复生效" : "暂时失效"}>
                        {trade.isDisabled ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                      <button onClick={() => onDelete(trade.id)} className="text-app-subtext hover:text-red-400 transition-colors p-1" title="删除">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {editingTrade && editState && (
        <EditBubble 
          trade={editingTrade} 
          availableTags={availableTags}
          onUpdate={onUpdate} 
          onClose={() => setEditState(null)} 
          initialPosition={{ top: editState.top, left: editState.left }}
          settings={settings}
          mode={editState.mode}
          onTagColorChange={handleTagColorChange}
        />
      )}
    </>
  );
}