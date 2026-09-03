import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X, RefreshCw, Edit2, Check, TrendingUp, TrendingDown, Settings, CloudDownload, CloudUpload, Moon, Sun, CheckCircle2, Trash2, GripVertical, RotateCcw, Eye, EyeOff, Download, BarChart3, List, ChevronDown, Copy } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { StockEntry, StockDividendRates, DividendRateColorRange, StockSettings, ApiSource } from '../types';
import { fetchBollData, checkAllBollCache, countStaleBollCache, countVisibleBollItems, getBollCacheTimestamps, BollData, BollPeriod, BollAdjust, BollKline } from '../services/bollService';
import { isStockPriceFresh, isTradingHours, getDynamicBollCacheTTL, getDynamicCacheTTL, formatDuration, formatTimePart, formatCacheTime } from '../services/cacheService';
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
  maxWidth?: number;
  actionButtons?: React.ReactNode;
  appVersion?: string;
  onTogglePage?: () => void;
  apiSource?: ApiSource;
  onResetStocks?: () => void;
  resetSignal?: number;
  dividendYearLeft?: number;
  dividendYearRight?: number;
  sortMode?: 'default' | 'dividendRate' | 'tag' | 'daily' | 'weekly' | 'monthly';
  onSortModeChange?: (mode: 'default' | 'dividendRate' | 'tag' | 'daily' | 'weekly' | 'monthly') => void;
  memo?: string;
  memoUpdatedAt?: number;
  memoBaseline?: string;
  onMemoChange?: (memo: string) => void;
  onMemoUpload?: () => Promise<boolean>;
  showRequestStats?: boolean;
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
  registerDate?: string; // 最新股权登记日
}

// 持仓列展示模式（表头按钮循环切换）
type PositionDisplayMode = 'yield' | 'shares' | 'cost';
const POSITION_MODE_LABEL: Record<PositionDisplayMode, string> = {
  yield: '股息率',
  shares: '份额',
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

// ---- 技术指标计算（复用已有K线数据，不额外请求） ----

interface IndicatorResult {
  open: number | null;   // 最新一根K线的开盘价
  high: number | null;   // 最新一根K线的最高价
  low: number | null;    // 最新一根K线的最低价
  changePct: number | null; // 最新收盘较昨收涨跌幅
  volume: number | null; // 最新一根K线的成交量
  volumeMa5: number | null; // 最近5根K线成交量均值
  kdj: { k: number | null; d: number | null; j: number | null };
  rsi: { rsi6: number | null; rsi12: number | null; rsi24: number | null };
  macd: { dif: number | null; dea: number | null; macd: number | null };
}

// 基于K线序列计算技术指标（9日KDJ / 6,12,24日RSI / 12,26,9 MACD）
// 用实时行情覆盖/追加今日K线，保证技术指标显示今日数据（不依赖K线缓存是否已含今日K线）
function mergeTodayBarToKlines(
  klines: BollKline[],
  rt: { open?: number; high?: number; low?: number; price?: number; volume?: number }
): BollKline[] {
  if (!klines || klines.length === 0) return klines;
  const price = rt.price ?? 0;
  const open = rt.open ?? 0;
  if (price <= 0 || open <= 0) return klines; // 无有效实时行情时不修改
  const high = rt.high && rt.high > 0 ? rt.high : price;
  const low = rt.low && rt.low > 0 ? rt.low : price;
  const today = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const todayBar: BollKline = { date: today, open, high, low, close: price, volume: rt.volume ?? 0 };
  const last = klines[klines.length - 1];
  // K 线末根已是当日：替换为实时数据；否则追加一个今日K线
  return last.date === today ? [...klines.slice(0, -1), todayBar] : [...klines, todayBar];
}

// 基于K线序列计算技术指标（KDJ/RSI/MACD、最高/最低/成交量及涨跌幅等）
function calcIndicators(klines: BollKline[]): IndicatorResult | null {
  if (!klines || klines.length === 0) return null;
  const last = klines[klines.length - 1];
  const prev = klines.length >= 2 ? klines[klines.length - 2] : null;

  const high = last.high ?? null;
  const low = last.low ?? null;
  const volume = last.volume ?? null;
  // 成交量 MA5：最近5根K线成交量均值
  const volumeMa5 = klines.length >= 5
    ? klines.slice(-5).reduce((sum, k) => sum + (k.volume ?? 0), 0) / 5
    : null;
  const changePct = prev && prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : null;

  // ---- KDJ (9) ----
  let kv: number | null = null, dv: number | null = null, jv: number | null = null;
  if (klines.length >= 9) {
    let k = 50, d = 50, prevK = 50;
    for (let i = 0; i < klines.length; i++) {
      const start = Math.max(0, i - 9 + 1);
      let hh = -Infinity, ll = Infinity;
      for (let j = start; j <= i; j++) {
        if (klines[j].high > hh) hh = klines[j].high;
        if (klines[j].low < ll) ll = klines[j].low;
      }
      const rsv = hh === ll ? 50 : ((klines[i].close - ll) / (hh - ll)) * 100;
      k = (2 / 3) * (prevK === 50 ? k : prevK) + (1 / 3) * rsv;
      prevK = k;
      d = (2 / 3) * d + (1 / 3) * k;
    }
    kv = parseFloat(k.toFixed(2));
    dv = parseFloat(d.toFixed(2));
    jv = parseFloat((3 * k - 2 * d).toFixed(2));
  }

  // ---- RSI (6/12/24) ----
  const calcRsi = (n: number): number | null => {
    if (klines.length <= n) return null;
    let up = 0, down = 0;
    for (let i = klines.length - n; i < klines.length; i++) {
      const diff = klines[i].close - klines[i - 1].close;
      if (diff > 0) up += diff; else down -= diff;
    }
    if (down === 0) return up === 0 ? 50 : 100;
    return parseFloat((100 - 100 / (1 + up / down)).toFixed(2));
  };

  // ---- MACD (12,26,9) ----
  const ema = (arr: number[], n: number): number[] => {
    const res: number[] = [];
    const alpha = 2 / (n + 1);
    let prevEma = 0;
    arr.forEach((v, i) => {
      if (i === 0) { prevEma = v; res.push(v); }
      else { prevEma = alpha * v + (1 - alpha) * prevEma; res.push(prevEma); }
    });
    return res;
  };
  const closes = klines.map(k => k.close);
  let dif: number | null = null, dea: number | null = null, macd: number | null = null;
  if (closes.length >= 26) {
    const ema12 = ema(closes, 12);
    const ema26 = ema(closes, 26);
    const n = closes.length;
    const difArr = closes.map((_, i) => ema12[i] - ema26[i]);
    const deaArr = ema(difArr, 9);
    dif = parseFloat(difArr[n - 1].toFixed(3));
    dea = parseFloat(deaArr[deaArr.length - 1].toFixed(3));
    macd = parseFloat((2 * (difArr[n - 1] - deaArr[deaArr.length - 1])).toFixed(3));
  }

  return { open: last.open ?? null, high, low, changePct, volume, volumeMa5, kdj: { k: kv, d: dv, j: jv }, rsi: { rsi6: calcRsi(6), rsi12: calcRsi(12), rsi24: calcRsi(24) }, macd: { dif, dea, macd } };
}

// 成交量格式化（万/亿,单位手）
const formatVolume = (v: number | null): string => {
  if (v == null) return '-';
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}亿手`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(2)}万手`;
  return `${Math.round(v)}手`;
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

// 格式化备忘录最后编辑时间（编辑于：YYYY年M月D日 HH:MM）
const formatMemoTime = (ts?: number): string => {
  if (!ts) return '编辑于 --';
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `编辑于 ${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// 股息率曲线共享组件：详情弹窗与列表页“股息率”浮窗共用一套渲染逻辑，
// 之后任一处的股息率曲线改动都会同时反映到另一处。
function DividendRateCurve({ klines, stock, fallbackDividend, title, ranges, period, rangeValue, offsetValue, onRangeChange, onOffsetChange }: {
  klines: BollKline[];
  stock: StockEntry;
  fallbackDividend: number;
  title?: string;
  ranges: DividendRateColorRange[];
  period?: 'daily' | 'weekly' | 'monthly';
  // 受控区间（列表页股息率列共享 daily 区间时传入）；未传入则内部自管理并本地记忆
  rangeValue?: number;
  offsetValue?: number;
  onRangeChange?: (v: number) => void;
  onOffsetChange?: (v: number) => void;
}) {
  const [chartRange, setChartRange] = useState(() => {
    if (period) {
      try { return Number(localStorage.getItem(`dividendChartRange_${period}`)) || 120; } catch { /* ignore */ }
    }
    return 120;
  });
  const [chartOffset, setChartOffset] = useState(() => {
    if (period) {
      try { return Number(localStorage.getItem(`dividendChartOffset_${period}`)) || 0; } catch { /* ignore */ }
    }
    return 0;
  });
  const sliderRAFRef = useRef<number | null>(null);
  // 兼容受控模式：有外部值则以外部值为准
  const range = Math.min(period && rangeValue !== undefined && onRangeChange ? rangeValue : chartRange, klines.length);
  const updateRange = (v: number) => {
    if (period && rangeValue !== undefined && onRangeChange) {
      onRangeChange(v);
    } else {
      setChartRange(v);
    }
    if (period) { try { localStorage.setItem(`dividendChartRange_${period}`, String(v)); } catch { /* ignore */ } }
  };
  const updateOffset = (v: number) => {
    if (period && offsetValue !== undefined && onOffsetChange) {
      onOffsetChange(v);
    } else {
      setChartOffset(v);
    }
    if (period) { try { localStorage.setItem(`dividendChartOffset_${period}`, String(v)); } catch { /* ignore */ } }
  };
  // 价格曲线 Y 轴模式：'dynamic' = 按当前区间价格动态取范围；'history' = 按全历史价格区间锁定
  const [priceAxisMode, setPriceAxisMode] = useState<'dynamic' | 'history'>(() => {
    let v = 'dynamic';
    try { v = localStorage.getItem('dividendPriceYAxisMode') || 'dynamic'; } catch { /* ignore */ }
    // 兼容旧的 'fixed' 值，映射为最接近的 'dynamic'
    return v === 'dynamic' || v === 'history' ? v : 'dynamic';
  });

  const currentKlines = klines;
  if (!currentKlines || currentKlines.length === 0) return null;
  const maxRange = currentKlines.length;
  const options = [5, 10, 20, 30, 60, 120, 250, 500].filter(opt => opt <= maxRange);
  const maxOffset = Math.max(0, maxRange - range);
  const offset = Math.min(period && offsetValue !== undefined && onOffsetChange ? offsetValue : chartOffset, maxOffset);
  const dividend = fallbackDividend;
  const chartData = currentKlines.slice(-range - offset, currentKlines.length - offset).map(k => {
    const byYear = stock.dividendByYear || {};
    const y = parseInt(k.date.slice(0, 4), 10);
    const pointDividend = (!isNaN(y) && byYear[y] && byYear[y] > 0) ? byYear[y]
      : (!isNaN(y) && byYear[y - 1] && byYear[y - 1] > 0) ? byYear[y - 1]
      : dividend;
    const rate = k.close > 0 ? (pointDividend / k.close) * 100 : 0;
    return {
      date: k.date,
      price: k.close,
      dividend: pointDividend,
      rate: parseFloat(rate.toFixed(2)),
    };
  });
  // 计算 Y 轴 5 条等间距标尺
  const rates = chartData.map(d => d.rate);
  const rawMin = rates.length > 0 ? Math.min(...rates) : 0;
  const rawMax = rates.length > 0 ? Math.max(...rates) : 1;
  const pad = rates.length > 0 ? Math.max((rawMax - rawMin) * 0.1, 0.1) : 0.25;
  const yMin = rawMin - pad;
  const yMax = rawMax + pad;
  const yTicks = rates.length > 0
    ? Array.from({ length: 5 }, (_, i) => yMin + (yMax - yMin) * i / 4)
    : [0, 0.25, 0.5, 0.75, 1];
  const maxTickLen = yTicks.reduce((max, v) => Math.max(max, v.toFixed(1).length + 1), 0);
  const yAxisFontSize = maxTickLen > 5 ? 7 : 8;
  // 价格曲线 Y 轴范围：dynamic = 按当前窗口 chartData 价格 min/max ±10%；history = 按全历史价格 min/max ±10% 锁定
  const priceAxisDomain: [number, number] = (() => {
    const prices = priceAxisMode === 'history' ? currentKlines.map(k => k.close) : chartData.map(d => d.price);
    const pMin = Math.min(...prices);
    const pMax = Math.max(...prices);
    const pPad = Math.max((pMax - pMin) * 0.1, 0.1);
    return [pMin - pPad, pMax + pPad];
  })();
  // X 轴标尺：始终包含首尾日期，中间均匀分布
  const xTicks = chartData.length > 0
    ? Array.from({ length: 6 }, (_, i) => chartData[Math.round(i * (chartData.length - 1) / 5)]?.date).filter(Boolean)
    : [];
  return (
    <div className="border-t border-app-border bg-app-card pt-2">
      <div className="flex items-center mb-1">
        <span className="text-[10px] text-app-subtext">{title}</span>
        <button
          type="button"
          title=""
          className="ml-auto text-[9px] px-1.5 py-0.5 rounded border border-app-border text-[rgba(148,163,184,0.4)] hover:bg-app-hover/50 shrink-0"
          onClick={() => {
            const next = priceAxisMode === 'dynamic' ? 'history' : 'dynamic';
            setPriceAxisMode(next);
            try { localStorage.setItem('dividendPriceYAxisMode', next); } catch { /* ignore */ }
          }}
        >
          {priceAxisMode === 'dynamic' ? '区间价格' : '历史价格'}
        </button>
      </div>
      <div className="h-[120px] w-full select-none outline-none focus-visible:outline-2 focus-visible:outline-indigo-500/50 [&_svg]:outline-none [&_svg]:focus:outline-none">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 5, left: 2, bottom: 0 }}>
            {yTicks.map((v, i) => (
              <ReferenceLine key={`grid-h-${i}`} y={v} stroke="rgba(148,163,184,0.15)" strokeDasharray="3 3" />
            ))}
            <XAxis
              dataKey="date"
              tick={{ fontSize: 9, fill: '#94a3b8' }}
              stroke="rgba(148,163,184,0.3)"
              tickLine={false}
              axisLine={false}
              ticks={xTicks}
              tickMargin={6}
              tickFormatter={(v: string) => {
                const xFirst = xTicks[0];
                const xLast = xTicks[xTicks.length - 1];
                if (v === xFirst) return v;
                if (v === xLast && xLast?.slice(0, 4) !== xFirst?.slice(0, 4)) return v;
                return v.length >= 10 ? v.slice(5, 10) : v;
              }}
            />
            <YAxis
              tick={{ fontSize: yAxisFontSize, fill: '#94a3b8' }}
              stroke="rgba(148,163,184,0.3)"
              tickLine={false}
              axisLine={false}
              domain={[yTicks[0], yTicks[4]]}
              ticks={yTicks}
              width={30}
              tickFormatter={(v: number) => `${v.toFixed(1)}%`}
            />
            <YAxis
              yAxisId="price"
              orientation="right"
              hide={true}
              domain={priceAxisDomain}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(15,23,42,0.95)',
                border: '1px solid rgba(148,163,184,0.3)',
                borderRadius: 6,
                fontSize: 11,
                color: 'inherit',
              }}
              content={({ active, payload, label }) => {
                if (!active || !payload || !payload[0]) return null;
                const d = payload[0].payload;
                return (
                  <div className="bg-[rgba(15,23,42,0.95)] border border-[rgba(148,163,184,0.3)] rounded px-2 py-1.5 text-xs leading-relaxed">
                    <div className="text-app-subtext">{label}</div>
                    <div>股价: <span className="text-app-text">¥{d.price.toFixed(2)}</span></div>
                    <div>分红: <span className="text-app-text">{d.dividend.toFixed(3)} 元</span></div>
                    <div>股息率: <span className="text-green-400">{d.rate.toFixed(2)}%</span></div>
                  </div>
                );
              }}
              cursor={{ stroke: 'rgba(99,102,241,0.4)', strokeWidth: 1 }}
            />
            <Line
              type="monotone"
              dataKey="rate"
              stroke="#3b82f6"
              strokeWidth={1.8}
              dot={range >= 120 ? false : { r: 2, fill: '#3b82f6', strokeWidth: 0 }}
              activeDot={range >= 120 ? { r: 3 } : { r: 4 }}
              isAnimationActive={false}
            />
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="price"
              stroke="rgba(148,163,184,0.4)"
              strokeWidth={1}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-2 mt-1 mb-1.5">
        <input
          type="range"
          min={0}
          max={maxOffset}
          value={maxOffset - offset}
          onChange={(e) => {
            const newOffset = maxOffset - Number(e.target.value);
            if (sliderRAFRef.current) cancelAnimationFrame(sliderRAFRef.current);
            sliderRAFRef.current = requestAnimationFrame(() => {
              sliderRAFRef.current = null;
              updateOffset(newOffset);
            });
          }}
          className="flex-1 h-1.5 bg-app-input rounded-lg appearance-none cursor-pointer accent-gray-500 
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gray-500
            [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-gray-500 [&::-moz-range-thumb]:border-0"
        />
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            className="text-xs px-2.5 py-1 rounded-l bg-app-input text-app-subtext hover:bg-app-hover/50 disabled:opacity-30 disabled:cursor-not-allowed"
            disabled={options.indexOf(range) <= 0}
            onClick={() => {
              const idx = options.indexOf(range);
              if (idx > 0) {
                updateRange(options[idx - 1]);
                updateOffset(0);
              }
            }}
          >−</button>
          <span className="text-xs px-2.5 py-1 bg-app-input text-app-subtext select-none">{range}</span>
          <button
            type="button"
            className="text-xs px-2.5 py-1 rounded-r bg-app-input text-app-subtext hover:bg-app-hover/50 disabled:opacity-30 disabled:cursor-not-allowed"
            disabled={options.indexOf(range) >= options.length - 1}
            onClick={() => {
              const idx = options.indexOf(range);
              if (idx < options.length - 1) {
                updateRange(options[idx + 1]);
                updateOffset(0);
              }
            }}
          >+</button>
        </div>
      </div>
      {(() => {
        if (chartData.length === 0) return null;
        const byYear = stock.dividendByYear || {};
        const calcDividendForDate = (dateStr: string): { amount: number; isApproximate: boolean } => {
          if (!dateStr) return { amount: 0, isApproximate: false };
          const y = parseInt(dateStr.slice(0, 4), 10);
          if (isNaN(y)) return { amount: 0, isApproximate: false };
          if (byYear[y] && byYear[y] > 0) return { amount: byYear[y], isApproximate: false };
          if (byYear[y - 1] && byYear[y - 1] > 0) return { amount: byYear[y - 1], isApproximate: true };
          return { amount: 0, isApproximate: false };
        };
        const calcRate = (price: number, dividend: number): string => {
          if (!dividend || !price) return '-';
          return (dividend / price * 100).toFixed(2) + '%';
        };
        const calcRateColor = (price: number, dividend: number): string => {
          if (!dividend || !price) return 'text-app-subtext';
          return getDividendRateColor(dividend / price * 100, ranges);
        };
        const highItem = chartData.reduce((a, b) => a.price > b.price ? a : b);
        const lowItem = chartData.reduce((a, b) => a.price < b.price ? a : b);
        const highDiv = calcDividendForDate(highItem.date);
        const lowDiv = calcDividendForDate(lowItem.date);
        const highRate = calcRate(highItem.price, highDiv.amount);
        const lowRate = calcRate(lowItem.price, lowDiv.amount);
        const highRateColor = calcRateColor(highItem.price, highDiv.amount);
        const lowRateColor = calcRateColor(lowItem.price, lowDiv.amount);
        const highSymbol = !highDiv.amount ? '' : (highDiv.isApproximate ? '≈' : '=');
        const lowSymbol = !lowDiv.amount ? '' : (lowDiv.isApproximate ? '≈' : '=');
        return (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 p-1.5 rounded bg-app-input">
              <span className="text-[10px] text-app-subtext shrink-0">最高价</span>
              <span className="font-mono text-[10px] font-bold text-red-500 shrink-0">{formatPrice(highItem.price, stock.name)}</span>
              <span className="text-[10px] shrink-0">
                <span className="text-app-subtext">股息率</span>
                {highSymbol && <span className="text-app-subtext mx-0.5">{highSymbol}</span>}
                <span className={`font-mono font-bold ${highRateColor}`}>{highDiv.amount ? highRate : '-'}</span>
              </span>
              <span className="text-[10px] text-app-subtext ml-auto shrink-0">{highItem.date}</span>
            </div>
            <div className="flex items-center gap-2 p-1.5 rounded bg-app-input">
              <span className="text-[10px] text-app-subtext shrink-0">最低价</span>
              <span className="font-mono text-[10px] font-bold text-brand-green shrink-0">{formatPrice(lowItem.price, stock.name)}</span>
              <span className="text-[10px] shrink-0">
                <span className="text-app-subtext">股息率</span>
                {lowSymbol && <span className="text-app-subtext mx-0.5">{lowSymbol}</span>}
                <span className={`font-mono font-bold ${lowRateColor}`}>{lowDiv.amount ? lowRate : '-'}</span>
              </span>
              <span className="text-[10px] text-app-subtext ml-auto shrink-0">{lowItem.date}</span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export const StockDividendPage: React.FC<StockDividendPageProps> = ({ stocks, onStocksChange, isAdding, onCloseAdding, visibleColumns, dividendRateColumns, colorRanges, tagColors = {}, onTagColorsChange, maxRows = 15, maxWidth = 812, actionButtons, appVersion, onTogglePage, apiSource = 'tencent' as ApiSource, onResetStocks, resetSignal, dividendYearLeft = 2024, dividendYearRight = 2025, sortMode = 'default', onSortModeChange, memo, memoUpdatedAt, memoBaseline, onMemoChange, onMemoUpload, showRequestStats = true }) => {
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
  // 股息率曲线日线区间（本地记忆，供列表股息率列下方的历史比例计算使用）
  const [dailyChartRange, setDailyChartRange] = useState<number>(() => {
    try { return Number(localStorage.getItem('dividendChartRange_daily')) || 120; } catch { return 120; }
  });
  const [dailyChartOffset, setDailyChartOffset] = useState<number>(() => {
    try { return Number(localStorage.getItem('dividendChartOffset_daily')) || 0; } catch { return 0; }
  });
  const handleDailyRangeChange = (v: number) => {
    setDailyChartRange(v);
    try { localStorage.setItem('dividendChartRange_daily', String(v)); } catch { /* ignore */ }
  };
  const handleDailyOffsetChange = (v: number) => {
    setDailyChartOffset(v);
    try { localStorage.setItem('dividendChartOffset_daily', String(v)); } catch { /* ignore */ }
  };
  // 股票列表股息率区间内每日股息率：与 DividendRateCurve 的速率算法保持一致
  const rateForKline = (stock: StockEntry, k: BollKline, fallback: number): number => {
    const byYear = stock.dividendByYear || {};
    const y = parseInt(k.date.slice(0, 4), 10);
    const pointDividend = (!isNaN(y) && byYear[y] && byYear[y] > 0) ? byYear[y]
      : (!isNaN(y) && byYear[y - 1] && byYear[y - 1] > 0) ? byYear[y - 1]
      : fallback;
    return k.close > 0 ? (pointDividend / k.close) * 100 : 0;
  };
  // 计算当前股息率相对区间内历史最高/次高股息率的比例（%）；无数据返回 null
  const calcDivRateHistoryRatio = (stock: StockEntry, klines: BollKline[] | undefined, currentRate: number): number | null => {
    if (!klines || klines.length === 0 || stock.bollHidden || currentRate <= 0) return null;
    const fallback = getDividendForYear(stock, getSelectedYear(stock));
    const seg = klines.slice(-dailyChartRange - dailyChartOffset, klines.length - dailyChartOffset);
    if (seg.length === 0) return null;
    const rates = seg.map(k => rateForKline(stock, k, fallback)).filter(r => r > 0);
    // 取去重后的最大与次大值
    const uniq = Array.from(new Set(rates)).sort((a, b) => b - a);
    const maxRate = uniq[0];
    const secondMaxRate = uniq[1];
    const denom = (maxRate !== undefined && currentRate >= maxRate) ? secondMaxRate : maxRate;
    if (denom === undefined || denom <= 0) return null;
    return (currentRate / denom) * 100;
  };
  // 备忘录上传状态与错误提示
  const [memoUploading, setMemoUploading] = useState(false);
  const [memoToast, setMemoToast] = useState<string | null>(null);
  const memoToastTimer = useRef<number | null>(null);

  // 添加股票的进度提示与错误状态
  const [addStep, setAddStep] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  // 备忘录是否有未同步的改动（与最近一次上传/下载的文字不同）
  const memoDirty = (memo || '') !== (memoBaseline || '');

  const handleMemoUploadClick = async () => {
    if (memoUploading || !onMemoUpload) return;
    setMemoUploading(true);
    try {
      const ok = await onMemoUpload();
      if (!ok) {
        setMemoToast('备忘录上传失败，请检查网络或 Token 设置');
        if (memoToastTimer.current) window.clearTimeout(memoToastTimer.current);
        memoToastTimer.current = window.setTimeout(() => setMemoToast(null), 3000);
      }
    } finally {
      setMemoUploading(false);
    }
  };

  useEffect(() => {
    if (resetSignal !== undefined && resetSignal > 0) {
      setShowResetConfirm(true);
    }
  }, [resetSignal]);
  const handleSortModeChange = (mode: 'default' | 'dividendRate' | 'tag' | 'daily' | 'weekly' | 'monthly') => {
    if (onSortModeChange) onSortModeChange(mode);
  };
  // 布林线列排序方向：false=下→中→上，true=上→中→下
  const [bollSortReverse, setBollSortReverse] = useState(false);
  const handleBollSortClick = (period: 'daily' | 'weekly' | 'monthly') => {
    if (sortMode !== period) {
      // 切换到此列，初始正向（下→中→上）
      if (onSortModeChange) onSortModeChange(period);
      setBollSortReverse(false);
    } else {
      // 再次点击：正向与反向两档切换
      setBollSortReverse(prev => !prev);
    }
  };

  // 列表页股票名称支撑/压力位弹窗（hover 或 click）
  const handleListSrClick = (e: React.MouseEvent, stock: StockEntry, pin = false) => {
    e.stopPropagation();
    // 点击固定且当前正是同一股票的固定弹窗 → 再次点击收起
    if (pin && listSrTooltipPinned && listSrStock?.id === stock.id) {
      listSrHoveredRef.current = false;
      listSrActiveIdRef.current = undefined;
      setListSrTooltipPinned(false);
      setListSrPreviewText(null);
      setListSrStock(null);
      return;
    }
    const btn = e.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    listSrHoveredRef.current = true;
    listSrBtnRef.current = btn as unknown as HTMLButtonElement;
    listSrActiveIdRef.current = stock.id;
    setListSrTooltipPinned(pin);
    setListSrStock(stock);
    const adjustLabel = '前复权';
    const popupLogCtx = requestLogService.beginBatch('支撑/压力位预览：1 只股票 · 3 条请求');
    Promise.all([
      fetchBollData(stock.code, 'daily', 'qfq', apiSource, undefined, popupLogCtx),
      fetchBollData(stock.code, 'weekly', 'qfq', apiSource, undefined, popupLogCtx),
      fetchBollData(stock.code, 'monthly', 'qfq', apiSource, undefined, popupLogCtx),
    ]).then(([dailyR, weeklyR, monthlyR]) => {
      if (!listSrActiveIdRef.current || listSrActiveIdRef.current !== stock.id) return;
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
      listSrTooltipMeasuredSize.current = { w: tw, h: th };
      const gap = 8;
      let calcLeft = rect.left + rect.width + gap;
      let calcTop = rect.top + rect.height / 2 - th / 2;
      if (calcLeft + tw > window.innerWidth - 10) {
        calcLeft = rect.left - tw - gap;
      }
      if (calcLeft < 10) {
        calcLeft = (window.innerWidth - tw) / 2;
      }
      if (calcTop + th > window.innerHeight - 10) {
        calcTop = window.innerHeight - th - 10;
      }
      if (calcTop < 10) {
        calcTop = 10;
      }
      setListSrTooltipOffset(calcLeft);
      setListSrTooltipAbove(calcTop);
      setListSrPreviewText(text);
    });
  };

  // 悬停名称显示支撑/压力位（临时，不固定）
  const handleListSrHoverEnter = (e: React.MouseEvent, stock: StockEntry) => {
    // 已有任一弹窗被点击固定：悬停其他项目不触发新弹窗，保持固定弹窗
    if (listSrTooltipPinned || priceInfoPinned || positionInfoPinned || divRateInfoPinned) return;
    handleListSrClick(e, stock, false);
  };

  // 移开名称：非固定时关闭
  const handleListSrHoverLeave = () => {
    if (!listSrTooltipPinned) {
      listSrHoveredRef.current = false;
      listSrActiveIdRef.current = undefined;
      setListSrPreviewText(null);
    }
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
  const popupContentRef = useRef<HTMLDivElement>(null);
  const popupScrollPosRef = useRef(0);
  const [dividendRateChartRange, setDividendRateChartRange] = useState(120);
  const [dividendRateChartOffset, setDividendRateChartOffset] = useState(0);
  
  const sliderRAFRef = useRef<number | null>(null);
  const copyHoveredRef = useRef(false);
  const [copyPreviewPos, setCopyPreviewPos] = useState({ left: 0, top: 0 });
  const [srTooltipHidden, setSrTooltipHidden] = useState(false);

  // 列表页支撑/压力位弹窗状态
  const [listSrPreviewText, setListSrPreviewText] = useState<string | null>(null);
  const [listSrTooltipOffset, setListSrTooltipOffset] = useState(0);
  const [listSrTooltipAbove, setListSrTooltipAbove] = useState(0);
  const listSrBtnRef = useRef<HTMLButtonElement | null>(null);
  const listSrHoveredRef = useRef(false);
  const listSrActiveIdRef = useRef<string | undefined>(undefined);
  const [listSrCopied, setListSrCopied] = useState(false);
  const [listSrTooltipPinned, setListSrTooltipPinned] = useState(false);
  const listSrTooltipRef = useRef<HTMLDivElement | null>(null);
  const listSrTooltipMeasuredSize = useRef({ w: 0, h: 0 });
  const [listSrTooltipHidden, setListSrTooltipHidden] = useState(false);
  const listCopyHoveredRef = useRef(false);
  const [listCopyPreviewText, setListCopyPreviewText] = useState<string | null>(null);
  const [listCopyPreviewPos, setListCopyPreviewPos] = useState({ left: 0, top: 0 });
  // 当前点击的股票（用于列表页弹窗内的复制操作）
  const [listSrStock, setListSrStock] = useState<StockEntry | null>(null);

  // 价格技术指标浮窗（复用现有K线数据，不额外请求）
  const [priceInfoData, setPriceInfoData] = useState<IndicatorResult | null>(null);
  const [priceInfoStock, setPriceInfoStock] = useState<StockEntry | null>(null);
  const [priceInfoPos, setPriceInfoPos] = useState({ left: 0, top: 0 });
  const [priceInfoLoading, setPriceInfoLoading] = useState(false);
  const [priceInfoPinned, setPriceInfoPinned] = useState(false);
  const priceInfoBtnRef = useRef<HTMLTableCellElement | null>(null);
  const priceInfoRef = useRef<HTMLDivElement | null>(null);
  const priceInfoHoveredRef = useRef(false);
  const priceInfoActiveIdRef = useRef<string | undefined>(undefined);
  // 判断鼠标是否停留在价格浮窗内部（用 relatedTarget 配平，避免计数器泄漏）
  const isInsidePriceInfo = (node: Node | null) => !!node && !!priceInfoRef.current?.contains(node);

  // 股息率曲线浮窗（复用 DividendRateCurve 共享组件，hover 临时显示 / 点击固定，逻辑与价格浮窗一致）
  const [divRateInfoStock, setDivRateInfoStock] = useState<StockEntry | null>(null);
  const [divRateInfoKlines, setDivRateInfoKlines] = useState<BollKline[] | null>(null);
  const [divRateInfoPos, setDivRateInfoPos] = useState({ left: 0, top: 0 });
  const [divRateInfoLoading, setDivRateInfoLoading] = useState(false);
  const [divRateInfoPinned, setDivRateInfoPinned] = useState(false);
  const divRateInfoBtnRef = useRef<HTMLTableCellElement | null>(null);
  const divRateInfoRef = useRef<HTMLDivElement | null>(null);
  const divRateInfoHoveredRef = useRef(false);
  const divRateInfoActiveIdRef = useRef<string | undefined>(undefined);
  const isInsideDivRateInfo = (node: Node | null) => !!node && !!divRateInfoRef.current?.contains(node);

  // 持仓详情浮窗（hover 临时显示 / 点击固定，逻辑与价格浮窗一致，浮窗朝左侧展示）
  const [positionInfoStock, setPositionInfoStock] = useState<StockEntry | null>(null);
  const [positionInfoPos, setPositionInfoPos] = useState({ left: 0, top: 0 });
  const [positionInfoPinned, setPositionInfoPinned] = useState(false);
  const positionInfoBtnRef = useRef<HTMLTableCellElement | null>(null);
  const positionInfoRef = useRef<HTMLDivElement | null>(null);
  const positionInfoHoveredRef = useRef(false);
  const positionInfoActiveIdRef = useRef<string | undefined>(undefined);
  const isInsidePositionInfo = (node: Node | null) => !!node && !!positionInfoRef.current?.contains(node);

  // 显示价格技术指标浮窗（位置逻辑参考股票名称弹窗：右侧垂直居中）
  const openPriceInfo = (btn: HTMLElement, stock: StockEntry) => {
    const rect = btn.getBoundingClientRect();
    priceInfoBtnRef.current = btn as unknown as HTMLTableCellElement;
    priceInfoActiveIdRef.current = stock.id;
    setPriceInfoStock(stock);
    setPriceInfoLoading(true);
    setPriceInfoData(null);
    // 定位：参考名称弹窗，出现在价格右侧并垂直居中
    const popupW = 195;
    const estH = 330;
    const gap = 8;
    let left = rect.right + gap;
    let top = rect.top + rect.height / 2 - estH / 2;
    if (left + popupW > window.innerWidth - 10) left = rect.left - popupW - gap;
    if (left < 10) left = (window.innerWidth - popupW) / 2;
    if (top + estH > window.innerHeight - 10) top = window.innerHeight - estH - 10;
    if (top < 10) top = 10;
    setPriceInfoPos({ left, top });

    const popupLogCtx = requestLogService.beginBatch(`技术指标预览 ${stock.name}(${getDisplayCode(stock.code)})：1 只股票 · 1 条请求`);
    fetchBollData(stock.code, 'daily', bollAdjust, apiSource, undefined, popupLogCtx).then(result => {
      // 仅在仍是当前目标股票时应用结果（避免悬停切换/移开后残留旧数据）
      if (priceInfoActiveIdRef.current !== stock.id) return;
      // 用实时行情(开/高/低/量/现价)覆盖或追加今日K线，保证浮窗显示今日数据
      const merged = mergeTodayBarToKlines(result.data?.klines || [], stock);
      const ind = calcIndicators(merged);
      setPriceInfoData(ind);
      setPriceInfoLoading(false);
      // 自适应高度：数据渲染后用浮窗实际高度重算垂直居中
      requestAnimationFrame(() => {
        if (priceInfoActiveIdRef.current !== stock.id || !priceInfoBtnRef.current) return;
        const pRef = priceInfoRef.current;
        const popupH = pRef?.offsetHeight || 0;
        if (!popupH) return;
        const popupW = 195;
        const gap = 8;
        const btnRect = (priceInfoBtnRef.current as HTMLElement).getBoundingClientRect();
        let left = btnRect.right + gap;
        let top = btnRect.top + btnRect.height / 2 - popupH / 2;
        if (left + popupW > window.innerWidth - 10) left = btnRect.left - popupW - gap;
        if (left < 10) left = (window.innerWidth - popupW) / 2;
        if (top + popupH > window.innerHeight - 10) top = window.innerHeight - popupH - 10;
        if (top < 10) top = 10;
        setPriceInfoPos({ left, top });
      });
    });
  };

  // 悬停价格显示
  const handlePriceInfoEnter = (e: React.MouseEvent, stock: StockEntry) => {
    // 已有任一弹窗被点击固定：悬停其他项目不触发新弹窗，保持固定弹窗
    if (listSrTooltipPinned || priceInfoPinned || positionInfoPinned || divRateInfoPinned) return;
    priceInfoHoveredRef.current = true;
    openPriceInfo(e.currentTarget as HTMLElement, stock);
  };

  // 价格悬停离开：若鼠标移入浮窗内部则保留，否则关闭（未固定时）
  const handlePriceInfoLeave = (e?: React.MouseEvent) => {
    priceInfoHoveredRef.current = false;
    if (priceInfoPinned) return;
    if (e && isInsidePriceInfo(e.relatedTarget as Node | null)) return;
    priceInfoActiveIdRef.current = undefined;
    setPriceInfoStock(null);
    setPriceInfoData(null);
    setPriceInfoLoading(false);
  };

  // 浮窗悬停离开：仍在浮窗内部（子元素间移动）则保留，真正离开且未固定时关闭
  const handlePriceInfoFloatLeave = (e: React.MouseEvent) => {
    if (priceInfoPinned) return;
    if (isInsidePriceInfo(e.relatedTarget as Node | null)) return;
    priceInfoHoveredRef.current = false;
    priceInfoActiveIdRef.current = undefined;
    setPriceInfoStock(null);
    setPriceInfoData(null);
    setPriceInfoLoading(false);
  };

  // 点击价格：切换固定/取消固定
  const handlePriceInfoClick = (e: React.MouseEvent, stock: StockEntry) => {
    e.stopPropagation();
    if (priceInfoPinned && priceInfoStock?.id === stock.id) {
      // 取消固定并关闭
      priceInfoHoveredRef.current = false;
      priceInfoActiveIdRef.current = undefined;
      setPriceInfoPinned(false);
      setPriceInfoStock(null);
      setPriceInfoData(null);
      setPriceInfoLoading(false);
      return;
    }
    openPriceInfo(e.currentTarget as HTMLElement, stock);
    setPriceInfoPinned(true);
  };

  // 显示股息率曲线浮窗（位置参考价格浮窗：右侧垂直居中）
  const openDivRateInfo = (btn: HTMLElement, stock: StockEntry) => {
    const rect = btn.getBoundingClientRect();
    divRateInfoBtnRef.current = btn as unknown as HTMLTableCellElement;
    divRateInfoActiveIdRef.current = stock.id;
    setDivRateInfoStock(stock);
    setDivRateInfoLoading(true);
    setDivRateInfoKlines(null);
    const popupW = 330;
    const estH = 300;
    const gap = 8;
    let left = rect.right + gap;
    let top = rect.top + rect.height / 2 - estH / 2;
    if (left + popupW > window.innerWidth - 10) left = rect.left - popupW - gap;
    if (left < 10) left = (window.innerWidth - popupW) / 2;
    if (top + estH > window.innerHeight - 10) top = window.innerHeight - estH - 10;
    if (top < 10) top = 10;
    setDivRateInfoPos({ left, top });

    const popupLogCtx = requestLogService.beginBatch(`股息率曲线预览 ${stock.name}(${getDisplayCode(stock.code)})：1 只股票 · 1 条请求`);
    fetchBollData(stock.code, 'daily', bollAdjust, apiSource, undefined, popupLogCtx).then(result => {
      // 仅在仍是当前目标股票时应用结果（避免悬停切换/移开后残留旧数据）
      if (divRateInfoActiveIdRef.current !== stock.id) return;
      const klines = result.data?.klines || [];
      setDivRateInfoKlines(klines);
      setDivRateInfoLoading(false);
      // 自适应高度：数据渲染后用浮窗实际高度重算垂直居中
      requestAnimationFrame(() => {
        if (divRateInfoActiveIdRef.current !== stock.id || !divRateInfoBtnRef.current) return;
        const popupH = divRateInfoRef.current?.offsetHeight || 0;
        if (!popupH) return;
        const popupW = 330;
        const gap = 8;
        const btnRect = (divRateInfoBtnRef.current as HTMLElement).getBoundingClientRect();
        let left = btnRect.right + gap;
        let top = btnRect.top + btnRect.height / 2 - popupH / 2;
        if (left + popupW > window.innerWidth - 10) left = btnRect.left - popupW - gap;
        if (left < 10) left = (window.innerWidth - popupW) / 2;
        if (top + popupH > window.innerHeight - 10) top = window.innerHeight - popupH - 10;
        if (top < 10) top = 10;
        setDivRateInfoPos({ left, top });
      });
    });
  };

  // 悬停股息率列显示
  const handleDivRateInfoEnter = (e: React.MouseEvent, stock: StockEntry) => {
    // 已有任一弹窗被点击固定：悬停其他项目不触发新弹窗，保持固定弹窗
    if (listSrTooltipPinned || priceInfoPinned || positionInfoPinned || divRateInfoPinned) return;
    divRateInfoHoveredRef.current = true;
    openDivRateInfo(e.currentTarget as HTMLElement, stock);
  };

  // 股息率悬停离开：若鼠标移入浮窗内部则保留，否则关闭（未固定时）
  const handleDivRateInfoLeave = (e?: React.MouseEvent) => {
    divRateInfoHoveredRef.current = false;
    if (divRateInfoPinned) return;
    if (e && isInsideDivRateInfo(e.relatedTarget as Node | null)) return;
    divRateInfoActiveIdRef.current = undefined;
    setDivRateInfoStock(null);
    setDivRateInfoKlines(null);
    setDivRateInfoLoading(false);
  };

  // 浮窗悬停离开：仍在浮窗内部（子元素间移动）则保留，真正离开且未固定时关闭
  const handleDivRateInfoFloatLeave = (e: React.MouseEvent) => {
    if (divRateInfoPinned) return;
    if (isInsideDivRateInfo(e.relatedTarget as Node | null)) return;
    divRateInfoHoveredRef.current = false;
    divRateInfoActiveIdRef.current = undefined;
    setDivRateInfoStock(null);
    setDivRateInfoKlines(null);
    setDivRateInfoLoading(false);
  };

  // 点击股息率：切换固定/取消固定
  const handleDivRateInfoClick = (e: React.MouseEvent, stock: StockEntry) => {
    e.stopPropagation();
    if (divRateInfoPinned && divRateInfoStock?.id === stock.id) {
      // 取消固定并关闭
      divRateInfoHoveredRef.current = false;
      divRateInfoActiveIdRef.current = undefined;
      setDivRateInfoPinned(false);
      setDivRateInfoStock(null);
      setDivRateInfoKlines(null);
      setDivRateInfoLoading(false);
      return;
    }
    openDivRateInfo(e.currentTarget as HTMLElement, stock);
    setDivRateInfoPinned(true);
  };

  // 显示持仓详情浮窗（朝左侧展示，垂直居中；数据全部来自本地持仓，无需请求）
  const openPositionInfo = (btn: HTMLElement, stock: StockEntry) => {
    const rect = btn.getBoundingClientRect();
    positionInfoBtnRef.current = btn as unknown as HTMLTableCellElement;
    positionInfoActiveIdRef.current = stock.id;
    setPositionInfoStock(stock);
    const popupW = 220;
    const estH = 170;
    const gap = 8;
    let left = rect.left - popupW - gap;
    let top = rect.top + rect.height / 2 - estH / 2;
    // 左侧空间不足时翻转到右侧；两者都不足时居中
    if (left < 10) left = rect.right + gap;
    if (left + popupW > window.innerWidth - 10) left = (window.innerWidth - popupW) / 2;
    if (top + estH > window.innerHeight - 10) top = window.innerHeight - estH - 10;
    if (top < 10) top = 10;
    setPositionInfoPos({ left, top });
  };

  // 悬停持仓显示（临时，不固定）
  const handlePositionInfoEnter = (e: React.MouseEvent, stock: StockEntry) => {
    // 已有任一弹窗被点击固定：悬停其他项目不触发新弹窗，保持固定弹窗
    if (listSrTooltipPinned || priceInfoPinned || positionInfoPinned || divRateInfoPinned) return;
    positionInfoHoveredRef.current = true;
    openPositionInfo(e.currentTarget as HTMLElement, stock);
  };

  // 持仓悬停离开：若鼠标移入浮窗内部则保留，否则关闭（未固定时）
  const handlePositionInfoLeave = (e?: React.MouseEvent) => {
    positionInfoHoveredRef.current = false;
    if (positionInfoPinned) return;
    if (e && isInsidePositionInfo(e.relatedTarget as Node | null)) return;
    positionInfoActiveIdRef.current = undefined;
    setPositionInfoStock(null);
  };

  // 浮窗悬停离开：仍在浮窗内部（子元素间移动）则保留，真正离开且未固定时关闭
  const handlePositionInfoFloatLeave = (e: React.MouseEvent) => {
    if (positionInfoPinned) return;
    if (isInsidePositionInfo(e.relatedTarget as Node | null)) return;
    positionInfoHoveredRef.current = false;
    positionInfoActiveIdRef.current = undefined;
    setPositionInfoStock(null);
  };

  // 点击持仓：切换固定/取消固定
  const handlePositionInfoClick = (e: React.MouseEvent, stock: StockEntry) => {
    e.stopPropagation();
    if (positionInfoPinned && positionInfoStock?.id === stock.id) {
      // 取消固定并关闭
      positionInfoHoveredRef.current = false;
      positionInfoActiveIdRef.current = undefined;
      setPositionInfoPinned(false);
      setPositionInfoStock(null);
      return;
    }
    openPositionInfo(e.currentTarget as HTMLElement, stock);
    setPositionInfoPinned(true);
  };

  const [stockBollMap, setStockBollMap] = useState<Map<string, { daily: BollData | null; weekly: BollData | null; monthly: BollData | null }>>(new Map());
  const [stockBollErrorMap, setStockBollErrorMap] = useState<Map<string, { daily?: string; weekly?: string; monthly?: string }>>(new Map());
  const [isRefreshingBoll, setIsRefreshingBoll] = useState(false);

  // 列表当前显示顺序（按排序规则重排；默认顺序即 stocks 原序）
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
    } else if (sortMode === 'daily' || sortMode === 'weekly' || sortMode === 'monthly') {
      // 轨道分组排序：升序=下→中→上，降序=上→中→下；同一轨道内按偏离度百分比
      // （负数代表向下偏离最远的“下中的下”），升序时负数靠前、正数靠后，降序时相反，
      // 无数据排最后
      const bandRank = bollSortReverse
        ? { upper: 0, mid: 1, lower: 2, default: 3 }
        : { lower: 0, mid: 1, upper: 2, default: 3 };
      const rank = (stock: typeof stocks[number]) =>
        stock.bollHidden ? null : getBollPosition(stockBollMap.get(stock.id)?.[sortMode] ?? null, stock.price || 0);
      return [...stocks].sort((a, b) => {
        const pa = rank(a), pb = rank(b);
        if (!pa || !pb) return !pa && !pb ? 0 : pa ? -1 : 1;
        const ba = bandRank[pa.band] ?? 3, bb = bandRank[pb.band] ?? 3;
        if (ba !== bb) return ba - bb;
        return bollSortReverse ? pb.percent - pa.percent : pa.percent - pb.percent;
      });
    }
    return stocks;
  }, [stocks, sortMode, stockBollMap, bollSortReverse]);

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
    // 先递增版本号，让旧请求通过版本检查自行取消，避免新请求被阻塞无法产生日志
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
    const visibleTotal = countVisibleBollItems(stocks);
    const staleCount = countStaleBollCache(stocks, bollAdjust, apiSource, dynamicTTL);
    // 计算缓存时间信息用于日志
    const cacheTimestamps = getBollCacheTimestamps(stocks, bollAdjust, apiSource);
    const now = Date.now();
    let cacheInfoStr = '';
    if (cacheTimestamps.length > 0) {
      const maxTs = Math.max(...cacheTimestamps); // 使用最新缓存时间，更准确反映缓存有效期
      const isTrading = isTradingHours();
      const expiryTime = isTrading ? maxTs + dynamicTTL : now + dynamicTTL;
      cacheInfoStr = `（缓存时间：${formatCacheTime(maxTs)}，有效期至：${formatCacheTime(expiryTime)}）`;
    }
    const logCtx = requestLogService.beginBatch(
      staleCount === 0
        ? `${trigger}：${visibleTotal} 项缓存均未过期，无需请求${cacheInfoStr}`
        : `${trigger}：${staleCount}/${visibleTotal} 项已过期，重新请求 ${staleCount} 条请求${cacheInfoStr}`
    );
    const { allCached, cachedData } = checkAllBollCache(stocks, bollAdjust, apiSource, dynamicTTL, logCtx, batchTimestamp);
    
    if (fetchVersionRef.current !== currentVersion) {
      // 已被新请求取消，旧请求中止，新请求会负责最终的清理
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
    // 请求顺序遵循列表当前的排列顺序（sortedStocks），而非固定固有顺序
    const order = sortedStocks;
    for (let i = 0; i < order.length; i++) {
      // 检查版本号，如果已被新请求替代则取消
      if (fetchVersionRef.current !== currentVersion) {
        // 已被新请求取消，旧请求中止，新请求会负责最终的清理
        return;
      }
      
      const stock = order[i];
      
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
        // 已被新请求取消，旧请求中止，新请求会负责最终的清理
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
      if (i < order.length - 1) {
        for (let w = 0; w < 25; w++) {
          await new Promise(resolve => setTimeout(resolve, 10));
          if (fetchVersionRef.current !== currentVersion) {
            // 已被新请求取消，旧请求中止，新请求会负责最终的清理
            return;
          }
        }
      }
    }
    isFetchingRef.current = false;
    setIsRefreshingBoll(false);
  }, [stocks, bollAdjust, apiSource, sortedStocks]);

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

  // 列表页价格弹窗：点击外部关闭
  useEffect(() => {
    if (!priceInfoPinned) return;
    const handler = (e: MouseEvent) => {
      if (priceInfoRef.current && !priceInfoRef.current.contains(e.target as Node) &&
          priceInfoBtnRef.current && !priceInfoBtnRef.current.contains(e.target as Node)) {
        priceInfoHoveredRef.current = false;
        priceInfoActiveIdRef.current = undefined;
        setPriceInfoPinned(false);
        setPriceInfoStock(null);
        setPriceInfoData(null);
        setPriceInfoLoading(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [priceInfoPinned]);

  // 列表页持仓浮窗：点击外部关闭
  useEffect(() => {
    if (!positionInfoPinned) return;
    const handler = (e: MouseEvent) => {
      if (positionInfoRef.current && !positionInfoRef.current.contains(e.target as Node) &&
          positionInfoBtnRef.current && !positionInfoBtnRef.current.contains(e.target as Node)) {
        positionInfoHoveredRef.current = false;
        positionInfoActiveIdRef.current = undefined;
        setPositionInfoPinned(false);
        setPositionInfoStock(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [positionInfoPinned]);

  // 列表页股息率浮窗：点击外部关闭
  useEffect(() => {
    if (!divRateInfoPinned) return;
    const handler = (e: MouseEvent) => {
      if (divRateInfoRef.current && !divRateInfoRef.current.contains(e.target as Node) &&
          divRateInfoBtnRef.current && !divRateInfoBtnRef.current.contains(e.target as Node)) {
        divRateInfoHoveredRef.current = false;
        divRateInfoActiveIdRef.current = undefined;
        setDivRateInfoPinned(false);
        setDivRateInfoStock(null);
        setDivRateInfoKlines(null);
        setDivRateInfoLoading(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [divRateInfoPinned]);

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

  // 列表页支撑/压力位弹窗：点击外部关闭
  useEffect(() => {
    if (!listSrTooltipPinned) return;
    const handler = (e: MouseEvent) => {
      if (listSrTooltipRef.current && !listSrTooltipRef.current.contains(e.target as Node) &&
          listSrBtnRef.current && !listSrBtnRef.current.contains(e.target as Node)) {
        setListSrTooltipPinned(false);
        setListSrPreviewText(null);
        setListSrStock(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [listSrTooltipPinned]);

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
      // 浏览器宽度不足以同时展示时，居中显示
      if (calcLeft + w > window.innerWidth - 10) {
        calcLeft = (window.innerWidth - w) / 2;
      }
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
    open: number;
    volume: number;
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
            const open = parseFloat(data[5]);
            const volume = parseFloat(data[6]);
            // 腾讯实时行情：data[33]最高、data[34]最低
            const high = parseFloat(data[33]);
            const low = parseFloat(data[34]);
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
              open: open || price,
              volume: volume || 0,
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
            high: result.high,
            low: result.low,
            open: result.open,
            volume: result.volume,
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
    // 计算缓存时间信息用于日志
    const priceTimestamps = stocks.map(s => s.priceUpdatedAt).filter((t): t is number => t !== null && t !== undefined);
    let cacheInfoStr = '';
    const now = Date.now();
    if (priceTimestamps.length > 0) {
      const minTs = Math.min(...priceTimestamps);
      const isTrading = isTradingHours();
      const expiryTime = isTrading ? minTs + getDynamicCacheTTL() : now + getDynamicCacheTTL();
      cacheInfoStr = `（缓存时间：${formatCacheTime(minTs)}，有效期至：${formatCacheTime(expiryTime)}）`;
    }
    let refreshReason: string;
    if (skipFresh) {
      refreshReason = staleCount === 0
        ? `打开股息页自动刷新股价：${stocks.length} 只股票缓存均未过期，无需请求${cacheInfoStr}`
        : `打开股息页自动刷新股价：${staleCount}/${stocks.length} 只已过期，重新请求 ${staleCount} 条请求${cacheInfoStr}`;
    } else if (marketClosed) {
      refreshReason = staleCount === 0
        ? `点击「价格」列头刷新（休市）：${stocks.length} 只股票缓存均未过期，无需请求${cacheInfoStr}`
        : `点击「价格」列头刷新（休市）：${staleCount}/${stocks.length} 只已过期，重新请求 ${staleCount} 条请求${cacheInfoStr}`;
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
            high: result.high,
            low: result.low,
            open: result.open,
            volume: result.volume,
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
      // 提取最近一次股权登记日
      const futureRegDate = result.records
        ?.filter(r => r.registerDate)
        .map(r => r.registerDate!)
        .sort()
        .reverse()[0];
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
        registerDate: futureRegDate,
      });
      // 默认全部勾选所有有数据的股票
      if (result.found && !result.error) selected.add(stock.id);
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
    // 提取最近一次股权登记日
    const futureRegDate = result.records
      ?.filter(r => r.registerDate)
      .map(r => r.registerDate!)
      .sort()
      .reverse()[0];
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
      registerDate: futureRegDate,
    };
    setDividendDiff([entry]);
    setSelectedDividendIds(result.found && !result.error ? new Set([stock.id]) : new Set());
    setIsFetchingSingleDividend(null);
  }, [isFetchingSingleDividend, dividendYearLeft, dividendYearRight]);

  // 导出内置分红数据（临时功能，用于填充 createDefaultStocks）
  const handleExportDefaultData = useCallback(() => {
    const lines = stocks.map(s => {
      const years = Object.entries(s.dividendByYear || {})
        .sort(([a], [b]) => Number(b) - Number(a))
        .map(([y, v]) => `${y}: ${Number(v).toFixed(4)}`)
        .join(', ');
      return `  { code: '${s.code}', name: '${s.name}', dividendByYear: { ${years} } }`;
    });
    const code = `const stockData = [\n${lines.join(',\n')}\n];`;
    navigator.clipboard.writeText(code).then(() => {
      showNotice('内置分红数据已复制到剪贴板，请粘贴给开发者');
    });
  }, [stocks]);

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
      // 从 records 中提取最近一次股权登记日
      const futureRegDate = entry.records
        ?.filter(r => r.registerDate)
        .map(r => r.registerDate!)
        .sort()
        .reverse()[0];
      return {
        ...stock,
        dividend2024,
        dividend2025,
        dividendByYear,
        dividendRate2025,
        dividendRates: calculateDividendRates(selectedDividend, rateCols),
        registerDate: futureRegDate || stock.registerDate,
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

    setAddError(null);
    setAddStep('正在获取股价…');
    setIsRefreshing(new Set(['new']));
    try {
      // 步骤1：获取实时股价
      const priceLogCtx = requestLogService.beginBatch('添加股票查询股价：1 只股票 · 1 条请求');
      const result = await fetchStockPrice(stockCode, priceLogCtx);
      if (!result) {
        setAddError('未获取到实时价格，请检查股票代码或网络后重试');
      }

      // 步骤2：自动查询该股票的 2024/2025 全年分红（查不到则保持 0，可稍后用"自动获取分红"批量补）
      let dividend2024 = 0;
      let dividend2025 = 0;
      let dividendByYear: Record<number, number> = {};
      let registerDate: string | undefined;
      setAddStep('正在请求年度分红数据…');
      try {
        const divLogCtx = requestLogService.beginBatch('添加股票查询分红：1 只股票 · 1~2 条请求');
        const divResult = await fetchYearlyDividends(stockCode, divLogCtx);
        if (divResult.found) {
          dividend2024 = divResult.dividend2024;
          dividend2025 = divResult.dividend2025;
          dividendByYear = divResult.dividendByYear;
          // 与批量获取分红一致的逻辑：从 records 提取最近一次股权登记日
          registerDate = divResult.records
            ?.filter(r => r.registerDate)
            .map(r => r.registerDate!)
            .sort()
            .reverse()[0];
        }
      } catch (e) {
        // 分红获取失败不影响添加股票，但给出可排查的状态
        setAddError(e instanceof Error ? `查询分红失败：${e.message}` : '查询分红失败：未知错误');
      }

      // 步骤3：写入列表
      setAddStep('正在写入列表…');
      const newEntry: StockEntry = {
        id: Date.now().toString(),
        code: stockCode,
        name: newStock.name || result?.name || stockCode,
        price: result?.price || 0,
        changePercent: result?.changePercent || 0,
        high: result?.high || 0,
        low: result?.low || 0,
        open: result?.open || 0,
        volume: result?.volume || 0,
        dividend2024,
        dividend2025,
        dividendByYear,
        dividendRate2025: 0,
        positionShares: 0,
        positionCost: 0,
        priceUpdatedAt: result ? Date.now() : null,
        dividendRates: calculateDividendRates(dividend2025),
        registerDate,
      };

      onStocksChange([...stocks, newEntry]);
      setNewStock({ code: '', name: '' });
      setAddStep(null);
      setAddError(null);
      onCloseAdding();
    } catch (e) {
      // 网络请求等异常：给出状态与错误信息便于排查，弹窗保持打开
      setAddStep(null);
      setAddError(e instanceof Error ? `添加失败：${e.message}` : '添加失败：未知错误');
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
        <div className="w-full flex items-center gap-3" style={{ maxWidth }}>
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
        <div className="bg-app-card border border-app-border rounded-xl overflow-hidden shadow-sm w-full" style={{ maxWidth }}>
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
              html, body {
                scrollbar-width: none;
                -ms-overflow-style: none;
              }
              html::-webkit-scrollbar, body::-webkit-scrollbar {
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
              {cols.includes('position') && <col style={{ width: '70px' }} />}
              {dividendYearCols.map(yearCol => <col key={yearCol} style={{ width: '50px' }} />)}
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
                onClick={() => { setBollAdjust(bollAdjust === 'qfq' ? 'none' : 'qfq'); setDividendRateChartRange(120); }}
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
                {cols.includes('position') && <th
                  className="px-1 py-2 text-center text-xs uppercase font-bold text-app-subtext tracking-wider bg-app-input whitespace-nowrap border-b border-app-border border-r border-app-border"
                >
                  持仓
                </th>}
                {dividendYearCols.length > 0 && <th
                  colSpan={dividendYearCols.length + 1}
                  className="px-1 py-2 text-center text-xs uppercase font-bold text-app-subtext tracking-wider border-b border-app-border border-r border-app-border bg-app-input whitespace-nowrap"
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
                <th className="px-1 py-2 text-center text-xs uppercase font-bold text-app-subtext tracking-wider bg-app-input whitespace-nowrap border-b border-app-border" rowSpan={2}>操作</th>
              </tr>
              <tr className="bg-app-input">
                {(cols.includes('code') || cols.includes('name')) && <th className="px-2 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border sticky left-[36px] z-10">代码</th>}
                {(cols.includes('dividendRate') || cols.includes('price') || cols.includes('changePercent')) && <th colSpan={3} className="px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border whitespace-nowrap">{latestUpdateTime > 0 ? formatRelativeTime(latestUpdateTime) : '--'}</th>}
                <th className="px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border cursor-pointer select-none hover:bg-app-card transition-colors" onClick={() => handleBollSortClick('daily')}>日线</th>
                <th className="px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border cursor-pointer select-none hover:bg-app-card transition-colors" onClick={() => handleBollSortClick('weekly')}>周线</th>
                <th className="px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border cursor-pointer select-none hover:bg-app-card transition-colors" onClick={() => handleBollSortClick('monthly')}>月线</th>
                {cols.includes('position') && <th
                  className="px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border cursor-pointer select-none hover:bg-app-card transition-colors"
                  onClick={cyclePositionMode}
                  title={`点击切换展示：股息率 / 份额 / 成本`}
                >
                  {POSITION_MODE_LABEL[positionDisplayMode]}
                </th>}
                {dividendYearCols.map((yearCol, idx) => (
                  <th key={yearCol} className="px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border">
                    {yearCol === 'dividendLeft' ? dividendYearLeft : dividendYearRight}
                  </th>
                ))}
                {dividendYearCols.length > 0 && <th className="px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border whitespace-nowrap w-0">登记日</th>}
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
                        <div className="relative flex items-center justify-center h-8 whitespace-nowrap cursor-pointer" onClick={(e) => handleListSrClick(e, stock, true)} onMouseEnter={(e) => handleListSrHoverEnter(e, stock)} onMouseLeave={() => handleListSrHoverLeave()}>
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
                  {cols.includes('dividendRate') && <td
                    onMouseEnter={(e) => handleDivRateInfoEnter(e, stock)}
                    onMouseLeave={handleDivRateInfoLeave}
                    onClick={(e) => handleDivRateInfoClick(e, stock)}
                    className="px-1 py-1.5 text-center border-r border-app-border cursor-pointer hover:bg-app-input/50 transition-colors"
                    title=""
                  >
                    <div className="flex flex-col items-center leading-none gap-0.5">
                      <span className={`font-mono text-xs font-bold ${getDividendRateColor(getDividendRate(stock), ranges)}`}>
                        {getDividendRate(stock) > 0 ? formatPercent(getDividendRate(stock)) : '--'}
                      </span>
                      {(() => {
                        const cur = getDividendRate(stock);
                        if (cur <= 0) return null;
                        const klines = stockBollMap.get(stock.id)?.daily?.klines;
                        const ratio = calcDivRateHistoryRatio(stock, klines, cur);
                        return (
                          <span className="font-mono text-[10px] text-app-rowtext">
                            {ratio !== null ? `${Math.round(ratio)}%` : '--'}
                          </span>
                        );
                      })()}
                    </div>
                  </td>}
                  {cols.includes('price') && <td
                    onMouseEnter={(e) => handlePriceInfoEnter(e, stock)}
                    onMouseLeave={handlePriceInfoLeave}
                    onClick={(e) => handlePriceInfoClick(e, stock)}
                    className="px-1 py-1.5 text-center border-r border-app-border cursor-pointer hover:bg-app-input/50 transition-colors"
                    title=""
                  >
                    <div className="flex items-center justify-center gap-0.5">
                      <span className={`font-mono text-xs font-bold ${stock.changePercent >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>
                        {formatPrice(stock.price, stock.name)}
                      </span>
                      {refreshFailed.has(stock.id) && (
                            <span onClick={(e) => { e.stopPropagation(); handleRefreshPrice(stock.id); }} className="cursor-pointer text-brand-yellow hover:opacity-80" title="重新刷新股价"><RefreshCw size={10} /></span>
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
                            const popupH = window.innerHeight * 0.9;
                            const centerY = window.innerHeight / 2;
                            let top = centerY - popupH / 2;
                            top = Math.max(12, Math.min(top, window.innerHeight - popupH - 12));
                            setBollPeriod(key);
                            setDividendRateChartRange(120);
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
                    const positionPct = cost > 0 && stock.price > 0 ? ((stock.price - cost) / cost) * 100 : 0;
                    const positionPctStr = cost > 0 && stock.price > 0 ? `${positionPct >= 0 ? '+' : ''}${positionPct.toFixed(2)}%` : '';
                    // 股息率差值：基于成本的股息率 - 基于现价的股息率
                    const costYield = dividend > 0 && cost > 0 ? (dividend / cost) * 100 : null;
                    const priceYield = dividend > 0 && (stock.price || 0) > 0 ? (dividend / (stock.price || 0)) * 100 : null;
                    const yieldDiff = costYield != null && priceYield != null ? costYield - priceYield : null;
                    const yieldDiffStr = yieldDiff != null ? `${yieldDiff >= 0 ? '+' : ''}${yieldDiff.toFixed(2)}%` : '';
                    const showPct = (positionDisplayMode !== 'shares' && cost > 0 && stock.price > 0);
                    const totalAmount = shares > 0 && cost > 0 ? `¥${Math.round(shares * cost).toLocaleString()}` : '-';
                    const hasPosition = shares > 0 || cost > 0;
                    const displayValue = positionDisplayMode === 'shares'
                      ? sharesText
                      : positionDisplayMode === 'cost'
                        ? costText
                        : yieldPct;
                    return (
                      <td
                        className="px-1 py-1.5 text-center border-r border-app-border cursor-pointer"
                        onMouseEnter={(e) => { if (editingId !== stock.id && hasPosition) handlePositionInfoEnter(e, stock); }}
                        onMouseLeave={handlePositionInfoLeave}
                        onClick={(e) => { if (editingId !== stock.id && hasPosition) handlePositionInfoClick(e, stock); }}
                      >
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
                        ) : positionDisplayMode === 'shares' ? (
                          hasPosition ? (
                            <div className="flex flex-col items-center leading-tight">
                              <span className="font-mono text-[11px] whitespace-nowrap text-app-rowtext">{totalAmount}</span>
                              <span className="font-mono text-[10px] text-app-rowtext">{displayValue}</span>
                            </div>
                          ) : (
                            <span className="font-mono text-[11px] whitespace-nowrap text-app-rowtext">-</span>
                          )
                        ) : showPct ? (
                          <div className="flex flex-col items-center leading-tight">
                            <span className={`font-mono text-[11px] whitespace-nowrap ${costColor}`}>{displayValue}</span>
                            <span className="font-mono text-[10px] text-app-rowtext">{positionDisplayMode === 'yield' ? yieldDiffStr : positionPctStr}</span>
                          </div>
                        ) : (
                          <span className={`font-mono text-[11px] whitespace-nowrap ${costColor}`}>{displayValue}</span>
                        )}
                      </td>
                    );
                  })()}
                  {dividendYearCols.map((yearCol, idx) => {
                    const year = yearCol === 'dividendLeft' ? dividendYearLeft : dividendYearRight;
                    const value = getDividendForYear(stock, year);
                    const isSelected = getSelectedYear(stock) === year;
                    const otherYear = yearCol === 'dividendLeft' ? dividendYearRight : dividendYearLeft;
                    const otherValue = getDividendForYear(stock, otherYear);
                    const selectedColor = value > otherValue ? 'text-brand-red' : value < otherValue ? 'text-brand-green' : 'text-blue-400';
                    return (
                      <td key={yearCol} className="px-1 py-1.5 text-center cursor-pointer border-r border-app-border" onClick={() => {
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
                  {dividendYearCols.length > 0 && (
                    <td className="px-1 py-1.5 text-center border-r border-app-border">
                      {(() => {
                        if (!stock.registerDate) return <span className="text-app-subtext">-</span>;
                        const today = new Date();
                        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                        const regDate = new Date(stock.registerDate);
                        const isToday = stock.registerDate === todayStr;
                        const isFuture = !isToday && regDate >= today;
                        const parts = stock.registerDate.split('-');
                        const dateLabel = `${parseInt(parts[1])}月${parseInt(parts[2])}日`;
                        const dateColor = isToday ? 'text-brand-red' : isFuture ? 'text-orange-400' : 'text-app-rowtext';
                        return (
                          <span className={`font-mono text-xs ${dateColor}`}>
                            {dateLabel}
                          </span>
                        );
                      })()}
                    </td>
                  )}
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

      {/* 备忘录模块（随云端同步） */}
      <div className="flex justify-center">
        <div className="bg-app-card border border-app-border rounded-xl overflow-hidden shadow-sm w-full mt-1" style={{ maxWidth }}>
          <div className="flex items-center justify-between px-3 py-2 border-b border-app-border bg-app-input">
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] font-bold text-app-subtext tracking-wider uppercase">交易备忘录</span>
              {memoDirty && (
                <button
                  onClick={handleMemoUploadClick}
                  disabled={memoUploading}
                  title="上传备忘录到云端"
                  className="p-0.5 text-app-subtext hover:text-app-text transition-colors"
                >
                  {memoUploading ? (
                    <RefreshCw className="w-3 h-3 animate-spin" />
                  ) : (
                    <CloudUpload className="w-3 h-3" />
                  )}
                </button>
              )}
            </div>
            <span className="text-[10px] text-app-rowtext font-mono opacity-60">{formatMemoTime(memoUpdatedAt)}</span>
          </div>
          <textarea
            value={memo || ''}
            onChange={(e) => onMemoChange?.(e.target.value)}
            placeholder="在这里记录备忘内容…"
            rows={4}
            className="w-full bg-app-card text-app-subtext text-[11px] leading-relaxed tracking-wider p-3 outline-none resize-y focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-all"
          />
        </div>
      </div>

      {/* 备忘录上传失败 toast 提示 */}
      {memoToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] bg-app-card border border-app-border rounded-lg px-4 py-2 text-xs text-app-text shadow-lg">
          {memoToast}
        </div>
      )}

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
                  setAddStep(null);
                  setAddError(null);
                }}
                className="flex-1 py-2 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 transform active:scale-[0.98] border border-app-border text-app-subtext hover:bg-app-input hover:text-app-text"
              >
                取消
              </button>
              <button
                onClick={handleAddStock}
                disabled={!newStock.code.trim() || isRefreshing.has('new') || addStep !== null}
                className="flex-1 py-2 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 transform active:scale-[0.98] disabled:opacity-50 bg-brand-yellow text-slate-900 hover:bg-[#fdd835]"
              >
                {addStep !== null ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
                {addStep !== null ? '添加中…' : '添加'}
              </button>
            </div>
            {/* 添加进度与错误提示 */}
            {(addStep !== null || addError) && (
              <div className="mt-3 space-y-1.5">
                {addStep !== null && (
                  <div className="flex items-center gap-2 text-[11px] text-app-text bg-app-input border border-app-border rounded-lg px-2.5 py-1.5">
                    <RefreshCw size={11} className="animate-spin text-app-subtext shrink-0" />
                    <span>{addStep}</span>
                  </div>
                )}
                {addError && (
                  <div className="text-[11px] leading-snug text-brand-red bg-app-input border border-brand-red/30 rounded-lg px-2.5 py-1.5 break-all">
                    <span className="font-bold mr-1">错误</span>{addError}
                  </div>
                )}
              </div>
            )}
          </div>
        </>,
        document.body
      )}

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
        
        const reloadBoll = (period: BollPeriod, adjust: BollAdjust, savedScrollPos?: number) => {
          setBollData(null);
          setBollError(null);
          setBollUnsupported(false);
          if (stock.bollHidden) return;
          const popupLogCtx = requestLogService.beginBatch('切换布林线周期/复权：1 只股票 · 1 条请求');
          fetchBollData(stock.code, period, adjust, apiSource, undefined, popupLogCtx).then(result => {
            setBollData(result.data);
            setBollError(result.error || null);
            setBollUnsupported(result.unsupported || false);
            // 恢复弹窗滚动位置
            if (savedScrollPos !== undefined && savedScrollPos > 0) {
              requestAnimationFrame(() => {
                if (popupContentRef.current) {
                  popupContentRef.current.scrollTop = savedScrollPos;
                }
              });
            }
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
              className="fixed z-50 bg-app-card border border-app-border rounded-lg shadow-xl w-[340px] flex flex-col"
              style={{ top: ratesPopupPos.top, left: ratesPopupPos.left, maxHeight: window.innerHeight * 0.9 }}
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
            <div ref={popupContentRef} className="flex-1 overflow-y-auto px-3" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
              <div className="text-[10px] text-app-subtext mb-2">
                股息率对应股价（基于{getSelectedYear(stock)}年分红 ¥{formatPrice(getDividendForYear(stock, getSelectedYear(stock)), stock.name)}）
              </div>
              <div className="grid grid-cols-3 gap-1 mb-3">
                {(() => {
                  const currentRate = getDividendRate(stock);
                  const dividend = getDividendForYear(stock, getSelectedYear(stock)) || 0;
                  // 以当前股息率最近的 0.5 网格为中心，左右各 4 格按 0.5 递增/递减（共 9 格）
                  const centerRate = Math.round(currentRate * 2) / 2;
                  const rates = Array.from({ length: 9 }, (_, i) => centerRate - 4 * 0.5 + i * 0.5);
                  const rateColorClass = getDividendRateColor(centerRate, ranges);
                  return rates.map((rateNum, idx) => {
                    const isCurrentRate = idx === 4; // 中心格
                    const rateLabel = `${rateNum.toFixed(1)}%`;
                    const price = dividend > 0 ? dividend / (rateNum / 100) : 0;
                    return (
                      <div key={rateLabel} className={`flex flex-col items-center p-1 rounded ${isCurrentRate ? 'bg-indigo-500/10 ring-1 ring-indigo-500/30' : 'bg-app-input'}`}>
                        <span className={`text-[10px] ${isCurrentRate ? rateColorClass : 'text-app-subtext'}`}>{rateLabel}</span>
                        <span className={`font-mono text-xs font-bold ${isCurrentRate ? rateColorClass : 'text-app-subtext'}`}>
                          {price > 0 ? formatPrice(price, stock.name) : '-'}
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
                          // 浏览器宽度不足以同时展示时，居中显示
                          if (calcLeft + tw > window.innerWidth - 10) {
                            calcLeft = (window.innerWidth - tw) / 2;
                          }
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
                          // 浏览器宽度不足以同时展示时，居中显示
                          if (calcLeft + tw > window.innerWidth - 10) {
                            calcLeft = (window.innerWidth - tw) / 2;
                          }
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
                      className={`fixed z-[60] bg-app-card border border-slate-500/40 rounded px-2.5 py-1.5 text-[11px] font-mono text-app-subtext whitespace-pre shadow-[0_8px_30px_rgba(0,0,0,0.55)] leading-relaxed text-left${srTooltipHidden ? ' invisible' : ''}`}
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
                            <div className="fixed z-[70] bg-app-card border border-slate-500/40 rounded px-2 py-1 text-[11px] font-mono text-app-subtext whitespace-pre shadow-[0_8px_30px_rgba(0,0,0,0.55)] leading-relaxed text-left" style={{ left: copyPreviewPos.left, top: copyPreviewPos.top, tabSize: 8 }}>
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
                      onClick={() => { popupScrollPosRef.current = popupContentRef.current?.scrollTop || 0; setBollPeriod(p); setDividendRateChartRange(120); setDividendRateChartOffset(0); reloadBoll(p, bollAdjust, popupScrollPosRef.current); }}
                      className={`px-2 py-1 text-[11px] rounded transition-colors ${bollPeriod === p ? 'bg-indigo-500/20 text-indigo-400' : 'bg-app-input text-app-subtext hover:bg-app-input/80'}`}
                    >
                      {p === 'daily' ? '日线' : p === 'weekly' ? '周线' : '月线'}
                    </button>
                  ))}
                  <div className="w-px h-3 bg-app-border mx-0.5" />
                  {(['qfq', 'none'] as BollAdjust[]).map(a => (
                    <button
                      key={a}
                      onClick={() => { popupScrollPosRef.current = popupContentRef.current?.scrollTop || 0; setBollAdjust(a); setDividendRateChartRange(120); setDividendRateChartOffset(0); reloadBoll(bollPeriod, a, popupScrollPosRef.current); }}
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
                    {(() => {
                      const bandLabels: { band: string; label: string; value: number | undefined; labelColor: string; valueColor: string }[] = [
                        { band: 'mid', label: getBollBandLabel(bollPeriod, 'mid'), value: bollData?.mid, labelColor: 'text-blue-500', valueColor: 'text-blue-500' },
                        { band: 'upper', label: getBollBandLabel(bollPeriod, 'upper'), value: bollData?.upper, labelColor: 'text-brand-red', valueColor: 'text-red-500' },
                        { band: 'lower', label: getBollBandLabel(bollPeriod, 'lower'), value: bollData?.lower, labelColor: 'text-brand-green', valueColor: 'text-brand-green' },
                      ];
                      const pos = bollData && stock.price ? getBollPosition(bollData, stock.price) : null;
                      const absPct = pos ? Math.abs(pos.percent) : 0;
                      const arrowCount = absPct <= 0.5 ? 0 : absPct <= 3 ? 1 : absPct <= 6 ? 2 : 3;
                      const arrow = pos && arrowCount > 0 ? (pos.percent >= 0 ? '↑' : '↓').repeat(arrowCount) : '';
                      const isCounter = pos && ((pos.band === 'upper' && pos.percent < 0) || (pos.band === 'lower' && pos.percent >= 0));
                      return bandLabels.map(({ band, label, value, labelColor, valueColor }) => {
                        const isClosest = pos && pos.band === band;
                        const showArrow = isClosest && arrowCount > 0 && arrow;
                        // 价格非常接近该轨道（≤0.5%）→ 不加箭头，加下划线
                        const showUnderline = isClosest && arrowCount === 0;
                        const displayArrow = showArrow ? (isCounter ? arrow : '') : '';
                        const displayArrowAfter = showArrow ? (!isCounter ? arrow : '') : '';
                        return (
                          <div key={band} className="flex flex-col items-center p-1 rounded bg-app-input">
                            <span className={`text-[11px] font-bold ${labelColor}`}>
                              {displayArrow}{showUnderline ? `- ${label} -` : label}{displayArrowAfter}
                            </span>
                            <span className={`font-mono text-xs font-bold ${valueColor}`}>
                              {value != null ? formatPrice(value, stock.name) : '-'}
                              {isClosest && pos ? <span className={`font-mono text-[9px] ${valueColor} ml-1`}>({pos.percent >= 0 ? '+' : ''}{pos.percent.toFixed(2)}%)</span> : null}
                            </span>
                          </div>
                        );
                      });
                    })()}
                </div>
                <DividendRateCurve
                  klines={bollData?.klines || []}
                  stock={stock}
                  fallbackDividend={getDividendForYear(stock, getSelectedYear(stock))}
                  title={`股息率曲线（${bollPeriod === 'daily' ? '日' : bollPeriod === 'weekly' ? '周' : '月'}线）`}
                  ranges={ranges}
                  period={bollPeriod === 'weekly' ? 'weekly' : bollPeriod === 'monthly' ? 'monthly' : 'daily'}
                />
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
                      const annualDividends = chartData.map(d => d.dividend);
                      const maxAnnualDiv = annualDividends.length > 0 ? Math.max(...annualDividends) : 1;
                      const annualTickLen = maxAnnualDiv.toFixed(1).length + 1;
                      const annualYAxisFontSize = annualTickLen > 5 ? 7 : 9;
                      return (
                        <div className="h-[120px] w-full select-none outline-none focus-visible:outline-2 focus-visible:outline-indigo-500/50 [&_svg]:outline-none [&_svg]:focus:outline-none">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData} margin={{ top: 5, right: 5, left: 2, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" vertical={false} />
                              <XAxis
                                dataKey="year"
                                tick={{ fontSize: 9, fill: '#94a3b8' }}
                                stroke="rgba(148,163,184,0.3)"
                                tickLine={false}
                                axisLine={false}
                                minTickGap={18}
                              />
                              <YAxis
                                tick={{ fontSize: annualYAxisFontSize, fill: '#94a3b8' }}
                                stroke="rgba(148,163,184,0.3)"
                                tickLine={false}
                                axisLine={false}
                                domain={[0, 'auto']}
                                width={30}
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
                                isAnimationActive={false}
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
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-2 sm:p-4">
              <div className="bg-app-card border border-app-border rounded-xl shadow-2xl w-full max-w-[400px] max-h-[90vh] flex flex-col">
                <div className="flex items-start justify-between px-3 py-2 border-b border-app-border">
                  <div>
                    <h3 className="text-xs font-bold text-app-text">分红数据核对</h3>
                    <p className="text-[9px] text-app-subtext mt-0.5">
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
                  <table className="w-full text-[10px] border-separate border-spacing-0">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-app-input">
                        <th className="px-1 py-1 text-center border-b border-app-border">
                          <label className="flex items-center justify-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={allSelected}
                              disabled={selectable.length === 0}
                              onChange={toggleSelectAllDividends}
                              className="accent-indigo-500 w-3 h-3"
                            />
                          </label>
                        </th>
                        <th className="px-1 py-1 text-left border-b border-app-border border-r border-app-border whitespace-nowrap">股票</th>
                        <th className="px-1 py-1 text-center border-b border-app-border border-r border-app-border whitespace-nowrap">{dividendYearLeft}</th>
                        <th className="px-1 py-1 text-center border-b border-app-border border-r border-app-border whitespace-nowrap">{dividendYearRight}</th>
                        <th className="px-1 py-1 text-center border-b border-app-border border-r border-app-border whitespace-nowrap">登记日</th>
                        <th className="px-1 py-1 text-center border-b border-app-border whitespace-nowrap">状态</th>
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
                            <td className="px-1 py-0.5 text-center border-b border-app-border">
                              <input
                                type="checkbox"
                                checked={selectedDividendIds.has(entry.stockId)}
                                disabled={!entry.hasData || !!entry.error}
                                onChange={() => toggleDividendRow(entry.stockId)}
                                className="accent-indigo-500 w-3 h-3"
                              />
                            </td>
                            <td
                              className="px-1 py-0.5 border-b border-app-border border-r border-app-border"
                              title={recordTooltip || undefined}
                            >
                              <div className="text-[10px] text-app-text font-medium whitespace-nowrap">{entry.name}</div>
                              <div className="text-[8px] text-app-subtext font-mono">{entry.code}</div>
                            </td>
                            <td className="px-1 py-0.5 text-center border-b border-app-border border-r border-app-border font-mono">
                              {formatDividendCell(entry.current2024, entry.fetched2024, entry.hasData)}
                            </td>
                            <td className="px-1 py-0.5 text-center border-b border-app-border border-r border-app-border font-mono">
                              {formatDividendCell(entry.current2025, entry.fetched2025, entry.hasData)}
                            </td>
                            <td className="px-1 py-0.5 text-center border-b border-app-border border-r border-app-border font-mono">
                              {(() => {
                                if (!entry.registerDate) return <span className="text-app-subtext">-</span>;
                                const today = new Date();
                                const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                                const regDate = new Date(entry.registerDate);
                                const isToday = entry.registerDate === todayStr;
                                const isFuture = !isToday && regDate >= today;
                                const parts = entry.registerDate.split('-');
                                const dateLabel = `${parseInt(parts[1])}月${parseInt(parts[2])}日`;
                                const dateColor = isToday ? 'text-brand-red' : isFuture ? 'text-orange-400' : 'text-app-rowtext';
                                return (
                                  <span className={dateColor}>
                                    {dateLabel}
                                  </span>
                                );
                              })()}
                            </td>
                            <td className="px-1 py-0.5 text-center border-b border-app-border whitespace-nowrap">
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
                <div className="flex items-center justify-between gap-2 flex-wrap px-3 py-2 border-t border-app-border">
                  <span className="text-[9px] text-app-subtext">
                    {selectable.length > 0
                      ? `已勾选 ${selectedCount} 只将更新`
                      : '本次没有可更新的股票'}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setDividendDiff(null)}
                      className="px-2.5 py-1.5 rounded-lg text-[10px] font-semibold border border-app-border text-app-subtext hover:bg-app-input transition-colors"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleApplyDividends}
                      disabled={selectedCount === 0}
                      className="px-2.5 py-1.5 rounded-lg text-[10px] font-semibold bg-indigo-600 text-white hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

      {/* 列表页价格技术指标弹窗 */}
      {priceInfoStock && (
        <div
          ref={priceInfoRef}
          className="fixed z-[59] bg-app-input border border-slate-500/40 rounded-lg shadow-[0_8px_30px_rgba(0,0,0,0.55)] overflow-hidden"
          style={{ top: priceInfoPos.top, left: priceInfoPos.left, width: 210 }}
          onMouseEnter={() => { priceInfoHoveredRef.current = true; }}
          onMouseLeave={handlePriceInfoFloatLeave}
        >
          <div className="px-2.5 py-1.5 border-b border-app-border bg-app-input flex items-center justify-center">
            <span className="text-[11px] font-bold text-app-subtext">{priceInfoStock.name}</span>
          </div>
          <div className="px-2.5 py-1.5 bg-app-card">
            {priceInfoLoading && <div className="text-[10px] text-app-subtext py-2 text-center">加载中…</div>}
            {!priceInfoLoading && !priceInfoData && <div className="text-[10px] text-app-subtext py-2 text-center">暂无数据</div>}
            {!priceInfoLoading && priceInfoData && (() => {
              const d = priceInfoData;
              const fmt = (v: number | null) => v == null ? '-' : formatPrice(v, priceInfoStock!.name);
              const pctColor = d.changePct == null ? 'text-app-subtext' : d.changePct >= 0 ? 'text-brand-red' : 'text-brand-green';
              // 昨收价：现价 / (1 + 涨跌幅)
              const prevClose = (d.changePct == null || priceInfoStock == null || priceInfoStock.price <= 0)
                ? null : priceInfoStock.price / (1 + d.changePct / 100);
              // 开/现/低/高 各自与昨收价比较着色（符合正规交易软件规则）
              const priceColor = (v: number | null) => {
                if (v == null || prevClose == null) return 'text-app-subtext';
                if (v > prevClose) return 'text-brand-red';
                if (v < prevClose) return 'text-brand-green';
                return 'text-app-rowtext';
              };
              const fmtPct = (v: number | null) => v == null ? '-' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
              const numFmt = (v: number | null, dec = 2) => v == null ? '-' : v.toFixed(dec);
              const cell2 = (label: string, val: React.ReactNode, colorClass = 'text-app-rowtext') => (
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[10px] text-app-subtext whitespace-nowrap">{label}</span>
                  <span className={`font-mono text-[11px] ${colorClass}`}>{val}</span>
                </div>
              );
              const volumeRatioText = (() => {
                if (d.volume == null || d.volumeMa5 == null || d.volumeMa5 === 0) return '-';
                return (d.volume / d.volumeMa5).toFixed(2);
              })();
              const volumeColor = d.volume != null && d.volumeMa5 != null && d.volumeMa5 !== 0
                ? (d.volume >= d.volumeMa5 ? 'text-brand-red' : 'text-brand-green')
                : 'text-app-rowtext';
              const changeAmount = (() => {
                if (d.changePct == null || priceInfoStock == null || priceInfoStock.price <= 0) return '-';
                return formatPrice(priceInfoStock.price - priceInfoStock.price / (1 + d.changePct / 100), priceInfoStock.name);
              })();
              const subRows = (label: string, vals: [string, string | null, string?][]) => {
                return (
                  <div className="py-[3px]">
                    <div className="text-[10px] text-app-subtext mb-0.5">{label}</div>
                    <div className="flex gap-2">
                      {vals.map(([k, v, c]) => (
                        <span key={k} className="flex-1 text-center font-mono text-[10px] text-app-rowtext">
                          <span>{k}<span>:</span></span>
                          <span className={c ?? ''}>{v ?? '-'}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                );
              };
              // 超买(数值偏高)用红色，超卖(数值偏低)用绿色
              const rsiColor = (v: number | null) => v == null ? undefined : (v > 70 ? 'text-brand-red' : v < 30 ? 'text-brand-green' : undefined);
              const kdjColor = (v: number | null, buyHigh: number, sellLow: number) => v == null ? undefined : (v > buyHigh ? 'text-brand-red' : v < sellLow ? 'text-brand-green' : undefined);
              return (
                <div>
                  <div className="mb-1 space-y-1">
                    <div className="grid grid-cols-2 gap-x-4">{cell2('开', fmt(d.open), priceColor(d.open))}{cell2('现', formatPrice(priceInfoStock.price, priceInfoStock.name), priceColor(priceInfoStock.price))}</div>
                    <div className="grid grid-cols-2 gap-x-4">{cell2('低', fmt(d.low), priceColor(d.low))}{cell2('高', fmt(d.high), priceColor(d.high))}</div>
                    <div className="grid grid-cols-2 gap-x-4">{cell2('额', changeAmount, pctColor)}{cell2('幅', fmtPct(d.changePct), pctColor)}</div>
                    <div className="grid grid-cols-2 gap-x-4">{cell2('量', formatVolume(d.volume), volumeColor)}{cell2('量比', volumeRatioText, volumeColor)}</div>
                  </div>
                  <div className="border-t border-app-border my-1" />
                  {subRows('KDJ (9, 3, 3)', [['K', numFmt(d.kdj.k), kdjColor(d.kdj.k, 80, 20)], ['D', numFmt(d.kdj.d), kdjColor(d.kdj.d, 80, 20)], ['J', numFmt(d.kdj.j), kdjColor(d.kdj.j, 100, 0)]])}
                  {subRows('RSI (6, 12, 24)', [['6', numFmt(d.rsi.rsi6), rsiColor(d.rsi.rsi6)], ['12', numFmt(d.rsi.rsi12), rsiColor(d.rsi.rsi12)], ['24', numFmt(d.rsi.rsi24), rsiColor(d.rsi.rsi24)]])}
                  {subRows('MACD (12, 26, 9)', [['DIF', numFmt(d.macd.dif, 3)], ['DEA', numFmt(d.macd.dea, 3)], ['MACD', numFmt(d.macd.macd, 3)]])}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* 列表页持仓详情浮窗（朝左侧展示，数据来自本地持仓） */}
      {positionInfoStock && (() => {
        const s = positionInfoStock;
        const shares = s.positionShares || 0;
        const cost = s.positionCost || 0;
        const price = s.price || 0;
        const dividend = getDividendForYear(s, getSelectedYear(s)) || 0;
        const fmtP = (v: number) => formatPrice(v, s.name);
        const sharesText = shares > 0 ? `${Number.isInteger(shares) ? shares : shares.toFixed(2)}股` : '-';
        const marketValue = shares > 0 && price > 0 ? `¥${Math.round(shares * price).toLocaleString()}` : '-';
        const totalCost = shares > 0 && cost > 0 ? `¥${Math.round(shares * cost).toLocaleString()}` : '-';
        const profit = shares > 0 && cost > 0 && price > 0 ? shares * (price - cost) : 0;
        const profitText = profit !== 0 ? `${profit >= 0 ? '+' : ''}${fmtP(profit)}` : '-';
        const profitPct = cost > 0 && price > 0 ? ((price - cost) / cost) * 100 : 0;
        const profitPctText = cost > 0 && price > 0 ? `${profitPct >= 0 ? '+' : ''}${profitPct.toFixed(2)}%` : '-';
        const yieldText = shares > 0 && cost > 0 && dividend > 0 ? ((dividend / cost) * 100).toFixed(2) + '%' : '-';
        const costColor = cost > 0 ? (cost > price ? 'text-brand-green' : 'text-brand-red') : 'text-app-subtext';
        const pctColor = s.changePercent >= 0 ? 'text-brand-red' : 'text-brand-green';
        const profitColor = profit > 0 ? 'text-brand-red' : profit < 0 ? 'text-brand-green' : 'text-app-rowtext';
        const cell2 = (label: string, val: React.ReactNode, colorClass = 'text-app-rowtext') => (
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] text-app-subtext whitespace-nowrap">{label}</span>
            <span className={`font-mono text-[11px] ${colorClass}`}>{val}</span>
          </div>
        );
        return (
          <div
            ref={positionInfoRef}
            className="fixed z-[59] bg-app-input border border-slate-500/40 rounded-lg shadow-[0_8px_30px_rgba(0,0,0,0.55)] overflow-hidden"
            style={{ top: positionInfoPos.top, left: positionInfoPos.left, width: 220 }}
            onMouseEnter={() => { positionInfoHoveredRef.current = true; }}
            onMouseLeave={handlePositionInfoFloatLeave}
          >
            <div className="px-2.5 py-1.5 border-b border-app-border bg-app-input flex items-center justify-center">
              <span className="text-[11px] font-bold text-app-subtext">{s.name}</span>
            </div>
            <div className="px-2.5 py-1.5 space-y-1 bg-app-card">
              <div className="grid grid-cols-2 gap-x-4">{cell2('成本', cost > 0 ? fmtP(cost) : '-', costColor)}{cell2('现价', price > 0 ? fmtP(price) : '-', pctColor)}</div>
              <div className="grid grid-cols-2 gap-x-4">{cell2('股数', sharesText)}{cell2('市值', marketValue)}</div>
              <div className="grid grid-cols-2 gap-x-4">{cell2('浮盈', profitText, profitColor)}{cell2('盈亏', profitPctText, profitColor)}</div>
              <div className="grid grid-cols-2 gap-x-4">{cell2('总成本', totalCost)}{cell2('股息率', yieldText)}</div>
            </div>
          </div>
        );
      })()}

      {/* 列表页股息率曲线浮窗（复用 DividendRateCurve 共享组件） */}
      {divRateInfoStock && (
        <div
          ref={divRateInfoRef}
          className="fixed z-[59] bg-app-input border border-slate-500/40 rounded-lg shadow-[0_8px_30px_rgba(0,0,0,0.55)] overflow-hidden"
          style={{ top: divRateInfoPos.top, left: divRateInfoPos.left, width: 330 }}
          onMouseEnter={() => { divRateInfoHoveredRef.current = true; }}
          onMouseLeave={handleDivRateInfoFloatLeave}
        >
          <div className="px-2.5 py-1.5 border-b border-app-border bg-app-input flex items-center justify-center">
            <span className="text-[11px] font-bold text-app-subtext">{divRateInfoStock.name}</span>
          </div>
          <div className="p-2.5 bg-app-card">
            {divRateInfoLoading ? (
              <div className="text-[10px] text-app-subtext py-2 text-center">加载中…</div>
            ) : divRateInfoKlines && divRateInfoKlines.length > 0 ? (
              <DividendRateCurve
                klines={divRateInfoKlines}
                stock={divRateInfoStock}
                fallbackDividend={getDividendForYear(divRateInfoStock, getSelectedYear(divRateInfoStock))}
                title="股息率曲线（日线）"
                ranges={ranges}
                period="daily"
                rangeValue={dailyChartRange}
                offsetValue={dailyChartOffset}
                onRangeChange={handleDailyRangeChange}
                onOffsetChange={handleDailyOffsetChange}
              />
            ) : (
              <div className="text-[10px] text-app-subtext py-2 text-center">暂无数据</div>
            )}
          </div>
        </div>
      )}

      {/* 列表页支撑/压力位弹窗 */}
      {listSrPreviewText && listSrStock && (
        <div
          ref={listSrTooltipRef}
          className={`fixed z-[60] bg-app-card border border-slate-500/40 rounded px-2.5 py-1.5 text-[11px] font-mono text-app-rowtext whitespace-pre shadow-[0_8px_30px_rgba(0,0,0,0.55)] leading-relaxed text-left ${listSrTooltipHidden ? ' invisible' : ''}`}
          style={{ top: listSrTooltipAbove, left: listSrTooltipOffset, tabSize: 8 }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              const stock = listSrStock;
              if (!stock) return;
              const adjustLabel = '前复权';
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
                fetchBollData(stock.code, 'daily', 'qfq', apiSource, undefined, popupLogCtx),
                fetchBollData(stock.code, 'weekly', 'qfq', apiSource, undefined, popupLogCtx),
                fetchBollData(stock.code, 'monthly', 'qfq', apiSource, undefined, popupLogCtx),
              ]).then(([dailyR, weeklyR, monthlyR]) => {
                const text = [
                  `${stock.name}（${adjustLabel}）`,
                  buildLine('日线', dailyR.data),
                  buildLine('周线', weeklyR.data),
                  buildLine('月线', monthlyR.data),
                ].join('\n');
                const done = () => {
                  setListSrCopied(true);
                  setTimeout(() => setListSrCopied(false), 1500);
                };
                if (navigator.clipboard?.writeText) {
                  navigator.clipboard.writeText(text).then(done).catch(() => {});
                }
              });
            }}
            className="absolute top-1.5 right-2 p-0.5 rounded hover:bg-app-input transition-colors text-app-subtext"
            title=""
          >
            {listSrCopied ? <Check size={10} className="text-indigo-400" /> : <Copy size={10} className="text-app-subtext" />}
          </button>
          {listSrPreviewText}
        </div>
      )}

      {/* 页面底部请求计数器 */}
      {showRequestStats && (
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
            <button
              onClick={handleExportDefaultData}
              disabled={stocks.length === 0}
              className="flex items-center gap-1 px-2 py-1 text-xs text-app-subtext hover:text-blue-400 border border-app-border rounded hover:border-blue-400/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="导出当前股票分红数据为内置代码"
            >
              <Download size={12} />
              <span className="hidden sm:inline">导出内置</span>
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
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const text = `${new Date(triggerAt).toLocaleString('zh-CN', { hour12: false })} ${group.reason}`;
                            navigator.clipboard?.writeText(text).catch(() => {});
                          }}
                          className="shrink-0 text-app-subtext hover:text-app-text transition-colors"
                          title=""
                        >
                          <Copy size={10} />
                        </button>
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
      )}
    </div>
  );
};
