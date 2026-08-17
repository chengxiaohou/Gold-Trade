import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X, RefreshCw, Edit2, Check, TrendingUp, TrendingDown, Settings, CloudDownload, CloudUpload, Moon, Sun, CheckCircle2, Trash2, GripVertical, RotateCcw, Eye, EyeOff, Download, BarChart3, List, ChevronDown, Copy } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { StockEntry, StockDividendRates, DividendRateColorRange, StockSettings, ApiSource } from '../types';
import { fetchBollData, checkAllBollCache, countStaleBollCache, BollData, BollPeriod, BollAdjust } from '../services/bollService';
import { isStockPriceFresh, isTradingHours, getDynamicBollCacheTTL } from '../services/cacheService';
import { requestLogService, RequestLogEntry, RequestLogStats, type LogBatchContext } from '../services/requestLogService';
import { fetchYearlyDividends, DividendRecord } from '../services/dividendService';
import { getNickname } from '../services/nicknameService';

const TAG_PALETTE = [
  { key: 'gray', label: '灰色', bg: 'bg-gray-500/10', text: 'text-gray-500', border: 'border-gray-500/20', hover: 'hover:border-gray-500/50' },
  { key: 'indigo', label: '默认', bg: 'bg-indigo-500/10', text: 'text-indigo-500', border: 'border-indigo-500/20', hover: 'hover:border-indigo-500/50' },
  { key: 'red', label: '红色', bg: 'bg-red-500/10', text: 'text-red-500', border: 'border-red-500/20', hover: 'hover:border-red-500/50' },
  { key: 'green', label: '绿色', bg: 'bg-brand-green/10', text: 'text-brand-green', border: 'border-brand-green/20', hover: 'hover:border-brand-green/50' },
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
  apiSource?: ApiSource;
  onResetStocks?: () => void;
  resetSignal?: number;
  dividendYearLeft?: number;
  dividendYearRight?: number;
  sortMode?: 'default' | 'dividendRate' | 'tag';
  onSortModeChange?: (mode: 'default' | 'dividendRate' | 'tag') => void;
}

// 分红核对弹窗里的单只股票差异条目
interface DividendDiffEntry {
  stockId: string;
  code: string;
  name: string;
  current2024: number;
  current2025: number;
  fetched2024: number | null; // null = 查不到
  fetched2025: number | null;
  fetchedDividendByYear: Record<number, number>;
  hasData: boolean;
  error?: string;
  records: DividendRecord[];
}

// 持仓列展示模式（表头按钮循环切换）
type PositionDisplayMode = 'yield' | 'shares' | 'cost';
const POSITION_MODE_LABEL: Record<PositionDisplayMode, string> = {
  yield: '股息率',
  shares: '股数',
  cost: '成本',
};

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

// 分红核对弹窗：单个年份的单元格（现值 → 查到值）
const formatDividendCell = (current: number, fetched: number | null, hasData: boolean) => {
  if (!hasData) return <span className="text-app-subtext">-</span>;
  const diff = Math.abs((fetched ?? 0) - current) > 0.0001;
  if (!diff) return <span className="text-app-rowtext">{current.toFixed(4)}</span>;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="text-app-subtext line-through">{current.toFixed(4)}</span>
      <span className="text-indigo-400 font-bold">→{(fetched ?? 0).toFixed(4)}</span>
    </span>
  );
};

// 根据名称判断：ETF 显示 3 位小数，普通股票显示 2 位小数
const formatPrice = (price: number, name?: string): string => {
  const isETF = name?.includes('ETF') || name?.includes('etf');
  return isETF ? price.toFixed(3) : price.toFixed(2);
};

const formatFetchTime = (timestamp: number): string => {
  if (!timestamp || timestamp < 1000000000000) return '-';
  const now = Date.now();
  const diff = now - timestamp;
  
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))}分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))}小时前`;
  
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

interface BollPosition {
  band: 'upper' | 'mid' | 'lower';
  percent: number;
}

const getBollPosition = (data: BollData | null, currentPrice: number): BollPosition | null => {
  if (!data || !currentPrice) return null;
  
  const { upper, mid, lower } = data;
  
  if (currentPrice >= upper) {
    return { band: 'upper', percent: ((currentPrice - upper) / upper) * 100 };
  } else if (currentPrice <= lower) {
    return { band: 'lower', percent: ((currentPrice - lower) / lower) * 100 };
  } else {
    const distToUpper = Math.abs(currentPrice - upper);
    const distToMid = Math.abs(currentPrice - mid);
    const distToLower = Math.abs(currentPrice - lower);
    
    if (distToUpper <= distToMid && distToUpper <= distToLower) {
      return { band: 'upper', percent: ((currentPrice - upper) / upper) * 100 };
    } else if (distToMid <= distToLower) {
      return { band: 'mid', percent: ((currentPrice - mid) / mid) * 100 };
    } else {
      return { band: 'lower', percent: ((currentPrice - lower) / lower) * 100 };
    }
  }
};

const getBollBandLabel = (period: BollPeriod, band: BollPosition['band']): string => {
  const periodMap: Record<BollPeriod, string> = { daily: '日', weekly: '周', monthly: '月' };
  const bandMap = { upper: '上', mid: '中', lower: '下' };
  return `${periodMap[period]}${bandMap[band]}`;
};

const getDividendRateColor = (rate: number, colorRanges: DividendRateColorRange[]): string => {
  if (!rate || rate <= 0) return 'text-app-rowtext';
  const COLOR_MAP: Record<string, string> = {
    'indigo': 'text-indigo-500',
    'gray': 'text-gray-500',
    'red': 'text-red-500',
    'green': 'text-brand-green',
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

export const StockDividendPage: React.FC<StockDividendPageProps> = ({ stocks, onStocksChange, isAdding, onCloseAdding, visibleColumns, dividendRateColumns, colorRanges, tagColors = {}, onTagColorsChange, maxRows = 15, actionButtons, appVersion, onTogglePage, apiSource = 'tencent' as ApiSource, onResetStocks, resetSignal, dividendYearLeft = 2024, dividendYearRight = 2025, sortMode = 'default', onSortModeChange }) => {
  const defaultVisibleColumns = ['code', 'name', 'price', 'changePercent', 'dividendLeft', 'dividendRight', 'position', 'dividendRate', 'dividendRates'];
  const cols = visibleColumns || defaultVisibleColumns;
  // 分红年份列（dividendLeft / dividendRight）：表头合并为一格，年份各自成列
  const dividendYearCols = cols.filter(c => c === 'dividendLeft' || c === 'dividendRight');
  // 获取某年的分红金额（优先从 dividendByYear 取，兼容旧数据）
  const getDividendForYear = (stock: StockEntry, year: number): number => {
    if (stock.dividendByYear && stock.dividendByYear[year] !== undefined) {
      return stock.dividendByYear[year];
    }
    // 兼容旧数据
    if (year === 2024) return stock.dividend2024 || 0;
    if (year === 2025) return stock.dividend2025 || 0;
    return 0;
  };

  // 获取该股票选中的分红年份（默认使用右年份）
  const getSelectedYear = (stock: StockEntry): number => {
    return stock.selectedDividendYear ?? dividendYearRight;
  };

  // 计算股息率（基于选中年份的分红）
  const getDividendRate = (stock: StockEntry): number => {
    const year = getSelectedYear(stock);
    const dividend = getDividendForYear(stock, year);
    return stock.price > 0 ? (dividend / stock.price) * 100 : 0;
  };
  const rateCols = dividendRateColumns || ['3%', '3.5%', '4%', '4.5%', '5%', '5.5%', '6%', '6.5%', '7%'];
  // 中文字符按2列宽计算，用于等宽字体对齐
  const visualPad = (s: string, len: number) => {
    let w = 0;
    for (const ch of s) w += ch.charCodeAt(0) > 127 ? 2 : 1;
    return s + ' '.repeat(Math.max(0, len - w));
  };
  const ranges = colorRanges || [
    { min: 3, max: 4, color: 'red' },
    { min: 4.5, max: 5.5, color: 'gray' },
    { min: 6, max: 7, color: 'green' }
  ];
  
  const latestUpdateTime = stocks.reduce((max, stock) => Math.max(max, stock.priceUpdatedAt || 0), 0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showRatesId, setShowRatesId] = useState<string | null>(null);
  const [ratesPopupPos, setRatesPopupPos] = useState<{ top: number, left: number }>({ top: 0, left: 0 });
  const ratesPopupRef = useRef<HTMLDivElement>(null);
  const ratesDragOffset = useRef({ x: 0, y: 0 });
  const isRatesDragging = useRef(false);
  const [newStock, setNewStock] = useState({
    code: '',
    name: '',
  });
  const [isRefreshing, setIsRefreshing] = useState<Set<string>>(new Set());
  const [refreshFailed, setRefreshFailed] = useState<Set<string>>(new Set());
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [editTagState, setEditTagState] = useState<{ id: string, top: number, left: number } | null>(null);
  const [deletingStockId, setDeletingStockId] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  // 分红自动获取状态
  const [isFetchingDividends, setIsFetchingDividends] = useState(false);
  const [isFetchingSingleDividend, setIsFetchingSingleDividend] = useState<string | null>(null);
  const [dividendDiff, setDividendDiff] = useState<DividendDiffEntry[] | null>(null);
  const [selectedDividendIds, setSelectedDividendIds] = useState<Set<string>>(new Set());
  // 持仓列当前展示的数据类型（默认股息率）
  const [positionDisplayMode, setPositionDisplayMode] = useState<PositionDisplayMode>('yield');
  // 股票名称/代号显示切换（默认显示股票名称）
  const [showNickname, setShowNickname] = useState(false);

  useEffect(() => {
    if (resetSignal !== undefined && resetSignal > 0) {
      setShowResetConfirm(true);
    }
  }, [resetSignal]);
  const handleSortModeChange = (mode: 'default' | 'dividendRate' | 'tag') => {
    if (onSortModeChange) onSortModeChange(mode);
  };
  const [bollData, setBollData] = useState<BollData | null>(null);
  const [bollError, setBollError] = useState<string | null>(null);
  const [bollUnsupported, setBollUnsupported] = useState<boolean>(false);
  const [bollPeriod, setBollPeriod] = useState<BollPeriod>('daily');
  const [bollAdjust, setBollAdjust] = useState<BollAdjust>('qfq');

  const [srPreviewText, setSrPreviewText] = useState<string | null>(null);
  const [srTooltipOffset, setSrTooltipOffset] = useState(0);
  const [srTooltipAbove, setSrTooltipAbove] = useState(true);
  const srBtnRef = useRef<HTMLButtonElement | null>(null);
  const srHoveredRef = useRef(false);
  const [srCopied, setSrCopied] = useState(false);
  const [srTooltipPinned, setSrTooltipPinned] = useState(false);
  const srTooltipRef = useRef<HTMLDivElement | null>(null);
  const maBollLabelRef = useRef<HTMLSpanElement | null>(null);
  const srTooltipMeasuredSize = useRef({ w: 0, h: 0 });
  const [copyPreviewText, setCopyPreviewText] = useState<string | null>(null);
  const copyHoveredRef = useRef(false);
  const [copyPreviewPos, setCopyPreviewPos] = useState({ left: 0, top: 0 });
  const [srTooltipHidden, setSrTooltipHidden] = useState(false);

  const [stockBollMap, setStockBollMap] = useState<Map<string, { daily: BollData | null; weekly: BollData | null; monthly: BollData | null }>>(new Map());
  const [stockBollErrorMap, setStockBollErrorMap] = useState<Map<string, { daily?: string; weekly?: string; monthly?: string }>>(new Map());
  const [isRefreshingBoll, setIsRefreshingBoll] = useState(false);

  // 请求日志状态
  const [requestLogs, setRequestLogs] = useState<RequestLogEntry[]>([]);
  const [requestStats, setRequestStats] = useState<RequestLogStats>({ total: 0, success: 0, failed: 0, cached: 0, pending: 0 });
  const [showLogPanel, setShowLogPanel] = useState(false);
  // 页面底部轻提示（自动消失）
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const showNotice = (msg: string) => {
    setNotice(msg);
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 3000);
  };
  // 日志面板中已展开的触发原因分组
  const [expandedLogReasons, setExpandedLogReasons] = useState<Set<string>>(new Set());

  const toggleLogReason = (reason: string) => {
    setExpandedLogReasons(prev => {
      const next = new Set(prev);
      if (next.has(reason)) next.delete(reason); else next.add(reason);
      return next;
    });
  };

  // 订阅请求日志更新
  useEffect(() => {
    const unsubscribe = requestLogService.subscribe((logs, stats) => {
      setRequestLogs(logs);
      setRequestStats(stats);
    });
    return unsubscribe;
  }, []);

  // 防止 StrictMode 双重调用
  const isFetchingRef = useRef(false);
  // 请求版本号：每次切换数据源递增，用于取消旧请求
  const fetchVersionRef = useRef(0);

  const fetchAllBoll = useCallback(async (trigger = '打开股息页自动刷新布林线') => {
    // 防止重复调用
    if (isFetchingRef.current) {
      return;
    }
    
    // 递增版本号，标记本次请求
    const currentVersion = ++fetchVersionRef.current;
    // 同一批次所有请求共享同一时间戳，确保缓存时间统一
    const batchTimestamp = Date.now();

    // 只在前复权模式下批量获取所有股票的BOLL数据
    // 新浪不支持不复权模式，跳过批量获取
    if (apiSource === 'sina' && bollAdjust === 'none') {
      setStockBollMap(new Map());
      setStockBollErrorMap(new Map());
      return;
    }
    
    // 不复权模式下腾讯也需要处理实时价格，减少批量请求
    if (bollAdjust === 'none') {
      setStockBollMap(new Map());
      setStockBollErrorMap(new Map());
      return;
    }
    
    isFetchingRef.current = true;
    setIsRefreshingBoll(true);
    
    // 清空旧数据，显示加载状态
    setStockBollMap(new Map());
    setStockBollErrorMap(new Map());
    
    // 先检查缓存
    const dynamicTTL = getDynamicBollCacheTTL();
    const staleCount = countStaleBollCache(stocks, bollAdjust, apiSource, dynamicTTL);
    const logCtx = requestLogService.beginBatch(
      staleCount === 0
        ? `${trigger}：${stocks.length * 3} 项缓存均未过期，无需请求`
        : `${trigger}：${staleCount}/${stocks.length * 3} 项已过期，重新请求 ${staleCount} 条请求`
    );
    const { allCached, cachedData } = checkAllBollCache(stocks, bollAdjust, apiSource, dynamicTTL, logCtx, batchTimestamp);
    
    if (fetchVersionRef.current !== currentVersion) {
      // 已被新请求取消
      return;
    }
    
    if (allCached) {
      // 所有数据都在缓存中，一次性批量更新
      setStockBollMap(cachedData);
      setStockBollErrorMap(new Map());
      
      isFetchingRef.current = false;
      setIsRefreshingBoll(false);
      return;
    }
    
    // 部分或全部数据不在缓存中，逐个获取
    for (let i = 0; i < stocks.length; i++) {
      // 检查版本号，如果已被新请求替代则取消
      if (fetchVersionRef.current !== currentVersion) {
        isFetchingRef.current = false;
        setIsRefreshingBoll(false);
        return;
      }
      
      const stock = stocks[i];
      
      // 跳过已隐藏布林线的股票
      if (stock.bollHidden) continue;
      
      // 先检查这只股票是否已缓存
      const cachedStockData = cachedData.get(stock.id);
      if (cachedStockData?.daily && cachedStockData?.weekly && cachedStockData?.monthly) {
        // 已缓存，直接更新UI
        setStockBollMap(prev => {
          const newMap = new Map(prev);
          newMap.set(stock.id, cachedStockData);
          return newMap;
        });
        continue; // 跳过网络请求
      }
      
      // 未缓存，发起网络请求
      const [dailyR, weeklyR, monthlyR] = await Promise.all([
        fetchBollData(stock.code, 'daily', bollAdjust, apiSource, batchTimestamp, logCtx),
        fetchBollData(stock.code, 'weekly', bollAdjust, apiSource, batchTimestamp, logCtx),
        fetchBollData(stock.code, 'monthly', bollAdjust, apiSource, batchTimestamp, logCtx),
      ]);
      
      // 请求完成后再次检查版本号
      if (fetchVersionRef.current !== currentVersion) {
        isFetchingRef.current = false;
        setIsRefreshingBoll(false);
        return;
      }
      
      // 立即更新状态
      setStockBollMap(prev => {
        const newMap = new Map(prev);
        newMap.set(stock.id, {
          daily: dailyR.data,
          weekly: weeklyR.data,
          monthly: monthlyR.data,
        });
        return newMap;
      });
      
      const errors: { daily?: string; weekly?: string; monthly?: string } = {};
      if (dailyR.error) errors.daily = dailyR.error;
      if (weeklyR.error) errors.weekly = weeklyR.error;
      if (monthlyR.error) errors.monthly = monthlyR.error;
      if (Object.keys(errors).length > 0) {
        setStockBollErrorMap(prev => {
          const newErrorMap = new Map(prev);
          newErrorMap.set(stock.id, errors);
          return newErrorMap;
        });
      }
      
      // 网络请求后，等待250ms再请求下一只股票（但期间要检查是否被取消）
      if (i < stocks.length - 1) {
        for (let w = 0; w < 25; w++) {
          await new Promise(resolve => setTimeout(resolve, 10));
          if (fetchVersionRef.current !== currentVersion) {
            isFetchingRef.current = false;
            setIsRefreshingBoll(false);
            return;
          }
        }
      }
    }
    isFetchingRef.current = false;
    setIsRefreshingBoll(false);
  }, [stocks, bollAdjust, apiSource]);

  // 防止 StrictMode 双重调用：标志在 effect 层设置，与 fetchAllBoll 内部守卫无关
  const didAutoRefreshBollRef = useRef(false);
  useEffect(() => {
    if (didAutoRefreshBollRef.current) return;
    didAutoRefreshBollRef.current = true;
    fetchAllBoll();
    // 只在挂载时自动刷新一次布林线；之后由「布林线」列头按钮手动刷新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 打开股息页时，自动刷新一次所有股价（组件每次挂载只执行一次）
  const didAutoRefreshPricesRef = useRef(false);
  useEffect(() => {
    if (didAutoRefreshPricesRef.current) return;
    didAutoRefreshPricesRef.current = true;
    handleRefreshAll(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 每30秒触发一次重渲染，让"刚刚/x分钟前"等相对时间自动更新（不发网络请求）
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setNowTick(t => t + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  // 支撑/压力位弹窗固定模式：点击弹窗外部关闭
  useEffect(() => {
    if (!srTooltipPinned) return;
    const handler = (e: MouseEvent) => {
      if (srTooltipRef.current && !srTooltipRef.current.contains(e.target as Node) &&
          srBtnRef.current && !srBtnRef.current.contains(e.target as Node)) {
        setSrTooltipPinned(false);
        setSrPreviewText(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [srTooltipPinned]);

  // 支撑/压力位弹窗跟随主弹窗移动
  useEffect(() => {
    if (!srPreviewText) return;
    const { w, h } = srTooltipMeasuredSize.current;
    if (!w || !h) return;
    const gap = 24;
    const popupLeft = ratesPopupPos.left;
    const popupTop = ratesPopupPos.top;
    let calcLeft = popupLeft - w - gap;
    const mainPopupHeight = ratesPopupRef.current?.offsetHeight || 0;
    let calcTop = popupTop + (mainPopupHeight - h) / 2;
    if (calcLeft < 10) {
      calcLeft = popupLeft + 340 + gap;
    }
    if (calcTop + h > window.innerHeight - 10) {
      calcTop = window.innerHeight - h - 10;
    }
    if (calcTop < 10) {
      calcTop = 10;
    }
    setSrTooltipOffset(calcLeft);
    setSrTooltipAbove(calcTop);
  }, [ratesPopupPos, srPreviewText]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    stocks.forEach(s => { if (s.tag && s.tag.trim()) tags.add(s.tag.trim()); });
    return Array.from(tags).sort();
  }, [stocks]);

  const sortedStocks = useMemo(() => {
    if (sortMode === 'dividendRate') {
      return [...stocks].sort((a, b) => getDividendRate(b) - getDividendRate(a));
    } else if (sortMode === 'tag') {
      return [...stocks].sort((a, b) => {
        const aHasTag = a.tag && a.tag.trim() ? 0 : 1;
        const bHasTag = b.tag && b.tag.trim() ? 0 : 1;
        if (aHasTag !== bHasTag) return aHasTag - bHasTag;
        const aTag = (a.tag || '').trim();
        const bTag = (b.tag || '').trim();
        return aTag.localeCompare(bTag);
      });
    }
    return stocks;
  }, [stocks, sortMode]);

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

  const fetchStockPrice = useCallback(async (stockCode: string, logCtx?: LogBatchContext): Promise<{
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
      const logId = requestLogService.startRequest(url, 'GET', logCtx);
      try {
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
            
            requestLogService.success(logId);
            return {
              name: data[1].replace(/\s/g, ''),
              price: price,
              changePercent: changePercent,
              high: high || price,
              low: low || price,
            };
          }
        }
        requestLogService.failed(logId, '股价解析失败');
        return null;
      } catch (error) {
        requestLogService.failed(logId, error instanceof Error ? error.message : '获取股价失败');
        throw error;
      }
    } catch (error) {
      console.error('获取股价失败:', error);
      return null;
    }
  }, []);

  const handleRefreshPrice = useCallback(async (id: string) => {
    const stock = stocks.find(s => s.id === id);
    if (!stock) return;

    const logCtx = requestLogService.beginBatch('点击行内重试：1 只股票 · 1 条请求');
    setIsRefreshing(prev => new Set(prev).add(id));
    setRefreshFailed(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    try {
      const result = await fetchStockPrice(stock.code, logCtx);
      if (result) {
        const year = getSelectedYear(stock);
        const dividend = getDividendForYear(stock, year);
        const dividendRate = result.price > 0 ? (dividend / result.price) * 100 : 0;
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

  const handleRefreshAll = useCallback(async (skipFresh = false) => {
    const marketClosed = !isTradingHours();
    // 休市时股价已是当日/最近收盘价，手动刷新也视为无需请求（除非缓存已过期）
    const effectiveSkip = skipFresh || marketClosed;
    const staleCount = effectiveSkip
      ? stocks.filter(s => !isStockPriceFresh(s.priceUpdatedAt)).length
      : stocks.length;
    let refreshReason: string;
    if (skipFresh) {
      refreshReason = staleCount === 0
        ? `打开股息页自动刷新股价：${stocks.length} 只股票缓存均未过期，无需请求`
        : `打开股息页自动刷新股价：${staleCount}/${stocks.length} 只已过期，重新请求 ${staleCount} 条请求`;
    } else if (marketClosed) {
      refreshReason = staleCount === 0
        ? `点击「价格」列头刷新（休市）：${stocks.length} 只股票缓存均未过期，无需请求`
        : `点击「价格」列头刷新（休市）：${staleCount}/${stocks.length} 只已过期，重新请求 ${staleCount} 条请求`;
    } else {
      refreshReason = `点击「价格」列头刷新：${stocks.length} 只股票 · ${stocks.length} 条请求`;
    }
    const logCtx = requestLogService.beginBatch(refreshReason);
    const batchTime = Date.now(); // 同批次共用的触发时间，作为本批所有股票的过期起点
    setIsRefreshing(new Set(stocks.map(s => s.id)));
    setRefreshFailed(new Set());
    try {
      const updatedStocks = [...stocks];
      const failedIds = new Set<string>();
      let changed = false;
      let skippedCount = 0;
      for (let i = 0; i < updatedStocks.length; i++) {
        const stock = updatedStocks[i];
        // 跳过仍新鲜的股价（主要用于打开页面时的自动刷新：休市时拿到收盘价后不再重复请求）
        if (effectiveSkip && isStockPriceFresh(stock.priceUpdatedAt)) {
          skippedCount++;
          // 仍新鲜的股票也把时间统一到本次触发时间，保证同批次共用过期时间
          updatedStocks[i] = { ...stock, priceUpdatedAt: batchTime };
          changed = true;
          continue;
        }
        const result = await fetchStockPrice(stock.code, logCtx);
        if (result) {
          const year = getSelectedYear(updatedStocks[i]);
          const dividend = getDividendForYear(updatedStocks[i], year);
          const dividendRate = result.price > 0 ? (dividend / result.price) * 100 : 0;
          updatedStocks[i] = {
            ...updatedStocks[i],
            price: result.price,
            changePercent: result.changePercent,
            priceUpdatedAt: batchTime,
            dividendRate2025: dividendRate,
          };
          changed = true;
        } else {
          failedIds.add(stock.id);
        }
      }
      if (skippedCount > 0) {
        showNotice(skippedCount >= stocks.length
          ? (marketClosed
              ? '休市中，股价已是最新收盘价，无需重新请求'
              : '全部股价数据仍新鲜（缓存未过期），无需重新请求')
          : `已跳过 ${skippedCount} 只仍新鲜的股票，刷新其余 ${stocks.length - skippedCount} 只`);
      }
      if (changed) {
        onStocksChange(updatedStocks);
      }
      if (failedIds.size > 0) {
        setRefreshFailed(failedIds);
      }
    } catch {
      setRefreshFailed(new Set(stocks.map(s => s.id)));
    } finally {
      setIsRefreshing(new Set());
    }
  }, [stocks, onStocksChange, fetchStockPrice]);

  // 批量获取所有股票的 2024/2025 全年分红（东方财富，按报告期年度汇总）
  const handleFetchAllDividends = useCallback(async () => {
    if (isFetchingDividends || stocks.length === 0) return;
    const logCtx = requestLogService.beginBatch(
      `点击「分红」列头刷新：${stocks.length} 只股票 · ${stocks.length} 条请求`
    );
    setIsFetchingDividends(true);
    const entries: DividendDiffEntry[] = [];
    const selected = new Set<string>();
    for (let i = 0; i < stocks.length; i++) {
      const stock = stocks[i];
      const result = await fetchYearlyDividends(stock.code, logCtx);
      const fetchedByYear = result.found ? result.dividendByYear : {};
      const existingByYear = stock.dividendByYear || {};
      const changed = result.found && Object.keys(fetchedByYear).some(yr =>
        Math.abs((fetchedByYear[Number(yr)] || 0) - (existingByYear[Number(yr)] || 0)) > 0.0001
      );
      entries.push({
        stockId: stock.id,
        code: getDisplayCode(stock.code),
        name: stock.name,
        current2024: getDividendForYear(stock, dividendYearLeft),
        current2025: getDividendForYear(stock, dividendYearRight),
        fetched2024: result.found ? (result.dividend2024 ?? null) : null,
        fetched2025: result.found ? (result.dividend2025 ?? null) : null,
        fetchedDividendByYear: result.found ? result.dividendByYear : stock.dividendByYear || {},
        hasData: result.found,
        error: result.error,
        records: result.records || [],
      });
      if (changed) selected.add(stock.id);
    }
    setDividendDiff(entries);
    setSelectedDividendIds(selected);
    setIsFetchingDividends(false);
  }, [stocks, isFetchingDividends]);

  // 单只股票拉取年度分红（与批量拉取流程一致，仅拉取当前这一只，弹窗只展示这一只的结果）
  const handleFetchSingleDividend = useCallback(async (stock: StockEntry) => {
    if (isFetchingSingleDividend) return;
    const logCtx = requestLogService.beginBatch(
      `小眼睛详情页刷新 ${stock.name}(${getDisplayCode(stock.code)})：1 只股票 · 1 条请求`
    );
    setIsFetchingSingleDividend(stock.id);
    const result = await fetchYearlyDividends(stock.code, logCtx);
    const fetchedByYear = result.found ? result.dividendByYear : {};
    const existingByYear = stock.dividendByYear || {};
    const changed = result.found && Object.keys(fetchedByYear).some(yr =>
      Math.abs((fetchedByYear[Number(yr)] || 0) - (existingByYear[Number(yr)] || 0)) > 0.0001
    );
    const entry: DividendDiffEntry = {
      stockId: stock.id,
      code: getDisplayCode(stock.code),
      name: stock.name,
      current2024: getDividendForYear(stock, dividendYearLeft),
      current2025: getDividendForYear(stock, dividendYearRight),
      fetched2024: result.found ? (result.dividend2024 ?? null) : null,
      fetched2025: result.found ? (result.dividend2025 ?? null) : null,
      fetchedDividendByYear: result.found ? result.dividendByYear : stock.dividendByYear || {},
      hasData: result.found,
      error: result.error,
      records: result.records || [],
    };
    setDividendDiff([entry]);
    setSelectedDividendIds(changed ? new Set([stock.id]) : new Set());
    setIsFetchingSingleDividend(null);
  }, [isFetchingSingleDividend, dividendYearLeft, dividendYearRight]);

  const toggleDividendRow = (id: string) => {
    setSelectedDividendIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllDividends = () => {
    if (!dividendDiff) return;
    const selectable = dividendDiff.filter(e => e.hasData && !e.error);
    const allSelected = selectable.length > 0 && selectable.every(e => selectedDividendIds.has(e.stockId));
    setSelectedDividendIds(allSelected ? new Set() : new Set(selectable.map(e => e.stockId)));
  };

  const handleApplyDividends = () => {
    if (!dividendDiff) return;
    const updatedStocks = stocks.map(stock => {
      const entry = dividendDiff.find(e => e.stockId === stock.id);
      if (!entry || !selectedDividendIds.has(stock.id) || !entry.hasData) return stock;
      const dividendByYear = Object.keys(entry.fetchedDividendByYear).length > 0
        ? entry.fetchedDividendByYear
        : (stock.dividendByYear || {});
      const dividend2024 = dividendByYear[dividendYearLeft] ?? entry.fetched2024 ?? stock.dividend2024;
      const dividend2025 = dividendByYear[dividendYearRight] ?? entry.fetched2025 ?? stock.dividend2025;
      const selectedYear = getSelectedYear(stock);
      const selectedDividend = dividendByYear[selectedYear] ?? 0;
      const dividendRate2025 = stock.price > 0 ? (selectedDividend / stock.price) * 100 : 0;
      return {
        ...stock,
        dividend2024,
        dividend2025,
        dividendByYear,
        dividendRate2025,
        dividendRates: calculateDividendRates(selectedDividend, rateCols),
      };
    });
    onStocksChange(updatedStocks);
    setDividendDiff(null);
    setSelectedDividendIds(new Set());
  };

  // 持仓列展示模式循环：股息率 → 股数 → 成本 → 股息率
  const cyclePositionMode = () => {
    setPositionDisplayMode(prev => prev === 'yield' ? 'shares' : prev === 'shares' ? 'cost' : 'yield');
  };

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
      const priceLogCtx = requestLogService.beginBatch('添加股票查询股价：1 只股票 · 1 条请求');
      const result = await fetchStockPrice(stockCode, priceLogCtx);

      // 自动查询该股票的 2024/2025 全年分红（查不到则保持 0，可稍后用"自动获取分红"批量补）
      let dividend2024 = 0;
      let dividend2025 = 0;
      let dividendByYear: Record<number, number> = {};
      try {
        const divLogCtx = requestLogService.beginBatch('添加股票查询分红：1 只股票 · 1~2 条请求');
        const divResult = await fetchYearlyDividends(stockCode, divLogCtx);
        if (divResult.found) {
          dividend2024 = divResult.dividend2024;
          dividend2025 = divResult.dividend2025;
          dividendByYear = divResult.dividendByYear;
        }
      } catch {
        // 分红获取失败不影响添加股票
      }

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
        dividendByYear,
        dividendRate2025: 0,
        positionShares: 0,
        positionCost: 0,
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
      
      if ((field as string) === 'dividendLeft' || (field as string) === 'dividendRight') {
        const dividend = typeof value === 'number' ? value : parseFloat(value) || 0;
        const year = (field as string) === 'dividendLeft' ? dividendYearLeft : dividendYearRight;
        // Update dividendByYear
        newStock.dividendByYear = { ...(s.dividendByYear || {}), [year]: dividend };
        // Keep legacy fields in sync
        if (year === 2024) newStock.dividend2024 = dividend;
        if (year === 2025) newStock.dividend2025 = dividend;
        // Recalculate rate if this is the selected year
        const selectedYear = getSelectedYear(s);
        if (selectedYear === year) {
          newStock.dividendRates = calculateDividendRates(dividend);
          newStock.dividendRate2025 = s.price > 0 ? (dividend / s.price) * 100 : 0;
        }
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
        <div className="w-full max-w-[742px] flex items-center gap-3">
          <h1 className="text-3xl font-bold text-app-subtext tracking-wide">股息率一览</h1>
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
      <div className="flex justify-center">
        <div className="bg-app-card border border-app-border rounded-xl overflow-hidden shadow-sm w-full max-w-[742px]">
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
            <table className="text-sm border-separate border-spacing-0" style={{ tableLayout: 'fixed', width: 'max-content' }}>
            <colgroup>
              <col style={{ width: '36px' }} />
              {(cols.includes('code') || cols.includes('name')) && <col style={{ width: '90px' }} />}
              {cols.includes('dividendRate') && <col style={{ width: '55px' }} />}
              {cols.includes('price') && <col style={{ width: '75px' }} />}
              {cols.includes('changePercent') && <col style={{ width: '55px' }} />}
              <col style={{ width: '65px' }} />
              <col style={{ width: '65px' }} />
              <col style={{ width: '65px' }} />
              {dividendYearCols.map(yearCol => <col key={yearCol} style={{ width: '50px' }} />)}
              {cols.includes('position') && <col style={{ width: '62px' }} />}
              <col style={{ width: '60px' }} />
            </colgroup>
            <thead className="sticky top-0 z-30 overflow-hidden">
              <tr className="bg-app-input">
                <th
                  className="px-1 py-2 text-center text-xs uppercase font-bold text-app-subtext tracking-wider border-b border-app-border border-r border-app-border sticky left-0 z-20 cursor-pointer select-none whitespace-nowrap bg-app-input"
                  rowSpan={2}
                  onClick={() => handleSortModeChange(sortMode === 'tag' ? 'default' : 'tag')}
                >
                  标签
                </th>
                {(cols.includes('code') || cols.includes('name')) && <th
                  className="px-2 py-2 text-center text-xs uppercase font-bold text-app-subtext tracking-wider border-b border-app-border border-r border-app-border bg-app-input whitespace-nowrap sticky left-[36px] z-10 cursor-pointer select-none"
                  onClick={() => setShowNickname(prev => !prev)}
                  title="点击在股票名称/代号之间切换"
                >{showNickname ? '代号' : '股票名称'}</th>}
                {cols.includes('dividendRate') && (
                  <th
                    className="px-1 py-2 text-center text-xs uppercase font-bold text-app-subtext tracking-wider border-b border-app-border border-r border-app-border bg-app-input whitespace-nowrap cursor-pointer select-none"
                    onClick={() => handleSortModeChange(sortMode === 'dividendRate' ? 'default' : 'dividendRate')}
                  >
                    股息率
                  </th>
                )}
                {cols.includes('price') && <th className="px-1 py-2 text-center text-xs uppercase font-bold text-app-subtext tracking-wider border-b border-app-border border-r border-app-border bg-app-input whitespace-nowrap">
                    <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                      价格
                      <button
                        onClick={() => handleRefreshAll(false)}
                        disabled={isRefreshing.size > 0}
                        className="p-0.5 hover:bg-app-card rounded transition-colors disabled:opacity-50"
                        title="刷新所有股价"
                      >
                        <RefreshCw size={10} className={isRefreshing.size > 0 ? 'animate-spin' : ''} />
                      </button>
                    </div>
                  </th>}
                {cols.includes('changePercent') && <th className="px-1 py-2 text-center text-xs uppercase font-bold text-app-subtext tracking-wider border-b border-app-border border-r border-app-border bg-app-input whitespace-nowrap">涨跌幅</th>}
                <th
                className="px-1 py-2 text-center text-xs uppercase font-bold text-app-subtext tracking-wider border-b border-app-border border-r border-app-border bg-app-input whitespace-nowrap cursor-pointer select-none hover:bg-app-card transition-colors"
                colSpan={3}
                onClick={() => setBollAdjust(bollAdjust === 'qfq' ? 'none' : 'qfq')}
                title="点击切换前复权/除权"
              >
                <div className="flex items-center justify-center gap-1">
                  <span>布林线 - {bollAdjust === 'qfq' ? '前复权' : '除权'}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      fetchAllBoll('点击「布林线」列头刷新按钮');
                    }}
                    disabled={isRefreshingBoll || bollAdjust === 'none'}
                    className="p-0.5 hover:bg-app-card rounded transition-colors disabled:opacity-50"
                    title="刷新所有BOLL数据"
                  >
                    <RefreshCw size={10} className={isRefreshingBoll ? 'animate-spin' : ''} />
                  </button>
                </div>
              </th>
                {dividendYearCols.length > 0 && <th
                  colSpan={dividendYearCols.length}
                  className="px-1 py-2 text-center text-xs uppercase font-bold text-app-subtext tracking-wider border-b border-app-border bg-app-input whitespace-nowrap"
                >
                  <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                    <span>分红</span>
                    <button
                      onClick={handleFetchAllDividends}
                      disabled={isFetchingDividends || stocks.length === 0}
                      className="p-0.5 hover:bg-app-card rounded transition-colors disabled:opacity-50"
                      title="批量获取全年分红（同花顺 F10）"
                    >
                      <RefreshCw size={10} className={isFetchingDividends ? 'animate-spin' : ''} />
                    </button>
                  </div>
                </th>}
                {cols.includes('position') && <th
                  className="px-1 py-2 text-center text-xs uppercase font-bold text-app-subtext tracking-wider bg-app-input whitespace-nowrap border-b border-app-border border-l border-app-border border-r border-app-border cursor-pointer select-none"
                  rowSpan={2}
                  onClick={cyclePositionMode}
                  title={`点击切换展示（当前：${POSITION_MODE_LABEL[positionDisplayMode]}）：股息率 / 持仓股数 / 成本`}
                >
                  持仓
                </th>}
                <th className="px-1 py-2 text-center text-xs uppercase font-bold text-app-subtext tracking-wider bg-app-input whitespace-nowrap border-b border-app-border" rowSpan={2}>操作</th>
              </tr>
              <tr className="bg-app-input">
                {(cols.includes('code') || cols.includes('name')) && <th className="px-2 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border sticky left-[36px] z-10">代码</th>}
                {(cols.includes('dividendRate') || cols.includes('price') || cols.includes('changePercent')) && <th colSpan={3} className="px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border whitespace-nowrap">{latestUpdateTime > 0 ? formatRelativeTime(latestUpdateTime) : '--'}</th>}
                <th className="px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border">日线</th>
                <th className="px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border">周线</th>
                <th className="px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border">月线</th>
                {dividendYearCols.map((yearCol, idx) => (
                  <th key={yearCol} className={`px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border ${idx < dividendYearCols.length - 1 ? 'border-r border-app-border' : ''}`}>
                    {yearCol === 'dividendLeft' ? dividendYearLeft : dividendYearRight}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedStocks.map(stock => (
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
                            value={[stock.name, getNickname(stock.code, stock.nickname)].filter(Boolean).join('-')}
                            onChange={(e) => {
                              const v = e.target.value;
                              const idx = v.indexOf('-');
                              const newName = idx >= 0 ? v.slice(0, idx) : v;
                              const newNickname = idx >= 0 ? v.slice(idx + 1) : '';
                              onStocksChange(stocks.map(s => {
                                if (s.id !== stock.id) return s;
                                return { ...s, name: newName, nickname: newNickname };
                              }));
                            }}
                            onKeyDown={(e) => { if (e.key === 'Enter') setEditingId(null); }}
                            enterKeyHint="done"
                            placeholder="名称-代号"
                            className="w-full bg-app-input border border-indigo-500 rounded px-0.5 py-0.5 text-[10px] leading-tight text-app-text outline-none text-center"
                            title="股票名称-代号，如：中国平安-星星人"
                          />}
                          {cols.includes('code') && <input
                            type="text"
                            value={getDisplayCode(stock.code)}
                            onChange={(e) => handleUpdateField(stock.id, 'code', e.target.value.toUpperCase())}
                            onKeyDown={(e) => { if (e.key === 'Enter') setEditingId(null); }}
                            enterKeyHint="done"
                            className="w-full bg-app-input border border-indigo-500 rounded px-0.5 py-0.5 text-[9px] leading-tight font-mono text-app-text outline-none text-center"
                          />}
                        </div>
                      ) : (
                        <div className="relative flex items-center justify-center h-8 whitespace-nowrap">
                          <span className={`text-[11px] font-bold leading-none ${getDividendRateColor(getDividendRate(stock), ranges)}`}>{(() => {
                            const raw = showNickname ? (getNickname(stock.code, stock.nickname) || stock.name) : stock.name;
                            const n = raw.replace(/\s/g, '');
                            return n.length > 5 ? n.slice(0, 5) + '…' : n;
                          })()}</span>
                          <span className="font-mono text-[8px] leading-none text-app-rowtext absolute bottom-0 left-0 right-0 text-center" style={{ opacity: 0.6 }}>{getDisplayCode(stock.code)}</span>
                        </div>
                      )}
                    </div>
                  </td>}
                  {cols.includes('dividendRate') && <td className="px-1 py-1.5 text-center border-r border-app-border">
                    <span className={`font-mono text-xs font-bold ${getDividendRateColor(getDividendRate(stock), ranges)}`}>
                      {getDividendRate(stock) > 0 ? formatPercent(getDividendRate(stock)) : '--'}
                    </span>
                  </td>}
                  {cols.includes('price') && <td className="px-1 py-1.5 text-center border-r border-app-border">
                    <div className="flex items-center justify-center gap-0.5">
                      <span className={`font-mono text-xs font-bold ${stock.changePercent >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>
                        {formatPrice(stock.price, stock.name)}
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
                  {(() => {
                    const bollInfo = stockBollMap.get(stock.id);
                    const price = stock.price || 0;
                    const periods: { key: BollPeriod; data: BollData | null }[] = [
                      { key: 'daily', data: !stock.bollHidden ? (bollInfo?.daily ?? null) : null },
                      { key: 'weekly', data: !stock.bollHidden ? (bollInfo?.weekly ?? null) : null },
                      { key: 'monthly', data: !stock.bollHidden ? (bollInfo?.monthly ?? null) : null },
                    ];
                    return periods.map(({ key, data }, idx) => {
                      const pos = getBollPosition(data, price);
                      const bandColor = pos?.band === 'upper' ? 'text-brand-red' : pos?.band === 'lower' ? 'text-brand-green' : 'text-blue-500';
                      const percentStr = pos ? `${pos.percent >= 0 ? '+' : ''}${pos.percent.toFixed(2)}%` : '-';
                      const absPct = pos ? Math.abs(pos.percent) : 0;
                      const arrowCount = absPct <= 0.5 ? 0 : absPct <= 3 ? 1 : absPct <= 6 ? 2 : 3;
                      const arrow = pos ? (arrowCount === 0 ? '' : (pos.percent >= 0 ? '↑' : '↓').repeat(arrowCount)) : '';
                      // 上轨+下箭头 或 下轨+上箭头 → 箭头放左边避免反直觉
                      const isCounterArrow = pos && ((pos.band === 'upper' && pos.percent < 0) || (pos.band === 'lower' && pos.percent >= 0));
                      return (
                        <td key={key} className={`px-1 py-1.5 text-center cursor-pointer hover:bg-app-input/50 ${idx < 2 ? 'border-r border-app-border' : 'border-r border-app-border'}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            const popupW = 340;
                            const popupH = 500;
                            const centerY = rect.top + rect.height / 2;
                            let top = centerY - popupH / 2;
                            top = Math.max(12, Math.min(top, window.innerHeight - popupH - 12));
                            setBollPeriod(key);
                            setShowRatesId(stock.id);
                            setRatesPopupPos({
                              top,
                              left: Math.min(Math.max(12, rect.right + 8), window.innerWidth - popupW - 12)
                            });
                            setBollData(null);
                            setBollError(null);
                            if (!stock.bollHidden) {
                              const popupLogCtx = requestLogService.beginBatch('打开 BOLL 弹窗：1 只股票 · 1 条请求');
                              fetchBollData(stock.code, key, bollAdjust, apiSource, undefined, popupLogCtx).then(result => {
                                setBollData(result.data);
                                setBollError(result.error || null);
                              });
                            }
                          }}
                        >
                          {pos ? (
                            <div className="flex flex-col items-center leading-tight">
                              <span className={`text-[11px] font-bold ${bandColor}`}>{isCounterArrow ? arrow : ''}{getBollBandLabel(key, pos.band)}{!isCounterArrow ? arrow : ''}</span>
                              <span className="font-mono text-[10px] text-app-rowtext">{percentStr}</span>
                            </div>
                          ) : (
                            <span className="text-app-subtext text-[11px]">-</span>
                          )}
                        </td>
                      );
                    });
                  })()}
                  {dividendYearCols.map((yearCol, idx) => {
                    const year = yearCol === 'dividendLeft' ? dividendYearLeft : dividendYearRight;
                    const value = getDividendForYear(stock, year);
                    const isSelected = getSelectedYear(stock) === year;
                    const otherYear = yearCol === 'dividendLeft' ? dividendYearRight : dividendYearLeft;
                    const otherValue = getDividendForYear(stock, otherYear);
                    const selectedColor = value > otherValue ? 'text-brand-red' : value < otherValue ? 'text-brand-green' : 'text-blue-400';
                    return (
                      <td key={yearCol} className={`px-1 py-1.5 text-center cursor-pointer ${idx < dividendYearCols.length - 1 ? 'border-r border-app-border' : ''}`} onClick={() => {
                        if (editingId !== stock.id) {
                          onStocksChange(stocks.map(s => s.id === stock.id ? { ...s, selectedDividendYear: year } : s));
                        }
                      }}>
                        {editingId === stock.id ? (
                          <input
                            type="number"
                            value={value}
                            onChange={(e) => handleUpdateField(stock.id, yearCol as keyof StockEntry, parseFloat(e.target.value) || 0)}
                            onKeyDown={(e) => { if (e.key === 'Enter') setEditingId(null); }}
                            enterKeyHint="done"
                            step="0.01"
                            className="w-full bg-app-input border border-indigo-500 rounded px-0.5 py-0.5 text-[10px] leading-tight font-mono text-app-text outline-none text-center"
                          />
                        ) : (
                          <span className={`font-mono text-xs font-normal ${isSelected ? selectedColor : 'text-app-rowtext'}`}>{formatPrice(value, stock.name)}</span>
                        )}
                      </td>
                    );
                  })}
                  {cols.includes('position') && (() => {
                    const shares = stock.positionShares || 0;
                    const cost = stock.positionCost || 0;
                    const dividend = getDividendForYear(stock, getSelectedYear(stock)) || 0;
                    const yieldPct = shares > 0 && cost > 0 && dividend > 0
                      ? ((dividend / cost) * 100).toFixed(2) + '%'
                      : '-';
                    const sharesText = shares > 0
                      ? `${Number.isInteger(shares) ? shares : shares.toFixed(2)}股`
                      : '-';
                    const costText = cost > 0 ? cost.toFixed(2) : '-';
                    const costColor = cost > 0 ? (cost > (stock.price || 0) ? 'text-brand-green' : 'text-brand-red') : 'text-app-subtext';
                    const displayValue = positionDisplayMode === 'shares'
                      ? sharesText
                      : positionDisplayMode === 'cost'
                        ? costText
                        : yieldPct;
                    return (
                      <td className="px-1 py-1.5 text-center border-l border-app-border border-r border-app-border">
                        {editingId === stock.id ? (
                          <div className="flex flex-col gap-0.5">
                            <input
                              type="number"
                              value={cost || ''}
                              onChange={(e) => handleUpdateField(stock.id, 'positionCost', parseFloat(e.target.value) || 0)}
                              onKeyDown={(e) => { if (e.key === 'Enter') setEditingId(null); }}
                              step="0.01"
                              min="0"
                              placeholder="成本价"
                              className="w-full bg-app-input border border-indigo-500 rounded px-0.5 py-0.5 text-[10px] leading-tight font-mono text-app-text outline-none text-center"
                              title="每股成本（买入均价）"
                            />
                            <input
                              type="number"
                              value={shares || ''}
                              onChange={(e) => handleUpdateField(stock.id, 'positionShares', parseFloat(e.target.value) || 0)}
                              onKeyDown={(e) => { if (e.key === 'Enter') setEditingId(null); }}
                              enterKeyHint="done"
                              step="1"
                              min="0"
                              placeholder="股数"
                              className="w-full bg-app-input border border-indigo-500 rounded px-0.5 py-0.5 text-[10px] leading-tight font-mono text-app-text outline-none text-center"
                              title="持仓股数"
                            />
                          </div>
                        ) : (
                          <span className={`font-mono text-[11px] whitespace-nowrap ${positionDisplayMode === 'cost' ? costColor : 'text-app-subtext'}`}>{displayValue}</span>
                        )}
                      </td>
                    );
                  })()}
                  <td className="px-1 py-1.5 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onStocksChange(stocks.map(s =>
                            s.id === stock.id ? { ...s, bollHidden: !s.bollHidden } : s
                          ));
                        }}
                        className={`p-0.5 rounded transition-colors ${stock.bollHidden ? 'text-gray-500' : 'text-app-subtext hover:bg-app-input'}`}
                        title={stock.bollHidden ? '显示布林线' : '隐藏布林线'}
                      >
                        {stock.bollHidden ? <EyeOff size={12} /> : <Eye size={12} />}
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
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeletingStockId(stock.id);
                        }}
                        className={`p-0.5 rounded transition-colors ${deletingStockId === stock.id ? 'bg-red-500/20 text-red-400' : 'text-app-subtext hover:bg-app-input'}`}
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
        <div className="bg-app-card border border-app-border rounded-xl p-4 max-w-[742px] w-full">
          <div className="text-xs text-app-subtext">
            <p className="mb-2">计算公式：<span className="font-mono">股价 = 分红金额 / 股息率</span></p>
            <p>例如：分红 ¥2.00，股息率 5%，对应股价 = 2.00 / 0.05 = ¥40.00</p>
            <p className="mt-2 text-[10px] opacity-70">股息率 = 选中年份分红 / 当前股价 × 100%</p>
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
        
        const reloadBoll = (period: BollPeriod, adjust: BollAdjust) => {
          setBollData(null);
          setBollError(null);
          setBollUnsupported(false);
          if (stock.bollHidden) return;
          const popupLogCtx = requestLogService.beginBatch('切换布林线周期/复权：1 只股票 · 1 条请求');
          fetchBollData(stock.code, period, adjust, apiSource, undefined, popupLogCtx).then(result => {
            setBollData(result.data);
            setBollError(result.error || null);
            setBollUnsupported(result.unsupported || false);
          });
        };

        const copyBollData = () => {
          if (stock.bollHidden) return;
          const adjustLabel = bollAdjust === 'qfq' ? '前复权' : '除权';
          const fmt = (v: number | null | undefined) => (v != null ? formatPrice(v, stock.name) : '-');
          const fmtPad = (v: number | null | undefined) => {
            const s = fmt(v);
            const targetLen = (stock.name?.includes('ETF') || stock.name?.includes('etf')) ? 7 : 6;
            return s.padEnd(targetLen);
          };
          const buildLine = (label: string, data: BollData | null | undefined) => {
            const ma = data?.ma;
            return `${label}：MA5=${fmtPad(ma?.ma5)}MA10=${fmtPad(ma?.ma10)}MA20=${fmtPad(ma?.ma20)}MA30=${fmtPad(ma?.ma30)}MA60=${fmtPad(ma?.ma60)}MA120=${fmtPad(ma?.ma120)}MA250=${fmtPad(ma?.ma250)}MA500=${fmtPad(ma?.ma500)} BOLL MID=${fmtPad(data?.mid)}UP=${fmtPad(data?.upper)}LOW=${fmtPad(data?.lower)}`;
          };
          const popupLogCtx = requestLogService.beginBatch('复制 MA 与 BOLL 数据：1 只股票 · 3 条请求');
          Promise.all([
            fetchBollData(stock.code, 'daily', bollAdjust, apiSource, undefined, popupLogCtx),
            fetchBollData(stock.code, 'weekly', bollAdjust, apiSource, undefined, popupLogCtx),
            fetchBollData(stock.code, 'monthly', bollAdjust, apiSource, undefined, popupLogCtx),
          ]).then(([dailyR, weeklyR, monthlyR]) => {
            const text = [
              `${stock.name}（${adjustLabel}）`,
              buildLine('日线', dailyR.data),
              buildLine('周线', weeklyR.data),
              buildLine('月线', monthlyR.data),
            ].join('\n');
            const done = () => {
              setSrCopied(true);
              setTimeout(() => setSrCopied(false), 1500);
            };
            if (navigator.clipboard?.writeText) {
              navigator.clipboard.writeText(text).then(done).catch(() => {
                const ta = document.createElement('textarea');
                ta.value = text;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                done();
              });
            } else {
              const ta = document.createElement('textarea');
              ta.value = text;
              document.body.appendChild(ta);
              ta.select();
              document.execCommand('copy');
              document.body.removeChild(ta);
              done();
            }
          });
        };

        const copySRData = () => {
          if (stock.bollHidden) return;
          const adjustLabel = bollAdjust === 'qfq' ? '前复权' : '除权';
          const popupLogCtx = requestLogService.beginBatch('复制支撑/压力位：1 只股票 · 3 条请求');
          Promise.all([
            fetchBollData(stock.code, 'daily', bollAdjust, apiSource, undefined, popupLogCtx),
            fetchBollData(stock.code, 'weekly', bollAdjust, apiSource, undefined, popupLogCtx),
            fetchBollData(stock.code, 'monthly', bollAdjust, apiSource, undefined, popupLogCtx),
          ]).then(([dailyR, weeklyR, monthlyR]) => {
            const periodLabels: { period: string; data: BollData | null }[] = [
              { period: '日', data: dailyR.data },
              { period: '周', data: weeklyR.data },
              { period: '月', data: monthlyR.data },
            ];
            const trackKeys: { key: keyof BollData; label: string }[] = [
              { key: 'upper', label: '上' },
              { key: 'mid', label: '中' },
              { key: 'lower', label: '下' },
            ];
            const maKeys: { key: 'ma5' | 'ma10' | 'ma20' | 'ma30' | 'ma60' | 'ma120' | 'ma250' | 'ma500'; label: string }[] = [
              { key: 'ma5', label: '5' },
              { key: 'ma10', label: '10' },
              { key: 'ma20', label: '20' },
              { key: 'ma30', label: '30' },
              { key: 'ma60', label: '60' },
              { key: 'ma120', label: '120' },
              { key: 'ma250', label: '250' },
              { key: 'ma500', label: '500' },
            ];
            const all: { price: number; name: string }[] = [];
            for (const { period, data } of periodLabels) {
              if (!data) continue;
              for (const t of trackKeys) {
                const v = data[t.key] as number | null | undefined;
                if (v != null) all.push({ price: v, name: `${period}${t.label}` });
              }
              if (data.ma) {
                for (const m of maKeys) {
                  const v = data.ma[m.key] as number | null | undefined;
                  if (v != null) all.push({ price: v, name: `${period}${m.label}` });
                }
              }
            }
            const sorted = all.sort((a, b) => b.price - a.price);
            const resistances = sorted.filter(l => l.price > (stock.price || 0)).sort((a, b) => a.price - b.price).slice(0, 10).reverse();
            const supports = sorted.filter(l => l.price < (stock.price || 0)).sort((a, b) => b.price - a.price).slice(0, 10);
            const lines: string[] = [`${stock.name}（${adjustLabel}）`];
            lines.push('───────────────────────────────');
            for (const r of resistances) {
              const diff = r.price - (stock.price || 0);
              const pct = (diff / (stock.price || 1)) * 100;
              const diffStr = (diff >= 0 ? '+' : '') + formatPrice(diff, stock.name);
              lines.push(`${r.name}\t${formatPrice(r.price, stock.name)}\t${diffStr}\t${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`);
            }
            lines.push(`现价\t${formatPrice(stock.price, stock.name)}\t------\t------`);
            for (const s of supports) {
              const diff = s.price - (stock.price || 0);
              const pct = (diff / (stock.price || 1)) * 100;
              const diffStr = (diff >= 0 ? '+' : '') + formatPrice(diff, stock.name);
              lines.push(`${s.name}\t${formatPrice(s.price, stock.name)}\t${diffStr}\t${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`);
            }
            lines.push('───────────────────────────────');
            const text = lines.join('\n');
            const done = () => {
              setSrCopied(true);
              setTimeout(() => setSrCopied(false), 1500);
            };
            if (navigator.clipboard?.writeText) {
              navigator.clipboard.writeText(text).then(done).catch(() => {
                const ta = document.createElement('textarea');
                ta.value = text;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                done();
              });
            } else {
              const ta = document.createElement('textarea');
              ta.value = text;
              document.body.appendChild(ta);
              ta.select();
              document.execCommand('copy');
              document.body.removeChild(ta);
              done();
            }
          });
        };

        const handleRatesPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
          if (!ratesPopupRef.current) return;
          e.preventDefault();
          e.stopPropagation();
          const rect = ratesPopupRef.current.getBoundingClientRect();
          ratesDragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
          isRatesDragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          ratesPopupRef.current.style.transition = 'none';
          document.body.style.cursor = 'grabbing';
          setSrTooltipHidden(true);
        };

        const handleRatesPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
          if (!isRatesDragging.current || !ratesPopupRef.current) return;
          e.preventDefault();
          e.stopPropagation();
          const newLeft = e.clientX - ratesDragOffset.current.x;
          const newTop = e.clientY - ratesDragOffset.current.y;
          ratesPopupRef.current.style.left = `${newLeft}px`;
          ratesPopupRef.current.style.top = `${newTop}px`;
        };

        const handleRatesPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
          if (!isRatesDragging.current || !ratesPopupRef.current) return;
          isRatesDragging.current = false;
          e.currentTarget.releasePointerCapture(e.pointerId);
          document.body.style.cursor = '';
          const rect = ratesPopupRef.current.getBoundingClientRect();
          setRatesPopupPos({ left: rect.left, top: rect.top });
          ratesPopupRef.current.style.transition = '';
          setSrTooltipHidden(false);
        };
        
        return createPortal(
          <>
            <div 
              className="fixed inset-0 z-40"
              onClick={() => setShowRatesId(null)}
            />
            <div 
              ref={ratesPopupRef}
              className="fixed z-50 bg-app-card border border-app-border rounded-lg shadow-xl w-[340px] flex flex-col max-h-[80vh]"
              style={{ top: ratesPopupPos.top, left: ratesPopupPos.left }}
            >
              <div className="p-3 pb-0 shrink-0">
              <div
                onPointerDown={handleRatesPointerDown}
                onPointerMove={handleRatesPointerMove}
                onPointerUp={handleRatesPointerUp}
                className="flex items-center justify-between mb-2 cursor-grab active:cursor-grabbing touch-none select-none"
              >
                <div className="flex items-center gap-2 pointer-events-none">
                  <span className="text-sm font-bold text-app-text">{stock.name}</span>
                  {stock.price > 0 && (
                    <span className={`font-mono text-xs font-bold ${stock.changePercent >= 0 ? 'text-red-500' : 'text-brand-green'}`}>
                      {formatPrice(stock.price, stock.name)}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setShowRatesId(null)}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="p-0.5 hover:bg-app-input rounded transition-colors"
                >
                  <X size={14} className="text-app-subtext" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-3" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
              <div className="text-[10px] text-app-subtext mb-2">
                股息率对应股价（基于{getSelectedYear(stock)}年分红 ¥{formatPrice(getDividendForYear(stock, getSelectedYear(stock)), stock.name)}）
              </div>
              <div className="grid grid-cols-3 gap-1 mb-3">
                {(() => {
                  const currentRate = getDividendRate(stock);
                  const rateNums = rateCols.map(r => parseFloat(r.replace('%', '')));
                  const highlightIdx = rateNums.reduce((closestIdx, val, idx) => 
                    Math.abs(val - currentRate) < Math.abs(rateNums[closestIdx] - currentRate) ? idx : closestIdx
                  , 0);
                  const rateColorClass = getDividendRateColor(currentRate, ranges);
                  return rateCols.map((rate, idx) => {
                    const price = stock.dividendRates[rate] || 0;
                    const isCurrentRate = idx === highlightIdx;
                    return (
                      <div key={rate} className={`flex flex-col items-center p-1 rounded ${isCurrentRate ? 'bg-indigo-500/10 ring-1 ring-indigo-500/30' : 'bg-app-input'}`}>
                        <span className={`text-[10px] ${isCurrentRate ? rateColorClass : 'text-app-subtext'}`}>{rate}</span>
                        <span className={`font-mono text-xs font-bold ${isCurrentRate ? rateColorClass : 'text-app-text'}`}>
                          {formatPrice(price, stock.name)}
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
              <div className="border-t border-app-border pt-2">
                <div className="flex items-center gap-1 mb-2">
                  <span ref={maBollLabelRef} className="text-[10px] text-app-subtext">MA & BOLL (20, 2)</span>
                  <button
                    ref={srBtnRef}
                    onClick={(e) => {
                      srHoveredRef.current = true;
                      srBtnRef.current = e.currentTarget;
                      setSrTooltipPinned(true);
                      const adjustLabel = bollAdjust === 'qfq' ? '前复权' : '除权';
                      const popupLogCtx = requestLogService.beginBatch('支撑/压力位预览：1 只股票 · 3 条请求');
                      Promise.all([
                        fetchBollData(stock.code, 'daily', bollAdjust, apiSource, undefined, popupLogCtx),
                        fetchBollData(stock.code, 'weekly', bollAdjust, apiSource, undefined, popupLogCtx),
                        fetchBollData(stock.code, 'monthly', bollAdjust, apiSource, undefined, popupLogCtx),
                      ]).then(([dailyR, weeklyR, monthlyR]) => {
                        if (!srBtnRef.current) return;
                        const periodLabels: { period: string; data: BollData | null }[] = [
                          { period: '日', data: dailyR.data },
                          { period: '周', data: weeklyR.data },
                          { period: '月', data: monthlyR.data },
                        ];
                        const trackKeys: { key: keyof BollData; label: string }[] = [
                          { key: 'upper', label: '上' },
                          { key: 'mid', label: '中' },
                          { key: 'lower', label: '下' },
                        ];
                        const maKeys: { key: 'ma5' | 'ma10' | 'ma20' | 'ma30' | 'ma60' | 'ma120' | 'ma250' | 'ma500'; label: string }[] = [
                          { key: 'ma5', label: '5' },
                          { key: 'ma10', label: '10' },
                          { key: 'ma20', label: '20' },
                          { key: 'ma30', label: '30' },
                          { key: 'ma60', label: '60' },
                          { key: 'ma120', label: '120' },
                          { key: 'ma250', label: '250' },
                          { key: 'ma500', label: '500' },
                        ];
                        const all: { price: number; name: string }[] = [];
                        for (const { period, data } of periodLabels) {
                          if (!data) continue;
                          for (const t of trackKeys) {
                            const v = data[t.key] as number | null | undefined;
                            if (v != null) all.push({ price: v, name: `${period}${t.label}` });
                          }
                          if (data.ma) {
                            for (const m of maKeys) {
                              const v = data.ma[m.key] as number | null | undefined;
                              if (v != null) all.push({ price: v, name: `${period}${m.label}` });
                            }
                          }
                        }
                        const sorted = all.sort((a, b) => b.price - a.price);
                        const resistances = sorted.filter(l => l.price > (stock.price || 0)).sort((a, b) => a.price - b.price).slice(0, 10).reverse();
                        const supports = sorted.filter(l => l.price < (stock.price || 0)).sort((a, b) => b.price - a.price).slice(0, 10);
                        const fmt = (v: number | null | undefined) => (v != null ? formatPrice(v, stock.name) : '-');
                        const lines: string[] = [`${stock.name}（${adjustLabel}）`];
                        lines.push('───────────────────────────────');
                        for (const r of resistances) {
                          const diff = r.price - (stock.price || 0);
                          const pct = (diff / (stock.price || 1)) * 100;
                          const diffStr = (diff >= 0 ? '+' : '') + formatPrice(diff, stock.name);
                          lines.push(`${r.name}\t${formatPrice(r.price, stock.name)}\t${diffStr}\t${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`);
                        }
                        lines.push(`现价\t${fmt(stock.price)}\t------\t------`);
                        for (const s of supports) {
                          const diff = s.price - (stock.price || 0);
                          const pct = (diff / (stock.price || 1)) * 100;
                          const diffStr = (diff >= 0 ? '+' : '') + formatPrice(diff, stock.name);
                          lines.push(`${s.name}\t${formatPrice(s.price, stock.name)}\t${diffStr}\t${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`);
                        }
                        lines.push('───────────────────────────────');
                        const text = lines.join('\n');
                        // 测量宽度
                        const measureEl = document.createElement('div');
                        measureEl.style.cssText = 'position:fixed;visibility:hidden;white-space:pre;font-family:monospace;font-size:10px;padding:6px 10px;border:1px solid;line-height:1.5';
                        measureEl.textContent = text;
                        document.body.appendChild(measureEl);
                        const tw = measureEl.offsetWidth;
                        const th = measureEl.offsetHeight;
                        document.body.removeChild(measureEl);
                        srTooltipMeasuredSize.current = { w: tw, h: th };
                        const gap = 24;
                        const popupLeft = ratesPopupPos.left;
                        const popupTop = ratesPopupPos.top;
                        let calcLeft = popupLeft - tw - gap;
                        const mainPopupHeight = ratesPopupRef.current?.offsetHeight || 0;
                        let calcTop = popupTop + (mainPopupHeight - th) / 2;
                        // 超出左边界时回退到弹窗右侧
                        if (calcLeft < 10) {
                          calcLeft = popupLeft + 340 + gap;
                        }
                        // 超出顶部/底部时调整
                        if (calcTop + th > window.innerHeight - 10) {
                          calcTop = window.innerHeight - th - 10;
                        }
                        if (calcTop < 10) {
                          calcTop = 10;
                        }
                        setSrTooltipOffset(calcLeft);
                        setSrTooltipAbove(calcTop);
                        setSrPreviewText(text);
                      });
                    }}
                    onMouseEnter={(e) => {
                      if (srTooltipPinned) return;
                      srHoveredRef.current = true;
                      srBtnRef.current = e.currentTarget;
                      const adjustLabel = bollAdjust === 'qfq' ? '前复权' : '除权';
                      const popupLogCtx = requestLogService.beginBatch('支撑/压力位预览：1 只股票 · 3 条请求');
                      Promise.all([
                        fetchBollData(stock.code, 'daily', bollAdjust, apiSource, undefined, popupLogCtx),
                        fetchBollData(stock.code, 'weekly', bollAdjust, apiSource, undefined, popupLogCtx),
                        fetchBollData(stock.code, 'monthly', bollAdjust, apiSource, undefined, popupLogCtx),
                      ]).then(([dailyR, weeklyR, monthlyR]) => {
                        if (!srHoveredRef.current || !srBtnRef.current || srTooltipPinned) return;
                        const periodLabels: { period: string; data: BollData | null }[] = [
                          { period: '日', data: dailyR.data },
                          { period: '周', data: weeklyR.data },
                          { period: '月', data: monthlyR.data },
                        ];
                        const trackKeys: { key: keyof BollData; label: string }[] = [
                          { key: 'upper', label: '上' },
                          { key: 'mid', label: '中' },
                          { key: 'lower', label: '下' },
                        ];
                        const maKeys: { key: 'ma5' | 'ma10' | 'ma20' | 'ma30' | 'ma60' | 'ma120' | 'ma250' | 'ma500'; label: string }[] = [
                          { key: 'ma5', label: '5' },
                          { key: 'ma10', label: '10' },
                          { key: 'ma20', label: '20' },
                          { key: 'ma30', label: '30' },
                          { key: 'ma60', label: '60' },
                          { key: 'ma120', label: '120' },
                          { key: 'ma250', label: '250' },
                          { key: 'ma500', label: '500' },
                        ];
                        const all: { price: number; name: string }[] = [];
                        for (const { period, data } of periodLabels) {
                          if (!data) continue;
                          for (const t of trackKeys) {
                            const v = data[t.key] as number | null | undefined;
                            if (v != null) all.push({ price: v, name: `${period}${t.label}` });
                          }
                          if (data.ma) {
                            for (const m of maKeys) {
                              const v = data.ma[m.key] as number | null | undefined;
                              if (v != null) all.push({ price: v, name: `${period}${m.label}` });
                            }
                          }
                        }
                        const sorted = all.sort((a, b) => b.price - a.price);
                        const resistances = sorted.filter(l => l.price > (stock.price || 0)).sort((a, b) => a.price - b.price).slice(0, 10).reverse();
                        const supports = sorted.filter(l => l.price < (stock.price || 0)).sort((a, b) => b.price - a.price).slice(0, 10);
                        const fmt = (v: number | null | undefined) => (v != null ? formatPrice(v, stock.name) : '-');
                        const lines: string[] = [`${stock.name}（${adjustLabel}）`];
                        lines.push('───────────────────────────────');
                        for (const r of resistances) {
                          const diff = r.price - (stock.price || 0);
                          const pct = (diff / (stock.price || 1)) * 100;
                          const diffStr = (diff >= 0 ? '+' : '') + formatPrice(diff, stock.name);
                          lines.push(`${r.name}\t${formatPrice(r.price, stock.name)}\t${diffStr}\t${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`);
                        }
                        lines.push(`现价\t${fmt(stock.price)}\t------\t------`);
                        for (const s of supports) {
                          const diff = s.price - (stock.price || 0);
                          const pct = (diff / (stock.price || 1)) * 100;
                          const diffStr = (diff >= 0 ? '+' : '') + formatPrice(diff, stock.name);
                          lines.push(`${s.name}\t${formatPrice(s.price, stock.name)}\t${diffStr}\t${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`);
                        }
                        lines.push('───────────────────────────────');
                        const text = lines.join('\n');
                        const measureEl = document.createElement('div');
                        measureEl.style.cssText = 'position:fixed;visibility:hidden;white-space:pre;font-family:monospace;font-size:10px;padding:6px 10px;border:1px solid;line-height:1.5';
                        measureEl.textContent = text;
                        document.body.appendChild(measureEl);
                        const tw = measureEl.offsetWidth;
                        const th = measureEl.offsetHeight;
                        document.body.removeChild(measureEl);
                        srTooltipMeasuredSize.current = { w: tw, h: th };
                        const gap = 24;
                        const popupLeft = ratesPopupPos.left;
                        const popupTop = ratesPopupPos.top;
                        let calcLeft = popupLeft - tw - gap;
                        const mainPopupHeight = ratesPopupRef.current?.offsetHeight || 0;
                        let calcTop = popupTop + (mainPopupHeight - th) / 2;
                        if (calcLeft < 10) {
                          calcLeft = popupLeft + 340 + gap;
                        }
                        if (calcTop + th > window.innerHeight - 10) {
                          calcTop = window.innerHeight - th - 10;
                        }
                        if (calcTop < 10) {
                          calcTop = 10;
                        }
                        setSrTooltipOffset(calcLeft);
                        setSrTooltipAbove(calcTop);
                        setSrPreviewText(text);
                      });
                    }}
                    onMouseLeave={() => {
                      srHoveredRef.current = false;
                      if (!srTooltipPinned) {
                        setSrPreviewText(null);
                      }
                    }}
                    className="p-0.5 rounded transition-colors hover:bg-app-input relative"
                    title=""
                  >
                    {srCopied ? <Check size={12} className="text-indigo-400" /> : <BarChart3 size={12} className="text-app-subtext" />}
                  </button>
                  {srPreviewText && (
                    <div
                      ref={srTooltipRef}
                      className={`fixed z-[60] bg-app-card border border-app-border rounded px-2.5 py-1.5 text-[11px] font-mono text-app-subtext whitespace-pre shadow-lg leading-relaxed text-left${srTooltipHidden ? ' invisible' : ''}`}
                      style={{ top: srTooltipAbove, left: srTooltipOffset, tabSize: 8 }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            copyBollData();
                          }}
                          onMouseEnter={(e) => {
                            copyHoveredRef.current = true;
                            const btnRect = e.currentTarget.getBoundingClientRect();
                            const adjustLabel = bollAdjust === 'qfq' ? '前复权' : '除权';
                            const fmt = (v: number | null | undefined) => (v != null ? formatPrice(v, stock.name) : '-');
                            const fmtPad = (v: number | null | undefined) => {
                              const s = fmt(v);
                              const targetLen = (stock.name?.includes('ETF') || stock.name?.includes('etf')) ? 7 : 6;
                              return s.padEnd(targetLen);
                            };
                            const maLine = (label: string, data: BollData | null | undefined) => {
                              const ma = data?.ma;
                              return `${label}MA： MA5=${fmtPad(ma?.ma5)}MA10=${fmtPad(ma?.ma10)}MA20=${fmtPad(ma?.ma20)}MA30=${fmtPad(ma?.ma30)}MA60=${fmtPad(ma?.ma60)}MA120=${fmtPad(ma?.ma120)}MA250=${fmtPad(ma?.ma250)}MA500=${fmtPad(ma?.ma500)}`;
                            };
                            const bollLine = (label: string, data: BollData | null | undefined) => {
                              return `${label}BOLL： MID=${fmtPad(data?.mid)}UP=${fmtPad(data?.upper)}LOW=${fmtPad(data?.lower)}`;
                            };
                            const popupLogCtx = requestLogService.beginBatch('复制预览：1 只股票 · 3 条请求');
                            Promise.all([
                              fetchBollData(stock.code, 'daily', bollAdjust, apiSource, undefined, popupLogCtx),
                              fetchBollData(stock.code, 'weekly', bollAdjust, apiSource, undefined, popupLogCtx),
                              fetchBollData(stock.code, 'monthly', bollAdjust, apiSource, undefined, popupLogCtx),
                            ]).then(([dailyR, weeklyR, monthlyR]) => {
                              if (!copyHoveredRef.current) return;
                              const text = [
                                `${stock.name}（${adjustLabel}）`,
                                maLine('日线', dailyR.data),
                                maLine('周线', weeklyR.data),
                                maLine('月线', monthlyR.data),
                                bollLine('日线', dailyR.data),
                                bollLine('周线', weeklyR.data),
                                bollLine('月线', monthlyR.data),
                              ].join('\n');
                              // 测量文本尺寸
                              const measureEl = document.createElement('div');
                              measureEl.style.cssText = 'position:fixed;visibility:hidden;white-space:pre;font-family:monospace;font-size:11px;padding:4px 8px;border:1px solid;line-height:1.5';
                              measureEl.textContent = text;
                              document.body.appendChild(measureEl);
                              const tw = measureEl.offsetWidth;
                              const th = measureEl.offsetHeight;
                              document.body.removeChild(measureEl);
                              // 计算位置：在子浮窗正上方居中
                              const srTooltipEl = srTooltipRef.current;
                              if (srTooltipEl) {
                                const srRect = srTooltipEl.getBoundingClientRect();
                                const gap = 16;
                                let left = btnRect.left + btnRect.width / 2 - tw / 2;
                                let top = srRect.top - th - gap;
                                if (left < 10) left = 10;
                                if (left + tw > window.innerWidth - 10) left = window.innerWidth - tw - 10;
                                if (top < 10) top = srRect.bottom + gap;
                                setCopyPreviewPos({ left, top });
                              }
                              setCopyPreviewText(text);
                            });
                          }}
                          onMouseLeave={() => {
                            copyHoveredRef.current = false;
                            setCopyPreviewText(null);
                          }}
                          className="p-0.5 rounded transition-colors hover:bg-app-input shrink-0 mt-1.5 mr-0"
                          title=""
                        >
                          {srCopied ? <Check size={12} className="text-indigo-400" /> : <Copy size={12} className="text-app-subtext" />}
                          {copyPreviewText && (
                            <div className="fixed z-[70] bg-app-card border border-app-border rounded px-2 py-1 text-[11px] font-mono text-app-subtext whitespace-pre shadow-lg leading-relaxed text-left" style={{ left: copyPreviewPos.left, top: copyPreviewPos.top, tabSize: 8 }}>
                              {copyPreviewText}
                            </div>
                          )}
                        </button>
                      </div>
                      <div className="-mt-4">{srPreviewText}</div>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 mb-2">
                  {(['daily', 'weekly', 'monthly'] as BollPeriod[]).map(p => (
                    <button
                      key={p}
                      onClick={() => { setBollPeriod(p); reloadBoll(p, bollAdjust); }}
                      className={`px-2 py-1 text-[11px] rounded transition-colors ${bollPeriod === p ? 'bg-indigo-500/20 text-indigo-400' : 'bg-app-input text-app-subtext hover:bg-app-input/80'}`}
                    >
                      {p === 'daily' ? '日线' : p === 'weekly' ? '周线' : '月线'}
                    </button>
                  ))}
                  <div className="w-px h-3 bg-app-border mx-0.5" />
                  {(['qfq', 'none'] as BollAdjust[]).map(a => (
                    <button
                      key={a}
                      onClick={() => { setBollAdjust(a); reloadBoll(bollPeriod, a); }}
                      className={`px-2 py-1 text-[11px] rounded transition-colors ${bollAdjust === a ? 'bg-indigo-500/20 text-indigo-400' : 'bg-app-input text-app-subtext hover:bg-app-input/80'}`}
                    >
                      {a === 'qfq' ? '前复权' : '除权'}
                    </button>
                  ))}
                </div>
                {/* 关键均线（与 BOLL 合并标题，无分隔线） */}
                <div className="mb-1">
                  <div className="grid grid-cols-4 gap-1 mb-1">
                    {([
                      'MA5', 'MA10', 'MA20', 'MA30',
                    ] as string[]).map(label => {
                      const value = label === 'MA5' ? bollData?.ma?.ma5 : label === 'MA10' ? bollData?.ma?.ma10 : label === 'MA20' ? bollData?.ma?.ma20 : bollData?.ma?.ma30;
                      const color = value != null ? (value > (stock.price || 0) ? 'text-brand-green' : value < (stock.price || 0) ? 'text-red-500' : 'text-blue-400') : 'text-gray-400';
                      return (
                        <div key={label} className="flex flex-col items-center p-1 rounded bg-app-input">
                          <span className="text-[10px] text-app-subtext">{label}</span>
                          <span className={`font-mono text-xs font-bold ${color}`}>{value != null ? formatPrice(value, stock.name) : '-'}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {([
                      'MA60', 'MA120', 'MA250', 'MA500',
                    ] as string[]).map(label => {
                      const value = label === 'MA60' ? bollData?.ma?.ma60 : label === 'MA120' ? bollData?.ma?.ma120 : label === 'MA250' ? bollData?.ma?.ma250 : bollData?.ma?.ma500;
                      const color = value != null ? (value > (stock.price || 0) ? 'text-brand-green' : value < (stock.price || 0) ? 'text-red-500' : 'text-blue-400') : 'text-gray-400';
                      return (
                        <div key={label} className="flex flex-col items-center p-1 rounded bg-app-input">
                          <span className="text-[10px] text-app-subtext">{label}</span>
                          <span className={`font-mono text-xs font-bold ${color}`}>{value != null ? formatPrice(value, stock.name) : '-'}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-1">
                    <div className="flex flex-col items-center p-1 rounded bg-app-input">
                      <span className="text-[10px] text-app-subtext">MID</span>
                      <span className="font-mono text-xs font-bold text-blue-400">{bollData ? formatPrice(bollData.mid, stock.name) : '-'}</span>
                    </div>
                    <div className="flex flex-col items-center p-1 rounded bg-app-input">
                      <span className="text-[10px] text-app-subtext">UP</span>
                      <span className="font-mono text-xs font-bold text-red-500">{bollData ? formatPrice(bollData.upper, stock.name) : '-'}</span>
                    </div>
                    <div className="flex flex-col items-center p-1 rounded bg-app-input">
                      <span className="text-[10px] text-app-subtext">LOW</span>
                      <span className="font-mono text-xs font-bold text-brand-green">{bollData ? formatPrice(bollData.lower, stock.name) : '-'}</span>
                    </div>
                </div>
                <div className="border-t border-app-border pt-2 mt-2 mb-2">
                  <div className="text-[10px] text-app-subtext mb-2">
                    {(() => {
                      const count = bollData?.rangeCount ?? 0;
                      if (bollPeriod === 'daily') return `区间极值（近${count}个交易日）`;
                      if (bollPeriod === 'weekly') return `区间极值（近${count}周）`;
                      return `区间极值（近${count}个月）`;
                    })()}
                  </div>
                  <div className="flex flex-col gap-1 mb-2">
                    {(() => {
                      const byYear = stock.dividendByYear || {};
                      // 返回 { amount, usedYear, isApproximate }：当年有数据就用(=)；当年无则回退前一年(≈)；前一年也无 → amount=0
                      const calcDividendForDate = (dateStr: string): { amount: number; isApproximate: boolean } => {
                        if (!dateStr) return { amount: 0, isApproximate: false };
                        const y = parseInt(dateStr.slice(0, 4), 10);
                        if (isNaN(y)) return { amount: 0, isApproximate: false };
                        if (byYear[y] && byYear[y] > 0) return { amount: byYear[y], isApproximate: false };
                        // 回退到前一年
                        if (byYear[y - 1] && byYear[y - 1] > 0) return { amount: byYear[y - 1], isApproximate: true };
                        return { amount: 0, isApproximate: false };
                      };
                      const calcRate = (price: number, dividend: number): string => {
                        if (!dividend || !price) return '-';
                        const rate = dividend / price * 100;
                        return rate.toFixed(2) + '%';
                      };
                      const calcRateColor = (price: number, dividend: number): string => {
                        if (!dividend || !price) return 'text-app-subtext';
                        const rate = dividend / price * 100;
                        return getDividendRateColor(rate, ranges);
                      };
                      const highPrice = bollData?.rangePriceHigh ?? 0;
                      const highDate = bollData?.rangePriceHighDate ?? '';
                      const highDiv = calcDividendForDate(highDate);
                      const highRate = calcRate(highPrice, highDiv.amount);
                      const highRateColor = calcRateColor(highPrice, highDiv.amount);
                      const highSymbol = !highDiv.amount ? '' : (highDiv.isApproximate ? '≈' : '=');
                      const lowPrice = bollData?.rangePriceLow ?? 0;
                      const lowDate = bollData?.rangePriceLowDate ?? '';
                      const lowDiv = calcDividendForDate(lowDate);
                      const lowRate = calcRate(lowPrice, lowDiv.amount);
                      const lowRateColor = calcRateColor(lowPrice, lowDiv.amount);
                      const lowSymbol = !lowDiv.amount ? '' : (lowDiv.isApproximate ? '≈' : '=');
                      return (
                        <>
                          <div className="flex items-center gap-2 p-1.5 rounded bg-app-input">
                            <span className="text-[10px] text-app-subtext shrink-0">最高价</span>
                            <span className="font-mono text-[10px] font-bold text-red-500 shrink-0">
                              {bollData ? formatPrice(highPrice, stock.name) : '-'}
                            </span>
                            <span className="text-[10px] shrink-0">
                              <span className="text-app-subtext">股息率</span>
                              {highSymbol && <span className="text-app-subtext mx-0.5">{highSymbol}</span>}
                              <span className={`font-mono font-bold ${highRateColor}`}>{bollData && highDiv.amount ? highRate : '-'}</span>
                            </span>
                            <span className="text-[10px] text-app-subtext ml-auto shrink-0">
                              {bollData && highDate ? highDate : '-'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 p-1.5 rounded bg-app-input">
                            <span className="text-[10px] text-app-subtext shrink-0">最低价</span>
                            <span className="font-mono text-[10px] font-bold text-brand-green shrink-0">
                              {bollData ? formatPrice(lowPrice, stock.name) : '-'}
                            </span>
                            <span className="text-[10px] shrink-0">
                              <span className="text-app-subtext">股息率</span>
                              {lowSymbol && <span className="text-app-subtext mx-0.5">{lowSymbol}</span>}
                              <span className={`font-mono font-bold ${lowRateColor}`}>{bollData && lowDiv.amount ? lowRate : '-'}</span>
                            </span>
                            <span className="text-[10px] text-app-subtext ml-auto shrink-0">
                              {bollData && lowDate ? lowDate : '-'}
                            </span>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                  <div className="border-t border-app-border pt-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-app-subtext">年度分红（元/股）</span>
                      <button
                        type="button"
                        onClick={() => handleFetchSingleDividend(stock)}
                        disabled={isFetchingSingleDividend !== null}
                        className="p-0.5 hover:bg-app-card rounded transition-colors disabled:opacity-50 shrink-0 text-app-subtext"
                        title="刷新该股票年度分红数据"
                      >
                        <RefreshCw
                          size={10}
                          className={isFetchingSingleDividend === stock.id ? 'animate-spin' : ''}
                        />
                      </button>
                    </div>
                    {(() => {
                      const byYear = stock.dividendByYear || {};
                      const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
                      const chartData = years.map(y => ({
                        year: y.toString(),
                        dividend: byYear[y],
                      }));
                      if (chartData.length === 0) {
                        return (
                          <div className="h-[120px] flex items-center justify-center text-[10px] text-app-subtext">
                            暂无分红数据（点击右上方刷新按钮拉取）
                          </div>
                        );
                      }
                      return (
                        <div className="h-[120px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" vertical={false} />
                              <XAxis
                                dataKey="year"
                                tick={{ fontSize: 9, fill: 'currentColor' }}
                                stroke="rgba(148,163,184,0.3)"
                                tickLine={false}
                                axisLine={false}
                                minTickGap={18}
                              />
                              <YAxis
                                tick={{ fontSize: 9, fill: 'currentColor' }}
                                stroke="rgba(148,163,184,0.3)"
                                tickLine={false}
                                axisLine={false}
                                domain={[0, 'auto']}
                                width={38}
                              />
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: 'rgba(15,23,42,0.95)',
                                  border: '1px solid rgba(148,163,184,0.3)',
                                  borderRadius: 6,
                                  fontSize: 11,
                                  color: 'inherit',
                                }}
                                formatter={(value: number) => [`${value.toFixed(3)} 元`, '每股分红']}
                                labelFormatter={(label) => `${label}年`}
                                cursor={{ stroke: 'rgba(99,102,241,0.4)', strokeWidth: 1 }}
                              />
                              <Line
                                type="monotone"
                                dataKey="dividend"
                                stroke="#6366f1"
                                strokeWidth={1.8}
                                dot={{ r: 2, fill: '#6366f1', strokeWidth: 0 }}
                                activeDot={{ r: 4 }}
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      );
                    })()}
                  </div>
                </div>
            </div>
            </div>
            <div className="px-3 py-3 shrink-0">
              <div className="flex justify-between items-center text-[10px] text-app-subtext px-1">
                      <span>价格 {formatPrice(stock.price || 0, stock.name)} - {formatFetchTime(stock.priceUpdatedAt || 0)}</span>
                      <span className="font-mono whitespace-nowrap">
                        {bollUnsupported ? (
                          <span className="text-brand-yellow">
                            {bollError}（请在设置中切换数据源）
                          </span>
                        ) : bollError ? (
                          <span className="text-red-400">{bollError}</span>
                        ) : (
                          <span>BOLL数据 {formatFetchTime(bollData?.fetchedAt || 0)}</span>
                        )}
                      </span>
                    </div>
              </div>
            </div>
          </>,
          document.body
        );
      })()}
      {deletingStockId && (() => {
        const stock = stocks.find(s => s.id === deletingStockId);
        if (!stock) return null;
        return createPortal(
          <>
            <div
              className="fixed inset-0 z-40 bg-black/40"
              onClick={() => setDeletingStockId(null)}
            />
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="bg-app-card border border-app-border rounded-xl shadow-xl p-5 w-72">
                <div className="text-sm font-bold text-app-text mb-1">确认删除</div>
                <div className="text-xs text-app-subtext mb-4">
                  确定要删除 <span className="text-app-text font-medium">{stock.name}</span> 吗？此操作无法撤销。
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeletingStockId(null);
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border border-app-border text-app-subtext hover:bg-app-input transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteStock(stock.id);
                      setDeletingStockId(null);
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/90 text-white hover:bg-red-500 transition-colors"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          </>,
          document.body
        );
      })()}

      {showResetConfirm && createPortal(
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setShowResetConfirm(false)}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="bg-app-card border border-app-border rounded-xl shadow-xl p-5 w-72">
              <div className="text-sm font-bold text-app-text mb-1">确认重置</div>
              <div className="text-xs text-app-subtext mb-4">
                确定要重置所有股票数据吗？此操作无法撤销。
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowResetConfirm(false);
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-app-border text-app-subtext hover:bg-app-input transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onResetStocks?.();
                    setShowResetConfirm(false);
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/90 text-white hover:bg-red-500 transition-colors"
                >
                  重置
                </button>
              </div>
            </div>
          </div>
        </>,
        document.body
      )}

      {dividendDiff && (() => {
        const selectable = dividendDiff.filter(e => e.hasData && !e.error);
        const selectedCount = dividendDiff.filter(e => selectedDividendIds.has(e.stockId)).length;
        const allSelected = selectable.length > 0 && selectable.every(e => selectedDividendIds.has(e.stockId));
        return createPortal(
          <>
            <div
              className="fixed inset-0 z-[9998] bg-black/40"
              onClick={() => setDividendDiff(null)}
            />
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <div className="bg-app-card border border-app-border rounded-xl shadow-2xl w-full max-w-[742px] max-h-[85vh] flex flex-col">
                <div className="flex items-start justify-between px-4 py-3 border-b border-app-border">
                  <div>
                    <h3 className="text-sm font-bold text-app-text">分红数据核对</h3>
                    <p className="text-[10px] text-app-subtext mt-0.5">
                      数据来源：同花顺 F10 · 按分红所属年度汇总（含中期/特别分红）· 每股税前派息（送转不计入）
                    </p>
                  </div>
                  <button
                    onClick={() => setDividendDiff(null)}
                    className="p-1 hover:bg-app-input rounded transition-colors shrink-0"
                  >
                    <X size={16} className="text-app-subtext" />
                  </button>
                </div>
                <div className="overflow-y-auto custom-scrollbar min-h-0">
                  <table className="w-full text-xs border-separate border-spacing-0">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-app-input">
                        <th className="px-2 py-2 text-center border-b border-app-border w-14">
                          <label className="flex items-center justify-center gap-1 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={allSelected}
                              disabled={selectable.length === 0}
                              onChange={toggleSelectAllDividends}
                              className="accent-indigo-500 w-3.5 h-3.5"
                            />
                            <span className="text-[10px] text-app-subtext">全选</span>
                          </label>
                        </th>
                        <th className="px-2 py-2 text-left border-b border-app-border border-r border-app-border whitespace-nowrap">股票</th>
                        <th className="px-2 py-2 text-center border-b border-app-border border-r border-app-border whitespace-nowrap">{dividendYearLeft} 分红</th>
                        <th className="px-2 py-2 text-center border-b border-app-border border-r border-app-border whitespace-nowrap">{dividendYearRight} 分红</th>
                        <th className="px-2 py-2 text-center border-b border-app-border whitespace-nowrap">状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dividendDiff.map(entry => {
                        const changed = entry.hasData && (
                          Math.abs((entry.fetched2024 ?? 0) - entry.current2024) > 0.0001 ||
                          Math.abs((entry.fetched2025 ?? 0) - entry.current2025) > 0.0001
                        );
                        const recordTooltip = entry.records
                          .map(r => `${r.reportDate} ${r.planProfile}`)
                          .join('\n');
                        return (
                          <tr key={entry.stockId} className="hover:bg-app-hover/50 transition-colors">
                            <td className="px-2 py-1.5 text-center border-b border-app-border">
                              <input
                                type="checkbox"
                                checked={selectedDividendIds.has(entry.stockId)}
                                disabled={!entry.hasData || !!entry.error}
                                onChange={() => toggleDividendRow(entry.stockId)}
                                className="accent-indigo-500 w-4 h-4"
                              />
                            </td>
                            <td
                              className="px-2 py-1.5 border-b border-app-border border-r border-app-border"
                              title={recordTooltip || undefined}
                            >
                              <div className="text-app-text font-medium whitespace-nowrap">{entry.name}</div>
                              <div className="text-[10px] text-app-subtext font-mono">{entry.code}</div>
                            </td>
                            <td className="px-2 py-1.5 text-center border-b border-app-border border-r border-app-border font-mono">
                              {formatDividendCell(entry.current2024, entry.fetched2024, entry.hasData)}
                            </td>
                            <td className="px-2 py-1.5 text-center border-b border-app-border border-r border-app-border font-mono">
                              {formatDividendCell(entry.current2025, entry.fetched2025, entry.hasData)}
                            </td>
                            <td className="px-2 py-1.5 text-center border-b border-app-border whitespace-nowrap">
                              {!entry.hasData ? (
                                <span className={entry.error ? 'text-red-400' : 'text-app-subtext'}>
                                  {entry.error ? '获取失败' : '查不到，保持手动'}
                                </span>
                              ) : changed ? (
                                <span className="text-indigo-400 font-medium">有差异</span>
                              ) : (
                                <span className="text-brand-green">无变化</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between gap-2 flex-wrap px-4 py-3 border-t border-app-border">
                  <span className="text-[10px] text-app-subtext">
                    {selectable.length > 0
                      ? `已勾选 ${selectedCount} 只将更新`
                      : '本次没有可更新的股票'}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setDividendDiff(null)}
                      className="px-3 py-2 rounded-lg text-xs font-semibold border border-app-border text-app-subtext hover:bg-app-input transition-colors"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleApplyDividends}
                      disabled={selectedCount === 0}
                      className="px-3 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      应用勾选（{selectedCount}）
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </>,
          document.body
        );
      })()}

      {/* 页面底部轻提示 */}
      {notice && (
        <div className="fixed bottom-14 left-1/2 -translate-x-1/2 z-40 bg-app-card border border-app-border rounded-lg px-4 py-2 text-xs text-app-text shadow-xl">
          {notice}
        </div>
      )}

      {/* 页面底部请求计数器 */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-app-card border-t border-app-border px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowLogPanel(!showLogPanel)}
              className="flex items-center gap-2 text-xs text-app-subtext hover:text-app-text transition-colors"
            >
              <BarChart3 size={14} />
              <span>请求统计</span>
            </button>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-app-subtext">总计: <span className="text-app-text font-medium">{requestStats.total}</span></span>
              <span className="text-green-400">成功: <span className="font-medium">{requestStats.success}</span></span>
              <span className="text-red-400">失败: <span className="font-medium">{requestStats.failed}</span></span>
              <span className="text-blue-400">缓存: <span className="font-medium">{requestStats.cached}</span></span>
              <span className="text-yellow-400">进行中: <span className="font-medium">{requestStats.pending}</span></span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowLogPanel(prev => !prev)}
              disabled={requestLogs.length === 0}
              className="flex items-center gap-1 px-2 py-1 text-xs text-app-subtext hover:text-app-text border border-app-border rounded hover:border-app-text/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="展开/收起当前请求日志"
            >
              <List size={12} />
              <span className="hidden sm:inline">{showLogPanel ? '收起日志' : '查看日志'}</span>
            </button>
            <button
              onClick={() => {
                const csvContent = requestLogService.exportLogs();
                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `request_logs_${new Date().toISOString().slice(0, 10)}.csv`;
                link.click();
                URL.revokeObjectURL(url);
              }}
              disabled={requestLogs.length === 0}
              className="flex items-center gap-1 px-2 py-1 text-xs text-app-subtext hover:text-app-text border border-app-border rounded hover:border-app-text/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="下载当前请求日志（CSV）"
            >
              <Download size={12} />
              <span className="hidden sm:inline">下载日志</span>
            </button>
            <button
              onClick={() => requestLogService.reset()}
              disabled={requestLogs.length === 0}
              className="flex items-center gap-1 px-2 py-1 text-xs text-app-subtext hover:text-red-400 border border-app-border rounded hover:border-red-400/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="清空当前请求日志"
            >
              <RotateCcw size={12} />
              <span className="hidden sm:inline">重置</span>
            </button>
          </div>
        </div>

        {/* 日志面板 */}
        {showLogPanel && (
          <div className="mt-2 pt-2 border-t border-app-border max-h-48 overflow-y-auto">
            <div className="space-y-1">
              {requestLogs.length === 0 ? (
                <div className="text-xs text-app-subtext text-center py-2">暂无请求记录</div>
              ) : (() => {
                // 按触发原因分组（保持新到旧顺序），第一层级只展示原因，点开再展开请求明细
                const groups: { reason: string; batchKey: string; logs: RequestLogEntry[] }[] = [];
                const groupIndex = new Map<string, number>();
                requestLogs.slice().reverse().forEach(log => {
                  // 同一批次（同一次触发）的所有请求归为一组；无批次标识的历史/单条请求各自成组
                  const batchKey = log.batchKey || `${log.reason || '（无触发原因）'}|${log.id}`;
                  const idx = groupIndex.get(batchKey);
                  if (idx === undefined) {
                    groupIndex.set(batchKey, groups.length);
                    groups.push({ reason: log.reason || '（无触发原因）', batchKey, logs: [log] });
                  } else {
                    groups[idx].logs.push(log);
                  }
                });
                return groups.map(group => {
                  const expanded = expandedLogReasons.has(group.batchKey);
                  const triggerAt = Math.min(...group.logs.map(l => l.timestamp));
                  const success = group.logs.filter(l => l.status === 'success').length;
                  const failed = group.logs.filter(l => l.status === 'failed').length;
                  const cached = group.logs.filter(l => l.status === 'cached').length;
                  return (
                    <div key={group.reason} className="bg-app-input/50 rounded overflow-hidden">
                      <button
                        onClick={() => toggleLogReason(group.batchKey)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-app-input transition-colors"
                        title={expanded ? '收起本条请求明细' : '展开本条请求明细'}
                      >
                        <ChevronDown size={12} className={`shrink-0 text-app-subtext transition-transform ${expanded ? '' : '-rotate-90'}`} />
                        <span className="text-app-subtext shrink-0 font-mono text-[10px]">{new Date(triggerAt).toLocaleString('zh-CN', { hour12: false })}</span>
                        <span className={`text-indigo-400/80 ${expanded ? '' : 'truncate'} flex-1`} title={group.reason}>{group.reason}</span>
                        <span className="text-app-subtext shrink-0 whitespace-nowrap">
                          {group.logs.length} 条
                          {success > 0 && <span className="text-green-400"> · 成功 {success}</span>}
                          {failed > 0 && <span className="text-red-400"> · 失败 {failed}</span>}
                          {cached > 0 && <span className="text-blue-400"> · 缓存 {cached}</span>}
                        </span>
                      </button>
                      {expanded && (
                        <div className="space-y-1 px-2 pb-2">
                          {group.logs.map(log => (
                            <div key={log.id} className="flex items-center gap-2 text-xs px-2 py-1 bg-app-card/70 rounded">
                              <span className="text-app-subtext shrink-0">{new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                              <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                log.status === 'success' ? 'bg-green-500/20 text-green-400' :
                                log.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                                log.status === 'cached' ? 'bg-blue-500/20 text-blue-400' :
                                'bg-yellow-500/20 text-yellow-400'
                              }`}>
                                {log.status === 'success' ? '成功' : log.status === 'failed' ? '失败' : log.status === 'cached' ? '缓存' : '进行中'}
                              </span>
                              <span className="text-app-text truncate flex-1" title={log.url}>{log.url}</span>
                              {log.duration && <span className="text-app-subtext shrink-0">{log.duration}ms</span>}
                              {log.error && <span className="text-red-400 truncate" title={log.error}>{log.error}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
