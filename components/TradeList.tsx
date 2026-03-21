
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { TradeRecord, AppSettings } from '../types';
import { Trash2, Edit2, X, GripHorizontal, Eye, EyeOff, RotateCcw, ArrowDownUp, ChevronDown, ChevronUp } from 'lucide-react';
import { InputGroup } from './InputGroup';

interface TradeListProps {
  trades: TradeRecord[];
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<TradeRecord>) => void;
  onReorder: (newTrades: TradeRecord[]) => void;
  settings: AppSettings;
  onSettingsChange: (updates: Partial<AppSettings>) => void;
}

type ColumnKey = 'tag' | 'price' | 'grams' | 'tradeTotal' | 'historicalAvg' | 'holdingTotal' | 'avgChange' | 'absChange';

interface ColumnDef {
  id: ColumnKey;
  label: React.ReactNode;
  render: (trade: TradeRecord & { historicalAvg: number, historicalBreakEven: number, avgChange: number, absChange: number, breakEvenChange: number, breakEvenAbsChange: number, holdingTotal: number }) => React.ReactNode;
}

const fmt = (n: number) => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TAG_PALETTE = [
  { key: 'indigo', label: '默认', bg: 'bg-indigo-500/10', text: 'text-indigo-500', border: 'border-indigo-500/20', hover: 'hover:border-indigo-500/50' },
  { key: 'gray', label: '灰色', bg: 'bg-gray-500/10', text: 'text-gray-500', border: 'border-gray-500/20', hover: 'hover:border-gray-500/50' },
  { key: 'red', label: '红色', bg: 'bg-red-500/10', text: 'text-red-500', border: 'border-red-500/20', hover: 'hover:border-red-500/50' },
  { key: 'green', label: '绿色', bg: 'bg-green-500/10', text: 'text-green-500', border: 'border-green-500/20', hover: 'hover:border-green-500/50' },
  { key: 'blue', label: '蓝色', bg: 'bg-blue-500/10', text: 'text-blue-500', border: 'border-blue-500/20', hover: 'hover:border-blue-500/50' },
  { key: 'purple', label: '紫色', bg: 'bg-purple-500/10', text: 'text-purple-500', border: 'border-purple-500/20', hover: 'hover:border-purple-500/50' },
  { key: 'pink', label: '粉色', bg: 'bg-pink-500/10', text: 'text-pink-500', border: 'border-pink-500/20', hover: 'hover:border-pink-500/50' },
];

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
  availableTags: string[];
  onUpdate: (id: string, updates: Partial<TradeRecord>) => void;
  onClose: () => void;
  initialPosition: { top: number, left: number };
  settings: AppSettings;
  mode: 'full' | 'tag';
  onTagColorChange: (tag: string, colorKey: string) => void;
}

const EditBubble: React.FC<EditBubbleProps> = ({ 
  trade, availableTags, onUpdate, onClose, initialPosition, settings, mode, onTagColorChange 
}) => {
  const initialSnapshot = useRef({
    price: trade.price,
    grams: trade.grams,
    type: trade.type,
    tag: trade.tag || ''
  });

  const [priceStr, setPriceStr] = useState(trade.price.toString());
  const [gramsStr, setGramsStr] = useState(trade.grams.toString());
  const [tagStr, setTagStr] = useState(trade.tag || '');
  
  const currentTagColorKey = settings.tagColors?.[tagStr] || 'indigo';
  const [position, setPosition] = useState(initialPosition);
  
  const bubbleRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);

  const handleReset = () => {
    const init = initialSnapshot.current;
    if (mode === 'full') {
      onUpdate(trade.id, {
        price: init.price,
        grams: init.grams,
        type: init.type
      });
      setPriceStr(init.price.toString());
      setGramsStr(init.grams.toString());
    } else {
      onUpdate(trade.id, { tag: init.tag });
      setTagStr(init.tag);
    }
  };

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

  const handleTagChange = (val: string) => {
    setTagStr(val);
    onUpdate(trade.id, { tag: val });
  };

  const handleColorSelect = (key: string) => {
     if (tagStr.trim()) {
        onTagColorChange(tagStr.trim(), key);
     }
  };

  const currentStyle = tagStr ? getTagStyle(currentTagColorKey) : EMPTY_STYLE;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onClick={onClose} />
      <div 
        ref={bubbleRef}
        className="fixed z-[9999] bg-app-card border border-app-border shadow-[0_10px_40px_-10px_rgba(0,0,0,0.7)] rounded-xl w-72 flex flex-col overflow-hidden text-app-text"
        style={{ top: position.top, left: position.left }}
      >
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
        
        <div className="p-5 space-y-4 bg-app-card max-h-[80vh] overflow-y-auto custom-scrollbar">
          {mode === 'full' ? (
            <>
              <div className="space-y-1.5">
                 <label className="text-[10px] uppercase font-bold text-app-subtext tracking-wider ml-0.5">交易方向</label>
                 <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => onUpdate(trade.id, { type: 'BUY' })} className={`h-11 text-sm font-bold rounded-lg border transition-all ${trade.type === 'BUY' ? 'bg-brand-red text-white border-brand-red shadow-sm' : 'bg-app-bg border-white/5 text-app-subtext'}`}>买入</button>
                    <button onClick={() => onUpdate(trade.id, { type: 'SELL' })} className={`h-11 text-sm font-bold rounded-lg border transition-all ${trade.type === 'SELL' ? 'bg-brand-green text-white border-brand-green shadow-sm' : 'bg-app-bg border-white/5 text-app-subtext'}`}>卖出</button>
                 </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <InputGroup 
                  label="成交价格" 
                  value={priceStr} 
                  onChange={(val) => {
                    setPriceStr(val);
                    const v = parseFloat(val);
                    if (!isNaN(v)) onUpdate(trade.id, { price: v });
                  }} 
                  step={settings.priceStep}
                  touchMode={settings.touchMode} 
                />
                <InputGroup 
                  label="数量" 
                  value={gramsStr} 
                  onChange={(val) => {
                    setGramsStr(val);
                    const v = parseFloat(val);
                    if (!isNaN(v)) onUpdate(trade.id, { grams: v });
                  }} 
                  step={settings.gramsStep} 
                  isQuantity={true}
                  touchMode={settings.touchMode}
                />
              </div>

              <div className="pt-3 flex justify-between items-center text-xs border-t border-white/5 mt-1">
                 <span className="text-app-subtext font-medium">交易额预览:</span>
                 <span className="text-app-text font-mono font-bold">
                   ¥ {fmt((parseFloat(priceStr) || 0) * (parseFloat(gramsStr) || 0))}
                 </span>
              </div>
            </>
          ) : (
            <div className="space-y-5">
              <div className="space-y-2">
                 <label className="text-xs text-app-subtext font-medium">标签 (Tag)</label>
                 <div className="relative">
                    <input
                      type="text"
                      value={tagStr}
                      onChange={(e) => handleTagChange(e.target.value)}
                      placeholder="如: 短线, 止盈..."
                      className="w-full bg-app-input border border-white/5 rounded-lg pl-3 pr-3 h-11 text-sm text-gray-400 placeholder-app-subtext/50 focus:border-brand-yellow focus:outline-none focus:ring-1 focus:ring-brand-yellow/50 transition-all"
                    />
                 </div>
                 
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
            </div>
          )}
        </div>
      </div>
    </>,
    document.body
  );
};

export const TradeList: React.FC<TradeListProps> = ({ trades, onDelete, onUpdate, onReorder, settings, onSettingsChange }) => {
  // sortDesc: true = Latest -> Earliest (Reversed), false = Earliest -> Latest (Original)
  const [sortDesc, setSortDesc] = useState(() => {
    const saved = localStorage.getItem('gold_trade_sort_desc');
    return saved !== 'false';
  });

  useEffect(() => {
    localStorage.setItem('gold_trade_sort_desc', String(sortDesc));
  }, [sortDesc]);

  const [activeColId, setActiveColId] = useState<ColumnKey | null>(null);
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [editState, setEditState] = useState<{ id: string, top: number, left: number, mode: 'full' | 'tag' } | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const colRects = useRef<Map<string, { left: number, width: number }>>(new Map());
  const rowRects = useRef<Map<string, { top: number, height: number }>>(new Map());
  
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const currentHoverColIdxRef = useRef<number | null>(null);
  const currentHoverRowIdxRef = useRef<number | null>(null);

  const handleEditClick = (e: React.MouseEvent, id: string, mode: 'full' | 'tag') => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const width = 288; 
    let left = rect.right - width;
    if (mode === 'tag') {
        left = rect.left;
    } else {
        left = rect.right - width;
    }
    
    let top = rect.bottom + 8;
    
    if (left < 10) left = 10;
    if (left + width > window.innerWidth) left = window.innerWidth - width - 10;
    
    const bubbleHeight = mode === 'full' ? 240 : 280;
    if (top + bubbleHeight > window.innerHeight) {
        top = rect.top - bubbleHeight - 8; 
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
    let runningRealizedPnL = 0;
    return trades.map(trade => {
      if (trade.isDisabled) {
         return { ...trade, historicalAvg: 0, historicalBreakEven: 0, avgChange: 0, absChange: 0, breakEvenChange: 0, breakEvenAbsChange: 0, holdingTotal: 0 };
      }
      const avgBefore = runningGrams > 0 ? runningTotalCost / runningGrams : 0;
      const breakEvenBefore = runningGrams > 0 ? Math.max(0, (runningTotalCost - runningRealizedPnL) / runningGrams) : 0;
      
      if (trade.type === 'BUY') {
        runningTotalCost += trade.price * trade.grams;
        runningGrams += trade.grams;
      } else {
        const currentAvg = runningGrams > 0 ? runningTotalCost / runningGrams : 0;
        const costBasis = trade.grams * currentAvg;
        runningTotalCost -= costBasis;
        runningRealizedPnL += (trade.price * trade.grams) - costBasis;
        runningGrams -= trade.grams;
      }
      if (runningGrams < 0.0001) { runningGrams = 0; runningTotalCost = 0; }
      const avgAfter = runningGrams > 0 ? runningTotalCost / runningGrams : 0;
      const breakEvenAfter = runningGrams > 0 ? Math.max(0, (runningTotalCost - runningRealizedPnL) / runningGrams) : 0;
      
      let avgChangePercent = avgBefore > 0 ? ((avgAfter - avgBefore) / avgBefore) * 100 : 0;
      let avgChangeAbs = avgBefore > 0 ? (avgAfter - avgBefore) : 0;
      
      let breakEvenChangePercent = breakEvenBefore > 0 ? ((breakEvenAfter - breakEvenBefore) / breakEvenBefore) * 100 : 0;
      let breakEvenChangeAbs = breakEvenBefore > 0 ? (breakEvenAfter - breakEvenBefore) : 0;
      
      return { 
        ...trade, 
        historicalAvg: avgAfter, 
        historicalBreakEven: breakEvenAfter, 
        avgChange: avgChangePercent, 
        absChange: avgChangeAbs, 
        breakEvenChange: breakEvenChangePercent,
        breakEvenAbsChange: breakEvenChangeAbs,
        holdingTotal: runningTotalCost 
      };
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
    price: { id: 'price', label: '单价', render: (t) => <span className="font-mono text-app-text">{t.price.toFixed(2)}</span> },
    grams: { id: 'grams', label: '数量', render: (t) => <span className="font-mono text-app-subtext">{t.grams.toFixed(2)}</span> },
    tradeTotal: { id: 'tradeTotal', label: '交易额', render: (t) => <span className="font-mono text-app-subtext">{fmt(t.price * t.grams)}</span> },
    holdingTotal: { id: 'holdingTotal', label: '持仓总额', render: (t) => {
       if (t.isDisabled) return <span className="font-mono text-app-subtext text-xs">-</span>;
       return <span className="font-mono text-app-subtext text-xs">{t.holdingTotal > 0 ? fmt(t.holdingTotal) : '-'}</span> 
    }},
    historicalAvg: { id: 'historicalAvg', label: settings.priceDisplayMode === 'avgCost' ? '持仓均价' : settings.priceDisplayMode === 'breakEven' ? '回本价' : (
      <div className="flex flex-col leading-tight items-start">
        <span>回本价</span>
        <span className="text-[10px] opacity-70 font-normal">持仓均价</span>
      </div>
    ), render: (t) => {
       const renderValue = (val: number, isAvg: boolean = false) => {
           if (val <= 0 || t.isDisabled) return <span className={`font-mono text-app-subtext font-medium ${isAvg ? 'text-[10px] opacity-70' : ''}`}>-</span>;
           let colorClass = 'text-app-subtext';
           if (val < t.price) colorClass = 'text-brand-red';
           else if (val > t.price) colorClass = 'text-brand-green';
           return <span className={`font-mono font-medium ${colorClass} ${isAvg ? 'text-[10px] opacity-70' : ''}`}>{val.toFixed(2)}</span>;
       };

       if (settings.priceDisplayMode === 'avgCost') {
           return renderValue(t.historicalAvg);
       } else if (settings.priceDisplayMode === 'breakEven') {
           return renderValue(t.historicalBreakEven);
       } else {
           return (
               <div className="flex flex-col items-end leading-tight">
                   {renderValue(t.historicalBreakEven)}
                   {renderValue(t.historicalAvg, true)}
               </div>
           );
       }
    }},
    absChange: { id: 'absChange', label: settings.priceDisplayMode === 'avgCost' ? '均价浮动' : settings.priceDisplayMode === 'breakEven' ? '回本浮动' : (
      <div className="flex flex-col leading-tight items-start">
        <span>回本浮动</span>
        <span className="text-[10px] opacity-70 font-normal">均价浮动</span>
      </div>
    ), render: (t) => {
        const renderValue = (val: number, isAvg: boolean = false) => {
            const sizeClass = isAvg ? 'text-[10px] opacity-70' : 'text-xs';
            if (Math.abs(val) < 0.001 || t.isDisabled) return <span className={`font-mono text-app-subtext ${sizeClass}`}>-</span>;
            return <span className={`font-mono font-medium ${sizeClass} ${val < 0 ? 'text-brand-red' : 'text-brand-green'}`}>
              {val > 0 ? '+' : ''}{val.toFixed(2)}
            </span>;
        };

        if (settings.priceDisplayMode === 'avgCost') {
            return renderValue(t.absChange);
        } else if (settings.priceDisplayMode === 'breakEven') {
            return renderValue(t.breakEvenAbsChange);
        } else {
            return (
                <div className="flex flex-col items-end leading-tight">
                    {renderValue(t.breakEvenAbsChange)}
                    {renderValue(t.absChange, true)}
                </div>
            );
        }
    }},
    avgChange: { id: 'avgChange', label: settings.priceDisplayMode === 'avgCost' ? '均价价差' : settings.priceDisplayMode === 'breakEven' ? '回本价差' : (
      <div className="flex flex-col leading-tight items-start">
        <span>回本价差</span>
        <span className="text-[10px] opacity-70 font-normal">均价价差</span>
      </div>
    ), render: (t) => {
      const renderValue = (avgVal: number, isAvg: boolean = false) => {
          const sizeClass = isAvg ? 'text-[10px] opacity-70' : 'text-xs';
          if (avgVal === 0 || t.isDisabled) return <span className={`font-mono text-app-subtext ${sizeClass}`}>-</span>;
          const diff = t.price - avgVal;
          if (Math.abs(diff) < 0.001) return <span className={`font-mono text-app-subtext ${sizeClass}`}>0.00</span>;
          return <span className={`font-mono font-medium ${sizeClass} ${diff > 0 ? 'text-brand-red' : 'text-brand-green'}`}>
            {diff > 0 ? '+' : ''}{diff.toFixed(2)}
          </span>;
      };

      if (settings.priceDisplayMode === 'avgCost') {
          return renderValue(t.historicalAvg);
      } else if (settings.priceDisplayMode === 'breakEven') {
          return renderValue(t.historicalBreakEven);
      } else {
          return (
              <div className="flex flex-col items-end leading-tight">
                  {renderValue(t.historicalBreakEven)}
                  {renderValue(t.historicalAvg, true)}
              </div>
          );
      }
    }}
  };

  const DEFAULT_ORDER: ColumnKey[] = ['tag', 'price', 'grams', 'tradeTotal', 'holdingTotal', 'historicalAvg', 'absChange', 'avgChange'];
  const [columnOrder, setColumnOrder] = useState<ColumnKey[]>(() => {
    const saved = localStorage.getItem('gold_trade_list_column_order_v4');
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
    localStorage.setItem('gold_trade_list_column_order_v4', JSON.stringify(columnOrder));
  }, [columnOrder]);

  const onColPointerDown = (e: React.PointerEvent, id: ColumnKey) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const rects = new Map();
    columnOrder.forEach(key => {
      const el = containerRef.current?.querySelector(`[data-col="${key}"]`);
      if (el) { const r = el.getBoundingClientRect(); rects.set(key, { left: r.left, width: r.width }); }
    });
    colRects.current = rects;
    setActiveColId(id);
    currentHoverColIdxRef.current = columnOrder.indexOf(id);
    startXRef.current = e.clientX;
    columnOrder.forEach((_, idx) => containerRef.current?.style.setProperty(`--col-shift-${idx}`, '0px'));
    containerRef.current?.style.setProperty('--col-drag-tx', '0px');
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onColPointerMove = (e: React.PointerEvent) => {
    if (!activeColId || !containerRef.current) return;
    const offset = e.clientX - startXRef.current;
    const activeIdx = columnOrder.indexOf(activeColId);
    const activeData = colRects.current.get(activeColId);
    if (!activeData) return;
    containerRef.current.style.setProperty('--col-drag-tx', `${offset}px`);
    const dragCenter = activeData.left + (activeData.width / 2) + offset;
    let newHoverIdx = activeIdx;
    for (let i = 0; i < columnOrder.length; i++) {
      const targetData = colRects.current.get(columnOrder[i]);
      if (!targetData) continue;
      if (dragCenter > targetData.left && dragCenter < targetData.left + targetData.width) { newHoverIdx = i; break; }
    }
    if (newHoverIdx !== currentHoverColIdxRef.current) {
      currentHoverColIdxRef.current = newHoverIdx;
      columnOrder.forEach((id, idx) => {
        if (id === activeColId) return;
        let tx = 0;
        if (newHoverIdx > activeIdx && idx > activeIdx && idx <= newHoverIdx) { tx = -activeData.width; }
        else if (newHoverIdx < activeIdx && idx < activeIdx && idx >= newHoverIdx) { tx = activeData.width; }
        containerRef.current?.style.setProperty(`--col-shift-${idx}`, `${tx}px`);
      });
    }
  };

  const onColPointerUp = (e: React.PointerEvent) => {
    if (activeColId && currentHoverColIdxRef.current !== null) {
      const activeIdx = columnOrder.indexOf(activeColId);
      if (activeIdx !== currentHoverColIdxRef.current) {
        const newOrder = [...columnOrder];
        const item = newOrder.splice(activeIdx, 1)[0];
        newOrder.splice(currentHoverColIdxRef.current, 0, item);
        setColumnOrder(newOrder);
      }
    }
    if (containerRef.current) {
      columnOrder.forEach((_, idx) => containerRef.current?.style.setProperty(`--col-shift-${idx}`, '0px'));
      containerRef.current.style.setProperty('--col-drag-tx', '0px');
    }
    setActiveColId(null);
    currentHoverColIdxRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const onRowPointerDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    
    const rects = new Map();
    displayTrades.forEach(t => {
      const el = containerRef.current?.querySelector(`[data-row="${t.id}"]`);
      if (el) { const r = el.getBoundingClientRect(); rects.set(t.id, { top: r.top, height: r.height }); }
    });
    rowRects.current = rects;
    setActiveRowId(id);
    currentHoverRowIdxRef.current = displayTrades.findIndex(t => t.id === id);
    startYRef.current = e.clientY;
    displayTrades.forEach((_, idx) => containerRef.current?.style.setProperty(`--row-shift-${idx}`, '0px'));
    containerRef.current?.style.setProperty('--row-drag-ty', '0px');
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onRowPointerMove = (e: React.PointerEvent) => {
    if (!activeRowId || !containerRef.current) return;
    const offset = e.clientY - startYRef.current;
    const activeIdx = displayTrades.findIndex(t => t.id === activeRowId);
    const activeData = rowRects.current.get(activeRowId);
    if (!activeData) return;
    containerRef.current.style.setProperty('--row-drag-ty', `${offset}px`);
    const dragCenter = activeData.top + (activeData.height / 2) + offset;
    let newHoverIdx = activeIdx;
    for (let i = 0; i < displayTrades.length; i++) {
      const targetData = rowRects.current.get(displayTrades[i].id);
      if (!targetData) continue;
      if (dragCenter > targetData.top && dragCenter < targetData.top + targetData.height) { newHoverIdx = i; break; }
    }
    if (newHoverIdx !== currentHoverRowIdxRef.current) {
      currentHoverRowIdxRef.current = newHoverIdx;
      displayTrades.forEach((t, idx) => {
        if (t.id === activeRowId) return;
        let ty = 0;
        if (newHoverIdx > activeIdx && idx > activeIdx && idx <= newHoverIdx) { ty = -activeData.height; }
        else if (newHoverIdx < activeIdx && idx < activeIdx && idx >= newHoverIdx) { ty = activeData.height; }
        containerRef.current?.style.setProperty(`--row-shift-${idx}`, `${ty}px`);
      });
    }
  };

  const onRowPointerUp = (e: React.PointerEvent) => {
    if (activeRowId && currentHoverRowIdxRef.current !== null) {
      const activeIdx = displayTrades.findIndex(t => t.id === activeRowId);
      if (activeIdx !== currentHoverRowIdxRef.current) {
        const newTrades = [...displayTrades];
        const item = newTrades.splice(activeIdx, 1)[0];
        newTrades.splice(currentHoverRowIdxRef.current, 0, item);
        
        // Remove computed fields to get clean TradeRecord objects
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const sanitized = newTrades.map(({ historicalAvg, avgChange, absChange, holdingTotal, ...rest }) => rest as TradeRecord);

        if (sortDesc) {
            onReorder(sanitized.reverse());
        } else {
            onReorder(sanitized);
        }
      }
    }
    if (containerRef.current) {
      displayTrades.forEach((_, idx) => containerRef.current?.style.setProperty(`--row-shift-${idx}`, '0px'));
      containerRef.current.style.setProperty('--row-drag-ty', '0px');
    }
    setActiveRowId(null);
    currentHoverRowIdxRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  };

  if (trades.length === 0) {
    return <div className="text-center py-8 text-app-subtext text-sm italic border border-dashed border-app-border rounded-xl">暂无交易记录</div>;
  }

  const editingTrade = editState ? trades.find(t => t.id === editState.id) : null;
  const visibleTrades = isExpanded ? displayTrades : displayTrades.slice(0, 20);

  return (
    <>
      <div className="rounded-xl border border-app-border bg-app-card overflow-hidden isolate transition-colors duration-300">
        <div ref={containerRef} className={`overflow-x-auto custom-scrollbar ${(activeColId || activeRowId) ? 'drag-active' : ''} ${isExpanded ? 'overflow-y-auto max-h-[800px]' : ''}`}>
          <style>{`
            /* 基础状态：禁止选中 */
            .drag-active { user-select: none !important; -webkit-user-select: none !important; }
            .drag-active * { cursor: grabbing !important; user-select: none !important; }
            
            .drag-active table { pointer-events: none; }
            .drag-active th, .drag-active td { pointer-events: auto; will-change: transform; transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1); }
            
            /* 列拖拽样式 */
            ${columnOrder.map((id, idx) => `
              .drag-col-${id} th:nth-child(${idx + 2}), .drag-col-${id} td:nth-child(${idx + 2}) { transform: translateX(var(--col-drag-tx)) !important; transition: none !important; z-index: 50; position: relative; background: var(--drag-bg) !important; box-shadow: 10px 0 20px rgba(0,0,0,0.3); }
              .drag-active th:nth-child(${idx + 2}):not(.dragging-cell), .drag-active td:nth-child(${idx + 2}):not(.dragging-cell) { transform: translateX(var(--col-shift-${idx})); }
            `).join('\n')}
            
            /* 行拖拽样式：提升 z-index 至 1000 确保悬浮在所有元素（包括粘性列）上方 */
            ${visibleTrades.map((t, idx) => `
               .drag-row-${t.id} td { transform: translateY(var(--row-drag-ty)) !important; transition: none !important; z-index: 1000 !important; position: relative; background: var(--drag-bg) !important; box-shadow: 0 15px 35px rgba(0,0,0,0.5); opacity: 0.95; }
               .drag-active tr[data-row]:not(.dragging-row):nth-child(${idx + 1}) td { transform: translateY(var(--row-shift-${idx})); }
            `).join('\n')}

            /* 非拖拽粘性列的层级管理 */
            .drag-active th:first-child, .drag-active td:first-child { z-index: 60; }
            .drag-active th:last-child, .drag-active td:last-child { z-index: 100; }
            
            /* 再次确保拖拽单元格在顶层 */
            .dragging-row td { z-index: 1000 !important; }
          `}</style>

          <table className="w-full text-sm text-left border-separate border-spacing-0 min-w-[550px]">
            <thead className="text-xs text-app-subtext uppercase bg-app-bg sticky top-0 z-30 shadow-sm">
              <tr className={activeColId ? `drag-col-${activeColId}` : ''}>
                <th className="p-0 text-center sticky top-0 left-0 z-40 bg-app-bg border-b border-r border-app-border w-[40px] min-w-[40px] max-w-[40px] shadow-lg">
                   <span className="font-bold">方向</span>
                </th>
                {columnOrder.map((colKey) => {
                  const col = COLUMN_DEFS[colKey];
                  const isDragging = activeColId === colKey;
                  return (
                    <th key={colKey} data-col={colKey} onPointerDown={(e) => onColPointerDown(e, colKey)} onPointerMove={onColPointerMove} onPointerUp={onColPointerUp} onPointerCancel={onColPointerUp} className={`px-2 py-3 md:px-4 md:py-4 border-b border-app-border bg-app-bg sticky top-0 z-30 cursor-grab active:cursor-grabbing select-none relative touch-none ${isDragging ? 'dragging-cell text-brand-yellow font-bold' : ''}`}>
                      <div className="flex items-center gap-1.5 pointer-events-none"><span className="whitespace-nowrap">{col.label}</span></div>
                      {isDragging && <div className="absolute inset-x-0 -bottom-[1px] h-0.5 bg-brand-yellow" />}
                    </th>
                  );
                })}
                <th className="px-1 py-3 md:py-4 text-center sticky top-0 right-0 z-40 bg-app-bg border-l border-b border-app-border shadow-lg w-[90px]">
                   <button onClick={() => setSortDesc(!sortDesc)} className={`flex items-center justify-center gap-1 w-full py-1.5 rounded-md transition-all text-[11px] font-bold border ${sortDesc ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20 hover:bg-indigo-500/20' : 'bg-brand-green/10 text-brand-green border-brand-green/20 hover:bg-brand-green/20'}`} title={sortDesc ? "当前：最新在最前" : "当前：最早在最前"}>
                     <span>{sortDesc ? "最新→最早" : "最早→最新"}</span>
                   </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleTrades.map((trade, index) => {
                const isDraggingRow = activeRowId === trade.id;
                return (
                  <tr 
                    key={trade.id} 
                    data-row={trade.id}
                    className={`${activeColId ? `drag-col-${activeColId}` : ''} ${isDraggingRow ? `drag-row-${trade.id} dragging-row` : ''} hover:bg-app-hover group transition-colors ${trade.isDisabled ? 'opacity-40 grayscale decoration-app-subtext' : ''}`}
                  >
                    <td 
                      onPointerDown={(e) => onRowPointerDown(e, trade.id)} 
                      onPointerMove={onRowPointerMove} 
                      onPointerUp={onRowPointerUp}
                      onPointerCancel={onRowPointerUp}
                      className="p-0 py-2.5 md:py-3 text-center sticky left-0 z-20 bg-app-card group-hover:bg-app-hover border-r border-b border-app-border shadow-lg transition-colors w-[40px] min-w-[40px] max-w-[40px] cursor-grab active:cursor-grabbing touch-none select-none"
                    >
                       <span className={`inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold mx-auto transition-transform group-hover:scale-110 ${trade.type === 'BUY' ? 'bg-brand-red/10 text-brand-red' : 'bg-brand-green/10 text-brand-green'}`}>{trade.type === 'BUY' ? '买' : '卖'}</span>
                    </td>
                    {columnOrder.map((colKey) => (
                      <td key={colKey} className={`px-2 py-2.5 md:px-4 md:py-3 whitespace-nowrap border-b border-app-border ${activeColId === colKey ? 'dragging-cell' : ''}`}>{COLUMN_DEFS[colKey].render(trade as any)}</td>
                    ))}
                    <td className="px-1 py-2.5 md:py-3 text-center sticky right-0 z-20 bg-app-card group-hover:bg-app-hover border-l border-b border-app-border shadow-lg transition-colors">
                      <div className="flex justify-center gap-1">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdate(trade.id, { isDisabled: !trade.isDisabled });
                          }} 
                          className={`p-1 transition-colors ${trade.isDisabled ? 'text-app-subtext hover:text-app-subtext/70' : 'text-app-subtext hover:text-indigo-400'}`} 
                          title={trade.isDisabled ? "恢复生效" : "暂时失效"}
                        >
                          {trade.isDisabled ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                        <button onClick={(e) => handleEditClick(e, trade.id, 'full')} className={`p-1 transition-colors ${editState?.id === trade.id && editState.mode === 'full' ? 'text-brand-yellow' : 'text-app-subtext hover:text-brand-yellow'}`} title="编辑">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={() => onDelete(trade.id)} className="text-app-subtext hover:text-red-400 transition-colors p-1" title="删除">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {displayTrades.length > 20 && (
              <tfoot>
                <tr>
                  <td colSpan={columnOrder.length + 2} className="p-0 border-b border-app-border bg-app-card hover:bg-app-hover transition-colors">
                    <button 
                      onClick={() => setIsExpanded(!isExpanded)}
                      className="w-full py-3 text-sm text-app-subtext hover:text-app-text flex items-center justify-center gap-2 sticky left-0 right-0"
                    >
                      {isExpanded ? (
                        <>
                          <ChevronUp size={16} />
                          收起列表
                        </>
                      ) : (
                        <>
                          <ChevronDown size={16} />
                          展开全部 ({displayTrades.length} 条记录)
                        </>
                      )}
                    </button>
                  </td>
                </tr>
              </tfoot>
            )}
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
