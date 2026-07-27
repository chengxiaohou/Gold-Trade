import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X, RefreshCw, Edit2, Check, TrendingUp, TrendingDown, Settings, CloudDownload, CloudUpload, Moon, Sun, CheckCircle2, Trash2, GripVertical, RotateCcw, Eye } from 'lucide-react';
import { StockEntry, StockDividendRates, DividendRateColorRange, StockSettings } from '../types';

const TAG_PALETTE = [
  { key: 'gray', label: '灰色', bg: 'bg-gray-500/10', text: 'text-gray-500', border: 'border-gray-500/20', hover: 'hover:border-gray-500/50' },
  { key: 'indigo', label: '默认', bg: 'bg-indigo-500/10', text: 'text-indigo-500', border: 'border-indigo-500/20', hover: 'hover:border-indigo-500/50' },
  { key: 'red', label: '红色', bg: 'bg-red-500/10', text: 'text-red-500', border: 'border-red-500/20', hover: 'hover:border-red-500/50' },
  { key: 'green', label: '绿色', bg: 'bg-green-500/10', text: 'text-green-500', border: 'border-green-500/20', hover: 'hover:border-green-500/50' },
  { key: 'yellow', label: '黄色', bg: 'bg-[var(--soft-yellow-bg)]', text: 'text-brand-softYellow', border: 'border-[var(--soft-yellow-border)]', hover: 'hover:border-[var(--soft-yellow-hover)]' },
  { key: 'blue', label: '蓝色', bg: 'bg-blue-500/10', text: 'text-blue-500', border: 'border-blue-500/20', hover: 'hover:border-blue-500/50' },
  { key: 'orange', label: '橙色', bg: 'bg-orange-500/10', text: 'text-orange-500', border: 'border-orange-500/20', hover: 'hover:border-orange-500/50' },
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

interface EditTagBubbleProps {
  stock: StockEntry;
  availableTags: string[];
  onUpdate: (id: string, updates: Partial<StockEntry>) => void;
  onClose: () => void;
  initialPosition: { top: number, left: number };
  tagColors: Record<string, string>;
  onTagColorChange: (tag: string, colorKey: string) => void;
}

const EditTagBubble: React.FC<EditTagBubbleProps> = ({ 
  stock, availableTags, onUpdate, onClose, initialPosition, tagColors, onTagColorChange 
}) => {
  const initialSnapshot = useRef({
    tag: stock.tag || '',
  });

  const [tagStr, setTagStr] = useState(stock.tag || '');
  
  const currentTagColorKey = tagColors?.[tagStr] || 'gray';
  const [position, setPosition] = useState(initialPosition);
  
  const bubbleRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);

  const handleReset = () => {
    const init = initialSnapshot.current;
    onUpdate(stock.id, { tag: init.tag });
    setTagStr(init.tag);
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
    onUpdate(stock.id, { tag: val });
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
        className="fixed z-[9999] bg-app-card border border-app-border shadow-[0_10px_40px_-10px_rgba(0,0,0,0.7)] rounded-xl w-80 flex flex-col overflow-hidden text-app-text"
        style={{ top: position.top, left: position.left }}
      >
        <div 
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="bg-app-bg/80 backdrop-blur-md p-3 flex justify-between items-center border-b border-white/5 cursor-grab active:cursor-grabbing touch-none select-none group"
        >
          <div className="flex items-center gap-2 text-app-subtext pointer-events-none">
            <h4 className="text-sm font-bold tracking-wider">编辑标签</h4>
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
          <div className="space-y-2">
             <label className="text-xs text-app-subtext font-medium">标签 (Tag)</label>
             <div className="relative">
                <input
                  type="text"
                  value={tagStr}
                  onChange={(e) => handleTagChange(e.target.value)}
                  placeholder="如: 高股息, 长线..."
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
                 
                 <div className="grid grid-cols-8 gap-2">
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
                      const savedColorKey = tagColors?.[tag];
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
      </div>
    </>,
    document.body
  );
};

interface StockDividendPageProps {
  stocks: StockEntry[];
  onStocksChange: (stocks: StockEntry[]) => void;
  isAdding: boolean;
  onCloseAdding: () => void;
  visibleColumns?: string[];
  dividendRateColumns?: string[];
  colorRanges?: DividendRateColorRange[];
  tagColors?: Record<string, string>;
  onTagColorsChange?: (colors: Record<string, string>) => void;
  maxRows?: number;
  actionButtons?: React.ReactNode;
  appVersion?: string;
  onTogglePage?: () => void;
}

const DEFAULT_DIVIDEND_RATES: StockDividendRates = {
  '2%': 0,
  '3%': 0,
  '4%': 0,
  '5%': 0,
  '6%': 0,
  '7%': 0,
};

const calculateDividendRates = (dividend: number, rateColumns: string[] = ['3%', '3.5%', '4%', '4.5%', '5%', '5.5%', '6%', '6.5%', '7%']): StockDividendRates => {
  const rates: StockDividendRates = {};
  rateColumns.forEach(rate => {
    const rateNum = parseFloat(rate) / 100;
    if (!isNaN(rateNum) && rateNum > 0) {
      rates[rate] = dividend / rateNum;
    }
  });
  return rates;
};

const formatPrice = (price: number): string => {
  return price.toFixed(2);
};

const getDividendRateColor = (rate: number, colorRanges: DividendRateColorRange[]): string => {
  if (!rate || rate <= 0) return 'text-app-rowtext';
  const COLOR_MAP: Record<string, string> = {
    'indigo': 'text-indigo-500',
    'gray': 'text-gray-500',
    'red': 'text-red-500',
    'green': 'text-green-500',
    'yellow': 'text-brand-softYellow',
    'blue': 'text-blue-500',
    'orange': 'text-orange-500',
    'pink': 'text-pink-500',
  };
  for (const range of colorRanges) {
    if (rate >= range.min && rate <= range.max) {
      return COLOR_MAP[range.color] || 'text-app-rowtext';
    }
  }
  return 'text-app-rowtext';
};

const formatRelativeTime = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  return `${days}天前`;
};

const formatPercent = (percent: number): string => {
  return percent.toFixed(2) + '%';
};

export const StockDividendPage: React.FC<StockDividendPageProps> = ({ stocks, onStocksChange, isAdding, onCloseAdding, visibleColumns, dividendRateColumns, colorRanges, tagColors = {}, onTagColorsChange, maxRows = 15, actionButtons, appVersion, onTogglePage }) => {
  const defaultVisibleColumns = ['code', 'name', 'price', 'changePercent', 'dividend2024', 'dividend2025', 'dividendRate2025', 'dividendRates'];
  const cols = visibleColumns || defaultVisibleColumns;
  const rateCols = dividendRateColumns || ['3%', '3.5%', '4%', '4.5%', '5%', '5.5%', '6%', '6.5%', '7%'];
  const ranges = colorRanges || [
    { min: 3, max: 4, color: 'red' },
    { min: 4.5, max: 5.5, color: 'gray' },
    { min: 6, max: 7, color: 'green' }
  ];
  
  const latestUpdateTime = stocks.reduce((max, stock) => Math.max(max, stock.priceUpdatedAt || 0), 0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showRatesId, setShowRatesId] = useState<string | null>(null);
  const [ratesPopupPos, setRatesPopupPos] = useState<{ top: number, left: number }>({ top: 0, left: 0 });
  const [newStock, setNewStock] = useState({
    code: '',
    name: '',
  });
  const [isRefreshing, setIsRefreshing] = useState<Set<string>>(new Set());
  const [refreshFailed, setRefreshFailed] = useState<Set<string>>(new Set());
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [editTagState, setEditTagState] = useState<{ id: string, top: number, left: number } | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    stocks.forEach(s => { if (s.tag && s.tag.trim()) tags.add(s.tag.trim()); });
    return Array.from(tags).sort();
  }, [stocks]);

  const handleEditTagClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const width = 288;
    let left = rect.left;
    let top = rect.bottom + 8;
    
    if (left < 10) left = 10;
    if (left + width > window.innerWidth) left = window.innerWidth - width - 10;
    
    const bubbleHeight = 280;
    if (top + bubbleHeight > window.innerHeight) {
      top = rect.top - bubbleHeight - 8;
    }
    setEditTagState({ id, top, left });
  };

  const handleTagColorChange = (tag: string, colorKey: string) => {
    const newColors = { ...tagColors, [tag]: colorKey };
    onTagColorsChange?.(newColors);
  };

  useEffect(() => {
    localStorage.setItem('stock_dividend_stocks', JSON.stringify(stocks));
  }, [stocks]);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedId && draggedId !== id) {
      setDragOverId(id);
    }
  };

  const handleDragLeave = () => {
    setDragOverId(null);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }

    const draggedIndex = stocks.findIndex(s => s.id === draggedId);
    const targetIndex = stocks.findIndex(s => s.id === targetId);

    if (draggedIndex !== -1 && targetIndex !== -1) {
      const newStocks = [...stocks];
      const [draggedItem] = newStocks.splice(draggedIndex, 1);
      newStocks.splice(targetIndex, 0, draggedItem);
      onStocksChange(newStocks);
    }

    setDraggedId(null);
    setDragOverId(null);
  };

  const getFullCode = (inputCode: string): string => {
    const code = inputCode.trim().toUpperCase();
    if (code.includes('.SH') || code.includes('.SZ')) {
      return code;
    }
    const numCode = parseInt(code, 10);
    if (isNaN(numCode)) return code;
    if (numCode >= 600000) return `${code}.SH`;
    if (numCode >= 1 && numCode <= 4999) return `${code}.SZ`;
    if (numCode >= 300000 && numCode <= 399999) return `${code}.SZ`;
    if (numCode >= 688000 && numCode <= 699999) return `${code}.SH`;
    if (numCode >= 430000 && numCode <= 439999) return `${code}.SZ`;
    return `${code}.SH`;
  };

  const getDisplayCode = (fullCode: string): string => {
    return fullCode.replace('.SH', '').replace('.SZ', '');
  };

  const fetchStockPrice = useCallback(async (stockCode: string): Promise<{
    price: number;
    name: string;
    changePercent: number;
    high: number;
    low: number;
  } | null> => {
    try {
      let market = 'sh';
      let code = stockCode;
      
      if (code.endsWith('.SZ')) {
        market = 'sz';
        code = code.replace('.SZ', '');
      } else if (code.endsWith('.SH')) {
        code = code.replace('.SH', '');
      } else if (parseInt(code) >= 300000 || parseInt(code) >= 2000) {
        market = 'sz';
      }
      
      const url = `https://qt.gtimg.cn/q=${market}${code}`;
      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      const decoder = new TextDecoder('gb18030');
      const text = decoder.decode(buffer);
      
      const match = text.match(/v_\w+="([^"]+)"/);
      if (match && match[1]) {
        const data = match[1].split('~');
        if (data.length >= 11) {
          const price = parseFloat(data[3]);
          const prevClose = parseFloat(data[4]);
          const high = parseFloat(data[5]);
          const low = parseFloat(data[6]);
          let changePercent = 0;
          
          if (prevClose > 0) {
            changePercent = ((price - prevClose) / prevClose) * 100;
          }
          
          return {
            name: data[1].replace(/\s/g, ''),
            price: price,
            changePercent: changePercent,
            high: high || price,
            low: low || price,
          };
        }
      }
      return null;
    } catch (error) {
      console.error('获取股价失败:', error);
      return null;
    }
  }, []);

  const handleRefreshPrice = useCallback(async (id: string) => {
    const stock = stocks.find(s => s.id === id);
    if (!stock) return;

    setIsRefreshing(prev => new Set(prev).add(id));
    setRefreshFailed(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    try {
      const result = await fetchStockPrice(stock.code);
      if (result) {
        const dividendRate = result.price > 0 ? (stock.dividend2025 / result.price) * 100 : 0;
        onStocksChange(stocks.map(s => 
          s.id === id ? {
            ...s,
            price: result.price,
            changePercent: result.changePercent,
            priceUpdatedAt: Date.now(),
            dividendRate2025: dividendRate,
          } : s
        ));
      } else {
        setRefreshFailed(prev => new Set(prev).add(id));
      }
    } catch {
      setRefreshFailed(prev => new Set(prev).add(id));
    } finally {
      setIsRefreshing(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, [stocks, onStocksChange, fetchStockPrice]);

  const handleRefreshAll = useCallback(async () => {
    setIsRefreshing(new Set(stocks.map(s => s.id)));
    setRefreshFailed(new Set());
    try {
      const updatedStocks = [...stocks];
      const failedIds = new Set<string>();
      for (let i = 0; i < updatedStocks.length; i++) {
        const stock = updatedStocks[i];
        const result = await fetchStockPrice(stock.code);
        if (result) {
          const dividendRate = result.price > 0 ? (stock.dividend2025 / result.price) * 100 : 0;
          updatedStocks[i] = {
            ...updatedStocks[i],
            price: result.price,
            changePercent: result.changePercent,
            priceUpdatedAt: Date.now(),
            dividendRate2025: dividendRate,
          };
        } else {
          failedIds.add(stock.id);
        }
      }
      onStocksChange(updatedStocks);
      if (failedIds.size > 0) {
        setRefreshFailed(failedIds);
      }
    } catch {
      setRefreshFailed(new Set(stocks.map(s => s.id)));
    } finally {
      setIsRefreshing(new Set());
    }
  }, [stocks, onStocksChange, fetchStockPrice]);

  const handleAddStock = useCallback(async () => {
    if (!newStock.code.trim()) return;

    const stockCode = getFullCode(newStock.code);
    const existing = stocks.find(s => s.code.toLowerCase() === stockCode.toLowerCase());
    if (existing) {
      alert('该股票已存在');
      return;
    }

    setIsRefreshing(new Set(['new']));
    try {
      let result = null;
      result = await fetchStockPrice(stockCode);

      const dividend2024 = 0;
      const dividend2025 = 0;

      const newEntry: StockEntry = {
        id: Date.now().toString(),
        code: stockCode,
        name: newStock.name || result?.name || stockCode,
        price: result?.price || 0,
        changePercent: result?.changePercent || 0,
        high: result?.high || 0,
        low: result?.low || 0,
        dividend2024,
        dividend2025,
        dividendRate2025: 0,
        priceUpdatedAt: result ? Date.now() : null,
        dividendRates: calculateDividendRates(dividend2025),
      };

      onStocksChange([...stocks, newEntry]);
      setNewStock({ code: '', name: '' });
      onCloseAdding();
    } catch {
      alert('添加股票失败');
    } finally {
      setIsRefreshing(new Set());
    }
  }, [newStock, stocks, onStocksChange, fetchStockPrice]);

  const handleDeleteStock = useCallback((id: string) => {
    onStocksChange(stocks.filter(s => s.id !== id));
    if (editingId === id) {
      setEditingId(null);
    }
  }, [stocks, onStocksChange, editingId]);

  const handleUpdateField = useCallback((id: string, field: keyof StockEntry, value: string | number) => {
    onStocksChange(stocks.map(s => {
      if (s.id !== id) return s;
      
      let newValue = value;
      if (field === 'code' && typeof value === 'string') {
        newValue = getFullCode(value);
      }
      
      let newStock = { ...s, [field]: newValue };
      
      if (field === 'dividend2025') {
        const dividend = typeof value === 'number' ? value : parseFloat(value) || 0;
        newStock.dividendRates = calculateDividendRates(dividend);
        newStock.dividendRate2025 = s.price > 0 ? (dividend / s.price) * 100 : 0;
      }
      
      return newStock;
    }));
  }, [stocks, onStocksChange]);

  const formatUpdateTime = (timestamp: number | null): string => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  };

  return (
    <div className="flex flex-col gap-3 w-full">
      <div className="flex justify-center">
        <div className="w-full max-w-[700px] flex items-center justify-between">
          <h1 className="text-3xl font-bold text-app-subtext tracking-wide">股息率一览</h1>
          <div className="flex items-center gap-3">
            {appVersion && <span className="text-[10px] text-white/[0.01] font-mono select-all hover:text-app-text ml-1">{appVersion}</span>}
            {onTogglePage && (
              <button
                onClick={onTogglePage}
                className="text-[10px] text-white/[0.01] font-mono select-all hover:text-app-text ml-1 transition-colors"
                title="切换到黄金交易模拟"
              >
                [黄金]
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="flex justify-center">
        <div className="bg-app-card border border-app-border rounded-xl overflow-hidden shadow-sm w-full max-w-[700px]">
          <div 
            ref={scrollContainerRef}
            className="overflow-x-auto custom-scrollbar"
            style={{ 
              maxHeight: maxRows > 0 ? `${maxRows * 32 + 48}px` : 'none',
              overflowY: maxRows > 0 ? 'auto' : 'visible',
              WebkitOverflowScrolling: 'touch',
              scrollbarWidth: 'none',
              msOverflowStyle: 'none'
            }}
          >
            <style>{`
              .custom-scrollbar::-webkit-scrollbar {
                display: none;
              }
            `}</style>
            <table className="text-sm border-separate border-spacing-0 w-full" style={{ tableLayout: 'auto' }}>
            <colgroup>
              <col style={{ width: '36px' }} />
              {(cols.includes('code') || cols.includes('name')) && <col style={{ width: '90px' }} />}
              {cols.includes('dividendRate2025') && <col style={{ width: '55px' }} />}
              {cols.includes('price') && <col style={{ width: '75px' }} />}
              {cols.includes('changePercent') && <col style={{ width: '55px' }} />}
              {cols.includes('dividend2024') && <col style={{ width: '50px' }} />}
              {cols.includes('dividend2025') && <col style={{ width: '50px' }} />}
              <col style={{ width: '60px' }} />
            </colgroup>
            <thead className="sticky top-0 z-30 overflow-hidden">
              <tr className="bg-app-input">
                <th className="px-1 py-2 text-center text-xs uppercase font-bold text-app-subtext tracking-wider border-b border-app-border border-r border-app-border bg-app-input whitespace-nowrap sticky left-0 z-20" rowSpan={2}>标签</th>
                {(cols.includes('code') || cols.includes('name')) && <th className="px-2 py-2 text-center text-xs uppercase font-bold text-app-subtext tracking-wider border-b border-app-border border-r border-app-border bg-app-input whitespace-nowrap sticky left-[36px] z-10">股票名称</th>}
                {cols.includes('dividendRate2025') && <th className="px-1 py-2 text-center text-xs uppercase font-bold text-app-subtext tracking-wider border-b border-app-border border-r border-app-border bg-app-input whitespace-nowrap">股息率</th>}
                {cols.includes('price') && <th className="px-1 py-2 text-center text-xs uppercase font-bold text-app-subtext tracking-wider border-b border-app-border border-r border-app-border bg-app-input whitespace-nowrap">
                    <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                      价格
                      <button
                        onClick={handleRefreshAll}
                        disabled={isRefreshing.size > 0}
                        className="p-0.5 hover:bg-app-card rounded transition-colors disabled:opacity-50"
                        title="刷新所有股价"
                      >
                        <RefreshCw size={10} className={isRefreshing.size > 0 ? 'animate-spin' : ''} />
                      </button>
                    </div>
                  </th>}
                {cols.includes('changePercent') && <th className="px-1 py-2 text-center text-xs uppercase font-bold text-app-subtext tracking-wider border-b border-app-border border-r border-app-border bg-app-input whitespace-nowrap">涨跌幅</th>}
                {cols.includes('dividend2024') && <th className="px-1 py-2 text-center text-xs uppercase font-bold text-app-subtext tracking-wider border-b border-app-border border-r border-app-border bg-app-input whitespace-nowrap">分红</th>}
                {cols.includes('dividend2025') && <th className="px-1 py-2 text-center text-xs uppercase font-bold text-app-subtext tracking-wider border-b border-app-border bg-app-input whitespace-nowrap">分红</th>}
                <th className="px-1 py-2 text-center text-xs uppercase font-bold text-app-subtext tracking-wider bg-app-input whitespace-nowrap border-b border-app-border border-l border-app-border" rowSpan={2}>操作</th>
              </tr>
              <tr className="bg-app-input">
                {(cols.includes('code') || cols.includes('name')) && <th className="px-2 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border sticky left-[36px] z-10">代码</th>}
                {(cols.includes('dividendRate2025') || cols.includes('price') || cols.includes('changePercent')) && <th colSpan={3} className="px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border whitespace-nowrap">{latestUpdateTime > 0 ? formatRelativeTime(latestUpdateTime) : '--'}</th>}
                {cols.includes('dividend2024') && <th className="px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border">2024</th>}
                {cols.includes('dividend2025') && <th className="px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border">2025</th>}
              </tr>
            </thead>
            <tbody>
              {stocks.map(stock => (
                <tr 
                  key={stock.id} 
                  className={`group border-t border-app-border hover:bg-app-hover transition-colors ${dragOverId === stock.id ? 'bg-brand-yellow/10' : ''}`}
                >
                  <td 
                    className={`px-1 py-1.5 align-middle sticky left-0 z-20 bg-app-card group-hover:bg-app-hover border-r border-app-border transition-colors ${draggedId === stock.id ? 'opacity-50' : ''}`}
                  >
                    <div 
                      onClick={(e) => handleEditTagClick(e, stock.id)}
                      className="cursor-pointer group/tag flex justify-center"
                      title="点击编辑标签"
                    >
                      {(() => {
                        const displayTag = stock.tag || '-';
                        let style = EMPTY_STYLE;
                        if (stock.tag) {
                          const colorKey = tagColors?.[stock.tag];
                          style = getTagStyle(colorKey);
                        }
                        return (
                          <span className={`inline-flex items-center justify-center w-[20px] h-[20px] rounded text-[9px] font-medium transition-colors border ${style.bg} ${style.text} ${style.border} ${style.hover || ''}`}>
                            {displayTag}
                          </span>
                        );
                      })()}
                    </div>
                  </td>
                  {(cols.includes('code') || cols.includes('name')) && <td 
                    className={`px-1 py-1.5 align-middle sticky left-[36px] z-10 bg-app-card group-hover:bg-app-hover cursor-move touch-none border-r border-app-border transition-colors ${draggedId === stock.id ? 'opacity-50' : ''}`}
                    draggable
                    onDragStart={(e) => handleDragStart(e, stock.id)}
                    onDragOver={(e) => handleDragOver(e, stock.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, stock.id)}
                  >
                    <div className="flex items-center justify-center gap-1 w-full">
                      {editingId === stock.id ? (
                        <div className="flex flex-col gap-0.5">
                          {cols.includes('name') && <input
                            type="text"
                            value={stock.name}
                            onChange={(e) => handleUpdateField(stock.id, 'name', e.target.value)}
                            className="w-full bg-app-input border border-indigo-500 rounded px-0.5 py-0.5 text-[10px] leading-tight text-app-text outline-none"
                          />}
                          {cols.includes('code') && <input
                            type="text"
                            value={getDisplayCode(stock.code)}
                            onChange={(e) => handleUpdateField(stock.id, 'code', e.target.value.toUpperCase())}
                            className="w-full bg-app-input border border-indigo-500 rounded px-0.5 py-0.5 text-[9px] leading-tight font-mono text-app-text outline-none"
                          />}
                        </div>
                      ) : (
                        <div className="relative flex items-center justify-center h-8 whitespace-nowrap">
                          <span className={`text-[11px] font-bold leading-none ${getDividendRateColor(stock.dividendRate2025, ranges)}`}>{(() => { const n = stock.name.replace(/\s/g, ''); return n.length > 4 ? n.slice(0, 4) + '…' : n; })()}</span>
                          <span className="font-mono text-[8px] leading-none text-app-rowtext absolute bottom-0 left-0 right-0 text-center" style={{ opacity: 0.6 }}>{getDisplayCode(stock.code)}</span>
                        </div>
                      )}
                    </div>
                  </td>}
                  {cols.includes('dividendRate2025') && <td className="px-1 py-1.5 text-center border-r border-app-border">
                    <span className={`font-mono text-xs font-bold ${getDividendRateColor(stock.dividendRate2025, ranges)}`}>
                      {stock.dividendRate2025 > 0 ? formatPercent(stock.dividendRate2025) : '--'}
                    </span>
                  </td>}
                  {cols.includes('price') && <td className="px-1 py-1.5 text-center border-r border-app-border">
                    <div className="flex items-center justify-center gap-0.5">
                      <span className={`font-mono text-xs font-bold ${stock.changePercent >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>
                        {formatPrice(stock.price)}
                      </span>
                      {refreshFailed.has(stock.id) && (
                        <button
                          onClick={() => handleRefreshPrice(stock.id)}
                          className="p-0.5 hover:bg-app-input rounded transition-colors"
                          title="重新刷新股价"
                        >
                          <RefreshCw size={10} className="text-brand-yellow" />
                        </button>
                      )}
                    </div>
                  </td>}
                  {cols.includes('changePercent') && <td className="px-1 py-1.5 text-center border-r border-app-border">
                    <span className={`font-mono text-xs font-bold ${stock.changePercent >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>
                      {stock.changePercent >= 0 ? '+' : ''}{formatPercent(stock.changePercent)}
                    </span>
                  </td>}
                  {cols.includes('dividend2024') && <td className="px-1 py-1.5 text-center border-r border-app-border">
                    {editingId === stock.id ? (
                      <input
                        type="number"
                        value={stock.dividend2024}
                        onChange={(e) => handleUpdateField(stock.id, 'dividend2024', parseFloat(e.target.value) || 0)}
                        step="0.01"
                        className="w-full bg-app-input border border-indigo-500 rounded px-0.5 py-0.5 text-[10px] leading-tight font-mono text-app-text outline-none text-center"
                      />
                    ) : (
                      <span className="font-mono text-[11px] text-app-rowtext">{formatPrice(stock.dividend2024)}</span>
                    )}
                  </td>}
                  {cols.includes('dividend2025') && <td className="px-1 py-1.5 text-center">
                    {editingId === stock.id ? (
                      <input
                        type="number"
                        value={stock.dividend2025}
                        onChange={(e) => handleUpdateField(stock.id, 'dividend2025', parseFloat(e.target.value) || 0)}
                        step="0.01"
                        className="w-full bg-app-input border border-indigo-500 rounded px-0.5 py-0.5 text-[10px] leading-tight font-mono text-app-text outline-none text-center"
                      />
                    ) : (
                      <span className="font-mono text-xs text-app-rowtext">{formatPrice(stock.dividend2025)}</span>
                    )}
                  </td>}
                  <td className="px-1 py-1.5 text-center border-l border-app-border">
                    <div className="flex items-center justify-center gap-0.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          setShowRatesId(stock.id);
                          setRatesPopupPos({
                            top: rect.bottom + 8,
                            left: Math.min(rect.right + 8, window.innerWidth - 280)
                          });
                        }}
                        className={`p-0.5 rounded transition-colors ${showRatesId === stock.id ? 'bg-indigo-500/20 text-indigo-400' : 'text-app-subtext hover:bg-app-input'}`}
                        title="股息率对应股价"
                      >
                        <Eye size={12} />
                      </button>
                      {editingId === stock.id ? (
                        <button
                          onClick={() => setEditingId(null)}
                          className="p-0.5 hover:bg-app-input rounded transition-colors"
                          title="保存"
                        >
                          <Check size={12} className="text-brand-green" />
                        </button>
                      ) : (
                        <button
                          onClick={() => setEditingId(stock.id)}
                          className="p-0.5 hover:bg-app-input rounded transition-colors"
                          title="编辑"
                        >
                          <Edit2 size={12} className="text-app-subtext" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteStock(stock.id)}
                        className="text-app-subtext hover:text-red-400 transition-colors p-0.5"
                        title="删除"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {stocks.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-app-subtext text-sm">
                    暂无股票数据，点击上方按钮添加股票
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {actionButtons && (
          <div className="flex justify-end p-3 border-t border-app-border bg-app-card">
            {actionButtons}
          </div>
        )}
        </div>
      </div>

      {isAdding && createPortal(
        <>
          <div 
            className="fixed inset-0 z-40"
            onClick={() => {
              onCloseAdding();
              setNewStock({ code: '', name: '' });
            }}
          />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-app-card border border-app-border rounded-xl p-4 w-[320px] shadow-2xl">
            <div className="text-sm font-bold text-app-text mb-3">添加股票</div>
            <div className="space-y-2">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-app-subtext tracking-wider ml-0.5">股票代码</label>
                <input
                  type="text"
                  value={newStock.code}
                  onChange={(e) => setNewStock(prev => ({ ...prev, code: e.target.value }))}
                  placeholder="如 600519（自动识别市场）"
                  className="w-full bg-app-input border border-app-border rounded-lg px-3 py-2 text-app-text font-mono text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 outline-none transition-all"
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-app-subtext tracking-wider ml-0.5">股票名称</label>
                <input
                  type="text"
                  value={newStock.name}
                  onChange={(e) => setNewStock(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="可选"
                  className="w-full bg-app-input border border-app-border rounded-lg px-3 py-2 text-app-text font-mono text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 outline-none transition-all"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => {
                  onCloseAdding();
                  setNewStock({ code: '', name: '' });
                }}
                className="flex-1 py-2 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 transform active:scale-[0.98] border border-app-border text-app-subtext hover:bg-app-input hover:text-app-text"
              >
                取消
              </button>
              <button
                onClick={handleAddStock}
                disabled={!newStock.code.trim() || isRefreshing.has('new')}
                className="flex-1 py-2 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 transform active:scale-[0.98] disabled:opacity-50 bg-brand-yellow text-slate-900 hover:bg-[#fdd835]"
              >
                <Plus size={14} />添加
              </button>
            </div>
          </div>
        </>,
        document.body
      )}

      <div className="flex justify-center">
        <div className="bg-app-card border border-app-border rounded-xl p-4 max-w-[700px] w-full">
          <div className="text-xs text-app-subtext">
            <p className="mb-2">计算公式：<span className="font-mono">股价 = 分红金额 / 股息率</span></p>
            <p>例如：分红 ¥2.00，股息率 5%，对应股价 = 2.00 / 0.05 = ¥40.00</p>
            <p className="mt-2 text-[10px] opacity-70">股息率(2025) = 分红(2025) / 当前股价 × 100%</p>
          </div>
        </div>
      </div>

      {editTagState && (
        <EditTagBubble 
          stock={stocks.find(s => s.id === editTagState.id)!}
          availableTags={availableTags}
          onUpdate={(id, updates) => onStocksChange(stocks.map(s => s.id === id ? { ...s, ...updates } : s))}
          onClose={() => setEditTagState(null)}
          initialPosition={{ top: editTagState.top, left: editTagState.left }}
          tagColors={tagColors}
          onTagColorChange={handleTagColorChange}
        />
      )}

      {showRatesId && (() => {
        const stock = stocks.find(s => s.id === showRatesId);
        if (!stock) return null;
        return createPortal(
          <>
            <div 
              className="fixed inset-0 z-40"
              onClick={() => setShowRatesId(null)}
            />
            <div 
              className="fixed z-50 bg-app-card border border-app-border rounded-lg shadow-xl p-3 w-64"
              style={{ top: ratesPopupPos.top, left: ratesPopupPos.left }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-app-text">{stock.name}</span>
                <button
                  onClick={() => setShowRatesId(null)}
                  className="p-0.5 hover:bg-app-input rounded transition-colors"
                >
                  <X size={14} className="text-app-subtext" />
                </button>
              </div>
              <div className="text-[10px] text-app-subtext mb-2">
                股息率对应股价（基于2025年分红 ¥{formatPrice(stock.dividend2025)}）
              </div>
              <div className="grid grid-cols-3 gap-1">
                {(() => {
                  const minRate = Math.min(...rateCols.map(r => parseFloat(r.replace('%', ''))));
                  const maxRate = Math.max(...rateCols.map(r => parseFloat(r.replace('%', ''))));
                  const currentRate = stock.dividendRate2025;
                  const highlightIdx = currentRate <= minRate ? 0 : currentRate >= maxRate ? rateCols.length - 1 : rateCols.findIndex((rate, idx) => {
                    const rateNum = parseFloat(rate.replace('%', ''));
                    const nextRateNum = idx < rateCols.length - 1 ? parseFloat(rateCols[idx + 1].replace('%', '')) : Infinity;
                    return currentRate >= rateNum && currentRate < nextRateNum;
                  });
                  const rateColorClass = highlightIdx >= 0 ? getDividendRateColor(currentRate, ranges) : '';
                  return rateCols.map((rate, idx) => {
                    const price = stock.dividendRates[rate] || 0;
                    const isCurrentRate = idx === highlightIdx;
                    return (
                      <div key={rate} className={`flex flex-col items-center p-1 rounded ${isCurrentRate ? 'bg-indigo-500/10 ring-1 ring-indigo-500/30' : 'bg-app-input'}`}>
                        <span className={`text-[10px] ${isCurrentRate ? rateColorClass : 'text-app-subtext'}`}>{rate}</span>
                        <span className={`font-mono text-xs font-bold ${isCurrentRate ? rateColorClass : 'text-app-text'}`}>
                          {formatPrice(price)}
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </>,
          document.body
        );
      })()}
    </div>
  );
};