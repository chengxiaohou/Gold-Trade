import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X, RefreshCw, Edit2, Check, TrendingUp, TrendingDown, Settings, CloudDownload, CloudUpload, Moon, Sun, Trash2, GripVertical, GripHorizontal, RotateCcw, Eye, EyeOff, Download, BarChart3, List, ChevronDown, Copy } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { StockEntry, StockDividendRates, DividendRateColorRange, StockSettings, StockTrade, ApiSource } from '../types';
import { fetchBollData, checkAllBollCache, countStaleBollCache, countVisibleBollItems, getBollCacheTimestamps, BollData, BollPeriod, BollAdjust, BollKline } from '../services/bollService';
import { isStockPriceFresh, isTradingHours, getMarketStatus, getDynamicBollCacheTTL, getDynamicCacheTTL, formatDuration, formatTimePart, formatCacheTime } from '../services/cacheService';
import { requestLogService, RequestLogEntry, RequestLogStats, type LogBatchContext } from '../services/requestLogService';
import { fetchYearlyDividends, DividendRecord } from '../services/dividendService';
import { getNickname } from '../services/nicknameService';
import { InputGroup } from './InputGroup';

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
  sortMode?: 'default' | 'dividendRate' | 'tag' | 'daily' | 'weekly' | 'monthly' | 'changePercent';
  onSortModeChange?: (mode: 'default' | 'dividendRate' | 'tag' | 'daily' | 'weekly' | 'monthly' | 'changePercent') => void;
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

// 持仓列中子列1的展示模式（表头按钮两态切换：股息率 ↔ 份额）
type PositionDisplayMode = 'shares' | 'cost';
const POSITION_MODE_LABEL: Record<PositionDisplayMode, string> = {
  shares: '份额',
  cost: '股息率',
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

// ── 行情状态分析：近 N 个交易日“破位”事件 ──
const MARKET_MA_PERIODS = [5, 10, 20, 30, 60, 120, 250, 500];

// 被跌破的均线明细
interface MarketMaInfo {
  period: number;
  value: number; // 破位当天的均线值
}

interface MarketEvent {
  date: string; // 破位当天日期 YYYY-MM-DD
  brokenCount: number; // 当日跌破的均线条数 N
  brokenList: MarketMaInfo[]; // 当日下穿的均线明细（按周期升序）
  ref: MarketMaInfo; // 参照均线：被跌破中数值最高的一条
  close: number; // 破位当天收盘价
  status: 'confirming' | 'trueBreak' | 'falseBreak'; // 修复观察 / 真破位 / 假破位
  returnDay?: { date: string; close: number; refMa: number }; // 假破位：回到均线上方那天
  window: { date: string; close: number; refMa: number }[]; // 观测窗口每日数据（破位日起）
}

// 破位：当日收盘价下穿若干条均线（前一日收盘≥均线、当日收盘<均线）
// 真/假破位：以被跌破均线中数值最高的一条为参照，破位当天算第1天，3天内
// 收盘价（每日对比该日最新均线值）回到其上方即假破位，否则第3天收盘后判真破位；
// 数据不足（事件距今天太近）时保持“修复观察”。
function analyzeMarketConditions(klines: BollKline[], lastDays = 5): MarketEvent[] {
  const n = klines.length;
  if (n < lastDays + 1) return [];
  const closes = klines.map(k => k.close);
  // 各周期均线序列：maSeries[pi][i] 为第 i 天该周期均线值，历史不足时为 null
  const maSeries = MARKET_MA_PERIODS.map(period => {
    const res: (number | null)[] = new Array(n).fill(null);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += closes[i];
      if (i >= period) sum -= closes[i - period];
      if (i >= period - 1) res[i] = sum / period;
    }
    return res;
  });
  const events: MarketEvent[] = [];
  for (let t = n - lastDays; t < n; t++) {
    if (t - 1 < 0) continue;
    // 统计当日下穿的均线集合
    const broken: MarketMaInfo[] = [];
    for (let pi = 0; pi < MARKET_MA_PERIODS.length; pi++) {
      const period = MARKET_MA_PERIODS[pi];
      const maT = maSeries[pi][t];
      const maPrev = maSeries[pi][t - 1];
      if (maT == null || maPrev == null) continue;
      if (closes[t] < maT && closes[t - 1] >= maPrev) broken.push({ period, value: maT });
    }
    if (broken.length === 0) continue;
    // 参照均线：被跌破中数值最高的一条（价格下跌时最先触到）
    const ref = broken.reduce((a, b) => (b.value > a.value ? b : a));
    const refPi = MARKET_MA_PERIODS.indexOf(ref.period);
    // 3 天观测：破位当天为第 1 天，记录每日收盘与当日最新参照均线值
    const window: { date: string; close: number; refMa: number }[] = [];
    let returned = false;
    for (let d = t; d <= t + 2 && d < n; d++) {
      const maD = maSeries[refPi][d];
      const refMa = maD ?? 0;
      window.push({ date: klines[d].date, close: closes[d], refMa });
      if (maD != null && closes[d] >= maD) { returned = true; break; }
    }
    let status: MarketEvent['status'];
    if (returned) status = 'falseBreak';
    else if (n - 1 >= t + 2) status = 'trueBreak';
    else status = 'confirming';
    const ev: MarketEvent = {
      date: klines[t].date,
      brokenCount: broken.length,
      brokenList: broken.slice().sort((a, b) => a.period - b.period),
      ref,
      close: closes[t],
      status,
      window,
    };
    if (status === 'falseBreak') ev.returnDay = window[window.length - 1];
    events.push(ev);
  }
  return events;
}


// ── K线形态分析：十字星 / 金针探底 / 吊颈线 / 射击之星 / 倒锤子线 ──
// 基础数据单元（基于 OHLC）：
//   实体高度 = |收盘-开盘|；上影线 = 最高-MAX(开,收)；下影线 = MIN(开,收)-最低；振幅 = 最高-最低
// 通用阈值：小实体 ≤ 振幅*10%；长影线 ≥ 实体*2；极短影线 ≤ 振幅*5%；十字星实体 ≤ 振幅*5%
interface KlinePattern {
  type: 'doji' | 'hammer' | 'hangingMan' | 'shootingStar' | 'invertedHammer';
  date: string;   // 形态当天日期 YYYY-MM-DD
  label: string;  // 完整名称（十字星 / 金针探底 / 吊颈线 / 射击之星 / 倒锤子线）
  single: string; // 列表单元格单字（十 / 金 / 吊 / 射 / 倒）
  color: 'green' | 'red' | 'slate'; // 红=买/看多 绿=卖/看空 灰=中性
  boosted?: boolean;   // 放量金针：当日成交量 > 前5日均量
  direction?: 'high' | 'low' | 'flat'; // 十字星趋势上下文
  detail: string[];    // 判定依据文案
}

function analyzeKlinePatterns(klines: BollKline[], fmt: (v: number) => string): KlinePattern[] {
  const n = klines.length;
  if (n < 21) return []; // 需 ≥21 根K线（前20日趋势 / 平均振幅）
  const i = n - 1; // 仅分析最新收盘交易日
  const k = klines[i];
  const body = Math.abs(k.close - k.open);
  const upper = k.high - Math.max(k.open, k.close);
  const lower = Math.min(k.open, k.close) - k.low;
  const range = k.high - k.low;
  if (range <= 0) return [];
  const smallBody = body <= range * 0.1; // 小实体
  const tinyBody = body <= range * 0.05; // 十字星实体
  // 前20日均线方向（今日 vs 昨日）
  let sum = 0, sumPrev = 0;
  for (let j = i - 19; j <= i; j++) sum += klines[j].close;
  for (let j = i - 20; j <= i - 1; j++) sumPrev += klines[j].close;
  const ma20Up = sum / 20 > sumPrev / 20;
  const ma20Down = sum / 20 < sumPrev / 20;
  // 近20日高低点与平均振幅（十字星用于排除一字板）
  let high20 = -Infinity, low20 = Infinity, rangeSum = 0;
  for (let j = i - 19; j <= i; j++) {
    if (klines[j].high > high20) high20 = klines[j].high;
    if (klines[j].low < low20) low20 = klines[j].low;
    rangeSum += klines[j].high - klines[j].low;
  }
  const avgRange = rangeSum / 20;
  const nearHigh = k.close >= high20 * 0.95; // 位于近20日最高价5%区间内
  const nearLow = k.close <= low20 * 1.05;   // 位于近20日最低价5%区间内
  // 放量增强：当日成交量 > 前5日均量
  let avgVolPrev = 0;
  for (let j = i - 5; j <= i - 1; j++) avgVolPrev += klines[j].volume;
  avgVolPrev /= 5;
  const boostedVol = k.volume > avgVolPrev;
  const fmtVol = (v: number) => (v >= 1e8 ? `${(v / 1e8).toFixed(2)}亿` : v >= 1e4 ? `${(v / 1e4).toFixed(1)}万` : `${v.toFixed(0)}`);
  const ds = k.date.slice(5).replace('-', '/'); // MM/DD
  const pct = (body / range * 100).toFixed(1);
  const patterns: KlinePattern[] = [];
  // 1. 十字星：实体 ≤ 振幅*5%，且振幅 > 平均振幅*10%（区分一字板）；结合前20日趋势定方向
  if (tinyBody && range > avgRange * 0.1) {
    const dir: 'high' | 'low' | 'flat' = nearHigh ? 'high' : nearLow ? 'low' : 'flat';
    patterns.push({
      type: 'doji', date: k.date, label: '十字星', single: '十', color: 'slate', direction: dir,
      detail: [
        `${ds} 十字星：开 ${fmt(k.open)} ≈ 收 ${fmt(k.close)}`,
        `实体占比 ${pct}% ≤ 5%（多空平衡）`,
        dir === 'high' ? '现价贴近近20日高点（≥95%区间）→ 高位警示'
          : dir === 'low' ? '现价贴近近20日低点（≤105%区间）→ 低位关注'
          : '趋势方向中性',
      ],
    });
    return patterns; // 十字星优先：实体过小，其余形态不再判定
  }
  // 2/3. 金针探底 & 吊颈线：下影线长、上影线短、实体小，仅前置趋势不同
  if (smallBody && upper <= body * 0.3) {
    if (lower >= body * 2.5 && (ma20Down || nearLow)) {
      patterns.push({
        type: 'hammer', date: k.date, label: boostedVol ? '放量金针' : '金针探底', single: '针', color: 'red', boosted: boostedVol,
        detail: [
          `${ds} ${boostedVol ? '放量金针' : '金针探底'}：收 ${fmt(k.close)}`,
          `下影 ${fmt(lower)} ≥ 实体×2.5（${fmt(body)}），上影 ${fmt(upper)} ≤ 实体×30%`,
          `${ma20Down ? 'MA20 方向向下' : '现价贴近近20日低点'} → 下跌末端承接`,
          ...(boostedVol ? [`成交量 ${fmtVol(k.volume)} > 前5日均量 ${fmtVol(avgVolPrev)} → 放量金针（权重提升）`] : []),
        ],
      });
    } else if (lower >= body * 2 && ma20Up && nearHigh) {
      patterns.push({
        type: 'hangingMan', date: k.date, label: '吊颈线', single: '吊', color: 'green',
        detail: [
          `${ds} 吊颈线：收 ${fmt(k.close)}`,
          `下影 ${fmt(lower)} ≥ 实体×2（${fmt(body)}），上影 ${fmt(upper)} ≤ 实体×30%`,
          'MA20 方向向上 且 现价贴近近20日高点 → 上涨末端假承接',
        ],
      });
    }
  }
  // 4/5. 射击之星 & 倒锤子线：上影线长、下影线短、实体小，仅前置趋势不同
  if (smallBody && lower <= body * 0.3) {
    if (upper >= body * 2 && (ma20Up || nearHigh)) {
      patterns.push({
        type: 'shootingStar', date: k.date, label: '射击之星', single: '射', color: 'green',
        detail: [
          `${ds} 射击之星：收 ${fmt(k.close)}`,
          `上影 ${fmt(upper)} ≥ 实体×2（${fmt(body)}），下影 ${fmt(lower)} ≤ 实体×30%`,
          `${ma20Up ? 'MA20 方向向上' : '现价贴近近20日高点'} → 冲高诱多砸盘`,
        ],
      });
    } else if (upper >= body * 2 && (ma20Down || nearLow)) {
      patterns.push({
        type: 'invertedHammer', date: k.date, label: '倒锤子线', single: '倒', color: 'red',
        detail: [
          `${ds} 倒锤子线：收 ${fmt(k.close)}`,
          `上影 ${fmt(upper)} ≥ 实体×2（${fmt(body)}），下影 ${fmt(lower)} ≤ 实体×30%`,
          `${ma20Down ? 'MA20 方向向下' : '现价贴近近20日低点'} → 下跌末端试盘`,
        ],
      });
    }
  }
  return patterns;
}


// ── 交易环境标签体系：趋势结构 / 量价关系 / 动能背离 / 波动率 / 综合强弱周期 ──
// 参考 docs/行情标签体系说明书.md 实现。打分制：均线40% + 量价40% + 波动(BOLL)20%（MACD 已移除，改由每日信号展示），
// 总分 ≥0.6 强周期 / ≤-0.6 弱周期，中间为震荡/变盘期；强弱细分再叠加关键信号确认。
interface EnvTag {
  key: string;      // 唯一标识（cycle 或维度标签）
  label: string;    // 完整名称
  single: string;   // 单字（单元格备用）
  color: 'red' | 'green' | 'orange' | 'indigo' | 'slate';
  score: number;    // 得分 -1~1
  dim: 'cycle' | 'trend' | 'volume' | 'volatility';
  detail: string[]; // 判定依据
}
interface EnvResult {
  tags: EnvTag[]; // cycle + 各维度触发的标签
  total: number;  // 综合得分
  dimScores: { trend: number; volume: number; volatility: number };
}

// 序列化指标计算（供环境分析使用，输入为完整K线序列）
function calcMaSeries(klines: BollKline[], period: number): (number | null)[] {
  const closes = klines.map(k => k.close);
  const res: (number | null)[] = new Array(klines.length).fill(null);
  let sum = 0;
  for (let i = 0; i < klines.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) res[i] = sum / period;
  }
  return res;
}
function calcRsiSeries(klines: BollKline[], n: number): (number | null)[] {
  const res: (number | null)[] = new Array(klines.length).fill(null);
  for (let i = 0; i < klines.length; i++) {
    if (i < n) continue;
    let up = 0, down = 0;
    for (let j = i - n + 1; j <= i; j++) {
      const diff = klines[j].close - klines[j - 1].close;
      if (diff > 0) up += diff; else down -= diff;
    }
    if (down === 0) res[i] = up === 0 ? 50 : 100;
    else res[i] = 100 - 100 / (1 + up / down);
  }
  return res;
}
function calcMacdSeries(klines: BollKline[]): { dif: number | null; dea: number | null }[] {
  const closes = klines.map(k => k.close);
  const ema = (arr: number[], n: number): number[] => {
    const res: number[] = [];
    const alpha = 2 / (n + 1);
    let prev = 0;
    arr.forEach((v, i) => {
      if (i === 0) { prev = v; res.push(v); }
      else { prev = alpha * v + (1 - alpha) * prev; res.push(prev); }
    });
    return res;
  };
  const res: { dif: number | null; dea: number | null }[] = new Array(klines.length).fill({ dif: null, dea: null });
  if (closes.length >= 26) {
    const ema12 = ema(closes, 12);
    const ema26 = ema(closes, 26);
    const difArr = closes.map((_, i) => ema12[i] - ema26[i]);
    const deaArr = ema(difArr, 9);
    for (let i = 0; i < closes.length; i++) res[i] = { dif: difArr[i], dea: deaArr[i] };
  }
  return res;
}
function calcBollSeries(klines: BollKline[]): { mid: number | null; upper: number | null; lower: number | null }[] {
  const closes = klines.map(k => k.close);
  const res: { mid: number | null; upper: number | null; lower: number | null }[] = new Array(klines.length).fill({ mid: null, upper: null, lower: null });
  for (let i = 19; i < klines.length; i++) {
    let sum = 0;
    for (let j = i - 19; j <= i; j++) sum += closes[j];
    const mid = sum / 20;
    const variance = closes.slice(i - 19, i + 1).reduce((s, v) => s + Math.pow(v - mid, 2), 0) / 20;
    const std = Math.sqrt(variance);
    res[i] = { mid, upper: mid + 2 * std, lower: mid - 2 * std };
  }
  return res;
}

// 量价判定资格：最新K线若是"未收盘的今日"，盘中（距收盘>30分钟）不给出任何量价关系标签，
// 避免量价未定型误导；当日交易时间还剩最后半小时（14:30 后）才开始计算展示今日量价标签。
function canJudgeTodayVolume(date: Date = new Date()): boolean {
  const status = getMarketStatus(date);
  if (status === 'closed') return true; // 15:00后已收盘
  if (status === 'afternoon_session') {
    return date.getHours() + date.getMinutes() / 60 >= 14.5; // 13:00-15:00：仅最后半小时
  }
  return false; // 盘前/上午时段/午间休市/全天休市
}
function isTodayVolumeEligible(klines: BollKline[]): boolean {
  if (!klines || klines.length === 0) return false;
  const lastDate = klines[klines.length - 1].date;
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (lastDate !== today) return true; // 最新K线为历史交易日（已收盘）
  return canJudgeTodayVolume(d);
}

// 每日行情信号（近10日）：MACD 金叉/死叉 + 量价显著信号（放量≥1.5×/极度缩量≤0.5×，按涨跌红绿）。
// 只展示足够明显/典型的信号，量价一般波动不标信号；与"环境量价（当前状态截面）"区分。
interface DailySignal {
  date: string;   // YYYY-MM-DD
  kind: 'macd-gold' | 'macd-dead' | 'vol-up' | 'vol-down' | 'vol-shrink';
  ratio: number | null;      // 量/5日均量 倍数（量价类；MACD 类为 null）
  detail: string[];          // 判定依据（区别于环境的当前状态描述）
}
function analyzeDailySignals(klines: BollKline[], allowTodayVolume = true): DailySignal[] {
  const n = klines.length;
  if (n < 30) return [];
  const macd = calcMacdSeries(klines);
  const volMa5s: number[] = new Array(n).fill(0);
  {
    let s = 0;
    for (let i = 0; i < n; i++) {
      s += klines[i].volume;
      if (i >= 5) s -= klines[i - 5].volume;
      volMa5s[i] = i >= 4 ? s / 5 : (i > 0 ? s / i : 0); // 前5日（不含当日）
    }
  }
  const fmtV = (v: number) => (v >= 1e8 ? `${(v / 1e8).toFixed(2)}亿` : v >= 1e4 ? `${(v / 1e4).toFixed(1)}万` : `${v.toFixed(0)}`);
  const start = Math.max(5, n - 10);
  const signals: DailySignal[] = [];
  const latestDate = klines[n - 1].date; // 最新K线日（未收盘的今日：非最后半小时不判定量价）
  for (let i = start; i < n; i++) {
    const k2 = klines[i], pk = klines[i - 1];
    const date = k2.date;
    // ── MACD 金叉/死叉（事件性）──
    if (i >= 1) {
      const m = macd[i], pm = macd[i - 1];
      if (m.dif != null && m.dea != null && pm.dif != null && pm.dea != null) {
        if (pm.dif < pm.dea && m.dif >= m.dea) {
          signals.push({ date, kind: 'macd-gold', ratio: null, detail: [`DIF ${m.dif.toFixed(3)} 上穿 DEA ${m.dea.toFixed(3)}`, '短期动能转强，若伴随放量更具确认性'] });
        } else if (pm.dif > pm.dea && m.dif <= m.dea) {
          signals.push({ date, kind: 'macd-dead', ratio: null, detail: [`DIF ${m.dif.toFixed(3)} 下穿 DEA ${m.dea.toFixed(3)}`, '短期动能转弱，警惕回调/转跌'] });
        }
      }
    }
    // ── 量价显著信号（未收盘的今日：非最后半小时不判定）──
    const vol = k2.volume, ma5 = volMa5s[i];
    if (ma5 <= 0) continue;
    if (date === latestDate && !allowTodayVolume) continue;
    const ratio = vol / ma5;
    const up = k2.close > pk.close;
    if (ratio >= 1.5) {
      signals.push({ date, kind: up ? 'vol-up' : 'vol-down', ratio, detail: [`量 ${fmtV(vol)} ≥ 5日均量 ${fmtV(ma5)}×${ratio.toFixed(1)}，收盘${up ? '涨' : '跌'}`, up ? '放量上攻：多方真实进场' : '放量下跌：抛压集中释放，警惕主力出逃'] });
    } else if (ratio <= 0.5) {
      signals.push({ date, kind: 'vol-shrink', ratio, detail: [`量 ${fmtV(vol)} 仅 5日均量 ${fmtV(ma5)}×${ratio.toFixed(1)}`, '极度缩量：多空观望，往往是变盘前的宁静'] });
    }
  }
  return signals;
}

function analyzeEnvironment(klines: BollKline[], fmt: (v: number) => string, allowVolume = true): EnvResult | null {
  const n = klines.length;
  if (n < 130) return null; // 需 120 日均线 + 近20日高低点 + 近60日带宽分位
  const i = n - 1;
  const k = klines[i];
  const close = k.close;
  const prev = klines[i - 1];
  const fmtVol = (v: number) => (v >= 1e8 ? `${(v / 1e8).toFixed(2)}亿` : v >= 1e4 ? `${(v / 1e4).toFixed(1)}万` : `${v.toFixed(0)}`);
  const fmtScore = (s: number) => (s >= 0 ? '+' : '') + s.toFixed(2);
  const ds = k.date.slice(5).replace('-', '/'); // MM/DD
  // 近20日高低点
  let high20 = -Infinity, low20 = Infinity;
  for (let j = i - 19; j <= i; j++) {
    if (klines[j].high > high20) high20 = klines[j].high;
    if (klines[j].low < low20) low20 = klines[j].low;
  }
  const nearHigh = close >= high20 * 0.95;

  // 序列指标
  const m5s = calcMaSeries(klines, 5), m10s = calcMaSeries(klines, 10), m20s = calcMaSeries(klines, 20),
    m60s = calcMaSeries(klines, 60), m120s = calcMaSeries(klines, 120);
  const bolls = calcBollSeries(klines);

  const m5 = m5s[i], m10 = m10s[i], m20 = m20s[i], m60 = m60s[i], m120 = m120s[i];
  const m5p = m5s[i - 1], m10p = m10s[i - 1], m20p = m20s[i - 1], m60p = m60s[i - 1], m120p = m120s[i - 1];

  // ── 趋势结构维度（30%）──
  let trendScore = 0;
  let trendTag: EnvTag | null = null;
  if (m5 && m10 && m20 && m60 && m120 && m5p && m10p && m20p && m60p && m120p) {
    const spread = Math.max(m5, m10, m20, m60) - Math.min(m5, m10, m20, m60);
    if (spread < close * 0.04) {
      trendScore = 0;
      trendTag = { key: 'trend-squeeze', label: '均线粘合', single: '粘', color: 'slate', score: 0, dim: 'trend', detail: [
        `${ds} 5/10/20/60 均线最大差值 ${fmt(spread)} < 股价×4%（${fmt(close)}）`,
        '方向选择的前夜：上破粘合区进强周期，下破进弱周期',
      ] };
    } else if (m5 > m10 && m10 > m20 && m20 > m60 && m60 > m120
      && m5 > m5p && m10 > m10p && m20 > m20p && m60 > m60p && m120 > m120p) {
      trendScore = 1;
      trendTag = { key: 'trend-strong-up', label: '多头强排列', single: '多', color: 'red', score: 1, dim: 'trend', detail: [
        `5>10>20>60>120（${fmt(m5)}>${fmt(m10)}>${fmt(m20)}>${fmt(m60)}>${fmt(m120)}）且斜率全部向上`,
        '主升浪进攻期：回踩 5/10 日线是高胜算买点',
      ] };
    } else if (m5 < m10 && m10 < m20 && m20 < m60 && m60 < m120
      && m5 < m5p && m10 < m10p && m20 < m20p && m60 < m60p && m120 < m120p) {
      trendScore = -1;
      trendTag = { key: 'trend-strong-down', label: '空头强排列', single: '空', color: 'green', score: -1, dim: 'trend', detail: [
        `120>60>20>10>5（${fmt(m120)}>${fmt(m60)}>${fmt(m20)}>${fmt(m10)}>${fmt(m5)}）且斜率全部向下`,
        '主跌浪/系统性风险：反弹到 5/10 日线是逃命线',
      ] };
    } else if (m5 > m10 && m10 > m20 && m20 > m60) {
      trendScore = 0.4;
      trendTag = { key: 'trend-weak-up', label: '多头弱排列', single: '弱', color: 'orange', score: 0.4, dim: 'trend', detail: [
        `5/10/20 短中期均线在 60 日之上（${fmt(m5)}>${fmt(m10)}>${fmt(m20)}>${fmt(m60)}）但缠绕粘合、斜率未全向上`,
        '高位震荡/上涨中继：适合高抛低吸，不宜追涨',
      ] };
    } else if (m5 < m10 && m10 < m20 && m20 < m60) {
      trendScore = -0.4;
      trendTag = { key: 'trend-weak-down', label: '空头弱排列', single: '空弱', color: 'slate', score: -0.4, dim: 'trend', detail: [
        `5/10/20 短中期均线在 60 日之下（${fmt(m5)}<${fmt(m10)}<${fmt(m20)}<${fmt(m60)}）且走平粘合`,
        '震荡筑底期：小仓位试盘，等短期均线上穿的金叉确认',
      ] };
    }
  }

  // ── 量价关系维度（40%：未收盘的今日非最后半小时不判定，量价缺席不参与打分）──
  let volumeScore = 0;
  let volTag: EnvTag | null = null;
  const up = close > prev.close;
  const down = close < prev.close;
  let volUp = false;
  let isLowVol = false;
  if (allowVolume) {
    let volMa5 = 0;
    for (let j = i - 5; j <= i - 1; j++) volMa5 += klines[j].volume;
    volMa5 /= 5;
    volUp = k.volume >= volMa5;
    let minVol = Infinity;
    for (let j = i - 19; j <= i; j++) minVol = Math.min(minVol, klines[j].volume);
    isLowVol = k.volume <= minVol;
    if (up && volUp) {
      volumeScore = 1;
      volTag = { key: 'vol-up-up', label: '量增价升', single: '增', color: 'red', score: 1, dim: 'volume', detail: [
        `${ds} 收 ${fmt(close)} > 昨收 ${fmt(prev.close)}，量 ${fmtVol(k.volume)} ≥ 5日均量 ${fmtVol(volMa5)}`,
        '真金白银的拉升：趋势具持续性，持仓不动是最优解',
      ] };
    } else if (up) {
      volumeScore = 0.2;
      volTag = { key: 'vol-up-down', label: '量缩价升', single: '缩', color: 'red', score: 0.2, dim: 'volume', detail: [
        `${ds} 收 ${fmt(close)} > 昨收 ${fmt(prev.close)}，但量 ${fmtVol(k.volume)} < 5日均量 ${fmtVol(volMa5)}`,
        '动能衰竭警告：高位易形成诱多陷阱，需提高警惕',
      ] };
    } else if (down && volUp) {
      volumeScore = -1;
      volTag = { key: 'vol-down-up', label: '量增价跌', single: '增', color: 'green', score: -1, dim: 'volume', detail: [
        `${ds} 收 ${fmt(close)} < 昨收 ${fmt(prev.close)}，量 ${fmtVol(k.volume)} ≥ 5日均量 ${fmtVol(volMa5)}`,
        nearHigh ? '出现在高位：机构高位出货，坚决离场' : '出现在大跌末端：恐慌盘涌出，往往接近最后一跌',
      ] };
    } else {
      volumeScore = -0.2;
      volTag = { key: 'vol-down-down', label: '量缩价跌', single: '缩', color: 'green', score: -0.2, dim: 'volume', detail: [
        `${ds} 收 ${fmt(close)} < 昨收 ${fmt(prev.close)}，量 ${fmtVol(k.volume)} < 5日均量 ${fmtVol(volMa5)}`,
        '无人接盘的阴跌：除非放量恐慌盘或大阳线，否则不抄底',
      ] };
    }
    if (isLowVol) {
      volumeScore = Math.min(1, volumeScore + 0.4);
      volTag.detail.push(`量 ${fmtVol(k.volume)} 创近20日最低 → 地量见地价（抛售枯竭）`);
    }
  }

  // ── 动能/MACD 维度（已移除：金叉/死叉改由每日行情信号展示，不参与环境打分）──

  // ── 波动率维度（15%：BOLL 20,2）──
  let bollScore = 0;
  let bollTag: EnvTag | null = null;
  let squeeze = false;
  const b = bolls[i], b3 = bolls[i - 3];
  if (b.mid && b.upper && b.lower && b3.upper && b3.lower) {
    const band = (b.upper - b.lower) / b.mid;
    const start = Math.max(0, i - 59);
    const bands: number[] = [];
    for (let j = start; j <= i; j++) {
      const bb = bolls[j];
      if (bb.mid && bb.upper && bb.lower) bands.push((bb.upper - bb.lower) / bb.mid);
    }
    bands.sort((a, b2) => a - b2);
    const p20 = bands[Math.floor(bands.length * 0.2)];
    squeeze = band < p20;
    const touchUpper = close >= b.mid + (b.upper - b.mid) * 0.7;
    const touchLower = close <= b.mid - (b.mid - b.lower) * 0.7;
    const upperRising = b.upper > b3.upper;
    const lowerFalling = b.lower < b3.lower;
    if (squeeze) {
      bollScore = 0;
      bollTag = { key: 'vol-squeeze', label: '布林收口', single: '收', color: 'slate', score: 0, dim: 'volatility', detail: [
        `带宽 ${(band * 100).toFixed(1)}% 低于近60日20%分位（${(p20 * 100).toFixed(1)}%）`,
        '大变盘前的宁静：盯方向，上破中轨做多、下破做空/离场',
      ] };
    } else if (touchUpper && upperRising) {
      bollScore = 1;
      bollTag = { key: 'vol-up', label: '上轨扩张', single: '扩', color: 'red', score: 1, dim: 'volatility', detail: [
        `上轨 ${fmt(b.upper)} 向上翘起，价 ${fmt(close)} 贴上轨运行`,
        '单边强趋势进行中：持仓者拿住，追高风险极大',
      ] };
    } else if (touchLower && lowerFalling) {
      bollScore = -1;
      bollTag = { key: 'vol-down', label: '下轨扩张', single: '扩', color: 'green', score: -1, dim: 'volatility', detail: [
        `下轨 ${fmt(b.lower)} 向下翘起，价 ${fmt(close)} 贴下轨运行`,
        '单边下跌恐慌中：不接飞刀，等价格站回下轨上方',
      ] };
    } else {
      bollScore = close >= b.mid ? 0.3 : -0.3;
    }
  }

  // ── 综合强弱周期（打分定档 + 关键信号确认）──
  // 权重重分配：均线40% + 量价40% + 波动20%（MACD已移除，权重归一）；量价缺席时剔除并归一
  const total = allowVolume
    ? 0.4 * trendScore + 0.4 * volumeScore + 0.2 * bollScore
    : (0.4 * trendScore + 0.2 * bollScore) / 0.6;
  const dimLine = allowVolume
    ? `均线 ${fmtScore(trendScore)} · 量价 ${fmtScore(volumeScore)} · 波动 ${fmtScore(bollScore)}`
    : `均线 ${fmtScore(trendScore)} · 量价 -- · 波动 ${fmtScore(bollScore)}`;
  const bear = trendScore <= -0.4;
  let cycle: EnvTag;
  if (total >= 0.6) {
    cycle = { key: 'cycle', label: '强进攻周期', single: '攻', color: 'red', score: total, dim: 'cycle', detail: [`综合得分 ${fmtScore(total)}`, dimLine, '趋势/量价/波动共振：重仓持有，逢回踩均线加仓'] };
  } else if (total <= -0.6) {
    cycle = { key: 'cycle', label: '弱筑底周期', single: '筑', color: 'indigo', score: total, dim: 'cycle', detail: [`综合得分 ${fmtScore(total)}`, dimLine, '下跌力量衰竭：轻仓试盘，等放量大阳线确认反转'] };
  } else if (total >= 0.2 && ((allowVolume && up && !volUp) || squeeze)) {
    cycle = { key: 'cycle', label: '强防守周期', single: '防', color: 'orange', score: total, dim: 'cycle', detail: [`综合得分 ${fmtScore(total)}`, dimLine, '趋势还在但内核转弱：只出不进，锁定利润，等方向明朗'] };
  } else if (total <= -0.2 && bear && ((allowVolume && isLowVol) || squeeze)) {
    cycle = { key: 'cycle', label: '弱筑底周期', single: '筑', color: 'indigo', score: total, dim: 'cycle', detail: [`综合得分 ${fmtScore(total)}`, dimLine, '空头衰竭信号（地量/收口）：轻仓试盘，急跌敢买'] };
  } else if (total <= -0.2 && bear) {
    cycle = { key: 'cycle', label: '弱反弹周期', single: '弹', color: 'green', score: total, dim: 'cycle', detail: [`综合得分 ${fmtScore(total)}`, dimLine, '空头下的超跌反抽：借反弹坚决减仓，绝不追高'] };
  } else {
    cycle = { key: 'cycle', label: '震荡变盘期', single: '震', color: 'slate', score: total, dim: 'cycle', detail: [`综合得分 ${fmtScore(total)}`, dimLine, '方向未明：控制仓位，等待突破确认'] };
  }
  const tags: EnvTag[] = [cycle];
  if (trendTag) tags.push(trendTag);
  if (volTag) tags.push(volTag);
  if (bollTag) tags.push(bollTag);
  return { tags, total, dimScores: { trend: trendScore, volume: volumeScore, volatility: bollScore } };
}

// 环境标签参考价值（实战含义）：key 为 EnvTag.label，文案取自 docs/行情标签体系说明书.md 第一部分
const ENV_REFERENCE: Record<string, string> = {
  '强进攻周期': '趋势/量能/动能三方共振的黄金时期。策略：重仓持有，逢回踩均线加仓，不轻易言顶。',
  '强防守周期': '鱼尾行情或变盘前夜，趋势还在但内核已弱。策略：只出不进，逐步减仓，锁定利润，等待方向明朗。',
  '弱反弹周期': '空头下的超跌反抽，标准的“逃命波”。策略：仓位重借此坚决减仓，持币观望，绝不追高。',
  '弱筑底周期': '黎明前的黑暗，下跌力量衰竭，大资金暗中吸筹。策略：轻仓试盘，急跌敢买，等放量大阳线确认反转。',
  '震荡变盘期': '方向选择前夜，多空未决。策略：控制仓位，等待突破方向确认。',
  '多头强排列': '主升浪进攻期。回踩 5/10 日线都是高胜算买点，只考虑止盈，不考虑止损离场（除非均线结构被破坏）。',
  '多头弱排列': '高位震荡/上涨中继。趋势未坏但短期赚钱效应下降，适合高抛低吸，不宜追涨杀跌。',
  '空头强排列': '主跌浪/系统性风险。反弹到 5/10 日线是标准“逃命线”，严禁抄底，持仓者应利用反弹止损。',
  '空头弱排列': '震荡筑底期。下跌动能衰竭但上涨趋势未起，适合小仓位试盘，等短期均线上穿的金叉确认。',
  '均线粘合': '方向选择的前夜（极强信号）。向上突破粘合区进入强周期，向下跌破进入弱周期。',
  '量增价升': '真金白银的拉升，趋势具有持续性。持仓不动是最优解。',
  '量缩价升': '动能衰竭的警告。高位易形成“诱多”陷阱，需立刻提高警惕。',
  '量增价跌': '视位置而定：高位是机构高位出货，坚决离场；大跌末端是恐慌盘涌出，往往接近“最后一跌”。',
  '量缩价跌': '无人接盘的阴跌，极其磨人。除非出现放量恐慌盘或大阳线，否则绝不能抄底。',
  '布林收口': '大变盘前的宁静（高价值信号）。盯紧方向：向上突破中轨做多，向下跌破中轨做空或离场。',
  '上轨扩张': '单边强趋势进行中，加速上涨标志。持仓者要拿住，但追高风险极大。',
  '下轨扩张': '单边下跌恐慌中，加速赶底。不要试图接飞刀，必须等价格重新站回下轨之上。',
};

// 每日量价/MACD 显著信号的参考价值（实战含义）：key 为 DailySignal.kind，
// 与"环境量价（当前状态）"的参考价值区分——这里是时间轴上的转折点/信号提示。
const DAILY_REFERENCE: Record<DailySignal['kind'], string> = {
  'macd-gold': '短期动能转强的转折信号。需放量配合确认，单独金叉可靠性一般，结合量价与环境周期综合判断。',
  'macd-dead': '短期动能转弱的转折信号。已持仓者警惕回调，未持仓者观望等待止跌企稳。',
  'vol-up': '放量当日往往是多方真实进场的确认点。若处低位且趋势向上，延续性强；高位放量需防诱多。',
  'vol-down': '抛压集中释放日。高位放量下跌警惕主力出货；低位放量下跌往往接近恐慌末端，可留意。',
  'vol-shrink': '多空观望的地量，常是变盘前宁静。不构成买卖依据，但值得关注随后的方向突破。',
};

// 每日信号的展示标签（color+缩写，见列表渲染），与浏览器环境/破位标签区分。
const SIG_LABEL: Record<DailySignal['kind'], string> = {
  'macd-gold': 'MACD金叉', 'macd-dead': 'MACD死叉', 'vol-up': '放量上涨', 'vol-down': '放量下跌', 'vol-shrink': '极度缩量',
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
  // 最新一根K线所在的年份（当前交易年份）：今年分红未完成，统一用选中年份的预估分红（fallback）计算
  const currentYear = parseInt((currentKlines[currentKlines.length - 1]?.date || '').slice(0, 4), 10);
  const chartData = currentKlines.slice(-range - offset, currentKlines.length - offset).map(k => {
    const byYear = stock.dividendByYear || {};
    const y = parseInt(k.date.slice(0, 4), 10);
    const pointDividend = (!isNaN(y) && y === currentYear) ? dividend
      : (!isNaN(y) && byYear[y] && byYear[y] > 0) ? byYear[y]
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
              strokeWidth={1.2}
              dot={false}
              activeDot={false}
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
          // 今年（当前交易年份）分红未完成：统一用选中年份的预估分红
          if (y === currentYear) return { amount: dividend, isApproximate: true };
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
  // 持仓列子列2当前展示类型（默认成本，点击在成本/份额间切换）
  const [positionDisplayMode, setPositionDisplayMode] = useState<PositionDisplayMode>('cost');
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
  const rateForKline = (stock: StockEntry, k: BollKline, fallback: number, klines: BollKline[]): number => {
    const byYear = stock.dividendByYear || {};
    const y = parseInt(k.date.slice(0, 4), 10);
    // 最新一根K线所在的年份（当前交易年份）：今年分红未完成，统一用选中年份的预估分红（fallback）
    const currentYear = klines.length > 0 ? parseInt((klines[klines.length - 1]?.date || '').slice(0, 4), 10) : NaN;
    const pointDividend = (!isNaN(y) && y === currentYear) ? fallback
      : (!isNaN(y) && byYear[y] && byYear[y] > 0) ? byYear[y]
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
    const rates = seg.map(k => rateForKline(stock, k, fallback, klines)).filter(r => r > 0);
    // 取去重后的最大与次大值
    const uniq = Array.from(new Set(rates)).sort((a, b) => b - a);
    const maxRate = uniq[0];
    const secondMaxRate = uniq[1];
    const denom = (maxRate !== undefined && currentRate >= maxRate) ? secondMaxRate : maxRate;
    if (denom === undefined || denom <= 0) return null;
    return (currentRate / denom) * 100;
  };
  // 周期内最低股息率 / 最高股息率的百分比（%），反映股息率的可能波动区间；无数据返回 null
  const calcDivRateRangeRatio = (stock: StockEntry, klines: BollKline[] | undefined): number | null => {
    if (!klines || klines.length === 0 || stock.bollHidden) return null;
    const fallback = getDividendForYear(stock, getSelectedYear(stock));
    const seg = klines.slice(-dailyChartRange - dailyChartOffset, klines.length - dailyChartOffset);
    if (seg.length === 0) return null;
    const rates = seg.map(k => rateForKline(stock, k, fallback, klines)).filter(r => r > 0);
    if (rates.length === 0) return null;
    const maxRate = Math.max(...rates);
    const minRate = Math.min(...rates);
    if (maxRate <= 0) return null;
    return (minRate / maxRate) * 100;
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
  const handleSortModeChange = (mode: 'default' | 'dividendRate' | 'tag' | 'daily' | 'weekly' | 'monthly' | 'changePercent') => {
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
  // 涨跌幅列排序方向：false=从大到小，true=从小到大，两档切换
  const [changePctSortReverse, setChangePctSortReverse] = useState(false);
  const handleChangePctSortClick = () => {
    if (sortMode !== 'changePercent') {
      if (onSortModeChange) onSortModeChange('changePercent');
      setChangePctSortReverse(false);
    } else {
      setChangePctSortReverse(prev => !prev);
    }
  };
  // 股息率列排序两档切换：'rate'=按股息率从高到低；'ratio'=按下方高百分比(区间当前位置股息率比例)从高到低
  const [divRateSortMode, setDivRateSortMode] = useState<'rate' | 'ratio'>('rate');
  const handleDivRateSortClick = () => {
    if (sortMode !== 'dividendRate') {
      if (onSortModeChange) onSortModeChange('dividendRate');
      setDivRateSortMode('rate');
    } else {
      setDivRateSortMode(prev => (prev === 'rate' ? 'ratio' : 'rate'));
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
    if (listSrTooltipPinned || priceInfoPinned || positionInfoPinned || divRateInfoPinned || mktInfoPinned) return;
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

  // 行情状态浮窗（近5交易日“破位”事件分析，数据复用 stockBollMap 日线，无需额外请求）
  const [mktInfoStock, setMktInfoStock] = useState<StockEntry | null>(null);
  const [mktInfoPos, setMktInfoPos] = useState({ left: 0, top: 0 });
  const [mktInfoPinned, setMktInfoPinned] = useState(false);
  const mktInfoBtnRef = useRef<HTMLTableCellElement | null>(null);
  const mktInfoRef = useRef<HTMLDivElement | null>(null);
  const mktInfoHoveredRef = useRef(false);
  const mktInfoActiveIdRef = useRef<string | undefined>(undefined);
  // 底部判定依据区：当前选中的标签（hover 展示 / 点击固定）
  // event/status = 破位类标签；pattern = K线形态标签；env = 环境标签
  // status = 观测末尾状态徽标（真/假/修）；repair = 中间观测日的“修复观察”徽标
  type MktSel = { date: string; kind: 'event' | 'status' | 'repair' }
    | { date: string; kind: 'pattern'; ptype: KlinePattern['type'] }
    | { date: string; kind: 'env'; ekey: string }
    | { date: string; kind: 'daily'; dkey: DailySignal['kind'] };
  const [mktSel, setMktSel] = useState<MktSel | null>(null);
  const [mktSelPinned, setMktSelPinned] = useState(false);
  const resetMktSel = () => { setMktSel(null); setMktSelPinned(false); };

  // 显示行情状态浮窗（位置参考价格浮窗：右侧垂直居中）
  const openMktInfo = (btn: HTMLElement, stock: StockEntry) => {
    mktInfoBtnRef.current = btn as unknown as HTMLTableCellElement;
    mktInfoActiveIdRef.current = stock.id;
    setMktInfoStock(stock);
    resetMktSel();
    const rect = btn.getBoundingClientRect();
    const popupW = 260;
    const estH = 420;
    const gap = 8;
    let left = rect.right + gap;
    let top = rect.top + rect.height / 2 - estH / 2;
    if (left + popupW > window.innerWidth - 10) left = rect.left - popupW - gap;
    if (left < 10) left = (window.innerWidth - popupW) / 2;
    if (top + estH > window.innerHeight - 10) top = window.innerHeight - estH - 10;
    if (top < 10) top = 10;
    setMktInfoPos({ left, top });
  };

  // 悬停名称显示行情状态（临时，不固定）
  const handleMktInfoEnter = (e: React.MouseEvent, stock: StockEntry) => {
    // 已有任一弹窗被点击固定：悬停其他项目不触发新弹窗，保持固定弹窗
    if (listSrTooltipPinned || priceInfoPinned || positionInfoPinned || divRateInfoPinned || mktInfoPinned) return;
    mktInfoHoveredRef.current = true;
    openMktInfo(e.currentTarget as HTMLElement, stock);
  };

  // 移开名称：非固定模式下直接关闭
  const handleMktInfoLeave = () => {
    mktInfoHoveredRef.current = false;
    if (mktInfoPinned) return;
    mktInfoActiveIdRef.current = undefined;
    setMktInfoStock(null);
    resetMktSel();
  };

  // 点击名称：切换固定/取消固定
  const handleMktInfoClick = (e: React.MouseEvent, stock: StockEntry) => {
    e.stopPropagation();
    if (mktInfoPinned && mktInfoStock?.id === stock.id) {
      mktInfoHoveredRef.current = false;
      mktInfoActiveIdRef.current = undefined;
      setMktInfoPinned(false);
      setMktInfoStock(null);
      resetMktSel();
      return;
    }
    openMktInfo(e.currentTarget as HTMLElement, stock);
    setMktInfoPinned(true);
  };

  // 悬停标签：展示判定依据（固定状态时不切换）
  const mktSelEq = (a: MktSel, b: MktSel): boolean => {
    if (a.kind !== b.kind || a.date !== b.date) return false;
    if (a.kind === 'pattern') return a.ptype === (b as { ptype: KlinePattern['type'] }).ptype;
    if (a.kind === 'env') return a.ekey === (b as { ekey: string }).ekey;
    if (a.kind === 'daily') return a.dkey === (b as { dkey: DailySignal['kind'] }).dkey;
    return true;
  };
  const handleMktTagEnter = (sel: MktSel) => {
    if (mktSelPinned) return;
    setMktSel(sel);
  };

  // 点击标签：固定/取消固定判定依据
  const handleMktTagClick = (sel: MktSel) => {
    // 悬停（未固定）模式下点击浮窗内标签：先把浮窗 host 固定，避免随后被 mouseleave 关闭整个浮窗
    if (!mktInfoPinned) setMktInfoPinned(true);
    if (mktSelPinned && mktSel && mktSelEq(mktSel, sel)) {
      resetMktSel();
    } else {
      setMktSel(sel);
      setMktSelPinned(true);
    }
  };


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
    if (listSrTooltipPinned || priceInfoPinned || positionInfoPinned || divRateInfoPinned || mktInfoPinned) return;
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
    if (listSrTooltipPinned || priceInfoPinned || positionInfoPinned || divRateInfoPinned || mktInfoPinned) return;
    divRateInfoHoveredRef.current = true;
    openDivRateInfo(e.currentTarget as HTMLElement, stock);
  };

  // 股息率悬停离开：非固定模式下直接关闭，不因鼠标快速移入浮窗（relatedTarget 命中图表）而残留
  const handleDivRateInfoLeave = (e?: React.MouseEvent) => {
    divRateInfoHoveredRef.current = false;
    if (divRateInfoPinned) return;
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
    if (listSrTooltipPinned || priceInfoPinned || positionInfoPinned || divRateInfoPinned || mktInfoPinned) return;
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

  // 名称列第二行展示模式：默认“状态标签”，点击“代码”表头切换为展示代码
  const [nameSubMode, setNameSubMode] = useState<'tags' | 'code'>('tags');
  // 最新收盘交易日状态标签（按 klines 引用缓存，数据未变时不重复计算）
  // 标签文本/逻辑变更时需 +1 版本号，避免 HMR 保留旧缓存导致缩写不生效
  const LATEST_TAG_VERSION = 8;
  const latestTagsCache = useRef(new Map<string, { v: number; key: unknown; tags: { key: string; text: string; cls: string }[] }>());
  const getLatestDayTags = (stock: StockEntry): { key: string; text: string; cls: string }[] => {
    const daily = stockBollMap.get(stock.id)?.daily;
    const klines = daily?.klines;
    if (!klines || klines.length === 0) return [];
    const cached = latestTagsCache.current.get(stock.id);
    if (cached && cached.key === klines && cached.v === LATEST_TAG_VERSION) return cached.tags;
    const events = analyzeMarketConditions(klines);
    const lastDate = klines[klines.length - 1].date;
    // 破位类事件标签（不含“修复观察”）
    const breakTags: { key: string; text: string; cls: string }[] = [];
    for (const ev of events) {
      // 仅保留“观测窗口覆盖最新交易日”的事件标签（含当天新破位）
      if (!ev.window.some(w => w.date === lastDate)) continue;
      if (ev.date === lastDate) {
        // 当天破位
        breakTags.push({ key: `r-${lastDate}`, text: '破', cls: 'bg-green-500/10 text-green-500 border-green-500/20' });
      } else if (ev.status !== 'confirming') {
        // 观测窗口恰好在最新交易日收盘后定论（仍在观测中的“修”不展示）
        breakTags.push({ key: `d-${ev.date}`, text: ev.status === 'trueBreak' ? '真' : '假', cls: ev.status === 'trueBreak' ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-red-500/10 text-red-500 border-red-500/20' });
      }
    }
    // 环境标签
    const env = analyzeEnvironment(klines, v => formatPrice(v, stock.name), isTodayVolumeEligible(klines));
    const envCls: Record<EnvTag['color'], string> = {
      red: 'bg-red-500/10 text-red-500 border-red-500/20',
      green: 'bg-green-500/10 text-green-500 border-green-500/20',
      orange: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
      indigo: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
      slate: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
    };
    // 依次拼装：K线形态 → 综合周期 → 量价 → 布林 → 破位
    const tags: { key: string; text: string; cls: string }[] = [];
    const patterns = analyzeKlinePatterns(klines, v => formatPrice(v, stock.name));
    for (const p of patterns) {
      tags.push({
        key: `p-${p.type}`,
        text: p.single,
        cls: p.color === 'red' ? 'bg-red-500/10 text-red-500 border-red-500/20'
          : p.color === 'green' ? 'bg-green-500/10 text-green-500 border-green-500/20'
          : 'bg-slate-500/10 text-slate-400 border-slate-500/30',
      });
    }
    const cycle = env ? env.tags.find(t => t.key === 'cycle') : null;
    if (cycle) tags.push({ key: 'env-cycle', text: cycle.single, cls: envCls[cycle.color] });
    if (env) {
      for (const t of env.tags) {
        if (t.dim === 'volume' || t.dim === 'volatility') {
          // 量价颜色按价格涨跌红绿（量增/缩配合升红/跌绿），布林按上轨扩张红/下轨扩张绿/收口灰
          tags.push({ key: `env-${t.key}`, text: t.single, cls: envCls[t.color] });
        }
      }
    }
    tags.push(...breakTags);
    latestTagsCache.current.set(stock.id, { v: LATEST_TAG_VERSION, key: klines, tags });
    return tags;
  };

  // 列表当前显示顺序（按排序规则重排；默认顺序即 stocks 原序）
  const sortedStocks = useMemo(() => {
    if (sortMode === 'dividendRate') {
      if (divRateSortMode === 'ratio') {
        // 两档切换第2档：按股息率列下方"右侧高百分比"(区间内当前位置股息率相对最高/次高的比例)从高到低
        const ratioVal = (s: StockEntry): number => {
          const cur = getDividendRate(s);
          if (cur <= 0) return -Infinity;
          const klines = stockBollMap.get(s.id)?.daily?.klines;
          const v = calcDivRateHistoryRatio(s, klines, cur);
          return v ?? -Infinity;
        };
        return [...stocks].sort((a, b) => ratioVal(b) - ratioVal(a));
      }
      // 第1档：按股息率从高到低
      return [...stocks].sort((a, b) => getDividendRate(b) - getDividendRate(a));
    } else if (sortMode === 'changePercent') {
      // 两档切换：false=从大到小，true=从小到大
      return [...stocks].sort((a, b) => changePctSortReverse
        ? (a.changePercent || 0) - (b.changePercent || 0)
        : (b.changePercent || 0) - (a.changePercent || 0));
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
  }, [stocks, sortMode, stockBollMap, bollSortReverse, changePctSortReverse, divRateSortMode]);

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
    let oldCacheInfoStr = '';
    if (cacheTimestamps.length > 0) {
      const maxTs = Math.max(...cacheTimestamps); // 使用最新缓存时间，更准确反映缓存有效期
      const isTrading = isTradingHours();
      const expiryTime = isTrading ? maxTs + dynamicTTL : now + dynamicTTL;
      cacheInfoStr = `（缓存有效期至：${formatCacheTime(expiryTime)}）`;
      // 原缓存有效期：按其缓存时间 + TTL 计算（标注在"已过期"后，区别于新缓存的有效期）
      oldCacheInfoStr = `（原缓存有效期至 ${formatCacheTime(maxTs + dynamicTTL)}）`;
    }
    const logCtx = requestLogService.beginBatch(
      staleCount === 0
        ? `${trigger}：${visibleTotal} 项缓存均未过期，无需请求${cacheInfoStr}`
        : `${trigger}：${staleCount}/${visibleTotal} 项已过期${oldCacheInfoStr}，重新请求 ${staleCount} 条请求${cacheInfoStr}`
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

  // 列表页行情状态浮窗：点击外部关闭
  useEffect(() => {
    if (!mktInfoPinned) return;
    const handler = (e: MouseEvent) => {
      if (mktInfoRef.current && !mktInfoRef.current.contains(e.target as Node) &&
          mktInfoBtnRef.current && !mktInfoBtnRef.current.contains(e.target as Node)) {
        mktInfoHoveredRef.current = false;
        mktInfoActiveIdRef.current = undefined;
        setMktInfoPinned(false);
        setMktInfoStock(null);
        resetMktSel();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [mktInfoPinned]);

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
      // 第一条请求失败即终止所有请求，并提示网络异常
      if (i === 0 && result.error) {
        showNotice('分红数据查询失败，请检查网络环境。');
        setIsFetchingDividends(false);
        return;
      }
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

  // 持仓列子列2展示模式两态切换：成本 → 份额 → 成本
  const cyclePositionMode = () => {
    setPositionDisplayMode(prev => prev === 'cost' ? 'shares' : 'cost');
  };

  // ============ 交易记录列（持仓大列内子列3） ============
  // 每只股票最多保留的已成交记录条数，控制 Gist 上传/下载负载；挂单不设上限
  const MAX_FILLED_TRADES = 20;
  // 超出上限的已成交记录压缩为两条只读合并汇总（买入最底、卖出倒数第二），不计入上限；用金额精确延续成本链
  const compactFilledTrades = (trades: StockTrade[]): StockTrade[] => {
    const ordinary = trades.filter(t => t.status === 'filled' && !t.isMerged);
    const excess = ordinary.length - MAX_FILLED_TRADES;
    if (excess <= 0) return trades;
    const sorted = [...ordinary].sort((a, b) => (a.filledAt || a.createdAt) - (b.filledAt || b.createdAt));
    const fold = sorted.slice(0, excess);
    const keepIds = new Set(sorted.slice(excess).map(t => t.id));
    // 汇总被折叠段：按方向累加总股数/总金额
    let buyShares = 0, buyAmt = 0, sellShares = 0, sellAmt = 0;
    for (const t of fold) {
      if (t.side === 'buy') { buyShares += t.shares; buyAmt += t.price * t.shares; }
      else { sellShares += t.shares; sellAmt += t.price * t.shares; }
    }
    const kept = trades.filter(t => t.status !== 'filled' || t.isMerged || keepIds.has(t.id));
    const existingBuy = kept.find(t => t.isMerged && t.side === 'buy');
    const existingSell = kept.find(t => t.isMerged && t.side === 'sell');
    const globalMin = trades.length ? Math.min(...trades.map(t => t.createdAt)) : Date.now();
    const res = kept.filter(t => !t.isMerged); // 撤销旧合并，下方按当前汇总重建
    // 买入合并：最底（createdAt 最小）
    const newBuyShares = (existingBuy ? existingBuy.shares : 0) + buyShares;
    const newBuyAmt = (existingBuy ? existingBuy.amount || 0 : 0) + buyAmt;
    if (newBuyShares > 0) {
      res.push({
        id: existingBuy?.id || `merged-buy-${globalMin}`, side: 'buy', price: newBuyAmt / newBuyShares,
        shares: newBuyShares, status: 'filled', createdAt: globalMin - 2,
        filledAt: existingBuy?.filledAt ?? fold[0]?.filledAt, isMerged: true,
        amount: newBuyAmt, note: existingBuy?.note ?? '合并买入',
      });
    }
    // 卖出合并：倒数第二（createdAt 略大于买入合并）
    const newSellShares = (existingSell ? existingSell.shares : 0) + sellShares;
    const newSellAmt = (existingSell ? existingSell.amount || 0 : 0) + sellAmt;
    if (newSellShares > 0) {
      res.push({
        id: existingSell?.id || `merged-sell-${globalMin}`, side: 'sell', price: newSellAmt / newSellShares,
        shares: newSellShares, status: 'filled', createdAt: globalMin - 1,
        filledAt: existingSell?.filledAt ?? fold[fold.length - 1]?.filledAt, isMerged: true,
        amount: newSellAmt, note: existingSell?.note ?? '合并卖出',
      });
    }
    return res;
  };
  const TRADE_STATUS_LABEL: Record<string, string> = {
    'buy-pending': '挂买', 'sell-pending': '挂卖',
    'buy-filled': '买入', 'sell-filled': '卖出',
  };
  const tradeStatusColor = (t: StockTrade) => t.status === 'pending' ? 'text-orange-400' : (t.side === 'buy' ? 'text-brand-red' : 'text-brand-green');
  const getTrades = (stock: StockEntry): StockTrade[] => stock.stockTrades || [];

  // 交易浮窗状态
  const [tradeInfoStock, setTradeInfoStock] = useState<StockEntry | null>(null);
  const [tradeInfoPos, setTradeInfoPos] = useState<{ top: number, left: number }>({ top: 0, left: 0 });
  const [tradeInfoPinned, setTradeInfoPinned] = useState(false);
  const [tradeInfoSettled, setTradeInfoSettled] = useState(false);
  const tradeSettledOnceRef = useRef(false);
  const tradeInfoBtnRef = useRef<HTMLTableCellElement | null>(null);
  const tradeInfoRef = useRef<HTMLDivElement | null>(null);

  // 新增挂单表单状态（提交成功后清空）
  const [addTradeSide, setAddTradeSide] = useState<'buy' | 'sell'>('buy');
  const [addTradePrice, setAddTradePrice] = useState('');
  const [addTradeShares, setAddTradeShares] = useState('');
  const [addTradeNote, setAddTradeNote] = useState('');
  const [editingTradeId, setEditingTradeId] = useState<string | null>(null);

  const openTradeInfo = (btn: HTMLElement, stock: StockEntry) => {
    tradeInfoBtnRef.current = btn as unknown as HTMLTableCellElement;
    setTradeInfoStock(stock);
    setTradeInfoSettled(false);
    tradeSettledOnceRef.current = false;
    // 挂单价格默认预填当前现价（股票/ETF 分别 2/3 位小数）
    setAddTradePrice(stock.price > 0 ? formatPrice(stock.price, stock.name) : '');
    const rect = btn.getBoundingClientRect();
    const popupW = 304;
    const estH = 520;
    const gap = 8;
    let left = rect.right + gap;
    // X 轴位置保持不动（沿用左右翻店逻辑），仅确定垂直居中 Y 轴
    if (left + popupW > window.innerWidth - 10) left = rect.left - popupW - gap;
    if (left < 10) left = (window.innerWidth - popupW) / 2;
    // 垂直居中于浏览器中心（最终位置由隐藏态测量后一次性确定，避免弹跳）
    const top = Math.max(10, Math.min(window.innerHeight - estH - 10, (window.innerHeight - estH) / 2));
    setTradeInfoPos({ left, top });
  };

  // 交易浮窗统一关闭：必须同时清除 pinned 与 stock，否则浮窗仍显示
  const closeTradeInfo = useCallback(() => {
    setTradeInfoPinned(false);
    setTradeInfoStock(null);
    setTradeInfoSettled(false);
    setEditingTradeId(null);
  }, []);

  // 交易浮窗可拖拽（拖画画头部）——参考黄金项目 EditBubble，改用 window 级指针监听，
  // 不依赖 pointer capture，避免捕获残留导致拖拽后点击空白无法关闭
  const tradeDragOffset = useRef({ x: 0, y: 0 });
  const isTradeDragging = useRef(false);
  const tradeDragMove = (e: PointerEvent) => {
    if (!isTradeDragging.current || !tradeInfoRef.current) return;
    const el = tradeInfoRef.current;
    el.style.left = `${e.clientX - tradeDragOffset.current.x}px`;
    el.style.top = `${e.clientY - tradeDragOffset.current.y}px`;
  };
  const tradeDragEnd = () => {
    if (!isTradeDragging.current) return;
    isTradeDragging.current = false;
    window.removeEventListener('pointermove', tradeDragMove);
    window.removeEventListener('pointerup', tradeDragEnd);
    window.removeEventListener('pointercancel', tradeDragEnd);
    document.body.style.cursor = '';
    const el = tradeInfoRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setTradeInfoPos({ left: rect.left, top: rect.top });
      el.style.transition = '';
    }
  };
  const handleTradeDragStart = (e: React.PointerEvent) => {
    const el = tradeInfoRef.current;
    if (!el || e.button !== 0) return;
    isTradeDragging.current = true;
    e.preventDefault();
    e.stopPropagation();
    const rect = el.getBoundingClientRect();
    tradeDragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    el.style.transition = 'none';
    document.body.style.cursor = 'grabbing';
    window.addEventListener('pointermove', tradeDragMove);
    window.addEventListener('pointerup', tradeDragEnd);
    window.addEventListener('pointercancel', tradeDragEnd);
  };

  // 首次打开：隐藏态测量真实高度后一次性定位居中（避免弹跳）；之后仅做边界钳制，不影响拖拽自由定位
  useEffect(() => {
    if (!tradeInfoStock || !tradeInfoRef.current) return;
    const raf = requestAnimationFrame(() => {
      const el = tradeInfoRef.current;
      if (!el) return;
      const pad = 8;
      const r = el.getBoundingClientRect();
      if (!tradeSettledOnceRef.current) {
        // 首次：垂直居中于浏览器中心，X 轴保持不动，然后一次性显示
        tradeSettledOnceRef.current = true;
        const top = Math.max(pad, (window.innerHeight - r.height - pad) / 2);
        setTradeInfoPos({ left: r.left, top });
        setTradeInfoSettled(true);
        return;
      }
      // 拖拽/后续：仅防止超出视口
      let top = r.top;
      let left = r.left;
      if (top < pad) top = pad;
      if (top + r.height > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - r.height - pad);
      if (left < pad) left = pad;
      if (left + r.width > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - r.width - pad);
      if (top !== r.top || left !== r.left) setTradeInfoPos({ left, top });
    });
    return () => cancelAnimationFrame(raf);
  }, [tradeInfoStock, tradeInfoPos]);

  // 点击交易列：切换固定/取消固定
  const handleTradeInfoClick = (e: React.MouseEvent, stock: StockEntry) => {
    e.stopPropagation();
    if (tradeInfoPinned && tradeInfoStock?.id === stock.id) {
      closeTradeInfo();
      return;
    }
    openTradeInfo(e.currentTarget as HTMLElement, stock);
    setTradeInfoPinned(true);
  };

  // 交易浮窗：点击外部关闭（与价格浮窗机制一致）
  useEffect(() => {
    if (!tradeInfoPinned) return;
    const handler = (e: MouseEvent) => {
      if (tradeInfoRef.current && !tradeInfoRef.current.contains(e.target as Node) &&
          tradeInfoBtnRef.current && !tradeInfoBtnRef.current.contains(e.target as Node)) {
        closeTradeInfo();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [tradeInfoPinned, closeTradeInfo]);

  // 新增一条交易记录：status 传 'pending' 为挂单（不影响持仓），传 'filled' 为直接成交（立即联动持仓）
  const handleAddTrade = useCallback((stockId: string, status: 'pending' | 'filled') => {
    const price = parseFloat(addTradePrice);
    let shares = parseFloat(addTradeShares);
    if (!(price > 0) || !(shares > 0)) return;
    // 卖出数量上限：不得超过现有持仓（静默截断，不做弹窗提示）
    if (addTradeSide === 'sell') {
      const avail = stocks.find(x => x.id === stockId)?.positionShares || 0;
      if (shares > avail) shares = avail;
    }
    const baseTrade: StockTrade = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      side: addTradeSide,
      price,
      shares,
      status,
      createdAt: Date.now(),
      note: addTradeNote.trim() || undefined,
    };
    onStocksChange(stocks.map(s => {
      if (s.id !== stockId) return s;
      let shares2 = s.positionShares || 0;
      let cost = s.positionCost || 0;
      let realizedPnL: number | undefined;
      let newTrade: StockTrade = baseTrade;
      if (status === 'filled') {
        // 直接成交：买入加权成本，卖出按当前均价结算已实现盈亏（与切换成交逻辑一致）
        if (addTradeSide === 'buy') {
          shares2 = shares2 + shares;
          cost = shares2 > 0 ? (cost * (shares2 - shares) + price * shares) / shares2 : 0;
        } else {
          shares2 = Math.max(0, shares2 - shares);
          realizedPnL = cost > 0 ? (price - cost) * shares : 0;
          if (shares2 === 0) cost = 0;
        }
        newTrade = { ...baseTrade, filledAt: Date.now(), realizedPnL };
      }
      let newTrades = [...(s.stockTrades || []), newTrade];
      // 已成交记录超限：把最旧的折叠为两条合并汇总（只读，不计入上限），避免 Gist 负载膨胀且成本链可精确追溯
      if (status === 'filled') newTrades = compactFilledTrades(newTrades);
      return { ...s, stockTrades: newTrades, positionShares: shares2, positionCost: cost };
    }));
    // 挂单/成交后仅清空数量与备注，保留价格（常为现价，方便连续操作）
    setAddTradeShares('');
    setAddTradeNote('');
  }, [stocks, onStocksChange, addTradeSide, addTradePrice, addTradeShares, addTradeNote]);

  // 保存编辑一条交易记录：先从原记录回退持仓影响，再按新字段与目标状态重算
  const handleSaveEditTrade = useCallback((stockId: string, tradeId: string, status: 'pending' | 'filled') => {
    const price = parseFloat(addTradePrice);
    let shares = parseFloat(addTradeShares);
    if (!(price > 0) || !(shares > 0)) return;
    onStocksChange(stocks.map(s => {
      if (s.id !== stockId) return s;
      const trades = s.stockTrades || [];
      const trade = trades.find(tr => tr.id === tradeId);
      if (!trade) return s;
      // 1) 移除该记录并回退其原有持仓影响
      const baseTrades = trades.filter(tr => tr.id !== tradeId);
      let shares2 = s.positionShares || 0;
      let cost = s.positionCost || 0;
      if (trade.status === 'filled') {
        if (trade.side === 'buy') {
          shares2 = Math.max(0, shares2 - trade.shares);
          if (shares2 > 0) cost = (cost * (shares2 + trade.shares) - trade.price * trade.shares) / shares2;
          else cost = 0;
        } else {
          // 原卖出清仓导致成本归零时无法精准恢复，保持当前值
          shares2 = shares2 + trade.shares;
        }
      }
      // 2) 卖出数量上限：不得超过回退原记录后的可用持仓（静默截断）
      if (addTradeSide === 'sell' && shares > shares2) shares = shares2;
      // 3) 按新字段构造记录
      let newTrade: StockTrade = {
        ...trade, side: addTradeSide, price, shares, note: addTradeNote.trim() || undefined,
        status, filledAt: undefined, realizedPnL: undefined,
      };
      if (status === 'filled') {
        if (addTradeSide === 'buy') {
          shares2 = shares2 + shares;
          cost = shares2 > 0 ? (cost * (shares2 - shares) + price * shares) / shares2 : 0;
        } else {
          shares2 = Math.max(0, shares2 - shares);
          const rp = cost > 0 ? (price - cost) * shares : 0;
          if (shares2 === 0) cost = 0;
          newTrade = { ...newTrade, filledAt: Date.now(), realizedPnL: rp };
        }
      }
      let newTrades = [...baseTrades, newTrade];
      // 已成交记录超限：折叠最旧成交为合并汇总（只读，不计入上限）
      if (status === 'filled') newTrades = compactFilledTrades(newTrades);
      return { ...s, stockTrades: newTrades, positionShares: shares2, positionCost: cost };
    }));
    // 保存编辑后仅清空数量与备注，保留价格
    setAddTradeShares('');
    setAddTradeNote('');
    setEditingTradeId(null);
  }, [stocks, onStocksChange, addTradeSide, addTradePrice, addTradeShares, addTradeNote]);

  // 撤单/删除一条交易记录：挂单直接删除；已成交记录删除时同步回退持仓（买入回减股数与成本加权、卖出回增股数与已实现盈亏）
  const handleRemoveTrade = useCallback((stockId: string, tradeId: string) => {
    onStocksChange(stocks.map(s => {
      if (s.id !== stockId) return s;
      const trade = (s.stockTrades || []).find(t => t.id === tradeId);
      if (!trade || trade.isMerged) return s;
      let shares = s.positionShares || 0;
      let cost = s.positionCost || 0;
      // 已成交记录删除：回退其持仓影响（与"取消成交"回退逻辑一致）
      if (trade.status === 'filled') {
        if (trade.side === 'buy') {
          shares = Math.max(0, shares - trade.shares);
          if (shares > 0) cost = (cost * (shares + trade.shares) - trade.price * trade.shares) / shares;
          else cost = 0;
        } else {
          shares = shares + trade.shares;
          // 若此前卖出已清仓导致成本归零，此处成本无法精准恢复，保持当前值
        }
      }
      return { ...s, stockTrades: (s.stockTrades || []).filter(t => t.id !== tradeId), positionShares: shares, positionCost: cost };
    }));
  }, [stocks, onStocksChange]);

  // 标记挂单成交：买入加权成本、卖出结算已实现盈亏；并控制已成交记录条数上限
  const handleToggleTrade = useCallback((stockId: string, tradeId: string) => {
    onStocksChange(stocks.map(s => {
      if (s.id !== stockId) return s;
      const trade = (s.stockTrades || []).find(t => t.id === tradeId);
      if (!trade || trade.isMerged) return s;
      let shares = s.positionShares || 0;
      let cost = s.positionCost || 0;
      let updatedTrade: StockTrade;
      let newTrades: StockTrade[];
      if (trade.status === 'pending') {
        // 标记成交：买入加权成本，卖出按当前均价结算已实现盈亏
        let realizedPnL: number | undefined;
        if (trade.side === 'buy') {
          shares = shares + trade.shares;
          cost = shares > 0 ? (cost * (shares - trade.shares) + trade.price * trade.shares) / shares : 0;
        } else {
          shares = Math.max(0, shares - trade.shares);
          realizedPnL = cost > 0 ? (trade.price - cost) * trade.shares : 0;
          if (shares === 0) cost = 0;
        }
        updatedTrade = { ...trade, status: 'filled', filledAt: Date.now(), realizedPnL };
      } else {
        // 取消成交（反选）：反向回退持仓，已实现盈亏与成交时间一并清除
        if (trade.side === 'buy') {
          shares = Math.max(0, shares - trade.shares);
          if (shares > 0) cost = (cost * (shares + trade.shares) - trade.price * trade.shares) / shares;
          else cost = 0;
        } else {
          shares = shares + trade.shares;
          // 若此前卖出已清仓（cost 归零），此处成本无法精准恢复，保持当前值，可手动校正
        }
        updatedTrade = { ...trade, status: 'pending', filledAt: undefined, realizedPnL: undefined };
      }
      newTrades = (s.stockTrades || []).map(t => t.id === tradeId ? updatedTrade : t);
      // 已成交记录超限：折叠最旧成交为合并汇总（只读，不计入上限），仅在标记成交时触发
      if (updatedTrade.status === 'filled') newTrades = compactFilledTrades(newTrades);
      return { ...s, stockTrades: newTrades, positionShares: shares, positionCost: cost };
    }));
  }, [stocks, onStocksChange]);

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
              {cols.includes('dividendRate') && <col style={{ width: '70px' }} />}
              {cols.includes('price') && <col style={{ width: '60px' }} />}
              {cols.includes('changePercent') && <col style={{ width: '55px' }} />}
              <col style={{ width: '65px' }} />
              <col style={{ width: '65px' }} />
              <col style={{ width: '65px' }} />
              {cols.includes('position') && <col style={{ width: '70px' }} />}
              {cols.includes('position') && <col style={{ width: '56px' }} />}
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
                    onClick={() => handleDivRateSortClick()}
                    title="点击切换排序：股息率高→低 / 下方高百分比高→低"
                  >
                    股息率
                  </th>
                )}
                {cols.includes('price') && <th className="px-1 py-2 text-center text-xs uppercase font-bold text-app-subtext tracking-wider border-b border-app-border border-r border-app-border bg-app-input whitespace-nowrap">价格</th>}
                {cols.includes('changePercent') && <th className="px-1 py-2 text-center text-xs uppercase font-bold text-app-subtext tracking-wider border-b border-app-border border-r border-app-border bg-app-input whitespace-nowrap cursor-pointer select-none" onClick={() => handleChangePctSortClick()}>涨跌幅</th>}
                <th
                className="px-1 py-2 text-center text-xs uppercase font-bold text-app-subtext tracking-wider border-b border-app-border border-r border-app-border bg-app-input whitespace-nowrap"
                colSpan={3}
              >
                <div className="flex items-center justify-center gap-1">
                  <span>BOLL</span>
                  {(() => {
                    const ts = getBollCacheTimestamps(stocks, bollAdjust, apiSource);
                    const t = ts.length > 0 ? Math.max(...ts) : 0;
                    return t > 0 ? <span className="text-[9px] text-app-subtext">{formatRelativeTime(t)}</span> : null;
                  })()}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      fetchAllBoll('点击「布林线」列头刷新按钮');
                    }}
                    disabled={isRefreshingBoll}
                    className="p-0.5 hover:bg-app-card rounded transition-colors disabled:opacity-50"
                    title="刷新所有BOLL数据"
                  >
                    <RefreshCw size={10} className={isRefreshingBoll ? 'animate-spin' : ''} />
                  </button>
                </div>
              </th>
                {cols.includes('position') && <th
                  colSpan={3}
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
                {(cols.includes('code') || cols.includes('name')) && <th
                  className="px-2 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border sticky left-[36px] z-10 cursor-pointer select-none hover:bg-app-card transition-colors"
                  onClick={() => setNameSubMode(m => m === 'tags' ? 'code' : 'tags')}
                  title="点击在状态标签/代码之间切换"
                >{nameSubMode === 'tags' ? '状态' : '代码'}</th>}
                {(cols.includes('dividendRate') || cols.includes('price') || cols.includes('changePercent')) && <th colSpan={3} className="px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border whitespace-nowrap">
                    <div className="flex items-center justify-center gap-1">
                      <span>{latestUpdateTime > 0 ? formatRelativeTime(latestUpdateTime) : '--'}</span>
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
                <th className="px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border cursor-pointer select-none hover:bg-app-card transition-colors" onClick={() => handleBollSortClick('daily')}>日线</th>
                <th className="px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border cursor-pointer select-none hover:bg-app-card transition-colors" onClick={() => handleBollSortClick('weekly')}>周线</th>
                <th className="px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border cursor-pointer select-none hover:bg-app-card transition-colors" onClick={() => handleBollSortClick('monthly')}>月线</th>
                {cols.includes('position') && <>
                  <th
                    className="w-[64px] px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border cursor-pointer select-none hover:bg-app-card transition-colors"
                    onClick={cyclePositionMode}
                    title={'点击切换展示：股息率 / 份额'}
                  >
                    {POSITION_MODE_LABEL[positionDisplayMode]}
                  </th>
                  <th
                    className="w-[64px] px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border"
                  >
                    成本
                  </th>
                  <th className="w-[56px] px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border">
                    交易
                  </th>
                </>}
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
                      ) : nameSubMode === 'tags' ? (
                        <div className="relative flex flex-col items-center justify-center cursor-pointer"
                          onMouseEnter={(e) => handleMktInfoEnter(e, stock)}
                          onMouseLeave={handleMktInfoLeave}
                          onClick={(e) => handleMktInfoClick(e, stock)}>
                          <span className={`text-[11px] font-bold leading-none ${getDividendRateColor(getDividendRate(stock), ranges)}`}>{(() => {
                            const raw = showNickname ? (getNickname(stock.code, stock.nickname) || stock.name) : stock.name;
                            const n = raw.replace(/\s/g, '');
                            return n.length > 5 ? n.slice(0, 5) + '…' : n;
                          })()}</span>
                          {(() => {
                            const tags = getLatestDayTags(stock);
                            if (tags.length === 0) return null;
                            return (
                              <div className="flex items-center justify-center gap-0.5 mt-1.5 leading-none">
                                {tags.slice(0, 5).map(t => (
                                  <span key={t.key} className={`inline-flex items-center justify-center rounded text-[8px] font-medium border px-0.5 py-px whitespace-nowrap ${t.cls}`}>{t.text}</span>
                                ))}
                              </div>
                            );
                          })()}
                        </div>
                      ) : (
                        <div className="relative flex items-center justify-center h-8 whitespace-nowrap cursor-pointer"
                          onMouseEnter={(e) => handleMktInfoEnter(e, stock)}
                          onMouseLeave={handleMktInfoLeave}
                          onClick={(e) => handleMktInfoClick(e, stock)}>
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
                        const rangeRatio = calcDivRateRangeRatio(stock, klines);
                        return (
                          <span className="font-mono text-[10px] text-app-rowtext">
                            {ratio !== null && rangeRatio !== null
                              ? `${Math.round(rangeRatio)}-${Math.round(ratio)}%`
                              : ratio !== null ? `${Math.round(ratio)}%` : '--'}
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
                  {cols.includes('changePercent') && <td
                    onMouseEnter={(e) => handleListSrHoverEnter(e, stock)}
                    onMouseLeave={() => handleListSrHoverLeave()}
                    onClick={(e) => handleListSrClick(e, stock, true)}
                    className="px-1 py-1.5 text-center border-r border-app-border cursor-pointer hover:bg-app-input/50 transition-colors"
                    title=""
                  >
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
                    const showCostPct = cost > 0 && stock.price > 0;
                    const totalAmount = shares > 0 && cost > 0 ? `¥${Math.round(shares * cost).toLocaleString()}` : '-';
                    const hasPosition = shares > 0 || cost > 0;
                    // 子列1：默认展示股息率，点击表头切换为份额（详见标题）
                    const col1 = positionDisplayMode === 'shares' ? (
                      <td
                        className="w-[64px] px-1 py-1.5 text-center border-r border-app-border cursor-pointer"
                        onMouseEnter={(e) => { if (editingId !== stock.id && hasPosition) handlePositionInfoEnter(e, stock); }}
                        onMouseLeave={handlePositionInfoLeave}
                        onClick={(e) => { if (editingId !== stock.id && hasPosition) handlePositionInfoClick(e, stock); }}
                      >
                        {hasPosition ? (
                          <div className="flex flex-col items-center leading-tight gap-px">
                            <span className="font-mono text-[11px] whitespace-nowrap text-app-rowtext">{totalAmount}</span>
                            <span className="font-mono text-[10px] text-app-rowtext">{sharesText}</span>
                          </div>
                        ) : (
                          <span className="font-mono text-[11px] whitespace-nowrap text-app-rowtext">-</span>
                        )}
                      </td>
                    ) : (
                      <td
                        className="w-[64px] px-1 py-1.5 text-center border-r border-app-border cursor-pointer"
                        onMouseEnter={(e) => { if (editingId !== stock.id && hasPosition) handlePositionInfoEnter(e, stock); }}
                        onMouseLeave={handlePositionInfoLeave}
                        onClick={(e) => { if (editingId !== stock.id && hasPosition) handlePositionInfoClick(e, stock); }}
                      >
                        {hasPosition ? (
                          <div className="flex flex-col items-center leading-tight gap-px">
                            <span className={`font-mono text-[11px] whitespace-nowrap ${costColor}`}>{yieldPct}</span>
                            <span className="font-mono text-[10px] text-app-rowtext">{yieldDiffStr}</span>
                          </div>
                        ) : (
                          <span className="font-mono text-[11px] whitespace-nowrap text-app-subtext">-</span>
                        )}
                      </td>
                    );
                    // 子列2：固定展示成本
                    const col2 = (
                      <td
                        className="w-[64px] px-1 py-1.5 text-center border-r border-app-border cursor-pointer"
                        onMouseEnter={(e) => { if (editingId !== stock.id && hasPosition) handlePositionInfoEnter(e, stock); }}
                        onMouseLeave={handlePositionInfoLeave}
                        onClick={(e) => { if (editingId !== stock.id && hasPosition) handlePositionInfoClick(e, stock); }}
                      >
                        {showCostPct ? (
                          <div className="flex flex-col items-center leading-tight gap-px">
                            <span className={`font-mono text-[11px] whitespace-nowrap ${costColor}`}>{costText}</span>
                            <span className="font-mono text-[10px] text-app-rowtext">{positionPctStr}</span>
                          </div>
                        ) : (
                          <span className={`font-mono text-[11px] whitespace-nowrap ${costColor}`}>{costText}</span>
                        )}
                      </td>
                    );
                    const col3 = (
                      <td
                        className="w-[56px] px-1 py-1.5 text-center border-r border-app-border cursor-pointer"
                        onClick={(e) => { if (editingId !== stock.id) handleTradeInfoClick(e, stock); }}
                      >
                        {(() => {
                          const trades = getTrades(stock);
                          const ordinary = trades.filter(t => !t.isMerged);
                          const latest = ordinary.length ? [...ordinary].sort((a, b) => b.createdAt - a.createdAt)[0] : null;
                          if (!latest) return (
                            <div className="flex flex-col items-center leading-tight gap-px">
                              <span className="text-[9px]">&nbsp;</span>
                              <span className="font-mono text-[10px] whitespace-nowrap text-app-subtext">-</span>
                              <span className="font-mono text-[8px]">&nbsp;</span>
                            </div>
                          );
                          const tradePrice = latest.price;
                          const diffValid = (stock.price || 0) > 0 && tradePrice > 0;
                          const diffNum = diffValid ? ((stock.price - tradePrice) / tradePrice) * 100 : null;
                          const priceDiffPct = diffNum != null ? `${diffNum >= 0 ? '+' : ''}${diffNum.toFixed(2)}%` : '';
                          const isSellFilled = latest.side === 'sell' && latest.status === 'filled';
                          const isBuyFilled = latest.side === 'buy' && latest.status === 'filled';
                          const isPending = latest.status === 'pending';
                          // 「可能已成交」智能判断：挂单方向 + 现价/挂单价符号对比 + 挂单当日盘中高低价对比
                          // 挂买百分比为负（现价<=挂单价）或当日最低<=挂单价 → 可能触发；挂卖百分比为正（现价>=挂单价）或当日最高>=挂单价 → 可能触发
                          let likelyFill = false;
                          if (isPending && latest.price > 0 && (stock.price || 0) > 0) {
                            const todayRange = (() => {
                              const d = new Date(latest.createdAt); const n = new Date();
                              return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
                            })();
                            if (latest.side === 'buy') {
                              likelyFill = stock.price <= latest.price || (todayRange && stock.low > 0 && stock.low <= latest.price);
                            } else {
                              likelyFill = stock.price >= latest.price || (todayRange && stock.high > 0 && stock.high >= latest.price);
                            }
                          }
                          const pctColor = diffNum != null && isSellFilled && diffNum < 0 ? 'text-brand-green'
                            : diffNum != null && isBuyFilled && diffNum > 0 ? 'text-brand-red'
                            : diffNum != null && isPending && likelyFill ? 'text-orange-400'
                            : 'text-app-rowtext';
                          return (
                            <div className="flex flex-col items-center leading-tight gap-px">
                              <span className={`text-[9px] font-bold whitespace-nowrap ${tradeStatusColor(latest)}`}>{TRADE_STATUS_LABEL[`${latest.side}-${latest.status}`]}</span>
                              <span className="font-mono text-[10px] whitespace-nowrap text-app-rowtext">{formatPrice(latest.price, stock.name)}</span>
                              {priceDiffPct && <span className={`font-mono text-[8px] font-semibold whitespace-nowrap ${pctColor}`}>{priceDiffPct}</span>}
                            </div>
                          );
                        })()}
                      </td>
                    );
                    return (
                      <React.Fragment key="position-cols">
                        {col1}
                        {col2}
                        {col3}
                      </React.Fragment>
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

      {/* 交易记录浮窗：管理买卖/挂单，标记成交联动持仓 */}
      {tradeInfoStock && (() => {
        const s = stocks.find(x => x.id === tradeInfoStock.id) || tradeInfoStock;
        const trades = getTrades(s);
        const sortedTrades = [...trades].sort((a, b) => b.createdAt - a.createdAt);
        const orderAmount = (parseFloat(addTradePrice) || 0) * (parseFloat(addTradeShares) || 0);
        const fmtP = (v: number) => formatPrice(v, s.name);
        const timeStr = (ts: number) => {
          const d = new Date(ts);
          return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        };
        const noteCls = "no-spinners w-full bg-app-input border border-app-border rounded-lg px-3 py-2 text-[11px] text-app-text outline-none focus:border-brand-yellow/50 focus:ring-1 focus:ring-brand-yellow/50 transition-all placeholder:text-app-subtext/40";
        // 当前持仓概要（口径与黄金项目一致：均价=总成本/持仓量，回本价考虑已落袋盈亏）
        const posShares = s.positionShares || 0;
        let avgCost = s.positionCost || 0;
        const marketPrice = s.price || 0;
        // 按成交顺序用移动加权成本重算每笔卖出的已实现盈亏（不依赖可能为 0 的存储 positionCost/realizedPnL）
        const recalcPnL = (() => {
          const filled = getTrades(s)
            .filter(t => t.status === 'filled')
            .sort((a, b) => a.createdAt - b.createdAt);
          let rs = 0, rc = 0, total = 0;
          const map: Record<string, number> = {};
          for (const t of filled) {
            // 金额优先取自 amount（合并记录必填），普通记录退化为 price*shares
            const amt = t.amount ?? t.price * t.shares;
            if (t.side === 'buy') {
              const prevRs = rs;
              rs += t.shares;
              rc = rs > 0 ? (rc * prevRs + amt) / rs : 0;
            } else {
              map[t.id] = rs > 0 ? amt - rc * t.shares : 0;
              total += map[t.id];
              rs = Math.max(0, rs - t.shares);
              if (rs === 0) rc = 0;
            }
          }
          return { map, total };
        })();
        const realizedPnl = recalcPnL.total;
        // 兜底：无显式成本但有已成交买入记录时，用成交加权均价代替（避免建仓后显示 0）
        if (avgCost <= 0 && posShares > 0) {
          const buys = getTrades(s).filter(t => t.status === 'filled' && t.side === 'buy');
          const totSharesB = buys.reduce((a, t) => a + t.shares, 0);
          if (totSharesB > 0) avgCost = buys.reduce((a, t) => a + (t.amount ?? t.price * t.shares), 0) / totSharesB;
        }
        const totalCost = posShares * avgCost;
        const breakEven = posShares > 0 ? Math.max(0, (totalCost - realizedPnl) / posShares) : 0;
        const floatingPnl = marketPrice > 0 && posShares > 0 ? (marketPrice - avgCost) * posShares : 0;
        // 当前持仓总金额（市值 = 持仓 × 现价）
        const totalValue = marketPrice > 0 ? posShares * marketPrice : 0;
        // 卖出数量上限：编辑模式下"视作未发生这笔交易"，回退其持仓影响后再限制（买入已回退则更严，卖出已回退则放宽）
        const editingCap = (() => {
          if (addTradeSide !== 'sell') return undefined;
          const base = s.positionShares || 0;
          const et = getTrades(s).find(x => x.id === editingTradeId);
          if (et) {
            if (et.status === 'filled' && et.side === 'buy') return Math.max(0, base - et.shares);
            if (et.status === 'filled' && et.side === 'sell') return base + et.shares;
          }
          return base;
        })();
        // 价格红绿着色：现价相对均价（高红低绿）；均价/回本价相对现价反向（高绿低红）
        const priceColor = (p: number, base: number, invert = false) => {
          if (!(marketPrice > 0) || p <= 0 || base <= 0) return 'text-app-text';
          if (Math.abs(p - base) < 0.005) return 'text-app-text';
          const higher = p > base;
          return (invert ? !higher : higher) ? 'text-brand-red' : 'text-brand-green';
        };
        return (
          <div
            ref={tradeInfoRef}
            className="fixed z-[60] bg-app-card border border-app-border shadow-[0_10px_40px_-10px_rgba(0,0,0,0.7)] rounded-xl overflow-hidden text-app-text"
            style={{ top: tradeInfoPos.top, left: tradeInfoPos.left, width: 304, opacity: tradeInfoSettled ? 1 : 0, transform: tradeInfoSettled ? 'none' : 'translate(0,0)' }}
          >
            {/* 可拖拽头部 */}
            <div
              onPointerDown={handleTradeDragStart}
              className="bg-app-bg/80 backdrop-blur-md px-3 py-2.5 flex items-center justify-between border-b border-app-border cursor-grab active:cursor-grabbing touch-none select-none group"
            >
              <div className="flex items-center gap-2 text-app-subtext pointer-events-none">
                <GripHorizontal size={15} className="opacity-80" />
                <h4 className="text-[12px] font-bold tracking-wider text-app-text">{s.name} · 交易</h4>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={closeTradeInfo} onPointerDown={(e) => e.stopPropagation()} className="text-app-subtext hover:text-app-text transition-colors bg-app-text/5 hover:bg-app-text/10 rounded p-1" title="关闭">
                  <X size={15} />
                </button>
              </div>
            </div>

            <div className="px-3 py-3 space-y-3 bg-app-card max-h-[80vh] overflow-y-auto">
              {/* 当前持仓概要 */}
              <div className="border border-app-border rounded-lg divide-y divide-app-border bg-app-input/50">
                <div className="px-2.5 pt-2 pb-1.5 flex items-center justify-center">
                  <span className="text-[10px] uppercase font-bold text-app-subtext tracking-wider">当前持仓</span>
                </div>
              <div className="grid grid-cols-3 gap-2 px-2.5 pb-2 pt-1.5">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[9px] uppercase font-bold text-app-subtext tracking-wider">现价</span>
                      <span className={`font-mono font-bold ${marketPrice > 0 && posShares > 0 ? priceColor(marketPrice, avgCost) : 'text-app-text'}`}>{marketPrice > 0 ? fmtP(marketPrice) : '-'}</span>
                    </div>
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[9px] uppercase font-bold text-app-subtext tracking-wider">持仓均价</span>
                      <span className={`font-mono font-bold ${posShares > 0 && avgCost > 0 ? priceColor(avgCost, marketPrice, true) : 'text-app-text'}`}>{posShares > 0 && avgCost > 0 ? fmtP(avgCost) : '-'}</span>
                    </div>
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[9px] uppercase font-bold text-app-subtext tracking-wider">回本价</span>
                      <span className={`font-mono font-bold ${posShares > 0 && avgCost > 0 ? priceColor(breakEven, marketPrice, true) : 'text-app-text'}`}>{posShares > 0 && avgCost > 0 ? fmtP(breakEven) : '-'}</span>
                    </div>
                  </div>
                <div className="px-2.5 pt-1.5 pb-2 grid grid-cols-4 gap-1">
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-[9px] uppercase font-bold text-app-subtext tracking-wider">持仓</span>
                    <span className="font-mono font-bold text-[11px]">{posShares}</span>
                  </div>
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-[9px] uppercase font-bold text-app-subtext tracking-wider">总金额</span>
                    <span className="font-mono font-bold text-[11px]">{marketPrice > 0 ? totalValue.toLocaleString('zh-CN', { maximumFractionDigits: 0 }) : '-'}</span>
                  </div>
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-[9px] uppercase font-bold text-app-subtext tracking-wider">浮动盈亏</span>
                    <span className={`font-mono font-bold text-[11px] ${posShares > 0 && marketPrice > 0 ? (floatingPnl >= 0 ? 'text-brand-red' : 'text-brand-green') : 'text-app-subtext'}`}>
                      {posShares > 0 && marketPrice > 0 ? `${floatingPnl >= 0 ? '+' : '-'}${Math.abs(floatingPnl).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
                    </span>
                  </div>
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-[9px] uppercase font-bold text-app-subtext tracking-wider">实现盈亏</span>
                    <span className={`font-mono font-bold text-[11px] ${realizedPnl !== 0 ? (realizedPnl >= 0 ? 'text-brand-red' : 'text-brand-green') : 'text-app-subtext'}`}>
                      {realizedPnl !== 0 ? `${realizedPnl >= 0 ? '+' : '-'}${Math.abs(realizedPnl).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
                    </span>
                  </div>
                </div>
              </div>

              {/* 交易方向：买入/卖出 */}
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-app-subtext tracking-wider ml-0.5">交易方向</label>
                <div className="grid grid-cols-2 rounded-lg overflow-hidden border border-app-border bg-app-input/50 h-8">
                  <button
                    type="button"
                    onClick={() => setAddTradeSide('buy')}
                    className={`text-sm font-bold transition-all ${addTradeSide === 'buy' ? 'bg-brand-red text-white shadow-sm' : 'text-app-subtext hover:text-app-text'}`}
                  >
                    买入
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddTradeSide('sell')}
                    className={`text-sm font-bold transition-all ${addTradeSide === 'sell' ? 'bg-brand-green text-white shadow-sm' : 'text-app-subtext hover:text-app-text'}`}
                  >
                    卖出
                  </button>
                </div>
              </div>

              {/* 挂单价 + 数量（复用黄金项目 InputGroup 步进输入，支持鼠标滚轮与触屏手势调节） */}
              <div className="grid grid-cols-2 gap-3">
                <InputGroup label="挂单价格" value={addTradePrice} onChange={setAddTradePrice} placeholder="0.00" step={0.01} min={0} touchMode onEnter={() => editingTradeId ? handleSaveEditTrade(s.id, editingTradeId, 'pending') : handleAddTrade(s.id, 'pending')} className="text-sm" />
                {/* 数量：卖出时以当前持仓为上限（静默截断） */}
                <InputGroup
                  label="数量(股)"
                  value={addTradeShares}
                  onChange={(v) => {
                    // 手输超上限时截断到可编辑上限（卖出方向，编辑模式视作未成交回退后）
                    if (editingCap !== undefined) {
                      const n = parseFloat(v);
                      setAddTradeShares(Number.isNaN(n) || n <= editingCap ? v : String(editingCap));
                    } else setAddTradeShares(v);
                  }}
                  placeholder="100" step={100} min={0}
                  max={editingCap}
                  touchMode
                  onEnter={() => editingTradeId ? handleSaveEditTrade(s.id, editingTradeId, 'pending') : handleAddTrade(s.id, 'pending')}
                  className="text-sm"
                />
              </div>

              {/* 挂单金额预览 */}
              <div className="flex items-center justify-between px-0.5 pt-0.5">
                <span className="text-[10px] font-medium text-app-subtext">挂单金额</span>
                <span className="font-mono font-bold text-[12px] text-app-text">
                  ¥{orderAmount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>

              {/* 备注 */}
              <div className="flex items-center gap-2">
                <label className="text-[10px] uppercase font-bold text-app-subtext tracking-wider ml-0.5 shrink-0">备注</label>
                <input
                  type="text"
                  value={addTradeNote}
                  onChange={(e) => setAddTradeNote(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { editingTradeId ? handleSaveEditTrade(s.id, editingTradeId, 'pending') : handleAddTrade(s.id, 'pending'); } }}
                  enterKeyHint="done"
                  placeholder="记录本次挂单的思路策略"
                  className={noteCls + ' flex-1'}
                />
              </div>

              {/* 下单：挂单 / 直接成交（编辑模式下变为 保存挂单 / 保存成交） */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => editingTradeId ? handleSaveEditTrade(s.id, editingTradeId, 'pending') : handleAddTrade(s.id, 'pending')}
                  disabled={!addTradePrice || !addTradeShares}
                  className="h-10 text-sm font-bold rounded-lg border transition-all disabled:opacity-40 bg-indigo-500/90 text-white border-indigo-500 hover:opacity-90 shadow-sm"
                >
                  {editingTradeId ? '保存挂单' : (addTradeSide === 'buy' ? '买入挂单' : '卖出挂单')}
                </button>
                <button
                  type="button"
                  onClick={() => editingTradeId ? handleSaveEditTrade(s.id, editingTradeId, 'filled') : handleAddTrade(s.id, 'filled')}
                  disabled={!addTradePrice || !addTradeShares}
                  className={`h-10 text-sm font-bold rounded-lg transition-all disabled:opacity-40 text-white shadow-sm ${addTradeSide === 'buy' ? 'bg-brand-red hover:opacity-90' : 'bg-brand-green hover:opacity-90'}`}
                >
                  {editingTradeId ? '保存成交' : (addTradeSide === 'buy' ? '买入成交' : '卖出成交')}
                </button>
              </div>

              {/* 历史记录 */}
              <div className="pt-1 border-t border-app-border">
                <div className="flex items-center justify-between px-0.5 pb-1.5">
                  <span className="text-[10px] uppercase font-bold text-app-subtext tracking-wider">历史记录</span>
                </div>
                <div className="space-y-1 h-[132px] overflow-y-auto pr-0.5 custom-scrollbar" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                  {sortedTrades.length === 0 ? (
                    // 空态占满固定高度，与有记录时高度一致，保证弹窗垂直居中不跳动
                    <div className="h-full flex items-center justify-center text-[10px] text-app-subtext border border-dashed border-app-border rounded-lg">暂无记录，添加第一条挂单吧</div>
                  ) : sortedTrades.map(t => (
                    <div key={t.id} className="bg-app-input rounded-lg px-2 py-1.5 space-y-1">
                      {/* 第一行：公式 + 已实现盈亏 + 状态徽标 */}
                      <div className="flex items-center gap-1.5 text-[11px] leading-tight">
                        <span className="font-mono font-bold text-app-text whitespace-nowrap">
                          {fmtP(t.price)}
                          <span className="font-normal text-app-subtext"> × </span>
                          {Number.isInteger(t.shares) ? t.shares : t.shares.toFixed(2)}
                          <span className="font-normal text-app-subtext"> = </span>
                          <span className={`font-bold ${t.side === 'buy' ? 'text-brand-red' : 'text-brand-green'}`}>
                            {(t.price * t.shares).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
                          </span>
                        </span>
                        {t.side === 'sell' && t.status === 'filled' && recalcPnL.map[t.id] !== undefined && (
                          <span className={`font-mono text-[10px] ${recalcPnL.map[t.id] >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>
                            {`${recalcPnL.map[t.id] >= 0 ? '+' : ''}${fmtP(recalcPnL.map[t.id])}`}
                          </span>
                        )}
                        {/* 状态徽标：普通记录点击切换成交/挂单；合并记录只读灰显 */}
                        {t.isMerged ? (
                          <span className="shrink-0 text-[8px] px-1 py-px rounded-full border font-bold ml-auto text-app-subtext/60 border-app-border/60 bg-app-text/5">
                            {t.side === 'buy' ? '买入汇总' : '卖出汇总'}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleToggleTrade(s.id, t.id)}
                            title={t.status === 'filled' ? '取消成交（恢复挂单）' : '标记为成交（联动持仓）'}
                            className={`shrink-0 text-[8px] px-1 py-px rounded-full border font-bold ml-auto cursor-pointer ${t.status === 'pending' ? 'text-orange-400 border-orange-400/40 bg-orange-400/10' : t.side === 'buy' ? 'text-brand-red border-brand-red/40 bg-brand-red/10' : 'text-brand-green border-brand-green/40 bg-brand-green/10'}`}
                          >
                            {TRADE_STATUS_LABEL[`${t.side}-${t.status}`]}
                          </button>
                        )}
                      </div>
                      {/* 第二行：时间 + 删除 + 备注 */}
                      <div className="flex items-center gap-2 text-[9px] text-app-subtext leading-none">
                        <span className="font-mono font-bold whitespace-nowrap self-center leading-none">{timeStr(t.createdAt)}</span>
                        {!t.isMerged && (
                        <div className="flex items-center -space-x-1 -ml-1">
                          <button
                            type="button"
                            onClick={() => handleRemoveTrade(s.id, t.id)}
                            className="shrink-0 px-1 rounded text-[9px] text-app-subtext/50 hover:text-brand-red hover:bg-app-text/5 transition-colors inline-flex items-center justify-center self-center leading-none"
                            title="撤单（删除该记录）"
                          >
                            撤单
                          </button>
                          {/* 编辑：把记录填回输入框进入编辑模式 */}
                          <button
                            type="button"
                            onClick={() => { setEditingTradeId(t.id); setAddTradeSide(t.side); setAddTradePrice(String(t.price)); setAddTradeShares(String(t.shares)); setAddTradeNote(t.note || ''); }}
                            className="shrink-0 px-1 rounded text-[9px] text-app-subtext/50 hover:text-app-text hover:bg-app-text/5 transition-colors inline-flex items-center justify-center self-center leading-none"
                            title="编辑该记录"
                          >
                            编辑
                          </button>
                        </div>
                        )}
                        {t.note && (
                          <span className="truncate min-w-0 ml-auto self-center leading-none" title={t.note}>{t.note}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 列表页行情状态浮窗（近10交易日破位分析） */}
      {mktInfoStock && (() => {
        const daily = stockBollMap.get(mktInfoStock.id)?.daily;
        const klines = daily?.klines;
        const events = klines && klines.length > 0 ? analyzeMarketConditions(klines, 10) : null;
        const allowVol = klines && klines.length > 0 ? isTodayVolumeEligible(klines) : false;
        const dailySignals = klines && klines.length > 0 ? analyzeDailySignals(klines, allowVol) : [];
        const patterns = klines && klines.length > 0 ? analyzeKlinePatterns(klines, v => formatPrice(v, mktInfoStock.name)) : null;
        const env = klines && klines.length > 0 ? analyzeEnvironment(klines, v => formatPrice(v, mktInfoStock.name), allowVol) : null;
        const fmtDay = (d: string) => {
          const p = d.split('-');
          return p.length === 3 ? `${parseInt(p[1], 10)}月${parseInt(p[2], 10)}日` : d;
        };
        const fmtShort = (d: string) => d.slice(5).replace('-', '/');
        const chipBase = 'inline-flex items-center justify-center rounded text-[9px] font-medium border px-1 py-px cursor-pointer transition-colors';
        const greenCls = 'bg-green-500/10 text-green-500 border-green-500/20';
        const greenSelCls = ' border-green-500/60';
        const statusChip = (ev: MarketEvent) => {
          if (ev.status === 'trueBreak') return { cls: greenCls, selCls: greenSelCls, label: '真破位' };
          if (ev.status === 'falseBreak') return { cls: 'bg-red-500/10 text-red-500 border-red-500/20', selCls: ' border-red-500/60', label: '假破位' };
          return { cls: 'bg-orange-500/10 text-orange-500 border-orange-500/20', selCls: ' border-orange-500/60', label: '修复观察' };
        };
        // 收盘价着色：对照前一交易日，当日收盘涨红、跌绿
        const kIdx = new Map<string, number>();
        if (klines) klines.forEach((k, i) => kIdx.set(k.date, i));
        const closeSpan = (date: string) => {
          const i = kIdx.get(date);
          if (i == null || !klines) return null;
          const c = klines[i].close;
          const p = klines[i - 1]?.close;
          const up = p != null && c > p;
          const dn = p != null && c < p;
          return <span className={`text-[9px] font-mono shrink-0 w-[30px] text-right ${up ? 'text-red-500' : dn ? 'text-green-500' : 'text-app-rowtext'}`}>{fp(c)}</span>;
        };
        // 默认选中：无指向时展示最新日期事件的“破位”标签
        const defaultSel = events && events.length > 0 ? { date: events[events.length - 1].date, kind: 'event' as const } : null;
        const selKey = mktSel ?? defaultSel;
        const isSel = (ev: MarketEvent, kind: 'event' | 'status' | 'repair') => !!selKey && selKey.kind !== 'pattern' && selKey.kind !== 'env' && selKey.date === ev.date && selKey.kind === kind;
        const isPatSel = (p: KlinePattern) => !!selKey && selKey.kind === 'pattern' && selKey.ptype === p.type;
        const isEnvSel = (t: EnvTag) => !!selKey && selKey.kind === 'env' && selKey.ekey === t.key;
        const envChipCls: Record<EnvTag['color'], { cls: string; sel: string }> = {
          red: { cls: 'bg-red-500/10 text-red-500 border-red-500/20', sel: ' border-red-500/60' },
          green: { cls: 'bg-green-500/10 text-green-500 border-green-500/20', sel: ' border-green-500/60' },
          orange: { cls: 'bg-orange-500/10 text-orange-500 border-orange-500/20', sel: ' border-orange-500/60' },
          indigo: { cls: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30', sel: ' border-indigo-400/60' },
          slate: { cls: 'bg-slate-500/10 text-slate-400 border-slate-500/30', sel: ' border-slate-400/60' },
        };
        const envDate = klines && klines.length > 0 ? klines[klines.length - 1].date : '';
        const patChipCls: Record<KlinePattern['color'], { cls: string; sel: string }> = {
          red: { cls: 'bg-red-500/10 text-red-500 border-red-500/20', sel: ' border-red-500/60' },
          green: { cls: 'bg-green-500/10 text-green-500 border-green-500/20', sel: ' border-green-500/60' },
          slate: { cls: 'bg-slate-500/10 text-slate-400 border-slate-500/30', sel: ' border-slate-400/60' },
        };
        const fp = (v: number) => formatPrice(v, mktInfoStock.name);
        const selEv = selKey && selKey.kind !== 'pattern' && selKey.kind !== 'env' && events ? events.find(e => e.date === selKey.date) : null;
        // 判定依据文案
        const explainLines: string[] = [];
        if (selKey && selKey.kind === 'pattern') {
          const p = patterns?.find(x => x.type === selKey.ptype);
          if (p) explainLines.push(...p.detail);
        } else if (selKey && selKey.kind === 'env') {
          const t = env?.tags.find(x => x.key === selKey.ekey);
          if (t) explainLines.push(...t.detail);
        } else if (selKey && selKey.kind === 'daily') {
          // 每日量价/MACD 显著信号：判定依据来自信号触发条件（区别于环境量价的"当前状态"描述）
          const sig = dailySignals.find(s => s.date === selKey.date && s.kind === selKey.dkey);
          if (sig) explainLines.push(`${fmtDay(sig.date)} ${SIG_LABEL[sig.kind]}`, ...sig.detail);
        } else if (selEv) {
          const maStr = selEv.brokenList.map(b => `MA${b.period} ${fp(b.value)}`).join(' · ');
          if (selKey!.kind === 'event') {
            explainLines.push(`${fmtDay(selEv.date)} 收盘 ${fp(selEv.close)}`, `当日下穿 ${selEv.brokenCount} 条均线：${maStr}`);
          } else if (selEv.status === 'trueBreak') {
            explainLines.push(
              `${fmtDay(selEv.date)} 收盘 ${fp(selEv.close)}，下穿 ${selEv.brokenCount} 条均线`,
              `参照均线 MA${selEv.ref.period}（破位日 ${fp(selEv.ref.value)}）`,
              ...selEv.window.map((w, i) => `${i + 1}天 ${fmtShort(w.date)}：收 ${fp(w.close)} < 均线 ${fp(w.refMa)}`),
              `3 天观测收盘均未回到均线上方 → 真破位`,
            );
          } else if (selEv.status === 'falseBreak') {
            const r = selEv.returnDay!;
            explainLines.push(
              `${fmtDay(selEv.date)} 收盘 ${fp(selEv.close)}，下穿 ${selEv.brokenCount} 条均线`,
              `参照均线 MA${selEv.ref.period}（破位日 ${fp(selEv.ref.value)}）`,
              `${fmtShort(r.date)} 收盘 ${fp(r.close)} 回到均线上方（MA${selEv.ref.period} ${fp(r.refMa)}）→ 假破位`,
            );
          } else {
            const last = selEv.window[selEv.window.length - 1];
            explainLines.push(
              `${fmtDay(selEv.date)} 收盘 ${fp(selEv.close)}，下穿 ${selEv.brokenCount} 条均线`,
              `参照均线 MA${selEv.ref.period}（破位日 ${fp(selEv.ref.value)}）`,
              `已观测 ${selEv.window.length}/3 天，最新 ${fmtShort(last.date)} 收盘 ${fp(last.close)} 仍低于均线 ${fp(last.refMa)}`,
              `观测未满 3 天 → 修复观察`,
            );
          }
        }
        return (
          <div
            ref={mktInfoRef}
            className="fixed z-[60] bg-app-card border border-slate-500/40 rounded-lg shadow-[0_8px_30px_rgba(0,0,0,0.55)] px-2.5 py-2 max-h-[80vh] overflow-y-auto custom-scrollbar"
            style={{ top: mktInfoPos.top, left: mktInfoPos.left, width: 260, scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            onClick={() => setMktSelPinned(false)}
          >
            <div className="text-[11px] font-bold text-app-subtext mb-1 text-center">{mktInfoStock.name} <span className="font-mono text-[9px] font-normal text-app-rowtext">{getDisplayCode(mktInfoStock.code)}</span></div>
            {env && env.tags.length > 0 && (
              <div className="border-t border-app-border pt-1.5 mb-1.5">
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-[9px] text-app-subtext shrink-0 mr-0.5">环境</span>
                  {env.tags.map(t => (
                    <span
                      key={t.key}
                      className={`${chipBase} ${envChipCls[t.color].cls}${isEnvSel(t) ? envChipCls[t.color].sel : ''}`}
                      onMouseEnter={() => handleMktTagEnter({ date: envDate, kind: 'env', ekey: t.key })}
                      onClick={(e) => { e.stopPropagation(); handleMktTagClick({ date: envDate, kind: 'env', ekey: t.key }); }}
                    >{t.dim === 'cycle' ? `${t.label} ${(t.score >= 0 ? '+' : '') + t.score.toFixed(2)}` : t.label}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="text-[9px] text-app-subtext border-t border-app-border pt-1 mb-1.5">近10交易日行情</div>
            {events === null ? (
              <div className="text-[10px] text-app-rowtext py-1">暂无K线数据</div>
            ) : events.length === 0 && dailySignals.length === 0 ? (
              <div className="text-[10px] text-app-rowtext py-1">近10日无异常</div>
            ) : (() => {
              // 破位事件 + 每日信号（MACD/量价）按日期聚合：一天一行，行内多个标签横向平铺、放不下自动换行，按日期正序（最新在下）
              type Entry = { key: string; node: React.ReactNode };
              const byDate = new Map<string, Entry[]>();
              const addChip = (date: string, node: React.ReactNode) => {
                const arr = byDate.get(date) ?? [];
                arr.push({ key: `${date}-${arr.length}`, node });
                byDate.set(date, arr);
              };
              const repairChip = (ev: MarketEvent) => (
                <span
                  className={`${chipBase} bg-orange-500/10 text-orange-500 border-orange-500/20${isSel(ev, 'repair') ? ' border-orange-500/60' : ''}`}
                  onMouseEnter={() => handleMktTagEnter({ date: ev.date, kind: 'repair' })}
                  onClick={(e) => { e.stopPropagation(); handleMktTagClick({ date: ev.date, kind: 'repair' }); }}
                >修复观察 x{ev.brokenCount}</span>
              );
              // 每日信号徽标（color+缩写，区别于环境量价的"当前状态"chip）
              const sigChipCls: Record<DailySignal['kind'], { cls: string; sel: string }> = {
                'macd-gold': { cls: 'bg-red-500/10 text-red-500 border-red-500/20', sel: ' border-red-500/60' },
                'macd-dead': { cls: 'bg-green-500/10 text-green-500 border-green-500/20', sel: ' border-green-500/60' },
                'vol-up': { cls: 'bg-red-500/10 text-red-500 border-red-500/20', sel: ' border-red-500/60' },
                'vol-down': { cls: 'bg-green-500/10 text-green-500 border-green-500/20', sel: ' border-green-500/60' },
                'vol-shrink': { cls: 'bg-orange-500/10 text-orange-500 border-orange-500/20', sel: ' border-orange-500/60' },
              };
              const sigLabel = SIG_LABEL;
              const isSelSig = (sig: DailySignal) => !!selKey && selKey.kind === 'daily' && selKey.date === sig.date && selKey.dkey === sig.kind;
              const sigChip = (sig: DailySignal) => (
                <span
                  className={`${chipBase} ${sigChipCls[sig.kind].cls}${isSelSig(sig) ? sigChipCls[sig.kind].sel : ''}`}
                  onMouseEnter={() => handleMktTagEnter({ date: sig.date, kind: 'daily', dkey: sig.kind })}
                  onClick={(e) => { e.stopPropagation(); handleMktTagClick({ date: sig.date, kind: 'daily', dkey: sig.kind }); }}
                >{sigLabel[sig.kind]}</span>
              );
              // 破位事件
              for (const ev of events) {
                addChip(ev.date, (
                  <span
                    className={`${chipBase} ${greenCls}${isSel(ev, 'event') ? greenSelCls : ''}`}
                    onMouseEnter={() => handleMktTagEnter({ date: ev.date, kind: 'event' })}
                    onClick={(e) => { e.stopPropagation(); handleMktTagClick({ date: ev.date, kind: 'event' }); }}
                  >破位 x{ev.brokenCount}</span>
                ));
                if (ev.window.length === 1) {
                  addChip(ev.date, repairChip(ev));
                } else {
                  // 中间观测日：修复观察（与破位 xN 同步，展示被观察的破位条数）
                  for (let i = 1; i < ev.window.length - 1; i++) addChip(ev.window[i].date, repairChip(ev));
                  // 观测末尾：定论（真/假）或当前状态（修复观察带进度）
                  const last = ev.window[ev.window.length - 1];
                  const st = statusChip(ev);
                  addChip(last.date, ev.status === 'confirming'
                    ? repairChip(ev)
                    : (
                      <span
                        className={`${chipBase} ${st.cls}${isSel(ev, 'status') ? st.selCls : ''}`}
                        onMouseEnter={() => handleMktTagEnter({ date: ev.date, kind: 'status' })}
                        onClick={(e) => { e.stopPropagation(); handleMktTagClick({ date: ev.date, kind: 'status' }); }}
                      >{st.label} x{ev.brokenCount}</span>
                    ));
                }
              }
              // 每日信号（MACD/量价）
              for (const sig of dailySignals) addChip(sig.date, sigChip(sig));
              // 最新K线形态（十字星/金针等）并进最新日期那一行，不单独占一行
              if (patterns && patterns.length > 0) {
                for (const p of patterns) addChip(p.date, (
                  <span
                    className={`${chipBase} ${patChipCls[p.color].cls}${isPatSel(p) ? patChipCls[p.color].sel : ''}`}
                    onMouseEnter={() => handleMktTagEnter({ date: p.date, kind: 'pattern', ptype: p.type })}
                    onClick={(e) => { e.stopPropagation(); handleMktTagClick({ date: p.date, kind: 'pattern', ptype: p.type }); }}
                  >{p.label}</span>
                ));
              }
              // 最新收盘日：价格列显示缓存现价（红涨绿跌），其余日期显示当日收盘
              const latestDate = klines && klines.length ? klines[klines.length - 1].date : '';
              const dates = [...byDate.keys()].sort();
              return dates.map(date => (
                <div key={date} className="flex items-start gap-1.5 mb-1 last:mb-0">
                  <span className="text-[9px] text-app-rowtext shrink-0 w-[36px] whitespace-nowrap mt-px">{fmtDay(date)}</span>
                  {date === latestDate && mktInfoStock.price > 0 ? (
                    <span className={`text-[9px] font-mono shrink-0 w-[30px] text-right ${mktInfoStock.changePercent >= 0 ? 'text-red-500' : 'text-green-500'}`}>{fp(mktInfoStock.price)}</span>
                  ) : closeSpan(date)}
                  <div className="flex flex-wrap gap-1 min-w-0">
                    {byDate.get(date)!.map(e => <React.Fragment key={e.key}>{e.node}</React.Fragment>)}
                  </div>
                </div>
              ));
            })()}
            <div className="border-t border-app-border mt-1 pt-1.5">
              <div className="text-[9px] text-app-subtext mb-1">判定依据</div>
              {explainLines.length > 0 ? (
                <div className="text-[9px] leading-relaxed text-app-rowtext break-all">{explainLines.map((l, i) => <div key={i}>{l}</div>)}</div>
              ) : (
                <div className="text-[9px] text-app-rowtext/70">悬停或点击上方标签查看判定依据</div>
              )}
            </div>
            <div className="border-t border-app-border mt-1 pt-1.5">
              <div className="text-[9px] text-app-subtext mb-1">参考价值</div>
              {selKey && selKey.kind === 'env' ? (() => {
                const t = env?.tags.find(x => x.key === selKey.ekey);
                const ref = t ? ENV_REFERENCE[t.label] : null;
                return ref ? (
                  <div className="text-[9px] leading-relaxed text-app-rowtext break-all">{ref}</div>
                ) : (
                  <div className="text-[9px] text-app-rowtext">-</div>
                );
              })() : selKey && selKey.kind === 'daily' ? (
                <div className="text-[9px] leading-relaxed text-app-rowtext break-all">{DAILY_REFERENCE[selKey.dkey] ?? '-'}</div>
              ) : (
                <div className="text-[9px] text-app-rowtext">-</div>
              )}
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
