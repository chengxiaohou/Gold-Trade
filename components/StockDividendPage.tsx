import React, { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X, RefreshCw, Edit2, Check, TrendingUp, TrendingDown, Settings, CloudDownload, CloudUpload, Moon, Sun, Trash2, GripVertical, GripHorizontal, RotateCcw, Eye, EyeOff, Download, Upload, BarChart3, ChevronDown, UnfoldVertical, FoldVertical, Copy, ArrowLeftRight, Link, SquarePen } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, ReferenceDot } from 'recharts';
import { StockEntry, StockDividendRates, DividendRateColorRange, StockSettings, StockTrade, ApiSource, TagParams, DEFAULT_TAG_PARAMS, UserTagRule } from '../types';
import type { BollData, BollPeriod, BollAdjust, BollKline } from '../services/bollService';
import { isStockPriceFresh, isTradingHours, getDynamicCacheTTL, formatDuration, formatTimePart, formatCacheTime, setBollFullFetchTime, getBollFullFetchTime } from '../services/cacheService';
import { priceBureau } from '../services/priceBureau';
import { requestLogService, RequestLogEntry, RequestLogStats, type LogBatchContext } from '../services/requestLogService';
import type { TencentQuote } from '../services/tencentQuote';
import { fetchYearlyDividends, DividendRecord } from '../services/dividendService';
import { getNickname } from '../services/nicknameService';
import { safeSetItem } from '../services/storageSafe';
import type { StockLedgerMap } from '../services/stockLedgerStore';
import { calcRealizedPnlForRange, calcPositionFromTrades } from '../services/realizedPnl';
import { analyzeKlinePatterns, analyzeKlinePatternsAt, analyzeDailySignals, analyzeFengSignals, isTodayVolumeEligible, analyzeMarketConditions, analyzeEnvironment, classifyPriceState, classifyPriceStateAt, volBucket, stabilizeComboReference, buildLatestShrinkTags, selectEnvDisplayTags, buildBreakExplainLines, latestBarFingerprint, analyzeKlineCombo, classifyVolumeAt, dividendRateForDay, PATTERN_CHIP_CLS as patChipCls, VOLUME5_CHIP_CLS as VOLDAY_CLS, PRICESTATE_CHIP_CLS as PRICESTATE_CLS, CHIP_CLS_GREEN as greenCls, CHIP_SEL_GREEN as greenSelCls, type KlineVolume5 } from '../services/tagAnalyzers';
import type { KlinePattern, DailySignal, FengDaySignal, MarketEvent, EnvTag, EnvResult, PriceStateTag, PatternCombo } from '../services/tagAnalyzers';
import { toggleTradeStatus, removeTrade } from '../services/stockTradeOps';
import { InputGroup } from './InputGroup';
import { useStepWheel } from '../hooks/useStepWheel';
import { BacktestModal } from './BacktestModal';
import PriceInfoPopover, { PriceIndicatorSection } from './PriceInfoPopover';
import SignalTagsFooter from './SignalTagsFooter';
import { getDayTagSet, type DayTag } from '../services/signalTagDetail';
import { calcIndicators, formatPrice, formatVolume, type IndicatorResult } from '../services/indicators';

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

// 盈利统计：快捷周期选择项
const PROFIT_RANGE_SEGS = [
  { key: 'w1', label: '近一周' },
  { key: 'w2', label: '两周' },
  { key: 'm1', label: '近一月' },
  { key: 'm3', label: '近三月' },
  { key: 'm6', label: '近半年' },
  { key: 'y1', label: '近一年' },
  { key: 'custom', label: '自定义' },
] as const;
type ProfitRangeMode = typeof PROFIT_RANGE_SEGS[number]['key'];

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
  autoRefreshInterval?: number; // 股价自动刷新间隔（秒），0=关闭；设备本地设置
  actionButtons?: React.ReactNode;
  appVersion?: string;
  onTogglePage?: () => void;
  apiSource?: ApiSource;
  tagParams?: TagParams;
  customTags?: UserTagRule[]; // 用户自定义动态信号标签（随 stockSettings 云端同步）
  onResetStocks?: () => void;
  resetSignal?: number;
  dividendYearLeft?: number;
  dividendYearRight?: number;
  sortMode?: 'default' | 'dividendRate' | 'tag' | 'daily' | 'weekly' | 'monthly' | 'changePercent' | 'costPct' | 'tradePct';
  onSortModeChange?: (mode: 'default' | 'dividendRate' | 'tag' | 'daily' | 'weekly' | 'monthly' | 'changePercent' | 'costPct' | 'tradePct') => void;
  memo?: string;
  memoUpdatedAt?: number;
  memoBaseline?: string;
  onMemoChange?: (memo: string) => void;
  onMemoUpload?: () => Promise<boolean>;
  buyOrderPlaceholder?: string; // 买入挂单备注占位文字（随云端同步）
  sellOrderPlaceholder?: string; // 卖出挂单备注占位文字（随云端同步）
  showRequestStats?: boolean;
  dividendTotalCapital?: number;          // 分红页账户总资金（随云端同步）
  onDividendTotalCapitalChange?: (v: number) => void;
  ledgerMap?: StockLedgerMap;
  onLedgerMapChange?: (updater: (prev: StockLedgerMap) => StockLedgerMap) => void;
  onExportFullBackup?: () => void;           // 全量备份导出（stocks + ledger + stockSettings）
  onImportFullBackup?: (file: File) => void; // 全量备份导入恢复
  onBacktestPresetsDirty?: () => void;       // 策略组有增删改时调用，用于触发云端"有改动需上传"
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

// ---- 交易记录通用常量与共享控件（交易窗口与交易列简易浮窗复用） ----
const TRADE_STATUS_LABEL: Record<string, string> = {
  'buy-pending': '挂买', 'sell-pending': '挂卖',
  'buy-filled': '买入', 'sell-filled': '卖出',
};
const tradeStatusColor = (t: StockTrade) => t.status === 'pending' ? 'text-orange-400' : (t.side === 'buy' ? 'text-brand-red' : 'text-brand-green');

// 把同花顺公告链接转换成 amihexin 跳转链接：
// 取 #seq= 公告编号 → 路径替换为 /tapp/app/noticebasic/index.html → 拼 ?seq= → URL 编码后加 amihexin://url= 前缀
const buildAmihexinUrl = (raw: string): string => {
  const trimmed = raw.trim();
  // 已是 amihexin:// 协议的直接透传，不再二次拼接（如用户手动输入的 amihexin://123）
  if (trimmed.startsWith('amihexin://')) return trimmed;
  const seqMatch = trimmed.match(/#seq=(\d+)/);
  const seq = seqMatch ? seqMatch[1] : '';
  let newUrl = trimmed.replace('/tapp/notice.html', '/tapp/app/noticebasic/index.html');
  // 去掉 # 片段及原有追踪参数（backwash_xxx 等分享追踪参数直接丢弃），只保留 ?seq= 公告编号
  const base = newUrl.split('#')[0].split('?')[0];
  const finalUrl = seq ? `${base}?seq=${seq}` : base;
  return `amihexin://url=${encodeURIComponent(finalUrl)}`;
};

// 触发自定义协议(amihexin://)跳转：某些 WebView 会静默拦截 location.href，改用隐藏 <a> 点击更可靠
const openScheme = (url: string): void => {
  const a = document.createElement('a');
  a.href = url;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

// ---- 挂单有效期判断：写死 5 个交易日（不含周末） ----
const PENDING_TTL_DAYS = 5;
const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
// 计算从创建日到今天经过了第几个交易日（首日计 1）。非交易时段/周末被视为"停牌日"，不计入。
function tradingDayIndex(createTime: number, now: number): number {
  const start = new Date(createTime); start.setHours(0, 0, 0, 0);
  const end = new Date(now); end.setHours(0, 0, 0, 0);
  if (end.getTime() <= start.getTime()) return 1;
  let count = 1;
  const cursor = new Date(start);
  cursor.setDate(cursor.getDate() + 1);
  while (cursor.getTime() <= end.getTime()) {
    if (!isWeekend(cursor)) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}
// 挂单是否处于最后一个交易日（返回 '!'）、已过期（返回 '?'）或正常（返回 ''）
function pendingExpirySuffix(t: StockTrade, now: number): string {
  if (t.status !== 'pending') return '';
  const idx = tradingDayIndex(t.createdAt, now);
  if (idx >= PENDING_TTL_DAYS + 1) return '?'; // 已过期（第 6 个交易日及以后）
  if (idx === PENDING_TTL_DAYS) return '!';     // 最后一个有效交易日
  return '';
}
// 生成挂单/成交的状态文字（含挂单过期标记）
const tradeStatusLabel = (t: StockTrade): string =>
  `${TRADE_STATUS_LABEL[`${t.side}-${t.status}`]}${pendingExpirySuffix(t, Date.now())}`;
// 挂单剩余有效交易天数：创建/编辑当天为 PENDING_TTL_DAYS，每过一个交易日减 1，过期后为 0
const pendingRemainingDays = (t: StockTrade, now: number): number =>
  t.status === 'pending' ? Math.max(0, PENDING_TTL_DAYS - (tradingDayIndex(t.createdAt, now) - 1)) : 0;

// 按成交顺序用移动加权成本重算每笔卖出的已实现盈亏（不依赖存储字段）
const calcRealizedPnlMap = (trades: StockTrade[]) => {
  const filled = trades.filter(t => t.status === 'filled' && !t.isDeleted).sort((a, b) => a.createdAt - b.createdAt);
  let rs = 0, rc = 0, total = 0;
  const map: Record<string, number> = {};
  for (const t of filled) {
    const amt = (t.amount ?? ((t.price ?? 0) * (t.shares ?? 0))) || 0;
    if (t.side === 'buy') {
      const prevRs = rs;
      rs += t.shares ?? 0;
      rc = rs > 0 ? (rc * prevRs + amt) / rs : 0;
    } else {
      const shares = t.shares ?? 0;
      map[t.id] = rs > 0 ? amt - rc * shares : 0;
      total += map[t.id];
      rs = Math.max(0, rs - shares);
      if (rs === 0) rc = 0;
    }
  }
  return { map, total };
};

// 交易历史记录条目（两行布局：公式+盈亏+状态徽标 / 时间+撤单+编辑+备注），撤单带确认
interface TradeRecordRowProps {
  t: StockTrade; stockName: string; currentPrice?: number; pnlMap: Record<string, number>;
  onToggle: (t: StockTrade) => void; onEdit: (t: StockTrade) => void; onDelete: (t: StockTrade) => void;
}
const TradeRecordRow: React.FC<TradeRecordRowProps> = ({ t, stockName, currentPrice = 0, pnlMap, onToggle, onEdit, onDelete }) => {
  const [confirming, setConfirming] = useState(false);
  const fmtP = (v: number) => formatPrice(v, stockName);
  const shares = t.shares ?? 0;
  const price = t.price ?? 0;
  // 对照列表页「交易」列的百分比：成交价与现价的差值百分比，着色逻辑一致
  const diffNum = currentPrice > 0 && price > 0 ? ((currentPrice - price) / price) * 100 : null;
  const isSellFilled = t.side === 'sell' && t.status === 'filled';
  const isBuyFilled = t.side === 'buy' && t.status === 'filled';
  const isPending = t.status === 'pending';
  let likelyFill = false;
  if (isPending && currentPrice > 0 && price > 0) {
    likelyFill = t.side === 'buy' ? currentPrice <= price : currentPrice >= price;
  }
  const pctColor = diffNum != null && isSellFilled && diffNum < 0 ? 'text-brand-green'
    : diffNum != null && isBuyFilled && diffNum > 0 ? 'text-brand-red'
    : diffNum != null && isPending && likelyFill ? 'text-orange-400'
    : 'text-app-rowtext';
  const timeStr = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  return (
    <div className="bg-app-input rounded-lg px-2 py-1.5 space-y-1">
      {/* 第一行：公式 + 已实现盈亏 + 状态徽标 */}
      <div className="flex items-center gap-1.5 text-[11px] leading-tight">
        <span className="font-mono font-bold text-app-text whitespace-nowrap">
          {fmtP(price)}
          <span className="font-normal text-app-subtext"> × </span>
          {Number.isInteger(shares) ? shares : shares.toFixed(2)}
          <span className="font-normal text-app-subtext"> = </span>
          <span className={`font-bold ${t.side === 'buy' ? 'text-brand-red' : 'text-brand-green'}`}>
            {(price * shares).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
          </span>
        </span>
        {t.side === 'sell' && t.status === 'filled' && pnlMap[t.id] !== undefined && (
          <span className={`font-mono text-[10px] ${pnlMap[t.id] >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>
            {`${pnlMap[t.id] >= 0 ? '+' : ''}${fmtP(pnlMap[t.id])}`}
          </span>
        )}
        {t.isMerged ? (
          <span className="shrink-0 text-[8px] px-1 py-px rounded-full border font-bold ml-auto text-app-subtext/60 border-app-border/60 bg-app-text/5">
            {t.side === 'buy' ? '买入汇总' : '卖出汇总'}
          </span>
        ) : (
          <span className="ml-auto shrink-0 flex items-center gap-1.5">
            {t.status === 'pending' && (
              <span className="font-mono text-[8px] text-orange-400 whitespace-nowrap">
                {pendingRemainingDays(t, Date.now())}天
              </span>
            )}
            {diffNum != null && (
              <span className={`font-mono text-[8px] font-semibold whitespace-nowrap ${pctColor}`}>
                {`${diffNum >= 0 ? '+' : ''}${diffNum.toFixed(2)}%`}
              </span>
            )}
            <button
              type="button"
              onClick={() => onToggle(t)}
              title={t.status === 'filled' ? '取消成交（恢复挂单）' : '标记为成交（联动持仓）'}
              className={`shrink-0 text-[8px] px-1 py-px rounded-full border font-bold cursor-pointer ${t.status === 'pending' ? 'text-orange-400 border-orange-400/40 bg-orange-400/10' : t.side === 'buy' ? 'text-brand-red border-brand-red/40 bg-brand-red/10' : 'text-brand-green border-brand-green/40 bg-brand-green/10'}`}
            >
              {tradeStatusLabel(t)}
            </button>
          </span>
        )}
      </div>
      {/* 第二行：时间 + 撤单(确认) + 编辑 + 备注 */}
      <div className="flex items-center gap-2 text-[9px] text-app-subtext leading-none">
        <span className="font-mono font-bold whitespace-nowrap self-center leading-none">{timeStr(t.createdAt)}</span>
        {!t.isMerged && (
          confirming ? (
            <span className="flex items-center -space-x-1 -ml-1">
              <button type="button" onClick={() => { onDelete(t); setConfirming(false); }} className="shrink-0 px-1 rounded text-[9px] font-bold text-brand-red hover:bg-app-text/5 transition-colors self-center leading-none">确认</button>
              <button type="button" onClick={() => setConfirming(false)} className="shrink-0 px-1 rounded text-[9px] text-app-subtext/70 hover:bg-app-text/5 transition-colors self-center leading-none">取消</button>
            </span>
          ) : (
            <div className="flex items-center -space-x-1 -ml-1">
              <button type="button" onClick={() => setConfirming(true)} className="shrink-0 px-1 rounded text-[9px] text-app-subtext/50 hover:text-brand-red hover:bg-app-text/5 transition-colors inline-flex items-center justify-center self-center leading-none" title="撤单（删除该记录）">撤单</button>
              <button type="button" onClick={() => onEdit(t)} className="shrink-0 px-1 rounded text-[9px] text-app-subtext/50 hover:text-app-text hover:bg-app-text/5 transition-colors inline-flex items-center justify-center self-center leading-none" title="编辑该记录">编辑</button>
            </div>
          )
        )}
        {t.note && <span className="truncate min-w-0 ml-auto pl-2 self-center leading-none" title={t.note}>{t.note}</span>} {/* pl-2 保证备注与编辑按钮的间距，长备注截断时也不会贴在一起 */}
      </div>
    </div>
  );
}

// ---- 技术指标计算：由 services/indicators 统一实现（列表页与回测图共用） ----

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

const formatPercent = (percent: number | null | undefined): string => {
  // 未拉取到行情（changePercent 可能为 undefined）时兜底，避免 undefined.toFixed() 崩溃
  if (percent == null || !Number.isFinite(percent)) return '0.00%';
  return percent.toFixed(2) + '%';
};

// 格式化备忘录最后编辑时间（编辑于：YYYY年M月D日 HH:MM）
const formatMemoTime = (ts?: number): string => {
  if (!ts) return '编辑于 --';
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `编辑于 ${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

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

// 环境 chip 配色 + 底座（标签弹窗"环境"区与价格弹窗底栏共用，单一配色来源，勿在别处另写一套）
const ENV_CHIP_CLS: Record<EnvTag['color'], { cls: string; sel: string }> = {
  red: { cls: 'bg-red-500/10 text-red-500 border-red-500/20', sel: ' border-red-500/60' },
  green: { cls: 'bg-green-500/10 text-green-500 border-green-500/20', sel: ' border-green-500/60' },
  orange: { cls: 'bg-orange-500/10 text-orange-500 border-orange-500/20', sel: ' border-orange-500/60' },
  indigo: { cls: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30', sel: ' border-indigo-400/60' },
  slate: { cls: 'bg-slate-500/10 text-slate-400 border-slate-500/30', sel: ' border-slate-400/60' },
};
const ENV_CHIP_BASE = 'inline-flex items-center justify-center rounded text-[9px] font-medium border px-1 py-px cursor-pointer transition-colors';

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


// 股息率曲线周期调节的步长：图表区域滚轮与下方的输入框共用，保证手感一致
const DIVIDEND_CHART_RANGE_STEP = 25;

// 股息率曲线共享组件：详情弹窗与列表页“股息率”浮窗共用一套渲染逻辑，
// 之后任一处的股息率曲线改动都会同时反映到另一处。
const DividendRateCurve = React.memo(function DividendRateCurve({ klines, stock, fallbackDividend, title, period, rangeValue, offsetValue, onRangeChange, onOffsetChange }: {
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

  // 图表区域滚轮/触控板调节周期：与输入框等其它控件完全共用同一套 useStepWheel 机制
  const chartWheelRef = useRef<HTMLDivElement>(null);
  const rangeRef = useRef<number>(range);
  useEffect(() => { rangeRef.current = range; }, [range]);
  useStepWheel({
    ref: chartWheelRef,
    valueRef: rangeRef,
    step: DIVIDEND_CHART_RANGE_STEP,
    min: 5,
    max: 500,
    onChange: (next) => { updateRange(next); },
    // Mac 触控板双指捏合：按比例缩放周期（张开=放大=周期变小），钳制在有效区间，与双指滑动步进互斥
    pinch: true,
    onPinch: (factor) => { updateRange(Math.max(5, Math.min(500, Math.round(rangeRef.current * factor)))); },
  });

  // —— 浮窗跟随移植：固定定位 + 直接改 transform 定位（不触发每帧重渲染），复用回测的边界翻转 ——
  const [floatVisible, setFloatVisible] = useState(false);
  const floatingElRef = useRef<HTMLDivElement>(null);
  // 内容区用 ref 直接写 textContent，避免 setState 触发整组件重渲染、拖慢跟随
  const floatDateRef = useRef<HTMLSpanElement>(null);
  const floatPriceRef = useRef<HTMLSpanElement>(null);
  const floatDividendRef = useRef<HTMLSpanElement>(null);
  const floatRateRef = useRef<HTMLSpanElement>(null);
  const FLOAT_W = 105;
  const FLOAT_H = 92;
  // 双指捏合缩放的起点状态：记录起始两指间距与起始周期，移动时按间距比例映射新周期
  const pinchRef = useRef<{ startDist: number; startRange: number } | null>(null);

  // 图表出现即全局监听方向键调节周期/平移（通过 ref 持最新闭包避免 stale 值）。
  // 注册 effect 放在早退之前，符合 hooks 规则；目标在输入框/编辑区时跳过以免干扰输入。
  const chartKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const fn = (e: KeyboardEvent) => chartKeyRef.current(e);
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

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

  // 可视窗口内的四个极值点：最高/最低价（价格线）、最高/最低股息率（股息率线），用于在曲线上打点标注
  const maxPricePt = chartData.length > 0 ? chartData.reduce((a, b) => a.price > b.price ? a : b) : null;
  const minPricePt = chartData.length > 0 ? chartData.reduce((a, b) => a.price < b.price ? a : b) : null;
  const maxRatePt = chartData.length > 0 ? chartData.reduce((a, b) => a.rate > b.rate ? a : b) : null;
  const minRatePt = chartData.length > 0 ? chartData.reduce((a, b) => a.rate < b.rate ? a : b) : null;

  // 浮窗跟随：定位窗口（transform），并把指针 X 映射到最近 K 线点、直接改 textContent 填充真实数据。
  // 全程不 setState、不触发 React 重渲染，保证高频跟随。
  // clientX/clientY 由鼠标或触摸统一传入：鼠标走 onMouseMove，触屏走 onTouchStart/onTouchMove（手指移动即实时跟随，不等松开）。
  const updateFloat = (clientX: number, clientY: number) => {
    const el = floatingElRef.current;
    if (!el) return;
    let x = clientX + 12;
    let y = clientY + 12;
    if (x + FLOAT_W > window.innerWidth - 8) x = Math.max(8, clientX - FLOAT_W - 12);
    if (y + FLOAT_H > window.innerHeight - 8) y = Math.max(8, clientY - FLOAT_H - 12);
    el.style.transform = `translate(${x}px, ${y}px)`;

    const container = chartWheelRef.current;
    if (!container || chartData.length === 0) return;
    const rect = container.getBoundingClientRect();
    const plotW = rect.width - 2 - 5; // 与 LineChart margin 左2 右5 保持一致
    const relX = clientX - rect.left - 2;
    const idx = Math.max(0, Math.min(chartData.length - 1, Math.round((relX / plotW) * (chartData.length - 1))));
    const d = chartData[idx];
    if (floatDateRef.current) floatDateRef.current.textContent = d.date;
    if (floatPriceRef.current) floatPriceRef.current.textContent = `¥${d.price.toFixed(2)}`;
    if (floatDividendRef.current) floatDividendRef.current.textContent = `¥${d.dividend.toFixed(3)}`;
    if (floatRateRef.current) floatRateRef.current.textContent = `${d.rate.toFixed(2)}%`;
  };
  const handleFloatMove = (e: React.MouseEvent<HTMLDivElement>) => updateFloat(e.clientX, e.clientY);
  // 触屏统一入口：单指→浮窗实时跟随；双指→捏合缩放调节周期（间距比例映射到周期，钳制在有效区间）
  const handleChartTouch = (e: React.TouchEvent<HTMLDivElement>) => {
    const ts = e.touches;
    if (ts.length >= 2) {
      // 双指捏合：起始两指间距为基准，移动时按当前间距/起始间距的比例反向映射周期（张开=放大=周期变小）
      e.preventDefault();
      const dist = Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
      if (!pinchRef.current) {
        pinchRef.current = { startDist: dist || 1, startRange: rangeRef.current };
      } else {
        const { startDist, startRange } = pinchRef.current;
        const ratio = startDist > 0 ? dist / startDist : 1;
        const lo = options.length > 0 ? options[0] : 5;
        const hi = options.length > 0 ? options[options.length - 1] : maxRange;
        const next = Math.max(lo, Math.min(hi, Math.round(startRange / ratio)));
        if (next !== rangeRef.current) updateRange(next);
      }
      return;
    }
    // 单指：恢复浮窗跟随，手指移动实时跟随（读取 touches[0]），松开后浮窗停留在最后位置，不主动隐藏
    pinchRef.current = null;
    const t = ts[0];
    if (!t) return;
    setFloatVisible(true);
    updateFloat(t.clientX, t.clientY);
  };
  const handleFloatLeave = () => setFloatVisible(false);

  // 方向键逻辑：上下改周期（与滚轮/输入框同一步长并钳制在有效区间），左右平移底部滑块（每次移动5%）
  chartKeyRef.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const lo = options.length > 0 ? options[0] : 5;
      const hi = options.length > 0 ? options[options.length - 1] : maxRange;
      const next = e.key === 'ArrowUp' ? range + DIVIDEND_CHART_RANGE_STEP : range - DIVIDEND_CHART_RANGE_STEP;
      updateRange(Math.min(hi, Math.max(lo, next)));
      updateOffset(0);
    } else if (e.key === '/') {
      e.preventDefault();
      updateRange(250);
      updateOffset(0);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const delta = Math.max(1, Math.round(maxOffset * 0.05));
      if (e.key === 'ArrowLeft') updateOffset(Math.min(maxOffset, offset + delta));
      else updateOffset(Math.max(0, offset - delta));
    }
  };

  return (
    <div className="border-t border-app-border bg-app-card pt-2">
      <div className="flex items-center mb-1">
        <span className="text-[10px] text-app-subtext shrink-0">{title.replace(/（([日月周]?)线）/, (m, unit) => `（${range}${unit}线）`)}</span>
        <button
          type="button"
          title="重置周期为250"
          className="p-0.5 text-app-subtext hover:text-app-text transition-colors shrink-0"
          onClick={() => { updateRange(250); updateOffset(0); }}
        >
          <RotateCcw size={11} strokeWidth={2} />
        </button>
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
      <div
        ref={chartWheelRef}
        className="h-[172px] w-full select-none touch-none"
        onMouseMove={handleFloatMove}
        onMouseEnter={() => setFloatVisible(true)}
        onMouseLeave={handleFloatLeave}
        onTouchStart={handleChartTouch}
        onTouchMove={handleChartTouch}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: 4, bottom: 0 }}>
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
              tick={(tp: any) => {
                const { y, payload } = tp;
                return (
                  <text x={0} y={y} dy={0.355} fontSize={yAxisFontSize} fill="#94a3b8" textAnchor="start">
                    {`${(payload.value as number).toFixed(1)}%`}
                  </text>
                );
              }}
              stroke="rgba(148,163,184,0.3)"
              tickLine={false}
              axisLine={false}
              domain={[yTicks[0] - (yTicks[4] - yTicks[0]) * 0.06, yTicks[4] + (yTicks[4] - yTicks[0]) * 0.06]}
              ticks={yTicks}
              width={30}
            />
            <YAxis
              yAxisId="price"
              orientation="right"
              hide={true}
              domain={priceAxisDomain}
            />
            <Tooltip
              // 内容盒已迁移到上方固定浮窗，这里只保留垂直光标线，避免出现两个弹窗
              content={() => null}
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
            {/* 极值点标注：在各自曲线上打点并标注数字（仿回测K线），最高/最低价 与 最高/最低股息率 */}
            {chartData.length > 0 && maxPricePt && minPricePt && maxRatePt && minRatePt && (
              <>
                <ReferenceDot x={maxPricePt.date} y={maxPricePt.price} yAxisId="price" r={0} stroke="none" label={{ value: maxPricePt.price.toFixed(2), position: 'top', fontSize: 8, fill: 'rgba(148,163,184,0.85)' }} />
                <ReferenceDot x={minPricePt.date} y={minPricePt.price} yAxisId="price" r={0} stroke="none" label={{ value: minPricePt.price.toFixed(2), position: 'bottom', fontSize: 8, fill: 'rgba(148,163,184,0.85)' }} />
                <ReferenceDot x={maxRatePt.date} y={maxRatePt.rate} r={0} stroke="none" label={{ value: `${maxRatePt.rate.toFixed(2)}%`, position: 'top', fontSize: 8, fill: '#3b82f6' }} />
                <ReferenceDot x={minRatePt.date} y={minRatePt.rate} r={0} stroke="none" label={{ value: `${minRatePt.rate.toFixed(2)}%`, position: 'bottom', fontSize: 8, fill: '#3b82f6' }} />
              </>
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {/* 固定定位 + transform/textContent 直接写 DOM 的悬浮窗：内容随时命中、绝不触发 React 重渲染
         容器与字体沿用 PriceInfoPopover，标题只留日期、数据单行白色显示 */}
      <div
        ref={floatingElRef}
        className={`pointer-events-none fixed left-0 top-0 z-[59] bg-app-input border border-slate-500/40 rounded-lg shadow-[0_8px_30px_rgba(0,0,0,0.55)] overflow-hidden transition-opacity duration-100 ${floatVisible ? 'opacity-100' : 'opacity-0'}`}
        style={{ width: 105 }}
      >
        <div className="px-2.5 py-1.5 border-b border-app-border bg-app-input flex items-center">
          <span className="font-mono text-[10px] text-app-subtext" ref={floatDateRef} />
        </div>
        <div className="px-2.5 py-1.5 bg-app-card space-y-1">
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] text-app-subtext whitespace-nowrap">股价</span>
              <span className="font-mono text-[11px] text-slate-400" ref={floatPriceRef} />
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] text-app-subtext whitespace-nowrap">股息率</span>
              <span className="font-mono text-[11px] text-slate-400" ref={floatRateRef} />
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] text-app-subtext whitespace-nowrap">分红</span>
              <span className="font-mono text-[11px] text-slate-400" ref={floatDividendRef} />
            </div>
          </div>
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
      </div>
    </div>
  );
});

// 支撑/压力位浮窗中的一行：plain 为纯文本行，cell 为带名称的表格行（名称可着色）
type SrRow =
  | { kind: 'plain'; text: string }
  | { kind: 'cell'; name: string; color?: string; rest: string };

export const StockDividendPage: React.FC<StockDividendPageProps> = ({ stocks, onStocksChange, isAdding, onCloseAdding, visibleColumns, dividendRateColumns, colorRanges, tagColors = {}, onTagColorsChange, maxRows = 15, maxWidth = 942, autoRefreshInterval = 60, actionButtons, appVersion, onTogglePage, apiSource = 'tencent' as ApiSource, tagParams = DEFAULT_TAG_PARAMS, customTags = [], onResetStocks, resetSignal, dividendYearLeft = 2024, dividendYearRight = 2025, sortMode = 'default', onSortModeChange, memo, memoUpdatedAt, memoBaseline, onMemoChange, onMemoUpload, buyOrderPlaceholder = '记录本次挂单的思路策略', sellOrderPlaceholder = '记录本次挂单的思路策略', showRequestStats = true, ledgerMap, onLedgerMapChange, onExportFullBackup, onImportFullBackup, onBacktestPresetsDirty, dividendTotalCapital = 0, onDividendTotalCapitalChange }) => {
  // 全量备份导入用的隐藏文件选择（放入盈利统计面板）
  const fullBackupInputRef = useRef<HTMLInputElement>(null);
  const defaultVisibleColumns = ['code', 'name', 'price', 'changePercent', 'dividendLeft', 'dividendRight', 'position', 'dividendRate', 'dividendRates'];
  // 把某股票的全量逐笔写入本地流水账（IndexedDB 由 App 层持久化）
  const pushLedger = useCallback((stockId: string, trades: StockTrade[]) => {
    onLedgerMapChange?.(prev => ({
      ...prev,
      [stockId]: { trades },
    }));
  }, [onLedgerMapChange]);
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
  // 股息率九宫格间隔（本地记忆，0.5 ↔ 0.25 切换）
  const [ratesGridStep, setRatesGridStep] = useState<number>(() => {
    try { return Number(localStorage.getItem('dividendRatesGridStep')) === 0.25 ? 0.25 : 0.5; } catch { return 0.5; }
  });
  const handleRatesGridStepToggle = () => {
    setRatesGridStep(prev => {
      const next = prev === 0.5 ? 0.25 : 0.5;
      try { localStorage.setItem('dividendRatesGridStep', String(next)); } catch { /* ignore */ }
      return next;
    });
  };
  // 九宫格中心格交互：悬停预览 + 点击钉住（点击状态优先于悬停）。无需本地记忆。
  const [ratesCenterToggle, setRatesCenterToggle] = useState<boolean>(false); // 点击钉住
  const [ratesCenterHover, setRatesCenterHover] = useState<boolean>(false);   // 悬停临时预览
  const handleRatesCenterToggle = () => {
    setRatesCenterHover(false); // 钉住后以点击状态为准，清除悬停预览
    setRatesCenterToggle(prev => !prev);
  };
  // 股票列表股息率区间内每日股息率：与 DividendRateCurve 的速率算法共用 dividendRateForDay（单一事实来源）
  const rateForKline = (stock: StockEntry, k: BollKline, fallback: number, klines: BollKline[]): number => {
    // 股息率按年份折算的"最新交易年份"取自全量末尾 K 线（klines 为全量，勿用单日窗口）
    const currentYear = klines.length ? parseInt(String((klines[klines.length - 1]?.date || '').slice(0, 4)), 10) : NaN;
    return dividendRateForDay(stock.dividendByYear, k.date, k.close, currentYear, fallback) ?? 0;
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
  const handleSortModeChange = (mode: 'default' | 'dividendRate' | 'tag' | 'daily' | 'weekly' | 'monthly' | 'changePercent' | 'costPct' | 'tradePct') => {
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
  // 成本列排序方向：false=成本下方盈亏%从高到低，true=从低到高，两档切换
  const [costPctSortReverse, setCostPctSortReverse] = useState(false);
  const handleCostPctSortClick = () => {
    if (sortMode !== 'costPct') {
      if (onSortModeChange) onSortModeChange('costPct');
      setCostPctSortReverse(false);
    } else {
      setCostPctSortReverse(prev => !prev);
    }
  };
  // 交易列排序方向：false=成交价相对现价涨跌%从高到低，true=从低到高，两档切换
  const [tradePctSortReverse, setTradePctSortReverse] = useState(false);
  const handleTradePctSortClick = () => {
    if (sortMode !== 'tradePct') {
      if (onSortModeChange) onSortModeChange('tradePct');
      setTradePctSortReverse(false);
    } else {
      setTradePctSortReverse(prev => !prev);
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
      setListSrPreviewRows(null);
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
      priceBureau.fetchAndAbsorb(stock.code, 'daily', apiSource, 'qfq', popupLogCtx),
      priceBureau.fetchAndAbsorb(stock.code, 'weekly', apiSource, 'qfq', popupLogCtx),
      priceBureau.fetchAndAbsorb(stock.code, 'monthly', apiSource, 'qfq', popupLogCtx),
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
      // 彩虹色（红橙黄绿青蓝紫）用于「日5」~「日250」标题
      const maRainbow: Record<string, string> = {
        '5': '#ef4444', '10': '#f97316', '20': '#facc15',
        '30': '#22c55e', '60': '#06b6d4', '120': '#3b82f6', '250': '#8b5cf6',
      };
      const colorForName = (name: string) => {
        const m = /^日(\d+)$/.exec(name);
        return m ? maRainbow[m[1]] : undefined;
      };
      const rows: SrRow[] = [{ kind: 'plain', text: `${stock.name}（${adjustLabel}）` }];
      rows.push({ kind: 'plain', text: '───────────────────────────────' });
      for (const r of resistances) {
        const diff = r.price - (stock.price || 0);
        const pct = (diff / (stock.price || 1)) * 100;
        const diffStr = (diff >= 0 ? '+' : '') + formatPrice(diff, stock.name);
        rows.push({ kind: 'cell', name: r.name, color: colorForName(r.name), rest: `\t${formatPrice(r.price, stock.name)}\t${diffStr}\t${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` });
      }
      rows.push({ kind: 'cell', name: '现价', color: undefined, rest: `\t${fmt(stock.price)}\t------\t------` });
      for (const s of supports) {
        const diff = s.price - (stock.price || 0);
        const pct = (diff / (stock.price || 1)) * 100;
        const diffStr = (diff >= 0 ? '+' : '') + formatPrice(diff, stock.name);
        rows.push({ kind: 'cell', name: s.name, color: colorForName(s.name), rest: `\t${formatPrice(s.price, stock.name)}\t${diffStr}\t${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` });
      }
      rows.push({ kind: 'plain', text: '───────────────────────────────' });
      const text = rows.map(r => (r.kind === 'plain' ? r.text : r.name + r.rest)).join('\n');
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
      setListSrPreviewRows(rows);
    });
  };

  // 悬停名称显示支撑/压力位（临时，不固定）
  const handleListSrHoverEnter = (e: React.MouseEvent, stock: StockEntry) => {
    // 已有任一弹窗被点击固定：悬停其他项目不触发新弹窗，保持固定弹窗
    if (listSrTooltipPinned || priceInfoPinned || positionInfoPinned || divRateInfoPinned || mktInfoPinned) return;
    handleListSrClick(e, stock, false);
  };

  // 移开名称：非固定时关闭；触摸点按中跳过关闭，交由 click 固定
  const handleListSrHoverLeave = () => {
    if (!listSrTooltipPinned) {
      if (listSrTouchGuardRef.current) return;
      listSrHoveredRef.current = false;
      listSrActiveIdRef.current = undefined;
      setListSrPreviewText(null);
      setListSrPreviewRows(null);
    }
  };

  // 触摸开始：短时间内跳过合成 mouseleave，放大最后的 click 固定
  const handleListSrTouchStart = () => {
    listSrTouchGuardRef.current = true;
    if (listSrTouchTimerRef.current !== undefined) clearTimeout(listSrTouchTimerRef.current);
    listSrTouchTimerRef.current = window.setTimeout(() => {
      listSrTouchGuardRef.current = false;
      listSrTouchTimerRef.current = undefined;
    }, 400);
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
  const [listSrPreviewRows, setListSrPreviewRows] = useState<SrRow[] | null>(null);
  const [listSrTooltipOffset, setListSrTooltipOffset] = useState(0);
  const [listSrTooltipAbove, setListSrTooltipAbove] = useState(0);
  const listSrBtnRef = useRef<HTMLButtonElement | null>(null);
  const listSrHoveredRef = useRef(false);
  const listSrActiveIdRef = useRef<string | undefined>(undefined);
  const [listSrCopied, setListSrCopied] = useState(false);
  const [listSrTooltipPinned, setListSrTooltipPinned] = useState(false);
  const listSrTooltipRef = useRef<HTMLDivElement | null>(null);
  const listSrTooltipMeasuredSize = useRef({ w: 0, h: 0 });
  const listSrTouchGuardRef = useRef(false); // 触摸点按中保护：避免合成mouseleave在点击固定前关闭浮窗
  const listSrTouchTimerRef = useRef<number | undefined>(undefined);
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
  const priceInfoTouchGuardRef = useRef(false); // 触摸点按中保护：避免合成mouseleave在点击固定前关闭浮窗
  const priceInfoTouchTimerRef = useRef<number | undefined>(undefined);
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
  const divRateTouchGuardRef = useRef(false); // 触摸点按中保护：避免合成mouseleave在点击固定前关闭浮窗
  const divRateTouchTimerRef = useRef<number | undefined>(undefined);
  const divRateInfoActiveIdRef = useRef<string | undefined>(undefined);
  const isInsideDivRateInfo = (node: Node | null) => !!node && !!divRateInfoRef.current?.contains(node);

  // 行情状态浮窗（近5交易日“破位”事件分析，数据复用 stockBollMap 日线，无需额外请求）
  const [mktInfoStock, setMktInfoStock] = useState<StockEntry | null>(null);
  const [backtestStock, setBacktestStock] = useState<StockEntry | null>(null);
  const [mktInfoPos, setMktInfoPos] = useState({ left: 0, top: 0 });
  const [mktInfoPinned, setMktInfoPinned] = useState(false);
  const mktInfoBtnRef = useRef<HTMLTableCellElement | null>(null);
  const mktInfoRef = useRef<HTMLDivElement | null>(null);
  const mktInfoHoveredRef = useRef(false);
  const mktInfoActiveIdRef = useRef<string | undefined>(undefined);
  const mktInfoTouchGuardRef = useRef(false); // 触摸点按中保护：避免合成mouseleave在点击固定前关闭浮窗
  const mktInfoTouchTimerRef = useRef<number | undefined>(undefined);
  // 底部判定依据区：当前选中的标签（hover 展示 / 点击固定）
  // event/status = 破位类标签；pattern = K线形态标签；env = 环境标签
  // status = 观测末尾状态徽标（真/假/修）；repair = 中间观测日的“修复观察”徽标
  type MktSel = { date: string; kind: 'event' | 'status' | 'repair' }
    | { date: string; kind: 'daytag'; tagKey: string }
    | { date: string; kind: 'pattern'; ptype: KlinePattern['type'] }
    | { date: string; kind: 'env'; ekey: string }
    | { date: string; kind: 'pricestate' }
    | { date: string; kind: 'volday' }
    | { date: string; kind: 'daily'; dkey: DailySignal['kind'] }
    | { date: string; kind: 'feng'; dir: 'add' | 'reduce' };
  const [mktSel, setMktSel] = useState<MktSel | null>(null);
  const [mktSelPinned, setMktSelPinned] = useState(false);
  const [mktBodyMaxH, setMktBodyMaxH] = useState<number | null>(null);
  const resetMktSel = () => { setMktSel(null); setMktSelPinned(false); };

  // 显示行情状态浮窗（位置参考价格浮窗：右侧垂直居中）
  const openMktInfo = (btn: HTMLElement, stock: StockEntry) => {
    mktInfoBtnRef.current = btn as unknown as HTMLTableCellElement;
    mktInfoActiveIdRef.current = stock.id;
    setMktInfoStock(stock);
    resetMktSel();
    setMktBodyMaxH(null);
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
    // 与价格弹窗一致，主动补齐该股票日线：mktInfo 读 priceBureau store，
    // 若日线未加载会显示"暂无K线数据"且拿不到 8/3 组指标；补齐后经 subscribe → sync → 重渲染自动更新。
    const popupLogCtx = requestLogService.beginBatch(`行情标签 ${stock.name}(${getDisplayCode(stock.code)})：日线数据补齐`);
    priceBureau.fetchAndAbsorb(stock.code, 'daily', apiSource, bollAdjust, popupLogCtx);
  };

  // 悬停名称显示行情状态（临时，不固定）
  const handleMktInfoEnter = (e: React.MouseEvent, stock: StockEntry) => {
    // 编辑该行或处于拖拽中：不触发浮窗（热区已改为整格，需避免误触）
    if (editingId === stock.id || draggedId) return;
    // 已有任一弹窗被点击固定：悬停其他项目不触发新弹窗，保持固定弹窗
    if (listSrTooltipPinned || priceInfoPinned || positionInfoPinned || divRateInfoPinned || mktInfoPinned) return;
    mktInfoHoveredRef.current = true;
    openMktInfo(e.currentTarget as HTMLElement, stock);
  };

  // 移开名称：非固定模式下直接关闭；触摸点按中跳过关闭，交由 click 固定
  const handleMktInfoLeave = () => {
    mktInfoHoveredRef.current = false;
    if (mktInfoPinned) return;
    if (mktInfoTouchGuardRef.current) return;
    mktInfoActiveIdRef.current = undefined;
    setMktInfoStock(null);
    resetMktSel();
  };

  // 触摸开始：短时间内跳过合成 mouseleave，放大最后的 click 固定
  const handleMktInfoTouchStart = () => {
    mktInfoTouchGuardRef.current = true;
    if (mktInfoTouchTimerRef.current !== undefined) clearTimeout(mktInfoTouchTimerRef.current);
    mktInfoTouchTimerRef.current = window.setTimeout(() => {
      mktInfoTouchGuardRef.current = false;
      mktInfoTouchTimerRef.current = undefined;
    }, 400);
  };

  // 点击名称：切换固定/取消固定
  const handleMktInfoClick = (e: React.MouseEvent, stock: StockEntry) => {
    // 编辑该行时点击（输入框）不触发浮窗，保持编辑交互
    if (editingId === stock.id) return;
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
    if (a.kind === 'feng') return a.dir === (b as { dir: 'add' | 'reduce' }).dir;
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
  // 关闭行情状态浮窗
  const closeMktInfo = () => {
    mktInfoHoveredRef.current = false;
    mktInfoActiveIdRef.current = undefined;
    setMktInfoPinned(false);
    setMktInfoStock(null);
    resetMktSel();
  };

  // 股票名称文字长按：打开公告链接（点一下仍是进回测，长按才触发链接）
  const nameLongPressTimerRef = useRef<number | null>(null);
  const nameLongPressFiredRef = useRef(false);

  // 行编辑（名称/链接）快照：进入编辑态时记录原始值，ESC 取消时还原，做到"不做任何修改"
  const editSnapshotRef = useRef<{ id: string; name: string; nickname?: string; link?: string } | null>(null);

  const beginRowEdit = (stock: StockEntry) => {
    editSnapshotRef.current = { id: stock.id, name: stock.name, nickname: stock.nickname, link: stock.link };
    setEditingId(stock.id);
  };

  const cancelRowEdit = () => {
    const snap = editSnapshotRef.current;
    if (snap && editingId === snap.id) {
      onStocksChange(stocks.map(s => (s.id === snap!.id ? { ...s, name: snap!.name, nickname: snap!.nickname, link: snap!.link } : s)));
    }
    editSnapshotRef.current = null;
    setEditingId(null);
  };
  const cancelRowEditRef = useRef(cancelRowEdit);
  cancelRowEditRef.current = cancelRowEdit;

  const startNameLongPress = (stock: StockEntry) => {
    if (nameLongPressTimerRef.current !== null) return;
    nameLongPressTimerRef.current = window.setTimeout(() => {
      nameLongPressTimerRef.current = null;
      nameLongPressFiredRef.current = true;
      const cur = stocks.find(s => s.id === stock.id) || stock;
      if (cur.link) {
        const finalUrl = buildAmihexinUrl(cur.link);
        if (finalUrl) openScheme(finalUrl);
      } else {
        // 没有链接：长按进入该行编辑态（可补链接/改名称）
        beginRowEdit(cur);
      }
    }, 600);
  };

  const stopNameLongPress = () => {
    if (nameLongPressTimerRef.current !== null) {
      clearTimeout(nameLongPressTimerRef.current);
      nameLongPressTimerRef.current = null;
    }
  };

  // 长按触发后，阻止随后的 click 冒泡到单元格，避免同时进入回测
  const guardNameLongPressClick = (e: React.MouseEvent) => {
    if (nameLongPressFiredRef.current) {
      nameLongPressFiredRef.current = false;
      e.stopPropagation();
    }
  };

  // 精确单击股票名称文字 → 直接打开回测页面（不触发标签弹窗）
  const handleStockNameClick = (e: React.MouseEvent, stock: StockEntry) => {
    if (editingId === stock.id || draggedId) return;
    e.stopPropagation();
    e.preventDefault();
    // 关闭当前 hover 暂留的行情浮窗，避免与回测整页叠加
    mktInfoHoveredRef.current = false;
    mktInfoActiveIdRef.current = undefined;
    setMktInfoPinned(false);
    setMktInfoStock(null);
    resetMktSel();
    setBacktestStock(stock);
  };

  // 行情状态浮窗可拖拽（拖拽头部）——与交易弹窗一致的 window 级指针实现
  const mktDragOffset = useRef({ x: 0, y: 0 });
  const isMktDragging = useRef(false);
  const mktDragMove = (e: PointerEvent) => {
    if (!isMktDragging.current || !mktInfoRef.current) return;
    const el = mktInfoRef.current;
    el.style.left = `${e.clientX - mktDragOffset.current.x}px`;
    el.style.top = `${e.clientY - mktDragOffset.current.y}px`;
  };
  const mktDragEnd = () => {
    if (!isMktDragging.current) return;
    isMktDragging.current = false;
    window.removeEventListener('pointermove', mktDragMove);
    window.removeEventListener('pointerup', mktDragEnd);
    window.removeEventListener('pointercancel', mktDragEnd);
    document.body.style.cursor = '';
    const el = mktInfoRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setMktInfoPos({ left: rect.left, top: rect.top });
      el.style.transition = '';
    }
  };
  const handleMktDragStart = (e: React.PointerEvent) => {
    const el = mktInfoRef.current;
    if (!el || e.button !== 0) return;
    isMktDragging.current = true;
    e.preventDefault();
    e.stopPropagation();
    const rect = el.getBoundingClientRect();
    mktDragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    el.style.transition = 'none';
    document.body.style.cursor = 'grabbing';
    window.addEventListener('pointermove', mktDragMove);
    window.addEventListener('pointerup', mktDragEnd);
    window.addEventListener('pointercancel', mktDragEnd);
  };


  // 判定依据变高导致浮窗超出视口时自动纠正位置；上下都超出则内容区内部滚动（与交易弹窗一致）
  useLayoutEffect(() => {
    if (!mktInfoStock || !mktInfoRef.current) return;
    const el = mktInfoRef.current;
    const pad = 8;
    const availableH = window.innerHeight - pad * 2;
    const r = el.getBoundingClientRect();
    // 头部约 40px；总高超出可用视口时压缩内容区，让它内部滚动
    if (r.height > availableH) {
      setMktBodyMaxH(Math.max(80, availableH - 40));
    }
    let top = r.top;
    let left = r.left;
    if (top < pad) top = pad;
    if (top + r.height > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - r.height - pad);
    if (left < pad) left = pad;
    if (left + r.width > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - r.width - pad);
    if (top !== r.top || left !== r.left) setMktInfoPos({ left, top });
  }, [mktInfoStock, mktInfoPos, mktBodyMaxH, mktSel, mktSelPinned]);


  // 持仓详情浮窗（hover 临时显示 / 点击固定，逻辑与价格浮窗一致，浮窗朝左侧展示）
  const [positionInfoStock, setPositionInfoStock] = useState<StockEntry | null>(null);
  const [positionInfoPos, setPositionInfoPos] = useState({ left: 0, top: 0 });
  const [positionInfoPinned, setPositionInfoPinned] = useState(false);
  const positionInfoBtnRef = useRef<HTMLTableCellElement | null>(null);
  const positionInfoRef = useRef<HTMLDivElement | null>(null);
  const positionInfoHoveredRef = useRef(false);
  const positionInfoActiveIdRef = useRef<string | undefined>(undefined);
  const positionInfoTouchGuardRef = useRef(false); // 触摸点按中保护：避免合成mouseleave在点击固定前关闭浮窗
  const positionInfoTouchTimerRef = useRef<number | undefined>(undefined);
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
    priceBureau.fetchAndAbsorb(stock.code, 'daily', apiSource, bollAdjust, popupLogCtx).then(result => {
      // 仅在仍是当前目标股票时应用结果（避免悬停切换/移开后残留旧数据）
      if (priceInfoActiveIdRef.current !== stock.id) return;
      // 用价格数据部的"今日合并日K线"（最新一根统一收敛为现价/收盘价），与股息率曲线同源，不再各自 merge
      const merged = priceBureau.getTodayDailyKlines(stock.code, stock);
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

  // 价格悬停离开：非固定模式下直接关闭；不判断 isInside，桌面 hover 从单元格移进浮窗也应关闭。
  // 移动端"点按闪现"由触摸保护(priceInfoTouchGuardRef)处理。
  const handlePriceInfoLeave = (e?: React.MouseEvent) => {
    priceInfoHoveredRef.current = false;
    if (priceInfoPinned) return;
    if (priceInfoTouchGuardRef.current) return; // 触摸点按中：跳过合成 mouseleave，等待 click 固定
    priceInfoActiveIdRef.current = undefined;
    setPriceInfoStock(null);
    setPriceInfoData(null);
    setPriceInfoLoading(false);
  };

  // 触摸开始：短时间内跳过合成 mouseleave，放大最后的 click 固定
  const handlePriceInfoTouchStart = () => {
    priceInfoTouchGuardRef.current = true;
    if (priceInfoTouchTimerRef.current !== undefined) clearTimeout(priceInfoTouchTimerRef.current);
    priceInfoTouchTimerRef.current = window.setTimeout(() => {
      priceInfoTouchGuardRef.current = false;
      priceInfoTouchTimerRef.current = undefined;
    }, 400);
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

    // 股息率曲线不再由组件自行拉取/替换最新一根K线：直接向价格数据部索要权威日K线
    // （最新一根已由 bollService 按现价/收盘价统一处理）。价格部门无缓存时由它内部补齐，组件只读。
    const repositionDivRate = () => {
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
    };
    const applyDivRateDaily = () => {
      // 仅在仍是当前目标股票时应用结果（避免悬停切换/移开后残留旧数据）
      if (divRateInfoActiveIdRef.current !== stock.id) return;
      // 向价格数据部索要"含今日实时bar"的权威日K线（最新一根由数据部统一收敛成现价/收盘价）
      const klines = priceBureau.getTodayDailyKlines(stock.code, stock);
      setDivRateInfoKlines(klines);
      setDivRateInfoLoading(false);
      // 自适应高度：数据渲染后用浮窗实际高度重算垂直居中
      requestAnimationFrame(repositionDivRate);
    };
    const daily = priceBureau.getDaily(stock.code);
    if (daily?.klines && daily.klines.length > 0) {
      applyDivRateDaily();
      return;
    }
    priceBureau.ensure(stock.code, 'daily', apiSource, bollAdjust).then(applyDivRateDaily);
  };

  // 悬停股息率列显示
  const handleDivRateInfoEnter = (e: React.MouseEvent, stock: StockEntry) => {
    // 已有任一弹窗被点击固定：悬停其他项目不触发新弹窗，保持固定弹窗
    if (listSrTooltipPinned || priceInfoPinned || positionInfoPinned || divRateInfoPinned || mktInfoPinned) return;
    divRateInfoHoveredRef.current = true;
    openDivRateInfo(e.currentTarget as HTMLElement, stock);
  };

  // 触摸开始：短时间内跳过合成 mouseleave（点按闪现缺陷），放大最后的 click 固定
  const handleDivRateInfoTouchStart = () => {
    divRateTouchGuardRef.current = true;
    if (divRateTouchTimerRef.current !== undefined) clearTimeout(divRateTouchTimerRef.current);
    divRateTouchTimerRef.current = window.setTimeout(() => {
      divRateTouchGuardRef.current = false;
      divRateTouchTimerRef.current = undefined;
    }, 400);
  };

  // 股息率悬停离开：非固定模式下直接关闭。
// 注意不在此处判断 isInsideDivRateInfo——桌面 hover 从单元格移进浮窗(图表)也应关闭临时弹窗。
// 移动端"点按闪现"由触摸保护(divRateTouchGuardRef)处理：触摸触发时不关闭，交由 click 固定。
  const handleDivRateInfoLeave = (e?: React.MouseEvent) => {
    divRateInfoHoveredRef.current = false;
    if (divRateInfoPinned) return;
    if (divRateTouchGuardRef.current) return; // 触摸点按中：跳过合成 mouseleave，等待 click 固定
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

  // 持仓悬停离开：非固定模式下直接关闭；不判断 isInside，桌面 hover 移进浮窗也应关闭。
  // 移动端"点按闪现"由触摸保护(positionInfoTouchGuardRef)处理。
  const handlePositionInfoLeave = (e?: React.MouseEvent) => {
    positionInfoHoveredRef.current = false;
    if (positionInfoPinned) return;
    if (positionInfoTouchGuardRef.current) return; // 触摸点按中：跳过合成 mouseleave，等待 click 固定
    positionInfoActiveIdRef.current = undefined;
    setPositionInfoStock(null);
  };

  // 触摸开始：短时间内跳过合成 mouseleave，放大最后的 click 固定
  const handlePositionInfoTouchStart = () => {
    positionInfoTouchGuardRef.current = true;
    if (positionInfoTouchTimerRef.current !== undefined) clearTimeout(positionInfoTouchTimerRef.current);
    positionInfoTouchTimerRef.current = window.setTimeout(() => {
      positionInfoTouchGuardRef.current = false;
      positionInfoTouchTimerRef.current = undefined;
    }, 400);
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
  const [isRefreshingBoll, setIsRefreshingBoll] = useState(false);

  // 价格数据部订阅：权威数据只存于 priceBureau，本状态仅为渲染镜像。
  // 任何写入（缓存命中/逐只落地/清场）都会 notify，这里重建镜像触发重渲。
  useEffect(() => {
    const sync = () => {
      const m = new Map<string, { daily: BollData | null; weekly: BollData | null; monthly: BollData | null }>();
      for (const s of stocks) {
        const e = priceBureau.getEntry(s.code);
        if (e) m.set(s.id, e);
      }
      setStockBollMap(m);
    };
    sync();
    return priceBureau.subscribe(sync);
  }, [stocks]);

  // 名称列第二行展示模式：默认“状态标签”，点击“代码”表头切换为展示代码
  const [nameSubMode, setNameSubMode] = useState<'tags' | 'code'>('tags');
  // 首次判定的统一数据源：对"同一组（实时价覆盖后的）K 线"只计算一遍 破位/形态/环境，
  // 列表缩略标签（buildLatestShrinkTags）与行情浮窗详细展示共用这份结果，杜绝两套判定喂不同数据。
  const LATEST_TAG_VERSION = 19; // 判定/展示逻辑变更时 +1，避免 HMR 保留旧缓存导致缩略与弹窗不一致
  const analyzedCache = useRef(new Map<string, { v: number; key: string; data: { klines: BollKline[] | null; events: MarketEvent[] | null; allowVol: boolean; patterns: KlinePattern[] | null; combos: PatternCombo[]; env: EnvResult | null; priceState: PriceStateTag | null; latestVol: KlineVolume5 | null } }>());
  const computeAnalyzed = (stock: StockEntry): { klines: BollKline[] | null; events: MarketEvent[] | null; allowVol: boolean; patterns: KlinePattern[] | null; combos: PatternCombo[]; env: EnvResult | null; priceState: PriceStateTag | null; latestVol: KlineVolume5 | null } => {
    // 与行情浮窗同一基准：走价格数据部"今日合并日K线"（最新一根统一为现价/实时最高最低），
    // 名称列缩略与价格浮窗天然同源，消除只看 close 导致的当日最高价漂移。
    const base = stockBollMap.get(stock.id)?.daily?.klines;
    const klines = priceBureau.getTodayDailyKlines(stock.code);
    if (!klines || klines.length === 0) return { klines: null, events: null, allowVol: false, patterns: null, combos: [], env: null, priceState: null, latestVol: null };
    const price = stock.price;
    // 缓存键必须包含实时价与"今日/live bar 的内容指纹"——盘中价格原地更新时数组引用不变，
    // 仅用数组引用会导致判定结果（如来去匆匆的十字星）缓存过期、与实时价不一致。
    // base 用稳定镜像引用，指纹用合并后的最新根，二者兼得缓存命中与实时正确。
    const key = `${base}::${price}::${latestBarFingerprint(klines)}::${JSON.stringify(tagParams)}`;
    const cached = analyzedCache.current.get(stock.id);
    if (cached && cached.key === key && cached.v === LATEST_TAG_VERSION) return cached.data;
    const allowVol = isTodayVolumeEligible(klines);
    const patterns = analyzeKlinePatterns(klines, v => formatPrice(v, stock.name), tagParams);
    const data = {
      klines,
      events: analyzeMarketConditions(klines, 10),
      allowVol,
      patterns,
      combos: analyzeKlineCombo(klines, patterns, tagParams),
      env: analyzeEnvironment(klines, v => formatPrice(v, stock.name), allowVol, tagParams),
      priceState: classifyPriceState(klines, v => formatPrice(v, stock.name), tagParams),
      latestVol: classifyVolumeAt(klines, klines.length - 1, tagParams),
    };
    analyzedCache.current.set(stock.id, { v: LATEST_TAG_VERSION, key, data });
    return data;
  };

  // 列表名称列缩略标签：直接复用 computeAnalyzed 的判定结果，从不自行重新判定
  const getLatestDayTags = (stock: StockEntry): { key: string; text: string; cls: string }[] => {
    const a = computeAnalyzed(stock);
    if (!a.klines) return [];
    return buildLatestShrinkTags(a.events, a.patterns, a.env, a.klines[a.klines.length - 1].date, a.priceState, a.latestVol);
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
    } else if (sortMode === 'costPct') {
      // 成本列排序：按成本下方盈亏%(现价相对成本的涨跌)高低，两档切换；空成本/无价格股票始终排在最后
      const costPct = (s: StockEntry): number | null =>
        s.positionCost > 0 && (s.price || 0) > 0 ? ((s.price - s.positionCost) / s.positionCost) * 100 : null;
      return [...stocks].sort((a, b) => {
        const pa = costPct(a), pb = costPct(b);
        if (pa == null && pb == null) return 0;
        if (pa == null) return 1; // 空数据排最后
        if (pb == null) return -1;
        return costPctSortReverse ? pa - pb : pb - pa;
      });
    } else if (sortMode === 'tradePct') {
      // 交易列排序：按成交价相对现价涨跌%(最新成交价相对现价的涨跌)高低，两档切换；无交易/无价格股票始终排在最后
      const tradePct = (s: StockEntry): number | null => {
        const trades = s.stockTrades || [];
        const ordinary = trades.filter(t => !t.isMerged);
        const latest = ordinary.length ? [...ordinary].sort((a, b) => b.createdAt - a.createdAt)[0] : null;
        if (!latest || latest.price <= 0 || (s.price || 0) <= 0) return null;
        return ((s.price - latest.price) / latest.price) * 100;
      };
      return [...stocks].sort((a, b) => {
        const pa = tradePct(a), pb = tradePct(b);
        if (pa == null && pb == null) return 0;
        if (pa == null) return 1; // 空数据排最后
        if (pb == null) return -1;
        return tradePctSortReverse ? pa - pb : pb - pa;
      });
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
  }, [stocks, sortMode, stockBollMap, bollSortReverse, changePctSortReverse, divRateSortMode, costPctSortReverse, tradePctSortReverse]);

  // 请求日志状态
  const [requestLogs, setRequestLogs] = useState<RequestLogEntry[]>([]);
  const [requestStats, setRequestStats] = useState<RequestLogStats>({ total: 0, success: 0, failed: 0, cached: 0, pending: 0 });
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

  // 底部栏视图：请求统计 / 盈利统计（存 localStorage）
  const getSavedBottomBarView = (): 'request' | 'profit' => {
    try {
      const v = localStorage.getItem('stock_bottom_bar_view');
      return v === 'request' || v === 'profit' ? v : 'request';
    } catch { return 'request'; }
  };
  const [bottomBarView, setBottomBarView] = useState<'request' | 'profit'>(getSavedBottomBarView);
  // 盈利统计：周期选择 + 面板展开 + 逐日明细展开（周期/展开 存 localStorage）
  const getSavedProfitRangeMode = (): ProfitRangeMode => {
    try {
      const v = localStorage.getItem('stock_profit_range_mode');
      return (v as ProfitRangeMode) || 'm1';
    } catch { return 'm1'; }
  };
  const getSavedShowProfitPanel = (): boolean => {
    try {
      return localStorage.getItem('stock_profit_panel_open') === '1';
    } catch { return false; }
  };
  const [profitRangeMode, setProfitRangeMode] = useState<ProfitRangeMode>(getSavedProfitRangeMode);
  const [profitCustomStart, setProfitCustomStart] = useState(() => {
    try {
      return localStorage.getItem('stock_profit_custom_start') || '';
    } catch { return ''; }
  });
  const [profitCustomEnd, setProfitCustomEnd] = useState(() => {
    try {
      return localStorage.getItem('stock_profit_custom_end') || '';
    } catch { return ''; }
  });
  const [showProfitPanel, setShowProfitPanel] = useState(getSavedShowProfitPanel);
  const [expandedProfitDays, setExpandedProfitDays] = useState<Set<string>>(new Set());

  // 持久化到 localStorage
  useEffect(() => {
    try { localStorage.setItem('stock_bottom_bar_view', bottomBarView); } catch {}
  }, [bottomBarView]);
  useEffect(() => {
    try { localStorage.setItem('stock_profit_range_mode', profitRangeMode); } catch {}
  }, [profitRangeMode]);
  useEffect(() => {
    try { localStorage.setItem('stock_profit_custom_start', profitCustomStart); } catch {}
  }, [profitCustomStart]);
  useEffect(() => {
    try { localStorage.setItem('stock_profit_custom_end', profitCustomEnd); } catch {}
  }, [profitCustomEnd]);
  useEffect(() => {
    try { localStorage.setItem('stock_profit_panel_open', showProfitPanel ? '1' : '0'); } catch {}
  }, [showProfitPanel]);

  // 请求日志面板展开也一起存（既然用户说请求统计也要记住）
  const getSavedShowLogPanel = (): boolean => {
    try {
      return localStorage.getItem('stock_request_log_panel_open') === '1';
    } catch { return false; }
  };
  const [showLogPanel, setShowLogPanel] = useState(getSavedShowLogPanel);
  useEffect(() => {
    try { localStorage.setItem('stock_request_log_panel_open', showLogPanel ? '1' : '0'); } catch {}
  }, [showLogPanel]);

  // 底部栏点击空白区域切换展开/收起（交互控件点击不触发）
  const toggleBottomBar = useCallback((e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('button, input, select, a, label')) return;
    if (bottomBarView === 'request') setShowLogPanel(v => !v);
    else setShowProfitPanel(v => !v);
  }, [bottomBarView]);

  // 盈利统计数据源：优先全量流水账；无流水账时回退到页面主 state 的 stockTrades（兼容首次使用未建 IndexedDB）
  const effectiveLedger = useMemo<StockLedgerMap>(() => {
    if (ledgerMap && Object.keys(ledgerMap).length > 0) return ledgerMap;
    const m: StockLedgerMap = {};
    stocks.forEach(s => { m[s.id] = { trades: s.stockTrades || [] }; });
    return m;
  }, [ledgerMap, stocks]);
  const profitStockNames = useMemo(() => Object.fromEntries(stocks.map(s => [s.id, s.name])), [stocks]);
  // 计算所选时间窗口 [startTs, endTs)
  const profitRange = useMemo(() => {
    const now = new Date();
    let end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    let start: Date;
    switch (profitRangeMode) {
      case 'w1': start = new Date(now.getTime() - 7 * 86400000); break;
      case 'w2': start = new Date(now.getTime() - 14 * 86400000); break;
      case 'm1': start = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()); break;
      case 'm3': start = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()); break;
      case 'm6': start = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()); break;
      case 'y1': start = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()); break;
      case 'custom':
        start = profitCustomStart ? new Date(`${profitCustomStart}T00:00:00`) : new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        if (profitCustomEnd) end = new Date(`${profitCustomEnd}T23:59:59.999`);
        break;
    }
    return { startTs: start.getTime(), endTs: end.getTime() };
  }, [profitRangeMode, profitCustomStart, profitCustomEnd]);
  const profitResult = useMemo(
    () => calcRealizedPnlForRange(effectiveLedger, profitStockNames, profitRange.startTs, profitRange.endTs),
    [effectiveLedger, profitStockNames, profitRange]
  );
  const fmtSignedAmount = (v: number) => `${v >= 0 ? '+' : ''}${v.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
  const fmtShortDate = (ts: number) => {
    const d = new Date(ts);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  };
  const profitRangeLabel = `${fmtShortDate(profitRange.startTs)} ~ ${fmtShortDate(profitRange.endTs)}`;

  // 账户汇总：已投入（持仓成本） / 总资金 / 剩余 / 仓位占比（不关联现价）
  const [editingCapital, setEditingCapital] = useState(false);
  const accountSummary = useMemo(() => {
    let invested = 0;
    for (const key of Object.keys(effectiveLedger)) {
      const entry = effectiveLedger[key];
      if (!entry || !entry.trades) continue;
      const { shares, avgCost } = calcPositionFromTrades(entry.trades);
      invested += shares * avgCost;
    }
    const total = dividendTotalCapital || 0;
    const remaining = Math.max(0, total - invested);
    const ratio = total > 0 ? (invested / total) * 100 : 0;
    return { invested, total, remaining, ratio };
  }, [effectiveLedger, dividendTotalCapital]);
  const fmtCapital = (v: number) => v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const toggleProfitDay = (date: string) => {
    setExpandedProfitDays(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date); else next.add(date);
      return next;
    });
  };

  // 逐日明细：一键全部展开/收起
  const allProfitDaysExpanded = profitResult.byDay.length > 0 && profitResult.byDay.every(d => expandedProfitDays.has(d.date));
  const toggleAllProfitDays = () => {
    setExpandedProfitDays(prev => {
      const next = new Set(prev);
      if (allProfitDaysExpanded) {
        profitResult.byDay.forEach(d => next.delete(d.date));
      } else {
        profitResult.byDay.forEach(d => next.add(d.date));
      }
      return next;
    });
  };

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

  // 请求版本号：每次切换数据源递增，用于取消旧请求
  const fetchVersionRef = useRef(0);

  const fetchAllBoll = useCallback(async (trigger = '打开股息页自动刷新布林线') => {
    // 价格数据部持权威数据与订阅；这里只做：源切换清场 + 委托批量加载 + 维护刷新态信号。
    // 请求取消/缓存判定/逐个落地/250ms 节流/日志全在 priceBureau.ensureBatch 内完成。
    const currentVersion = ++fetchVersionRef.current;

    // 只在前复权模式下批量获取所有股票的BOLL数据
    // 新浪不支持不复权模式，跳过批量获取
    if (apiSource === 'sina' && bollAdjust === 'none') {
      priceBureau.clear();
      return;
    }

    // 不复权模式下腾讯也需要处理实时价格，减少批量请求
    if (bollAdjust === 'none') {
      priceBureau.clear();
      return;
    }

    setIsRefreshingBoll(true);
    // 清空旧数据，显示加载状态
    priceBureau.clear();

    const madeRequest = await priceBureau.ensureBatch(stocks, apiSource, bollAdjust, {
      trigger,
      order: sortedStocks,
      cancelCheck: () => fetchVersionRef.current !== currentVersion,
    });

    // 全量（批量）刷新完成：仅在本次确实发起了网络请求时，才更新"全量刷新时间戳"
    // （表头与设置面板读取）。全部命中缓存、无需请求时保留旧时间，避免被缓存命中刷成"刚刚"。
    if (madeRequest) {
      setBollFullFetchTime(apiSource);
    }

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
        setListSrPreviewRows(null);
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
    safeSetItem('stock_dividend_stocks', JSON.stringify(stocks));
  }, [stocks]);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    // 排序模式下拖拽无意义：切回手动顺序，保证拖拽对可见列表立即生效
    if (sortMode !== 'default' && onSortModeChange) onSortModeChange('default');
  };

  // 拖拽结束（成功放置或中途放弃）统一清理，确保没有任何行残留高亮
  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
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
    // 基于当前可见顺序（sortedStocks）移动，再把 stocks 底层顺序对齐成新顺序，
    // 保证拖拽在任意排序方式下都按用户"所见"的顺序生效
    const order = sortedStocks.map(s => s.id);
    const fromIdx = order.indexOf(draggedId);
    const toIdx = order.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }
    const newOrder = [...order];
    const [movedId] = newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, movedId);
    const byId = new Map(stocks.map(s => [s.id, s]));
    const newStocks = newOrder.map(id => byId.get(id)).filter((s): s is StockEntry => !!s);
    if (newStocks.length === stocks.length) onStocksChange(newStocks);
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
      const ok = await priceBureau.refreshRealtimeSingle(stock.code, '点击行内重试');
      const q = priceBureau.getRealtime(stock.code);
      if (ok && q && q.price > 0) {
        const year = getSelectedYear(stock);
        const dividend = getDividendForYear(stock, year);
        const dividendRate = q.price > 0 ? (dividend / q.price) * 100 : 0;
        onStocksChange(stocks.map(s =>
          s.id === id ? {
            ...s,
            price: q.price,
            changePercent: q.changePercent,
            high: q.high,
            low: q.low,
            open: q.open,
            volume: q.volume,
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
  }, [stocks, onStocksChange]);

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
        : `打开股息页自动刷新股价：${staleCount}/${stocks.length} 只已过期，1 条批量请求（${staleCount} 只）${cacheInfoStr}`;
    } else if (marketClosed) {
      refreshReason = staleCount === 0
        ? `点击「价格」列头刷新（休市）：${stocks.length} 只股票缓存均未过期，无需请求${cacheInfoStr}`
        : `点击「价格」列头刷新（休市）：${staleCount}/${stocks.length} 只已过期，1 条批量请求（${staleCount} 只）${cacheInfoStr}`;
    } else {
      refreshReason = `点击「价格」列头刷新：${stocks.length} 只股票 · 1 条批量请求`;
    }
    const batchTime = Date.now(); // 同批次共用的触发时间，作为本批所有股票的过期起点
    setIsRefreshing(new Set(stocks.map(s => s.id)));
    setRefreshFailed(new Set());
    try {
      const updatedStocks = [...stocks];
      const failedIds = new Set<string>();
      let changed = false;
      let skippedCount = 0;
      // 第一遍：过滤出确实需要刷新的股票（其余命中新鲜缓存，保留原拉取时间）
      const toRefresh: { idx: number; stock: StockEntry }[] = [];
      for (let i = 0; i < updatedStocks.length; i++) {
        const stock = updatedStocks[i];
        if (effectiveSkip && isStockPriceFresh(stock.priceUpdatedAt)) {
          skippedCount++;
          continue;
        }
        toRefresh.push({ idx: i, stock });
      }
      if (toRefresh.length > 0) {
        const applyResult = (idx: number, r: { price: number; changePercent: number; high: number; low: number; open: number; volume: number }): void => {
          const year = getSelectedYear(updatedStocks[idx]);
          const dividend = getDividendForYear(updatedStocks[idx], year);
          const dividendRate = r.price > 0 ? (dividend / r.price) * 100 : 0;
          updatedStocks[idx] = {
            ...updatedStocks[idx],
            price: r.price,
            changePercent: r.changePercent,
            high: r.high,
            low: r.low,
            open: r.open,
            volume: r.volume,
            priceUpdatedAt: batchTime,
            dividendRate2025: dividendRate,
          };
        };
        // 主路径：N 只 → 1 条批量请求（统一走价格数据部，实时行情由 priceBureau 自持）
        await priceBureau.refreshRealtime(
          toRefresh.map(t => ({ id: t.stock.id, code: t.stock.code })),
          refreshReason,
        );
        const missing: { idx: number; stock: StockEntry }[] = [];
        for (const { idx, stock } of toRefresh) {
          const q = priceBureau.getRealtime(stock.code);
          if (q && q.price > 0) {
            applyResult(idx, q);
            changed = true;
          } else {
            missing.push({ idx, stock });
          }
        }
        // 兜底：批量响应中缺失的少量个股，逐只单点重试
        for (const { idx, stock } of missing) {
          const ok = await priceBureau.refreshRealtimeSingle(stock.code);
          const q = priceBureau.getRealtime(stock.code);
          if (ok && q && q.price > 0) {
            applyResult(idx, q);
            changed = true;
          } else {
            failedIds.add(stock.id);
          }
        }
      }
      if (skippedCount > 0) {
        showNotice(skippedCount >= stocks.length
          ? (marketClosed
              ? '休市期间，行情已是最新，无需刷新'
              : '全部股价已是最新，无需刷新')
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
  }, [stocks, onStocksChange]);

  // ---- 长按刷新按钮进入"自动刷新" ----
  // 自动刷新：仅盘中（isTradingHours 命中交易时段）每 interval 秒刷新一次；
  // 收盘/未开盘/午休时段直接停止。自动模式下按钮图标持续旋转并显示主题色，区别于手动加载。
  const [autoRefreshOn, setAutoRefreshOn] = useState(false);
  const autoHoldTimer = useRef<number | null>(null); // 长按 600ms 判定定时器
  const autoFired = useRef(false);                   // 长按已触发，吞掉随后的 click 以免误取消
  const autoTimer = useRef<number | null>(null);     // 自动刷新 interval
  const autoInFlight = useRef(false);                // 防止自动刷新 tick 之间/与手动并发
  const refreshAllRef = useRef(handleRefreshAll);    // 始终持有最新的 handleRefreshAll
  refreshAllRef.current = handleRefreshAll;

  // 自动刷新主循环：autoRefreshOn 时启动，非盘中停止；
  // 页面不在前台（后台标签页/浏览器切走）时跳过刷新，切回前台立即补一次。
  // 依赖 autoRefreshInterval：运行中修改间隔会重建定时器以新节奏计时。
  const autoWasOn = useRef(false);
  useEffect(() => {
    const justEnabled = autoRefreshOn && !autoWasOn.current;
    autoWasOn.current = autoRefreshOn;
    if (!autoRefreshOn) return;
    const tick = () => {
      // 页面不处于前台则不自动刷新（浏览器后台的 setInterval 仅被限流、不会停）
      if (document.visibilityState !== 'visible') return;
      if (!isTradingHours()) {
        setAutoRefreshOn(false); // 收盘 / 未开盘 / 午休 → 自动刷新直接停止
        return;
      }
      if (autoInFlight.current) return; // 上一轮还没结束，跳过本次
      autoInFlight.current = true;
      refreshAllRef.current(false).finally(() => { autoInFlight.current = false; });
    };
    if (justEnabled) tick(); // 仅进入自动模式时立即刷新一次；改间隔只重置计时，不额外补刷
    const intervalMs = Math.max(autoRefreshInterval || 60, 5) * 1000;
    autoTimer.current = window.setInterval(tick, intervalMs);
    // 从后台切回前台时，立即刷新一次（追平后台欠下的刷新）
    const onVisibility = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (autoTimer.current) { clearInterval(autoTimer.current); autoTimer.current = null; }
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [autoRefreshOn, autoRefreshInterval]);

  // 长按进入自动刷新的手势状态：按下后 600ms 未抬起/未移出则触发
  const startAutoHold = () => {
    if (autoRefreshOn) return; // 自动模式下左键为取消，不进长按
    autoFired.current = false;
    autoHoldTimer.current = window.setTimeout(() => {
      autoFired.current = true;
      setAutoRefreshOn(true);
    }, 600);
  };
  const cancelAutoHold = () => {
    if (autoHoldTimer.current) { clearTimeout(autoHoldTimer.current); autoHoldTimer.current = null; }
  };

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

  // ============ 交易记录列（持仓大列内子列4） ============
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
  const getTrades = (stock: StockEntry): StockTrade[] => stock.stockTrades || [];

  // 交易浮窗状态
  const [tradeInfoStock, setTradeInfoStock] = useState<StockEntry | null>(null);
  const [tradeInfoPos, setTradeInfoPos] = useState<{ top: number, left: number }>({ top: 0, left: 0 });
  const [tradeInfoPinned, setTradeInfoPinned] = useState(false);
  const [tradeInfoSettled, setTradeInfoSettled] = useState(false);
  const tradeSettledOnceRef = useRef(false);
  const tradeInfoBtnRef = useRef<HTMLTableCellElement | null>(null);
  const tradeInfoRef = useRef<HTMLDivElement | null>(null);

  // 交易列简易浮窗（仅鼠标移入展示最新一笔成交/挂单；点击由交易弹窗接管，两者只能同时展示一个）
  const [tradeSimpleStock, setTradeSimpleStock] = useState<StockEntry | null>(null);
  const [tradeSimplePos, setTradeSimplePos] = useState<{ top: number, left: number }>({ top: 0, left: 0 });
  const tradeSimpleBtnRef = useRef<HTMLElement | null>(null);
  const tradeSimpleRef = useRef<HTMLDivElement | null>(null);
  const tradeSimpleCloseTimerRef = useRef<number | undefined>(undefined); // 悬停宽限关闭计时
  const tradeSimpleShowTimerRef = useRef<number | undefined>(undefined); // 悬停宽限出现计时
  const tradeTouchGuardRef = useRef(false); // 触摸点按中不展示简易浮窗（只有鼠标 hover 触发）
  const tradeTouchTimerRef = useRef<number | undefined>(undefined);

  // 新增挂单表单状态（提交成功后清空）
  const [addTradeSide, setAddTradeSide] = useState<'buy' | 'sell'>('buy');
  const [addTradePrice, setAddTradePrice] = useState('');
  const [addTradeShares, setAddTradeShares] = useState('');
  const [addTradeNote, setAddTradeNote] = useState('');
  const [editingTradeId, setEditingTradeId] = useState<string | null>(null);
  // 内容区高度上限（px）：空间不足时压缩+内部滚动，null 表示不限制（保持原生 max-h 由 CSS 决定）
  const [tradeBodyMaxH, setTradeBodyMaxH] = useState<number | null>(null);
  // 标题栏公告链接：编辑模式 + 输入值（保存到股票 link 字段）
  const [linkEditing, setLinkEditing] = useState(false);
  const [linkInput, setLinkInput] = useState('');

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
    setAddTradeNote('' as string);
    setTradeBodyMaxH(null);
    setLinkEditing(false);
    setLinkInput('');
  }, []);

  // 标题栏公告链接按钮：已有 link 则转成 amihexin 链接用浏览器打开；没有则进入编辑模式
  // 注意必须从 stocks 实时取当前股票，不能用 tradeInfoStock（那是打开弹窗时捕获的旧引用，保存 link 后不会更新）
  const handleOpenStockLink = () => {
    if (!tradeInfoStock) return;
    const cur = stocks.find(x => x.id === tradeInfoStock.id) || tradeInfoStock;
    if (cur.link) {
      const finalUrl = buildAmihexinUrl(cur.link);
      // 用 openScheme 触发 amihexin:// 跳转：避免 window.open 新开空白标签页，也规避部分 WebView 拦截 location.href
      if (finalUrl) openScheme(finalUrl);
    } else {
      setLinkInput(cur.link || '');
      setLinkEditing(true);
    }
  };

  // 保存链接到股票 link 字段（空值当作清除）
  const saveStockLink = useCallback(() => {
    if (!tradeInfoStock) return;
    const trimmed = linkInput.trim();
    onStocksChange(stocks.map(s => s.id === tradeInfoStock.id ? { ...s, link: trimmed || undefined } : s));
    setLinkEditing(false);
    setLinkInput('');
  }, [tradeInfoStock, linkInput, stocks, onStocksChange]);

  // 取消编辑：直接还原标题栏，不改动 link
  const cancelStockLink = useCallback(() => {
    setLinkEditing(false);
    setLinkInput('');
  }, []);

  // 编辑模式下跳转按钮：固定触发 amihexin:// 协议跳转，与输入框内容无关
  const handleTestLinkJump = useCallback(() => {
    openScheme('amihexin://');
  }, []);

  // 统一 ESC 关闭：无论临时(hover)还是固定(click)悬浮窗，按 ESC 一律关闭
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 行编辑态（名称/链接）：ESC 取消并还原原始值，不做任何修改
      cancelRowEditRef.current();
      // 价格技术指标浮窗
      priceInfoHoveredRef.current = false;
      priceInfoActiveIdRef.current = undefined;
      setPriceInfoPinned(false);
      setPriceInfoStock(null);
      setPriceInfoData(null);
      setPriceInfoLoading(false);
      // 持仓详情浮窗
      positionInfoHoveredRef.current = false;
      positionInfoActiveIdRef.current = undefined;
      setPositionInfoPinned(false);
      setPositionInfoStock(null);
      // 股息率曲线浮窗
      divRateInfoHoveredRef.current = false;
      divRateInfoActiveIdRef.current = undefined;
      setDivRateInfoPinned(false);
      setDivRateInfoStock(null);
      setDivRateInfoKlines(null);
      setDivRateInfoLoading(false);
      // 行情状态浮窗（含底部判定依据区 mktSel）
      mktInfoHoveredRef.current = false;
      mktInfoActiveIdRef.current = undefined;
      setMktInfoPinned(false);
      setMktInfoStock(null);
      setMktSel(null);
      setMktSelPinned(false);
      // 列表页支撑/压力位浮窗
      listSrHoveredRef.current = false;
      listSrActiveIdRef.current = undefined;
      setListSrTooltipPinned(false);
      setListSrPreviewText(null);
      setListSrPreviewRows(null);
      setListSrStock(null);
      // 股息率/BOLL 曲线浮窗
      setShowRatesId(null);
      // 复制预览浮窗
      listCopyHoveredRef.current = false;
      setListCopyPreviewText(null);
      // 交易浮窗
      closeTradeInfo();
      setTradeSimpleStock(null);
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, []);

  // 判断某行是否正有弹窗显示：只要该行任一列的弹窗出现，整行就保持高亮
  // （哪一列弹窗弹出来，该行高亮就一直保持，鼠标移走也不消失）。
  const hasOpenPopup = (stockId: string): boolean =>
    mktInfoStock?.id === stockId ||
    divRateInfoStock?.id === stockId ||
    priceInfoStock?.id === stockId ||
    !!(listSrPreviewText && listSrStock?.id === stockId) ||
    showRatesId === stockId ||
    positionInfoStock?.id === stockId ||
    tradeInfoStock?.id === stockId;

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

  // 首次打开：同步测量真实高度后一次性定位居中（避免弹跳、且不被异步 rAF 取消导致永不显示）。
  // 用 useLayoutEffect（DOM 变更后、绘制前同步执行），取代原 useEffect+rAF：
  // 原实现依赖一次 requestAnimationFrame，若在触发前因重渲染被 cleanup 取消，弹窗会永久停留在
  // opacity:0 且仍可交互（z-60）的“隐形层”，吞掉后续点击/焦点，表现为移动端“有时只弹键盘、点不出弹窗”。
  // 拖拽/后续仅做边界钳制，不影响拖拽自由定位。
  useLayoutEffect(() => {
    if (!tradeInfoStock || !tradeInfoRef.current) return;
    const el = tradeInfoRef.current;
    const pad = 8;
    const availableH = window.innerHeight - pad * 2;
    const r = el.getBoundingClientRect();
    // 若真实高度超出可用视口高度，压缩内容区并让其内部滚动（用户诉求：空间不足时压缩固定高度+滚动）
    if (r.height > availableH) {
      // 头部固定约 40px，内容区占满剩余高度
      setTradeBodyMaxH(Math.max(120, availableH - 40));
    } else {
      setTradeBodyMaxH(null);
    }
    if (!tradeSettledOnceRef.current) {
      // 首次：垂直居中于浏览器中心，X 轴保持不动，然后一次性显示（可见高度≤可用视口）
      tradeSettledOnceRef.current = true;
      const h = Math.min(r.height, availableH) + (r.height > availableH ? 40 : 0);
      const top = Math.max(pad, (window.innerHeight - h - pad) / 2);
      setTradeInfoPos({ left: r.left, top });
      setTradeInfoSettled(true);
      return;
    }
    // 拖拽/后续：仅防止超出视口
    let top = r.top;
    let left = r.left;
    const h = r.height;
    if (top < pad) top = pad;
    if (top + h > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - h - pad);
    if (left < pad) left = pad;
    if (left + r.width > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - r.width - pad);
    if (top !== r.top || left !== r.left) setTradeInfoPos({ left, top });
  }, [tradeInfoStock, tradeInfoPos]);

  // 点击交易列：切换固定/取消固定
  const handleTradeInfoClick = (e: React.MouseEvent, stock: StockEntry) => {
    e.stopPropagation();
    if (tradeInfoPinned && tradeInfoStock?.id === stock.id) {
      closeTradeInfo();
      return;
    }
    setTradeSimpleStock(null); // 交易弹窗优先级更高，打开时关闭简易浮窗
    openTradeInfo(e.currentTarget as HTMLElement, stock);
    setTradeInfoPinned(true);
  };

  // 最新一笔非合并成交/挂单
  const latestTrade = (stock: StockEntry): StockTrade | null => {
    const ordinary = getTrades(stock).filter(t => !t.isMerged);
    return ordinary.length ? ordinary.sort((a, b) => b.createdAt - a.createdAt)[0] : null;
  };

  // 进入交易记录编辑模式（交易窗口与简易浮窗共用："编辑"按钮填回表单）
  const startEditTrade = (s: StockEntry, t: StockTrade) => {
    setEditingTradeId(t.id);
    setAddTradeSide(t.side);
    setAddTradePrice(String(t.price));
    setAddTradeShares(String(t.shares));
    setAddTradeNote(t.note || '');
  };

  // 简易浮窗：仅鼠标移入单元格时展示（固定状态下不显示；交易弹窗优先）
  const handleTradeSimpleEnter = (e: React.MouseEvent, stock: StockEntry) => {
    if (tradeTouchGuardRef.current) return; // 触摸不展示简易浮窗
    if (tradeInfoPinned || tradeInfoStock) { setTradeSimpleStock(null); return; } // 交易弹窗(点击)优先级更高
    if (!latestTrade(stock)) { setTradeSimpleStock(null); return; } // 无交易记录不展示
    cancelTradeSimpleClose();
    tradeSimpleBtnRef.current = e.currentTarget as HTMLElement;
    // 【特殊处理】与关闭宽限对称：移入也延迟 ENTER_GRACE 毫秒才弹出，
    // 避免鼠标只是快速划过单元格时就闪现浮窗；停留足够久才展示。
    if (tradeSimpleShowTimerRef.current !== undefined) clearTimeout(tradeSimpleShowTimerRef.current);
    tradeSimpleShowTimerRef.current = window.setTimeout(() => {
      tradeSimpleShowTimerRef.current = undefined;
      setTradeSimpleStock(stock); // 位置交由 layout effect 按实际高度垂直居中
    }, 200);
  };

  const cancelTradeSimpleShow = () => {
    if (tradeSimpleShowTimerRef.current !== undefined) {
      clearTimeout(tradeSimpleShowTimerRef.current);
      tradeSimpleShowTimerRef.current = undefined;
    }
  };

  // 【特殊处理】浮窗内有点击型按钮（编辑/撤单），不能鼠标一移出单元格就立刻消失，
  // 否则没有机会把鼠标跨过单元格与浮窗之间的空隙去点按钮。
  // 因此采用“悬停宽限”：移出后延迟 CLOSE_GRACE 毫秒再关，期间鼠标进入浮窗则取消关闭。
  const scheduleTradeSimpleClose = () => {
    if (tradeSimpleCloseTimerRef.current !== undefined) clearTimeout(tradeSimpleCloseTimerRef.current);
    tradeSimpleCloseTimerRef.current = window.setTimeout(() => {
      tradeSimpleCloseTimerRef.current = undefined;
      setTradeSimpleStock(null);
    }, 200);
  };
  const cancelTradeSimpleClose = () => {
    if (tradeSimpleCloseTimerRef.current !== undefined) {
      clearTimeout(tradeSimpleCloseTimerRef.current);
      tradeSimpleCloseTimerRef.current = undefined;
    }
  };

  // 移出单元格：直接移入浮窗内部(relatedTarget 为浮窗)则保留；否则延迟地关闭，留出飞到浮窗的时间
  const handleTradeSimpleLeave = (e: React.MouseEvent) => {
    cancelTradeSimpleShow(); // 还没到弹出时刻就移出，直接取消待弹出的浮窗
    if (e && tradeSimpleRef.current && tradeSimpleRef.current.contains(e.relatedTarget as Node | null)) return;
    scheduleTradeSimpleClose();
  };

  // 简易浮窗定位：垂直中心对齐单元格；随内容实际高度计算，渲染后再校正
  useLayoutEffect(() => {
    if (!tradeSimpleStock || !tradeSimpleBtnRef.current || !tradeSimpleRef.current) return;
    const btn = tradeSimpleBtnRef.current.getBoundingClientRect();
    const el = tradeSimpleRef.current;
    const w = el.offsetWidth, h = el.offsetHeight, gap = 8;
    let left = btn.right + gap;
    let top = btn.top + btn.height / 2 - h / 2; // 垂直居中
    if (left + w > window.innerWidth - 10) left = btn.left - w - gap;
    if (left < 10) left = (window.innerWidth - w) / 2;
    if (top + h > window.innerHeight - 10) top = window.innerHeight - h - 10;
    if (top < 10) top = 10;
    setTradeSimplePos({ left, top });
  }, [tradeSimpleStock]);

  // 触摸开始：屏蔽后续合成 mouseenter，简易浮窗只在真实鼠标 hover 时出现
  const handleTradeTouchStart = () => {
    setTradeSimpleStock(null);
    tradeTouchGuardRef.current = true;
    if (tradeTouchTimerRef.current !== undefined) clearTimeout(tradeTouchTimerRef.current);
    tradeTouchTimerRef.current = window.setTimeout(() => {
      tradeTouchGuardRef.current = false;
      tradeTouchTimerRef.current = undefined;
    }, 400);
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
      pushLedger(s.id, newTrades);
      return { ...s, stockTrades: newTrades, positionShares: shares2, positionCost: cost };
    }));
    // 挂单/成交后仅清空数量与备注，保留价格（常为现价，方便连续操作）
    setAddTradeShares('');
    setAddTradeNote('');
  }, [stocks, onStocksChange, addTradeSide, addTradePrice, addTradeShares, addTradeNote, pushLedger]);

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
        // 编辑挂单：时间戳更新到修改时刻，剩余有效交易天数随之重置为 5 天
        ...(status === 'pending' ? { createdAt: Date.now() } : {}),
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
      pushLedger(s.id, newTrades);
      return { ...s, stockTrades: newTrades, positionShares: shares2, positionCost: cost };
    }));
    // 保存编辑后仅清空数量与备注，保留价格
    setAddTradeShares('');
    setAddTradeNote('');
    setEditingTradeId(null);
  }, [stocks, onStocksChange, addTradeSide, addTradePrice, addTradeShares, addTradeNote, pushLedger]);

  // 撤单/删除一条交易记录：挂单直接删除；已成交记录删除时同步回退持仓（买入回减股数与成本加权、卖出回增股数与已实现盈亏）
  const handleRemoveTrade = useCallback((stockId: string, tradeId: string) => {
    const target = stocks.find(s => s.id === stockId);
    if (!target) return;
    const patch = removeTrade(target, tradeId);
    if (!patch.changed) return;
    // 同步写本地流水账（IndexedDB）：否则刷新时启动回填会把已删除/撤销的挂单重新加回来
    pushLedger(stockId, patch.stockTrades);
    onStocksChange(stocks.map(s => s.id === stockId ? {
      ...s,
      stockTrades: patch.stockTrades,
      positionShares: patch.positionShares,
      positionCost: patch.positionCost,
    } : s));
  }, [stocks, onStocksChange, pushLedger]);

  // 标记挂单成交：买入加权成本、卖出结算已实现盈亏；并控制已成交记录条数上限
  const handleToggleTrade = useCallback((stockId: string, tradeId: string) => {
    const target = stocks.find(s => s.id === stockId);
    if (!target) return;
    const patch = toggleTradeStatus(target, tradeId);
    if (!patch.changed) return;
    // 已成交记录超限：折叠最旧成交为合并汇总（只读，不计入上限），仅在标记成交时触发
    let trades = patch.stockTrades;
    if (patch.status === 'filled') trades = compactFilledTrades(trades);
    // 同步写本地流水账（IndexedDB）：否则刷新时启动回填会用旧挂单记录覆盖，"标记成交"状态丢失、回退成挂单
    pushLedger(stockId, trades);
    onStocksChange(stocks.map(s => s.id === stockId ? {
      ...s,
      stockTrades: trades,
      positionShares: patch.positionShares,
      positionCost: patch.positionCost,
    } : s));
  }, [stocks, onStocksChange, pushLedger]);

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
      // 步骤1：获取实时股价（统一走价格数据部）
      const ok = await priceBureau.refreshRealtimeSingle(stockCode, '添加股票查询股价');
      const result = priceBureau.getRealtime(stockCode);
      if (!ok || !result || result.price <= 0) {
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
  }, [newStock, stocks, onStocksChange]);

  const handleDeleteStock = useCallback((id: string) => {
    onStocksChange(stocks.filter(s => s.id !== id));
    // 同步删本地流水账（IndexedDB）：否则刷新时启动回填会从流水账读到该股旧交易、把股票"复活"
    onLedgerMapChange?.(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (editingId === id) {
      setEditingId(null);
    }
  }, [stocks, onStocksChange, onLedgerMapChange, editingId]);

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
      <div className="flex justify-center -mb-2.5">
        <div className="w-full flex items-end gap-3" style={{ maxWidth }}>
          <div className="flex items-center gap-3 pb-2">
            <h1 className="text-3xl font-bold text-app-subtext tracking-wide">股息率</h1>
          </div>
          {actionButtons && (
            <div className="ml-auto pb-1.5">
              {actionButtons}
            </div>
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
              {cols.includes('position') && <col style={{ width: '56px' }} />}
              {cols.includes('position') && <col style={{ width: '64px' }} />}
              {cols.includes('position') && <col style={{ width: '56px' }} />}
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
                    const t = getBollFullFetchTime(apiSource);
                    return t ? <span className="text-[9px] text-app-subtext">{formatRelativeTime(t)}</span> : null;
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
                  colSpan={4}
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
                        onClick={() => {
                          if (autoFired.current) { autoFired.current = false; return; } // 长按触发后吞掉这次 click
                          if (autoRefreshOn) { setAutoRefreshOn(false); return; }        // 自动模式下点击 = 取消自动刷新
                          handleRefreshAll(false);
                        }}
                        onPointerDown={startAutoHold}
                        onPointerUp={cancelAutoHold}
                        onPointerLeave={cancelAutoHold}
                        onContextMenu={(e) => e.preventDefault()}
                        disabled={!autoRefreshOn && isRefreshing.size > 0}
                        className="p-0.5 hover:bg-app-card rounded transition-colors disabled:opacity-50"
                        title={autoRefreshOn
                          ? `自动刷新中（间隔 ${autoRefreshInterval || 60} 秒），点击取消`
                          : '点击刷新所有股价；长按进入自动刷新'}
                      >
                        <RefreshCw size={10} className={autoRefreshOn
                          ? 'animate-spin text-indigo-400'
                          : (isRefreshing.size > 0 ? 'animate-spin' : '')} />
                      </button>
                    </div>
                  </th>}
                <th className="px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border cursor-pointer select-none hover:bg-app-card transition-colors" onClick={() => handleBollSortClick('daily')}>日线</th>
                <th className="px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border cursor-pointer select-none hover:bg-app-card transition-colors" onClick={() => handleBollSortClick('weekly')}>周线</th>
                <th className="px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border cursor-pointer select-none hover:bg-app-card transition-colors" onClick={() => handleBollSortClick('monthly')}>月线</th>
                {cols.includes('position') && <>
                  <th
                    className="w-[56px] px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border select-none"
                  >
                    股息率
                  </th>
                  <th
                    className="w-[64px] px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border select-none"
                  >
                    仓位
                  </th>
                  <th
                    className="w-[56px] px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border cursor-pointer select-none hover:bg-app-card transition-colors"
                    onClick={handleCostPctSortClick}
                    title="点击切换排序：成本下方盈亏%高→低 / 低→高"
                  >
                    成本
                  </th>
                  <th
                    className="w-[56px] px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border cursor-pointer select-none hover:bg-app-card transition-colors"
                    onClick={handleTradePctSortClick}
                    title="点击切换排序：成交价涨跌%高→低 / 低→高"
                  >
                    交易
                  </th>
                </>}
                {dividendYearCols.map((yearCol, idx) => (
                  <th key={yearCol} className="px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border">
                    {yearCol === 'dividendLeft' ? dividendYearLeft : dividendYearRight}
                  </th>
                ))}
                {dividendYearCols.length > 0 && <th className="px-1 py-1 text-center text-[10px] font-bold text-app-subtext bg-app-input border-b border-app-border border-r border-app-border whitespace-nowrap w-[62px]">登记日</th>}
              </tr>
            </thead>
            <tbody>
              {sortedStocks.map(stock => (
                <tr 
                    key={stock.id} 
                    onDragOver={(e) => handleDragOver(e, stock.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, stock.id)}
                    className={`group border-t border-app-border ${draggedId ? '' : 'hover:bg-app-hover'} transition-colors ${dragOverId === stock.id ? 'bg-brand-yellow/10' : ''} ${hasOpenPopup(stock.id) ? 'bg-app-hover' : ''}`}
                  >
                  <td 
                    className={`px-1 py-1.5 align-middle sticky left-0 z-20 ${hasOpenPopup(stock.id) ? 'bg-app-hover' : 'bg-app-card'} ${draggedId ? '' : 'group-hover:bg-app-hover'} cursor-move touch-none border-r border-app-border transition-colors ${draggedId === stock.id ? 'opacity-50' : ''}`}
                    draggable
                    onDragStart={(e) => handleDragStart(e, stock.id)}
                    onDragEnd={handleDragEnd}
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
                    className={`px-1 py-1.5 align-middle sticky left-[36px] z-10 ${hasOpenPopup(stock.id) ? 'bg-app-hover' : 'bg-app-card'} ${draggedId ? '' : 'group-hover:bg-app-hover'} cursor-pointer border-r border-app-border transition-colors ${draggedId ? '' : 'hover:bg-app-input/50'} ${draggedId === stock.id ? 'opacity-50' : ''}`}
                    onClick={(e) => handleStockNameClick(e, stock)}
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
                            value={stock.link || ''}
                            onChange={(e) => handleUpdateField(stock.id, 'link', e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') setEditingId(null); }}
                            enterKeyHint="done"
                            placeholder="链接"
                            className="w-full bg-app-input border border-indigo-500 rounded px-0.5 py-0.5 text-[9px] leading-tight font-mono text-app-text outline-none text-center"
                          />}
                        </div>
                      ) : nameSubMode === 'tags' ? (
                        <div className="relative flex flex-col items-center justify-center">
                          <span
                            onPointerDown={() => startNameLongPress(stock)}
                            onPointerUp={stopNameLongPress}
                            onPointerLeave={stopNameLongPress}
                            onPointerCancel={stopNameLongPress}
                            onClick={guardNameLongPressClick}
                            className={`text-[11px] font-bold leading-none cursor-pointer ${stock.link ? 'hover:underline underline-offset-2' : ''} ${getDividendRateColor(getDividendRate(stock), ranges)}`}>{(() => {
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
                        <div className="relative flex items-center justify-center h-8 whitespace-nowrap">
                          <span
                            onPointerDown={() => startNameLongPress(stock)}
                            onPointerUp={stopNameLongPress}
                            onPointerLeave={stopNameLongPress}
                            onPointerCancel={stopNameLongPress}
                            onClick={guardNameLongPressClick}
                            className={`text-[11px] font-bold leading-none cursor-pointer ${stock.link ? 'hover:underline underline-offset-2' : ''} ${getDividendRateColor(getDividendRate(stock), ranges)}`}>{(() => {
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
                    onTouchStart={handleDivRateInfoTouchStart}
                    onClick={(e) => handleDivRateInfoClick(e, stock)}
                    className={`px-1 py-1.5 text-center border-r border-app-border cursor-pointer transition-colors${draggedId ? '' : ' hover:bg-app-input/50'}`}
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
                    onMouseEnter={(e) => handleMktInfoEnter(e, stock)}
                    onMouseLeave={handleMktInfoLeave}
                    onTouchStart={handleMktInfoTouchStart}
                    onClick={(e) => handleMktInfoClick(e, stock)}
                    className={`px-1 py-1.5 text-center border-r border-app-border cursor-pointer transition-colors${draggedId ? '' : ' hover:bg-app-input/50'}`}
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
                    onTouchStart={handleListSrTouchStart}
                    onClick={(e) => handleListSrClick(e, stock, true)}
                    className={`px-1 py-1.5 text-center border-r border-app-border cursor-pointer transition-colors${draggedId ? '' : ' hover:bg-app-input/50'}`}
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
                        <td key={key} className={`px-1 py-1.5 text-center cursor-pointer ${draggedId ? '' : 'hover:bg-app-input/50'} ${idx < 2 ? 'border-r border-app-border' : 'border-r border-app-border'}`}
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
                            setRatesCenterToggle(false); // 新弹窗默认显示网格模式
                            setRatesCenterHover(false);
                            setRatesPopupPos({
                              top,
                              left: Math.min(Math.max(12, rect.right + 8), window.innerWidth - popupW - 12)
                            });
                            setBollData(null);
                            setBollError(null);
                            if (!stock.bollHidden) {
                              const popupLogCtx = requestLogService.beginBatch('打开 BOLL 弹窗：1 只股票 · 1 条请求');
                              priceBureau.fetchAndAbsorb(stock.code, key, apiSource, bollAdjust, popupLogCtx).then(result => {
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
                    // 仓位占比：本股票金额 / 分红页账户总资金（dividendTotalCapital），而非已投入持仓总额
                    const myAmt = shares > 0 && cost > 0 ? shares * cost : 0;
                    const positionRatioStr = myAmt > 0 && (dividendTotalCapital || 0) > 0 ? `${((myAmt / dividendTotalCapital) * 100).toFixed(1)}%` : '';
                    // 子列1：恒常展示股息率
                    const col1 = (
                      <td
                        className="w-[56px] px-1 py-1.5 text-center border-r border-app-border cursor-pointer"
                        onMouseEnter={(e) => { if (editingId !== stock.id && hasPosition) handlePositionInfoEnter(e, stock); }}
                        onMouseLeave={handlePositionInfoLeave}
                        onTouchStart={handlePositionInfoTouchStart}
                        onClick={(e) => { if (editingId !== stock.id && hasPosition) handlePositionInfoClick(e, stock); }}
                      >
                        {hasPosition ? (
                          <div className="flex flex-col items-center leading-tight gap-px">
                            <span className="font-mono text-[11px] whitespace-nowrap text-app-rowtext">{yieldPct}</span>
                            <span className={`font-mono text-[10px] ${costColor}`}>{yieldDiffStr}</span>
                          </div>
                        ) : (
                          <span className="font-mono text-[11px] whitespace-nowrap text-app-subtext">-</span>
                        )}
                      </td>
                    );
                    // 子列2：恒常展示仓位（总金额 + 份额 + 仓位占比）
                    const colHold = (
                      <td
                        className="w-[64px] px-1 py-1.5 text-center border-r border-app-border cursor-pointer"
                        onMouseEnter={(e) => { if (editingId !== stock.id && hasPosition) handlePositionInfoEnter(e, stock); }}
                        onMouseLeave={handlePositionInfoLeave}
                        onTouchStart={handlePositionInfoTouchStart}
                        onClick={(e) => { if (editingId !== stock.id && hasPosition) handlePositionInfoClick(e, stock); }}
                      >
                        {hasPosition ? (
                          <div className="flex flex-col items-center leading-tight gap-px">
                            <span className="font-mono text-[10px] whitespace-nowrap text-app-rowtext">{totalAmount}</span>
                            <span className="font-mono text-[9px] text-app-rowtext">{sharesText}</span>
                            <span className="font-mono text-[8px] font-semibold whitespace-nowrap text-app-rowtext">{positionRatioStr || '\u00A0'}</span>
                          </div>
                        ) : (
                          <span className="font-mono text-[11px] whitespace-nowrap text-app-rowtext">-</span>
                        )}
                      </td>
                    );
                    // 子列3：固定展示成本
                    const col2 = (
                      <td
                        className="w-[56px] px-1 py-1.5 text-center border-r border-app-border cursor-pointer"
                        onMouseEnter={(e) => { if (editingId !== stock.id && hasPosition) handlePositionInfoEnter(e, stock); }}
                        onMouseLeave={handlePositionInfoLeave}
                        onTouchStart={handlePositionInfoTouchStart}
                        onClick={(e) => { if (editingId !== stock.id && hasPosition) handlePositionInfoClick(e, stock); }}
                      >
                        {showCostPct ? (
                          <div className="flex flex-col items-center leading-tight gap-px">
                            <span className="font-mono text-[11px] whitespace-nowrap text-app-rowtext">{costText}</span>
                            <span className={`font-mono text-[10px] ${costColor}`}>{positionPctStr}</span>
                          </div>
                        ) : (
                          <span className="font-mono text-[11px] whitespace-nowrap text-app-rowtext">{costText}</span>
                        )}
                      </td>
                    );
                    const col3 = (
                      <td
                        className="w-[56px] px-1 py-1.5 text-center border-r border-app-border cursor-pointer hover:bg-app-input/50 transition-colors"
                        onMouseEnter={(e) => { if (editingId !== stock.id) handleTradeSimpleEnter(e, stock); }}
                        onMouseLeave={handleTradeSimpleLeave}
                        onTouchStart={handleTradeTouchStart}
                        onClick={(e) => { if (editingId !== stock.id) handleTradeInfoClick(e, stock); }}
                      >
                        {(() => {
                          const trades = getTrades(stock);
                          const ordinary = trades.filter(t => !t.isMerged);
                          const latest = ordinary.length ? [...ordinary].sort((a, b) => b.createdAt - a.createdAt)[0] : null;
                          if (!latest) return (
                            <div className="flex flex-col items-center leading-tight gap-px">
                              <span className="font-mono text-[10px]">&nbsp;</span>
                              <span className="text-[9px] text-app-subtext">-</span>
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
                          // 「可能已成交」仅按现价对比挂单价判断：挂买现价<=挂单价、挂卖现价>=挂单价 → 可能触发
                          let likelyFill = false;
                          if (isPending && latest.price > 0 && (stock.price || 0) > 0) {
                            likelyFill = latest.side === 'buy' ? stock.price <= latest.price : stock.price >= latest.price;
                          }
                          const pctColor = diffNum != null && isSellFilled && diffNum < 0 ? 'text-brand-green'
                            : diffNum != null && isBuyFilled && diffNum > 0 ? 'text-brand-red'
                            : diffNum != null && isPending && likelyFill ? 'text-orange-400'
                            : 'text-app-rowtext';
                          return (
                            <div className="flex flex-col items-center leading-tight gap-px">
                              <span className="font-mono text-[10px] whitespace-nowrap text-app-rowtext">{formatPrice(latest.price, stock.name)}</span>
                              <span className={`text-[9px] font-bold whitespace-nowrap ${tradeStatusColor(latest)}`}>{tradeStatusLabel(latest)}</span>
                              {priceDiffPct && <span className={`font-mono text-[8px] font-semibold whitespace-nowrap ${pctColor}`}>{priceDiffPct}</span>}
                            </div>
                          );
                        })()}
                      </td>
                    );
                    return (
                      <React.Fragment key="position-cols">
                        {col1}
                        {colHold}
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
                    <td className="px-1 py-1.5 text-center border-r border-app-border w-[62px]">
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
                          onClick={() => beginRowEdit(stock)}
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

      {/* 页面底部：版本号与黄金交易切换 */}
      <div className="flex justify-center">
        <div className="w-full flex justify-end items-center gap-3" style={{ maxWidth }}>
          {appVersion && <span className="select-all hover:text-app-text text-white/[0.01] text-[10px] font-mono">{appVersion}</span>}
          {onTogglePage && (
            <button
              onClick={onTogglePage}
              className="select-all hover:text-app-text transition-colors text-white/[0.01] text-[10px] font-mono"
              title="切换到黄金交易模拟"
            >
              [黄金]
            </button>
          )}
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
          priceBureau.fetchAndAbsorb(stock.code, period, apiSource, adjust, popupLogCtx).then(result => {
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
            priceBureau.fetchAndAbsorb(stock.code, 'daily', apiSource, bollAdjust, popupLogCtx),
            priceBureau.fetchAndAbsorb(stock.code, 'weekly', apiSource, bollAdjust, popupLogCtx),
            priceBureau.fetchAndAbsorb(stock.code, 'monthly', apiSource, bollAdjust, popupLogCtx),
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
            priceBureau.fetchAndAbsorb(stock.code, 'daily', apiSource, bollAdjust, popupLogCtx),
            priceBureau.fetchAndAbsorb(stock.code, 'weekly', apiSource, bollAdjust, popupLogCtx),
            priceBureau.fetchAndAbsorb(stock.code, 'monthly', apiSource, bollAdjust, popupLogCtx),
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
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="text-[10px] text-app-subtext">
                  股息率对应股价（基于{getSelectedYear(stock)}年分红 ¥{formatPrice(getDividendForYear(stock, getSelectedYear(stock)), stock.name)}）
                </div>
                <button
                  onClick={handleRatesGridStepToggle}
                  title={`切换股息率九宫格间隔（当前 ${ratesGridStep}）`}
                  className="p-0.5 hover:bg-app-input rounded transition-colors shrink-0"
                >
                  <ArrowLeftRight size={14} className="text-app-subtext" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1 mb-3">
                {(() => {
                  const currentRate = getDividendRate(stock);
                  const dividend = getDividendForYear(stock, getSelectedYear(stock)) || 0;
                  // 以当前股息率最近的 step 网格为中心，左右各 4 格按 step 递增/递减（共 9 格）
                  const step = ratesGridStep;
                  const centerRate = Math.round(currentRate / step) * step;
                  const rates = Array.from({ length: 9 }, (_, i) => centerRate - 4 * step + i * step);
                  const rateColorClass = getDividendRateColor(centerRate, ranges);
                  // 间隔 0.25 时需保留两位小数，且去除末尾多余的 0（如 4.25 → "4.25%"，3.5 → "3.5%"）
                  const fmtRate = (v: number) => `${parseFloat(v.toFixed(2)).toString()}%`;
                  return rates.map((rateNum, idx) => {
                    const isCurrentRate = idx === 4; // 中心格
                    // 中心格展示逻辑：点击钉住后固定显示当前股息率/当前价格；未点击时悬停临时预览，移出恢复
                    const currentRateVal = getDividendRate(stock);
                    const showActual = isCurrentRate && (ratesCenterToggle || ratesCenterHover);
                    const rateLabel = fmtRate(showActual ? currentRateVal : rateNum);
                    const price = showActual
                      ? (stock.price || 0)
                      : dividend > 0 ? dividend / (rateNum / 100) : 0;
                    const cellColor = showActual ? getDividendRateColor(currentRateVal, ranges) : rateColorClass;
                    return (
                      <div
                        key={rateLabel}
                        onClick={isCurrentRate ? handleRatesCenterToggle : undefined}
                        onMouseEnter={isCurrentRate ? () => setRatesCenterHover(true) : undefined}
                        onMouseLeave={isCurrentRate ? () => setRatesCenterHover(false) : undefined}
                        className={`flex flex-col items-center p-1 rounded ${isCurrentRate ? 'cursor-pointer ' + (showActual ? 'bg-brand-softYellow/15 ring-1 ring-brand-softYellow/30' : 'bg-indigo-500/10 ring-1 ring-indigo-500/30') : 'bg-app-input'}`}
                      >
                        <span className={`font-mono text-xs font-bold ${isCurrentRate ? cellColor : 'text-app-subtext'}`}>
                          {price > 0 ? formatPrice(price, stock.name) : '-'}
                        </span>
                        <span className={`font-mono text-xs font-normal ${isCurrentRate ? cellColor : 'text-app-subtext'}`}>{rateLabel}</span>
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
                        priceBureau.fetchAndAbsorb(stock.code, 'daily', apiSource, bollAdjust, popupLogCtx),
                        priceBureau.fetchAndAbsorb(stock.code, 'weekly', apiSource, bollAdjust, popupLogCtx),
                        priceBureau.fetchAndAbsorb(stock.code, 'monthly', apiSource, bollAdjust, popupLogCtx),
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
                        priceBureau.fetchAndAbsorb(stock.code, 'daily', apiSource, bollAdjust, popupLogCtx),
                        priceBureau.fetchAndAbsorb(stock.code, 'weekly', apiSource, bollAdjust, popupLogCtx),
                        priceBureau.fetchAndAbsorb(stock.code, 'monthly', apiSource, bollAdjust, popupLogCtx),
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
                              priceBureau.fetchAndAbsorb(stock.code, 'daily', apiSource, bollAdjust, popupLogCtx),
                              priceBureau.fetchAndAbsorb(stock.code, 'weekly', apiSource, bollAdjust, popupLogCtx),
                              priceBureau.fetchAndAbsorb(stock.code, 'monthly', apiSource, bollAdjust, popupLogCtx),
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
                  klines={(() => {
                    // 直接向价格数据部索要权威K线：日线含“今日实时bar”（最新一根由数据部统一收敛成现价/收盘价），
                    // 周/月线用原始周期K线（无实时合并）。bollData 仅作尚未同步时的兜底（同为吸收自 priceBureau 的同源数据）。
                    if (bollPeriod === 'daily') {
                      return priceBureau.getTodayDailyKlines(stock.code, stock) || bollData?.klines || [];
                    }
                    const bk = bollPeriod === 'weekly'
                      ? priceBureau.getWeekly(stock.code)
                      : priceBureau.getMonthly(stock.code);
                    return bk?.klines || bollData?.klines || [];
                  })()}
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
                            <LineChart data={chartData} margin={{ top: 5, right: 10, left: 4, bottom: 0 }}>
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
        <PriceInfoPopover
          innerRef={priceInfoRef}
          name={priceInfoStock.name}
          date={(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })()}
          price={priceInfoStock.price}
          changePercent={priceInfoStock.changePercent}
          data={priceInfoData}
          loading={priceInfoLoading}
          left={priceInfoPos.left}
          top={priceInfoPos.top}
          width={210}
          onMouseEnter={() => { priceInfoHoveredRef.current = true; }}
          onMouseLeave={handlePriceInfoFloatLeave}
          footer={(() => {
            // 底栏与标签弹窗共用同一 computeAnalyzed canonical K线，杜绝"尾巴接错源"；
            // 之前这里独立走 mergeTodayBarToKlines 的实时合并数组，导致同日量能漂移(明显放量/明显缩量)。
            const a = computeAnalyzed(priceInfoStock);
            if (!a.klines || a.klines.length === 0) return undefined;
            // 环境标签：与标签弹窗"环境"区同源(same computeAnalyzed.env→selectEnvDisplayTags)、同配色(ENV_CHIP_CLS)，放在"当日信号"上方
            const envChips = a.env ? selectEnvDisplayTags(a.env.tags).map(t => ({
              key: t.key,
              label: t.label,
              cls: `${ENV_CHIP_BASE} ${ENV_CHIP_CLS[t.color].cls}`,
            })) : undefined;
            return (
              <SignalTagsFooter
                win={a.klines}
                i={a.klines.length - 1}
                cfg={tagParams}
                customTags={customTags}
                dividendByYear={priceInfoStock?.dividendByYear}
                envChips={envChips}
                onPin={() => setPriceInfoPinned(true)}
              />
            );
          })()}
        />
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
        // 挂单金额展示：消除浮点误差后，小数为 0 则不显示小数，否则保留两位
        const orderAmtClean = Math.round(orderAmount * 100) / 100;
        const orderAmountText = Number.isInteger(orderAmtClean)
          ? orderAmtClean.toLocaleString('zh-CN')
          : orderAmtClean.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const fmtP = (v: number) => formatPrice(v, s.name);
        const noteCls = "no-spinners w-full bg-app-input border border-app-border rounded-lg px-3 py-2 text-[11px] text-app-text outline-none focus:border-brand-yellow/50 focus:ring-1 focus:ring-brand-yellow/50 transition-all placeholder:text-app-subtext/40";
        // 当前持仓概要：持仓只从交易记录重算，不再兜底旧的手动成本
        const posShares = s.positionShares || 0;
        const avgCost = s.positionCost || 0;
        const marketPrice = s.price || 0;
        // 挂单预览：金额 / 距现价 / 股息率相对持仓成本的差异
        const orderPriceNum = parseFloat(addTradePrice) || 0;
        const orderDividend = getDividendForYear(s, getSelectedYear(s)) || 0;
        const priceGapValid = orderPriceNum > 0 && marketPrice > 0;
        const priceGapPct = priceGapValid ? ((orderPriceNum - marketPrice) / marketPrice) * 100 : 0;
        const orderDivRate = orderPriceNum > 0 && orderDividend > 0 ? (orderDividend / orderPriceNum) * 100 : 0;
        const costDivRate = avgCost > 0 && orderDividend > 0 ? (orderDividend / avgCost) * 100 : 0;
        const divDiffValid = orderPriceNum > 0 && costDivRate > 0;
        // 差值 = 当前股息率 − 成本股息率（百分点），如 8.17% − 7.56% ≈ +0.61%
        const divDiffPct = divDiffValid ? (orderDivRate - costDivRate) : 0;
        // 按成交顺序用移动加权成本重算每笔卖出的已实现盈亏（不依赖可能为 0 的存储 positionCost/realizedPnL）
        const recalcPnL = calcRealizedPnlMap(getTrades(s));
        const realizedPnl = recalcPnL.total;
        const totalCost = posShares * avgCost;
        const breakEven = posShares > 0 ? Math.max(0, (totalCost - realizedPnl) / posShares) : 0;
        const floatingPnl = marketPrice > 0 && posShares > 0 ? (marketPrice - avgCost) * posShares : 0;
        // 盈亏金额展示：带正负号；末位两位小数都是 0 时省略小数，否则保留两位（先消除浮点误差）
        const fmtPnl = (v: number): string => {
          const abs = Math.abs(Math.round(v * 100) / 100);
          const str = Number.isInteger(abs)
            ? abs.toLocaleString('zh-CN')
            : abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          return `${v >= 0 ? '+' : '-'}${str}`;
        };
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
            className={`fixed z-[60] bg-app-card border border-app-border shadow-[0_10px_40px_-10px_rgba(0,0,0,0.7)] rounded-xl overflow-hidden text-app-text ${tradeInfoSettled ? '' : 'pointer-events-none'}`}
            style={{ top: tradeInfoPos.top, left: tradeInfoPos.left, width: 304, opacity: tradeInfoSettled ? 1 : 0, transform: tradeInfoSettled ? 'none' : 'translate(0,0)' }}
          >
            {/* 可拖拽头部 */}
            <div
              onPointerDown={handleTradeDragStart}
              className="bg-app-bg/80 backdrop-blur-md px-3 py-2.5 flex items-center justify-between border-b border-app-border cursor-grab active:cursor-grabbing touch-none select-none group"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0 text-app-subtext">
                <GripHorizontal size={15} className="opacity-80 shrink-0" />
                {linkEditing ? (
                  <input
                    autoFocus
                    value={linkInput}
                    onChange={(e) => setLinkInput(e.target.value)}
                    onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') saveStockLink(); }}
                    onPointerDown={(e) => e.stopPropagation()}
                    placeholder="输入公告链接"
                    className="flex-1 min-w-0 mr-1 no-spinners bg-app-input border border-app-border rounded px-2 py-0.5 text-[11px] text-app-text outline-none focus:border-brand-yellow/50 focus:ring-1 focus:ring-brand-yellow/50 transition-all placeholder:text-app-subtext/40"
                  />
                ) : (
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={handleOpenStockLink}
                    className="inline-flex items-center gap-1 text-app-subtext/70 hover:text-indigo-400 transition-colors min-w-0"
                    title={s.link ? '打开公告链接' : '添加公告链接'}
                  >
                    <span className="text-[13px] font-bold tracking-wider min-w-0 truncate">{s.name}</span>
                    {s.link ? <Link size={13} className="shrink-0" /> : <SquarePen size={13} className="shrink-0" />}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1">
                {linkEditing && (
                  <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={handleTestLinkJump} className="text-app-subtext hover:text-indigo-400 transition-colors p-1 rounded shrink-0" title="用当前链接跳转">
                    <Link size={15} />
                  </button>
                )}
                {linkEditing && (
                  <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={saveStockLink} className="text-brand-green hover:opacity-80 p-1 rounded shrink-0" title="保存链接">
                    <Check size={15} />
                  </button>
                )}
                <button type="button" onClick={linkEditing ? cancelStockLink : closeTradeInfo} onPointerDown={(e) => e.stopPropagation()} className="text-app-subtext hover:text-app-text transition-colors bg-app-text/5 hover:bg-app-text/10 rounded p-1" title={linkEditing ? '取消编辑' : '关闭'}>
                  <X size={15} />
                </button>
              </div>
            </div>

            <div className="px-3 py-3 space-y-3 bg-app-card overflow-y-auto custom-scrollbar" style={{ maxHeight: tradeBodyMaxH ?? undefined }}>
              {/* 当前持仓概要 */}
              <div className="border border-app-border rounded-lg divide-y divide-app-border bg-app-input/50">
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
                      {posShares > 0 && marketPrice > 0 ? fmtPnl(floatingPnl) : '-'}
                    </span>
                  </div>
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-[9px] uppercase font-bold text-app-subtext tracking-wider">实现盈亏</span>
                    <span className={`font-mono font-bold text-[11px] ${realizedPnl !== 0 ? (realizedPnl >= 0 ? 'text-brand-red' : 'text-brand-green') : 'text-app-subtext'}`}>
                      {realizedPnl !== 0 ? fmtPnl(realizedPnl) : '-'}
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
                <InputGroup label={<span className="inline-flex items-baseline gap-1 translate-y-px">挂单价格{priceGapValid && <span className="text-app-subtext/60 font-normal">({priceGapPct > 0 ? '+' : ''}{priceGapPct.toFixed(2)}%)</span>}</span>} value={addTradePrice} onChange={setAddTradePrice} placeholder="0.00" step={(s.name?.includes('ETF') || s.name?.includes('etf')) ? 0.001 : 0.01} min={0} precision={(s.name?.includes('ETF') || s.name?.includes('etf')) ? 3 : 2} touchMode onEnter={() => editingTradeId ? handleSaveEditTrade(s.id, editingTradeId, 'pending') : handleAddTrade(s.id, 'pending')} className="text-sm" />
                {/* 数量：卖出时以当前持仓为上限（静默截断） */}
                <InputGroup
                  label={<span className="translate-y-px">数量(股)</span>}
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

              {/* 挂单预览：挂单金额 / 股息率差（距现价移到挂单价格 label 内）并列一行 */}
              <div className="grid grid-cols-2 gap-x-3 px-0.5 pt-0.5" style={{ marginTop: 2 }}>
                <div className="flex items-center justify-start gap-1">
                  <span className="text-[10px] font-medium text-app-subtext translate-y-px">股息率</span>
                  <span className="font-mono font-bold text-[10px] text-app-subtext">
                    {orderDivRate > 0 ? orderDivRate.toFixed(2) : '-'}%{divDiffValid ? ` (${divDiffPct > 0 ? '+' : ''}${divDiffPct.toFixed(2)}%)` : ''}
                  </span>
                </div>
                <div className="flex items-center justify-start gap-1">
                  <span className="text-[10px] font-medium text-app-subtext translate-y-px">挂单金额</span>
                  <span className="font-mono font-bold text-[11px] text-app-subtext">
                    ¥{orderAmountText}
                  </span>
                </div>
              </div>

              {/* 备注 */}
              <div className="flex items-center gap-2">
                <label className="text-[10px] uppercase font-bold text-app-subtext tracking-wider ml-0.5 shrink-0">备注</label>
                <input
                  type="text"
                  value={addTradeNote}
                  onChange={(e) => setAddTradeNote(e.target.value)}
                  onFocus={() => {
                    // 备注为空时，首次点击聚焦默认填入"网格{股息率}"，方便后继续编辑
                    if (!addTradeNote) {
                      const r = getDividendRate(s);
                      if (r > 0) setAddTradeNote(`网格${String(parseFloat(r.toFixed(2)))}`);
                    }
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { editingTradeId ? handleSaveEditTrade(s.id, editingTradeId, 'pending') : handleAddTrade(s.id, 'pending'); } }}
                  enterKeyHint="done"
                  placeholder={addTradeSide === 'buy' ? buyOrderPlaceholder : sellOrderPlaceholder}
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
                    <TradeRecordRow
                      key={t.id}
                      t={t}
                      stockName={s.name}
                      currentPrice={s.price}
                      pnlMap={recalcPnL.map}
                      onToggle={(x) => handleToggleTrade(s.id, x.id)}
                      onDelete={(x) => handleRemoveTrade(s.id, x.id)}
                      onEdit={(x) => startEditTrade(s, x)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 交易列简易浮窗：鼠标移入时展示最近多笔交易（交易弹窗优先，两者不同时显示） */}
      {tradeSimpleStock && tradeInfoStock == null && tradeInfoPinned === false && (() => {
        const s = stocks.find(x => x.id === tradeSimpleStock.id) || tradeSimpleStock;
        const trades = getTrades(s).filter(x => !x.isMerged).sort((a, b) => b.createdAt - a.createdAt);
        if (trades.length === 0) return null;
        return (
          <div
            ref={tradeSimpleRef}
            className="fixed z-[59] bg-app-card border border-app-border rounded-lg px-2 py-2 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.7)] text-app-text"
            style={{ top: tradeSimplePos.top, left: tradeSimplePos.left, width: 304 }} // 宽度与交易窗口一致，保证备注完整展示
            onMouseEnter={cancelTradeSimpleClose}
            onMouseLeave={scheduleTradeSimpleClose}
          >
            <div className="max-h-[212px] overflow-y-auto space-y-1 pr-0.5">
              {trades.map(t => (
                <TradeRecordRow
                  key={t.id}
                  t={t}
                  stockName={s.name}
                  currentPrice={s.price}
                  pnlMap={calcRealizedPnlMap(getTrades(s)).map}
                  onToggle={(x) => handleToggleTrade(s.id, x.id)}
                  onDelete={(x) => handleRemoveTrade(s.id, x.id)}
                  onEdit={(x) => { // 点击编辑：切换到交易窗口的编辑模式
                    startEditTrade(s, x);
                    if (tradeSimpleBtnRef.current) openTradeInfo(tradeSimpleBtnRef.current, s);
                    setTradeInfoPinned(true);
                    setTradeSimpleStock(null);
                  }}
                />
              ))}
            </div>
          </div>
        );
      })()}

      {/* 列表页行情状态浮窗（近10交易日破位分析） */}
      {mktInfoStock && (() => {
        // 与列表缩略共享同一份判定结果（computeAnalyzed），保证弹窗与列表用同一实时价基准、绝不重复判定
        const analyzed = computeAnalyzed(mktInfoStock);
        const klines = analyzed.klines;
        const events = analyzed.events;
        // const dailySignals = klines && klines.length > 0 ? analyzeDailySignals(klines, allowVol) : []; // 暂时注释，后续可能重新启用
        const env = analyzed.env;
        // const feng = klines && klines.length > 0 ? analyzeFengSignals(klines, v => formatPrice(v, mktInfoStock.name), allowVol, tagParams) : null; // 暂时注释，后续可能重新启用
        const fmtDay = (d: string) => {
          const p = d.split('-');
          return p.length === 3 ? `${parseInt(p[1], 10)}月${parseInt(p[2], 10)}日` : d;
        };
        const fmtShort = (d: string) => d.slice(5).replace('-', '/');
        const chipBase = 'inline-flex items-center justify-center rounded text-[9px] font-medium border px-1 py-px cursor-pointer transition-colors';
        // 统一价格格式化（量价均线/判定依据共用）
        const fp = (v: number) => formatPrice(v, mktInfoStock.name);
        // 每股分红（按年份）：供 dividendRate 自定义标签，按 K 线所属年份折算（与列表股息率曲线同源）
        const dividendByYear = mktInfoStock.dividendByYear;
        // 价格数据区指标（8 项基础行情 + KDJ/RSI/MACD）：与价格浮窗同源(calcIndicators)、共用 PriceIndicatorSection 渲染，
        // 复用同一套实现，绝不在此另写一套。
        const ind = klines && klines.length > 0 ? calcIndicators(klines) : null;
        // 收盘价着色：对照前一交易日，当日收盘涨红、跌绿
        const kIdx = new Map<string, number>();
        if (klines) klines.forEach((k, i) => kIdx.set(k.date, i));
        // 近10日数值列：当日涨跌幅 + 最高价(▲) + 最低价(▼)；收盘价移到下一行与标签同行靠左
        // 红绿着色统一参考"前一交易日收盘价"：最高价、最低价各自与该参考价比较（高于红、低于绿、相等灰），▲▼ 跟随各自价格颜色；涨跌幅按涨跌红绿
        const priceCol = (date: string, closeVal?: number) => {
          const i = kIdx.get(date);
          if (i == null || !klines) return null;
          const k = klines[i];
          const c = closeVal ?? k.close;
          const p = klines[i - 1]?.close;
          const pct = p != null && p > 0 ? ((c - p) / p) * 100 : null;
          const pctCls = pct != null ? (pct > 0 ? 'text-red-500' : pct < 0 ? 'text-green-500' : 'text-app-rowtext') : 'text-app-rowtext';
          const col = (v: number) => (p != null ? (v > p ? 'text-red-500' : v < p ? 'text-green-500' : 'text-app-rowtext') : 'text-app-rowtext');
          const hCls = col(k.high);
          const lCls = col(k.low);
          return (
            <React.Fragment>
              <span className={`text-[10px] font-mono font-bold shrink-0 w-[30px] text-right ${pctCls}`}>{pct != null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` : ''}</span>
              <span className="flex items-center shrink-0 ml-1">
                <span className={`text-[10px] font-mono font-bold shrink-0 w-[30px] text-right ${hCls}`}>{fp(k.high)}</span>
                <span className={`text-[10px] leading-none shrink-0 ${hCls}`}>↑</span>
              </span>
              <span className="flex items-center shrink-0">
                <span className={`text-[10px] font-mono font-bold shrink-0 w-[30px] text-right ${lCls}`}>{fp(k.low)}</span>
                <span className={`text-[10px] leading-none shrink-0 ${lCls}`}>↓</span>
              </span>
            </React.Fragment>
          );
        };
        // 默认选中：无指向时展示最新交易日行首枚标签（由权威 getDayTagSet 产出）
        const lastK = klines && klines.length > 0 ? klines[klines.length - 1] : null;
        const lastDayTags: DayTag[] = lastK ? getDayTagSet(klines!, tagParams, fp, { events: events ?? [], customTags, dividendByYear }) : [];
        const defaultSel = lastDayTags.length > 0
          ? { date: lastK!.date, kind: 'daytag' as const, tagKey: lastDayTags[0].key }
          : null;
        const selKey = mktSel ?? defaultSel;
        const isDayTagSel = (date: string, tagKey: string) => !!selKey && selKey.kind === 'daytag' && selKey.date === date && selKey.tagKey === tagKey;
        const isPatSel = (p: KlinePattern) => !!selKey && selKey.kind === 'pattern' && selKey.ptype === p.type && selKey.date === p.date;
        const isEnvSel = (t: EnvTag) => !!selKey && selKey.kind === 'env' && selKey.ekey === t.key;
        const envChipCls = ENV_CHIP_CLS;
        const envDate = klines && klines.length > 0 ? klines[klines.length - 1].date : '';
        const selEv = selKey && selKey.kind !== 'pattern' && selKey.kind !== 'env' && events ? events.find(e => e.date === selKey.date) : null;
        // 判定依据文案：普通字符串行；或 {t,cls} 定制样式的行；或 {seg} 同一行内多个不同样式的片段。
        // 每日行标签（量能/价格态/形态/破位观测）统一取 getDayTagSet 的 detail；环境标签走 env。
        const daytagForSel: DayTag | null = (() => {
          if (!klines || !selKey || selKey.kind !== 'daytag') return null;
          const pi = klines.findIndex(k => k.date === selKey.date);
          if (pi < 0) return null;
          return getDayTagSet(klines.slice(0, pi + 1), tagParams, fp, { events: events ?? [], customTags, dividendByYear }).find(t => t.key === selKey.tagKey) ?? null;
        })();
        const explainLines: (string | { t: string; cls: string } | { seg: { t: string; cls: string }[] })[] = [];
        if (selKey && selKey.kind === 'env') {
          const t = env?.tags.find(x => x.key === selKey.ekey);
          if (t) explainLines.push(...t.detail);
        } else if (daytagForSel) {
          explainLines.push(...daytagForSel.detail);
        } else if (selEv) {
          explainLines.push(...buildBreakExplainLines(selEv, 'event', fp, fmtDay, fmtShort));
        }
        return (
          <div
            ref={mktInfoRef}
            className="fixed z-[60] bg-app-card border border-slate-500/40 rounded-lg shadow-[0_8px_30px_rgba(0,0,0,0.55)] overflow-hidden"
            style={{ top: mktInfoPos.top, left: mktInfoPos.left, width: 260, scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            onTouchStart={handleMktInfoTouchStart}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setMktSelPinned(false)}
          >
            {/* 可拖拽头部（样式与交易弹窗一致） */}
            <div
              onPointerDown={handleMktDragStart}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="bg-app-bg/80 backdrop-blur-md px-3 py-2 flex items-center justify-between border-b border-app-border cursor-grab active:cursor-grabbing touch-none select-none group"
            >
              <div className="flex items-center gap-2 text-app-subtext pointer-events-none">
                <GripHorizontal size={15} className="opacity-80" />
                <h4 className="text-[12px] font-bold tracking-wider text-app-rowtext">{mktInfoStock.name} <span className="font-mono text-[9px] font-normal text-app-rowtext">{envDate}</span></h4>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={(e) => { e.stopPropagation(); if (mktInfoStock) setBacktestStock(mktInfoStock); setMktInfoPinned(true); }} onPointerDown={(e) => e.stopPropagation()} className="text-app-subtext hover:text-brand-red transition-colors bg-app-text/5 hover:bg-app-text/10 rounded p-1" title="回测">
                  <BarChart3 size={15} />
                </button>
                <button type="button" onClick={closeMktInfo} onPointerDown={(e) => e.stopPropagation()} className="text-app-subtext hover:text-app-text transition-colors bg-app-text/5 hover:bg-app-text/10 rounded p-1" title="关闭">
                  <X size={15} />
                </button>
              </div>
            </div>
            <div className="px-2.5 py-2 flex flex-col min-h-0" style={{ maxHeight: mktBodyMaxH ?? undefined }}>
            {ind && (
              <div className="mb-1.5">
                <PriceIndicatorSection name={mktInfoStock.name} price={mktInfoStock.price} data={ind} />
              </div>
            )}
            {env && selectEnvDisplayTags(env.tags).length > 0 && (
              <div className="border-t border-app-border pt-1.5 mb-2">
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-[10px] font-bold text-app-subtext shrink-0 mr-auto">环境</span>
                  {selectEnvDisplayTags(env.tags).map(t => (
                    <span
                      key={t.key}
                      className={`${chipBase} ${envChipCls[t.color].cls}${isEnvSel(t) ? envChipCls[t.color].sel : ''}`}
                      onMouseEnter={() => handleMktTagEnter({ date: envDate, kind: 'env', ekey: t.key })}
                      onClick={(e) => { e.stopPropagation(); handleMktTagClick({ date: envDate, kind: 'env', ekey: t.key }); }}
                    >{t.label}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="overflow-y-auto custom-scrollbar min-h-0 flex-1">
            {!klines || klines.length === 0 ? (
              <div className="text-[10px] text-app-rowtext py-1">暂无K线数据</div>
            ) : (() => {
              // 破位事件 + 每日信号（MACD/量价）+ 每日量能标签 按日期聚合：一天一行，行内多个标签横向平铺、放不下自动换行，按日期正序（最新在下）
              type Entry = { key: string; node: React.ReactNode };
              const byDate = new Map<string, Entry[]>();
              const addChip = (date: string, node: React.ReactNode) => {
                const arr = byDate.get(date) ?? [];
                arr.push({ key: `${date}-${arr.length}`, node });
                byDate.set(date, arr);
              };
              // 逐日 chip 权威：量能5档 + 价格态 + 形态 + 破位观测态（观察/真/假）全部由 getDayTagSet 统一产出，
              // 与价格浮窗底栏/回测同一接口，绝不在此另拼；点击/悬浮选中同一 (date, tagKey)。
              const vStart = Math.max(0, klines.length - 10);
              for (let vi = vStart; vi < klines.length; vi++) {
                const d = klines[vi].date;
                const dayTags = getDayTagSet(klines.slice(0, vi + 1), tagParams, fp, { events: events ?? [], customTags, dividendByYear });
                for (const t of dayTags) {
                  addChip(d, (
                    <span
                      className={`${chipBase} ${t.cls}${isDayTagSel(d, t.key) ? t.sel : ''}`}
                      onMouseEnter={() => handleMktTagEnter({ date: d, kind: 'daytag', tagKey: t.key })}
                      onClick={(e) => { e.stopPropagation(); handleMktTagClick({ date: d, kind: 'daytag', tagKey: t.key }); }}
                    >{t.label}</span>
                  ));
                }
              }
              // 底部企稳已拆成 量能5档 + 价格态 两个原子 chip，由 getDayTagSet 提供，无需追加独立企稳 chip
              // 最新收盘日：价格列显示缓存现价（红涨绿跌），其余日期显示当日收盘
              const latestDate = klines && klines.length ? klines[klines.length - 1].date : '';
              // 当日收盘价列（与标签同行靠左）：最新日取实时现价，其余由当日收盘展示，红绿对照前一交易日收盘
              const closeCol = (date: string) => {
                const i = kIdx.get(date);
                if (i == null || !klines) return null;
                const k = klines[i];
                const c = date === latestDate && mktInfoStock.price > 0 ? mktInfoStock.price : k.close;
                const p = klines[i - 1]?.close;
                const col = (v: number) => (p != null ? (v > p ? 'text-red-500' : v < p ? 'text-green-500' : 'text-app-rowtext') : 'text-app-rowtext');
                return <span className={`text-[10px] font-mono font-bold w-[30px] shrink-0 text-right ${col(c)}`}>{fp(c)}</span>;
              };
              const dates = [...byDate.keys()].sort().reverse();
              return dates.map(date => (
                <div key={date} className="mb-2.5 last:mb-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-app-rowtext shrink-0 whitespace-nowrap">{fmtDay(date)}</span>
                    {closeCol(date)}
                    {date === latestDate && mktInfoStock.price > 0 ? priceCol(date, mktInfoStock.price) : priceCol(date)}
                  </div>
                  <div className="flex flex-wrap gap-1 items-center justify-end min-w-0 mt-0.5">
                    {byDate.get(date)!.map(e => <React.Fragment key={e.key}>{e.node}</React.Fragment>)}
                  </div>
                </div>
              ));
            })()}
            </div>
            <div className="border-t border-app-border mt-1 pt-1.5">
              <div className="text-[10px] font-bold text-app-subtext mb-1">判定依据</div>
              {explainLines.length > 0 ? (
                <div className="text-[9px] leading-relaxed text-app-rowtext break-all">{explainLines.map((l, i) => { const s = (l || '') as string | { t: string; cls: string } | { seg: { t: string; cls: string }[] }; if (typeof s === 'string') return <div key={i}>{s}</div>; if ('seg' in s) return <div key={i}>{s.seg.map((sg, j) => <span key={j} className={sg.cls}>{sg.t}</span>)}</div>; return <div key={i} className={s.cls}>{s.t}</div>; })}</div>
              ) : (
                <div className="text-[9px] text-app-rowtext/70">悬停或点击上方标签查看判定依据</div>
              )}
            </div>
            <div className="border-t border-app-border mt-1 pt-1.5">
              <div className="text-[10px] font-bold text-app-subtext mb-1">参考价值</div>
              {selKey && selKey.kind === 'env' ? (() => {
                const t = env?.tags.find(x => x.key === selKey.ekey);
                const ref = t ? ENV_REFERENCE[t.label] : null;
                return ref ? (
                  <div className="text-[9px] leading-relaxed text-app-rowtext break-all">{ref}</div>
                ) : (
                  <div className="text-[9px] text-app-rowtext">-</div>
                );
              })() : daytagForSel ? (
                daytagForSel.reference ? (
                  <div className="text-[9px] leading-relaxed text-app-rowtext break-all">{daytagForSel.reference}</div>
                ) : (
                  <div className="text-[9px] text-app-rowtext">-</div>
                )
              ) : (
                <div className="text-[9px] text-app-rowtext">-</div>
              )}
            </div>
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
                priceBureau.fetchAndAbsorb(stock.code, 'daily', apiSource, 'qfq', popupLogCtx),
                priceBureau.fetchAndAbsorb(stock.code, 'weekly', apiSource, 'qfq', popupLogCtx),
                priceBureau.fetchAndAbsorb(stock.code, 'monthly', apiSource, 'qfq', popupLogCtx),
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
          {listSrPreviewRows && listSrPreviewRows.length > 0 ? (
            listSrPreviewRows.map((row, i) =>
              row.kind === 'plain' ? (
                <div key={i} className="whitespace-pre">{row.text}</div>
              ) : (
                <div key={i} className="whitespace-pre" style={row.color ? { color: row.color } : undefined}>
                  <span>{row.name}</span>
                  <span>{row.rest}</span>
                </div>
              )
            )
          ) : (
            listSrPreviewText
          )}
        </div>
      )}

      {/* 页面底部请求计数器 */}
      {showRequestStats && (
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-app-card border-t border-app-border px-4 py-2">
        <div onClick={toggleBottomBar} className="flex items-center justify-between gap-2 h-[29px] cursor-pointer">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={(e) => { e.stopPropagation(); setBottomBarView(v => (v === 'request' ? 'profit' : 'request')); }}
              className="flex items-center gap-2 text-xs text-app-subtext hover:text-app-text transition-colors shrink-0"
              title={bottomBarView === 'request' ? '切换到盈利统计' : '切换到请求统计'}
            >
              <BarChart3 size={14} />
              <span>{bottomBarView === 'request' ? '请求统计' : '盈利统计'}</span>
            </button>
            {bottomBarView === 'request' ? (
              <div className="flex items-center gap-3 text-[10px] whitespace-nowrap">
                <span className="text-app-subtext">总计: <span className="text-app-subtext font-medium">{requestStats.total}</span></span>
                <span className="text-green-400">成功: <span className="font-medium">{requestStats.success}</span></span>
                <span className="text-red-400">失败: <span className="font-medium">{requestStats.failed}</span></span>
                <span className="text-blue-400">缓存: <span className="font-medium">{requestStats.cached}</span></span>
                <span className="text-yellow-400">进行中: <span className="font-medium">{requestStats.pending}</span></span>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-[10px] whitespace-nowrap">
                <span className="text-app-subtext">总资金:
                  {editingCapital ? (
                    <input
                      autoFocus
                      type="number"
                      value={dividendTotalCapital || ''}
                      onChange={(e) => onDividendTotalCapitalChange?.(parseFloat(e.target.value) || 0)}
                      onBlur={() => setEditingCapital(false)}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      placeholder="0.00"
                      className="no-spinners font-mono font-medium bg-transparent border-b border-app-border outline-none w-20 text-right mx-1"
                    />
                  ) : (
                    <span
                      onClick={(e) => { e.stopPropagation(); setEditingCapital(true); }}
                      className="font-mono font-medium text-app-text cursor-pointer hover:text-indigo-400 transition-colors"
                      title="点击修改总资金"
                    >
                      {fmtCapital(accountSummary.total)}
                    </span>
                  )}
                </span>
                <span className="text-app-subtext">已投入: <span className="font-mono font-medium text-app-text">{fmtCapital(accountSummary.invested)}</span></span>
                <span className="text-app-subtext">剩余: <span className="font-mono font-medium text-app-text">{fmtCapital(accountSummary.remaining)}</span></span>
                <span className="text-app-subtext">仓位: <span className="font-mono font-medium text-app-text">{accountSummary.ratio.toFixed(1)}%</span></span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {bottomBarView === 'request' ? (<>
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
            </>) : null}
          </div>
        </div>

        {/* 日志面板（仅请求视图） */}
        {bottomBarView === 'request' && showLogPanel && (
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

        {/* 盈利明细面板（仅盈利视图） */}
        {bottomBarView === 'profit' && showProfitPanel && (
          <div className="mt-2 pt-2 border-t border-app-border max-h-[66vh] flex flex-col">
            {/* 汇总区（非滚动）：周期选择 + 汇总卡片 + 个股小计 + 逐日明细标题 */}
            <div className="shrink-0 space-y-2">
            {/* 周期快捷选择 */}
            <div className="flex items-center gap-1.5 flex-wrap text-xs py-0.5">
              <div className="flex items-center rounded-md border border-app-border bg-app-input/40 p-0.5 shrink-0">
                {PROFIT_RANGE_SEGS.map(seg => (
                  <button
                    key={seg.key}
                    type="button"
                    onClick={() => {
                      setProfitRangeMode(seg.key);
                      if (seg.key !== 'custom') setShowProfitPanel(true);
                    }}
                    className={`px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap transition-colors ${
                      profitRangeMode === seg.key ? 'bg-app-card text-app-text font-semibold shadow-sm' : 'text-app-subtext hover:text-app-text'
                    }`}
                  >
                    {seg.label}
                  </button>
                ))}
              </div>
              {/* 自定义起止（仅在选中“自定义”时显示） */}
              {profitRangeMode === 'custom' && (
              <div className="flex items-center gap-1 rounded-md border border-app-border bg-app-input/40 px-1.5 py-[3px] shrink-0">
                <input
                  type="date"
                  value={profitCustomStart}
                  onChange={e => { setProfitCustomStart(e.target.value); setProfitRangeMode('custom'); setShowProfitPanel(true); }}
                  className="w-[100px] shrink-0 bg-transparent text-[10px] text-app-text outline-none appearance-none"
                />
                <span className="text-app-subtext shrink-0">至</span>
                <input
                  type="date"
                  value={profitCustomEnd}
                  onChange={e => { setProfitCustomEnd(e.target.value); setProfitRangeMode('custom'); setShowProfitPanel(true); }}
                  className="w-[100px] shrink-0 bg-transparent text-[10px] text-app-text outline-none appearance-none"
                />
              </div>
              )}
            </div>
            {/* 汇总卡片 + 个股小计（中间） */}
            <div className="bg-app-card/70 rounded-lg px-3 py-2 flex items-center gap-x-3 gap-y-1 border border-app-border">
              <div className="shrink-0">
                <div className="text-[10px] text-app-subtext mb-1">周期已实现盈亏</div>
                <div className={`font-mono text-xl font-bold leading-none ${profitResult.total >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>
                  {fmtSignedAmount(profitResult.total)}
                </div>
              </div>
              {Object.keys(profitResult.byStock).length > 0 && (
                <div className="flex-1 flex flex-wrap gap-1.5 justify-start">
                  {Object.keys(profitResult.byStock).map(sid => {
                    const v = profitResult.byStock[sid];
                    return (
                      <span key={sid} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-app-border bg-app-input/50 text-[10px]">
                        <span className="text-app-subtext">{profitStockNames[sid] || sid}</span>
                        <span className={`font-mono font-medium ${v >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>{fmtSignedAmount(v)}</span>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 逐日明细 */}
              <div className="flex items-center gap-2 px-1 pt-1">
                <span className="text-[10px] text-app-subtext">逐日明细</span>
                <button
                  type="button"
                  onClick={toggleAllProfitDays}
                  className="text-app-subtext hover:text-app-text transition-colors p-0.5 rounded"
                  title={allProfitDaysExpanded ? '全部收起' : '全部展开'}
                >
                  {allProfitDaysExpanded ? <FoldVertical size={12} /> : <UnfoldVertical size={12} />}
                </button>
                <div className="flex-1 h-px bg-app-border"></div>
              </div>
            </div>

            {/* 逐日明细列表（仅此区域垂直滚动） */}
            <div className="grow overflow-y-auto min-h-0 mt-2 space-y-1">
              {profitResult.byDay.length === 0 ? (
                <div className="text-xs text-app-subtext text-center py-3">所选周期内无买入/卖出记录</div>
              ) : [...profitResult.byDay].reverse().map(day => {
                const expanded = expandedProfitDays.has(day.date);
                return (
                  <div key={day.date} className="bg-app-input/50 rounded overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleProfitDay(day.date)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-app-input transition-colors"
                      title={expanded ? '收起当日明细' : '展开当日明细'}
                    >
                      <ChevronDown size={12} className={`shrink-0 text-app-subtext transition-transform ${expanded ? '' : '-rotate-90'}`} />
                      <span className="text-app-subtext shrink-0 font-mono text-[11px]">{day.date}</span>
                      {day.dayRealized !== 0 && (
                        <span className={`shrink-0 font-mono text-[11px] font-bold ${day.dayRealized >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>{fmtSignedAmount(day.dayRealized)}</span>
                      )}
                      <span className="ml-auto shrink-0 whitespace-nowrap font-mono text-[11px] text-app-subtext">买 {day.buys.length} · 卖 {day.sells.length}</span>
                    </button>
                    {expanded && (
                      <div className="space-y-1 px-2 pb-2">
                        {[...day.buys, ...day.sells]
                          .sort((a, b) => b.time - a.time)
                          .map((tx, i) => {
                            const isSell = tx.pnl !== undefined;
                            return (
                              <div key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs px-2 py-1 bg-app-card/70 rounded">
                                <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${isSell ? 'bg-green-500/20 text-brand-green' : 'bg-red-500/20 text-brand-red'}`}>{isSell ? '卖出' : '买入'}</span>
                                <span className="shrink-0 text-[10px] text-app-subtext">{tx.stockName}</span>
                                <span className="shrink-0 flex items-center gap-1 font-mono text-[10px] text-app-subtext">
                                  <span>{tx.price}</span>
                                  <span>×</span>
                                  <span>{Number.isInteger(tx.shares) ? tx.shares : tx.shares.toFixed(2)}</span>
                                  <span>=</span>
                                  <span>{tx.amount.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}</span>
                                </span>
                                {isSell && tx.pnl !== 0 && (
                                  <span className={`shrink-0 font-mono text-[11px] font-bold ${(tx.pnl ?? 0) >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>{fmtSignedAmount(tx.pnl!)}</span>
                                )}
                                <span className="ml-auto shrink-0 font-mono text-[10px] text-app-subtext">{new Date(tx.time).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 全量备份导入导出（底部，非滚动） */}
            <div className="shrink-0 mt-2 pt-2 border-t border-app-border flex items-center gap-2 px-1">
              <span className="text-[11px] text-app-subtext shrink-0">交易历史全量备份</span>
              <button
                type="button"
                onClick={() => onExportFullBackup?.()}
                disabled={!onExportFullBackup}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-app-subtext hover:text-app-text border border-app-border rounded hover:border-app-text/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="导出全部股票的交易历史 + 流水账 + 设置到 JSON"
              >
                备份
              </button>
              <button
                type="button"
                onClick={() => fullBackupInputRef.current?.click()}
                disabled={!onImportFullBackup}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-app-subtext hover:text-app-text border border-app-border rounded hover:border-app-text/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="从 JSON 恢复全部交易历史 + 流水账 + 设置"
              >
                恢复
              </button>
              <input
                ref={fullBackupInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) onImportFullBackup?.(f);
                  e.target.value = '';
                }}
              />
              <span className="ml-auto shrink-0 font-mono text-[10px] text-app-subtext">{profitRangeLabel}</span>
            </div>
          </div>
        )}
      </div>
      )}
      {backtestStock && (
        <BacktestModal stock={backtestStock} onClose={() => setBacktestStock(null)} onPresetsDirty={onBacktestPresetsDirty} tagParams={tagParams} customTags={customTags} />
      )}
    </div>
  );
};
