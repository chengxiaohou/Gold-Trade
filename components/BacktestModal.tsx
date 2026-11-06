import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, GripHorizontal, Play, Pin, Tag, Eye, EyeOff, Link, PanelLeft } from 'lucide-react';
import { createChart, ColorType, CandlestickSeries, LineSeries, TickMarkType, CrosshairMode, LineStyle } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, IPriceLine, LineData, MouseEventParams, Time } from 'lightweight-charts';
import type { StockEntry, BacktestStrategy, BacktestRule, BacktestResult, BacktestTrade, BacktestStrategyPreset, TagParams, UserTagRule } from '../types';
import { priceBureau } from '../services/priceBureau';
import type { BollKline } from '../services/bollService';
import { getMarketStatus } from '../services/cacheService';
import { runBacktest, scanTagOccurrences, BACKTEST_TAG_CATALOG, BT_GROUP_LABEL } from '../services/backtestEngine';
import { ENV_TAG_CATALOG, dividendRateForDay } from '../services/tagAnalyzers';
import { calcIndicators, formatPrice, type IndicatorResult } from '../services/indicators';
import { calcTradeStats, isEtf } from '../services/realizedPnl';
import { isPendingTradeActive } from '../services/stockTradeOps';
import PriceInfoPopover from './PriceInfoPopover';
import SignalTagsFooter from './SignalTagsFooter';
import { TAG_COLOR_HEX, TAG_PALETTE } from './CloudSettingsModal';
import { InputGroup } from './InputGroup';

type ChartCandle = { time: string; open: number; high: number; low: number; close: number };
// K线周期：日/周/月（各周期均直接使用数据中心的同名周期 K 线，均为 500 根）
type KlinePeriod = 'daily' | 'weekly' | 'monthly';
const KLINE_PERIODS: Array<{ key: KlinePeriod; label: string }> = [
  { key: 'daily', label: '日' },
  { key: 'weekly', label: '周' },
  { key: 'monthly', label: '月' },
];

// 覆盖层买卖点标签规格：锚定 K 线的 time 与锚定价（卖=high/买=low），使圆点贴 K 线实体边缘外侧
type TickSpec = { id: string; time: string; anchorPrice: number; action: 'buy' | 'sell' };
// 覆盖层标签计算后的像素坐标（已在可视区内的标签）
type OverlayTick = { id: string; x: number; y: number; action: 'buy' | 'sell' };
// 预览标签：某策略标签命中的 K 线像素坐标（缩写块，置于 K 线上下；color 用标签本身主题色）
type PreviewTick = { keyOf: string; date: string; x: number; y: number; abbr: string; color: string; side: 'top' | 'bottom'; detail: string[] };
// 极值标注：可视区内最高价/最低价 K 线的价格标签（最高价=high上侧、最低价=low下侧），跟随 K 线同步移动
type ExtremeTick = { kind: 'high' | 'low'; x: number; y: number; price: number; side: 'top' | 'bottom' };

export interface BacktestModalProps {
  stock: StockEntry;
  onClose: () => void;
  onPresetsDirty?: () => void; // 策略组有增删改时调用，用于告知上层"有改动需上传"
  tagParams?: TagParams; // 标签判定参数：与弹窗同一份，保证回测与弹窗信号判定严格一致
  customTags?: UserTagRule[]; // 用户自定义动态信号标签（随云端同步）
  // 长按 K 线图快速挂单：按光标价格相对现价的位置决定方向（上方=挂卖、下方=挂买）
  onQuickTrade?: (side: 'buy' | 'sell', price: number, clientX: number, clientY: number) => void;
  // 有上层弹窗（如交易浮窗）打开时，ESC 交给上层处理，本弹窗不响应
  suspendEsc?: boolean;
  // 点击价格轴上的挂单价格标签 → 打开交易弹窗并进入该挂单的编辑状态
  onPendingTradeClick?: (tradeId: string, clientX: number, clientY: number) => void;
}

interface RuleEditorProps {
  index: number;
  value: BacktestRule;
  onChange: (patch: Partial<BacktestRule>) => void;
  onRemove: () => void;
  previewing: boolean;
  onTogglePreview: () => void;
  customTags?: UserTagRule[]; // 用户自定义动态信号标签：注入到下拉「自定义」分组，可选作买卖触发
}

interface StatProps {
  label: string;
  value: string;
  className?: string;
}

const INPUT_CLS = 'bg-app-input border border-app-border rounded-lg px-2 py-1 text-[13px] leading-tight font-mono text-app-text outline-none';

// 回测周期预设 → 自然日天数（从最后一个交易日起往前推 N 天，取该日历窗口内的交易日 K 线）
const RANGE_PRESETS: Array<{ key: BacktestStrategy['rangePreset']; label: string; days: number }> = [
  { key: 'w1', label: '近一周', days: 7 },
  { key: 'w2', label: '两周', days: 14 },
  { key: 'm1', label: '近一月', days: 30 },
  { key: 'm3', label: '近三月', days: 90 },
  { key: 'h1', label: '近半年', days: 180 },
  { key: 'y1', label: '近一年', days: 365 },
  { key: 'y2', label: '近两年', days: 730 },
  { key: 'y3', label: '近3年', days: 1095 },
  { key: 'y5', label: '近5年', days: 1825 },
  { key: 'custom', label: '自定义', days: 0 },
];

// 均线规格（按参考配色）→ K线图上叠加的均线批次
const MA_SPECS: Array<{ period: number; color: string; label: string }> = [
  { period: 5, color: '#FFFFFF', label: 'MA5' },
  { period: 10, color: '#FF33AA', label: 'MA10' },
  { period: 20, color: '#FFB340', label: 'MA20' },
  { period: 30, color: '#33AAFF', label: 'MA30' },
  { period: 60, color: '#A05030', label: 'MA60' },
  { period: 120, color: '#30BB88', label: 'MA120' },
  { period: 250, color: '#FF8899', label: 'MA250' },
];

// 布林线规格（BOLL 20,2）：上轨/中轨/下轨
const BOLL_SPECS: Array<{ key: 'upper' | 'mid' | 'lower'; color: string; label: string }> = [
  { key: 'upper', color: '#ef4444', label: '上轨' },
  { key: 'mid', color: '#3b82f6', label: 'MID' },
  { key: 'lower', color: '#10b981', label: '下轨' },
];
// 布林计算参数
const BOLL_PERIOD = 20;
const BOLL_MULT = 2;

// 覆盖层标签几何：圆角方块（无文字）+ 点划线 + 末端圆点；仅靠颜色区分买卖/信号
const TICK_SIZE = 12;        // 方块宽高
const TICK_RADIUS = 2.5;     // 方块圆角
const LINE_LEN = 15;         // 点状虚线（方块→圆点）长度
const DOT_R = TICK_SIZE / 6; // 末端圆点半径 = 标签宽度 1/3 直径 / 2
const DOT_DA = '2 3';        // 点状虚线 pattern（短点+较大间隔）
const SPACING = 6;           // 圆点距 K 线实体边缘（high/low）的固定间距，上下一致
const SELL_BG = '#4A90D9';   // 卖出标签底色（蓝）
const BUY_BG = '#ef4444';    // 买入标签底色（红）
const TICK_FG = '#ffffff';   // 方块内文字色（买卖 B/S、预览标签首字）
const TICK_ACTIVE = '#94a3b8'; // 选中态描边色（浅灰）

// 极值标记（可视区内最高/最低价 K 线的价格标注）：纯数字，挨着 K 线尖端展示（最高价数字在上、最低价数字在下）
const EXT_COLOR = '#ffffff';     // 极值数字色（统一白色）
const EXT_FONT_SZ = 9;           // 数字字号
const EXT_GAP = 3;               // 数字与 K 线尖端（high/low）的间距
const EXT_PAD = 3;               // 数字距展示区左右/上下边缘的最小留白（避免边缘数字一半出屏幕）
const EXT_CHAR_W = 6.2;          // 每字符近似宽度（9px monospace）
const extremeTextWidth = (text: string) => text.length * EXT_CHAR_W;

// 把 lightweight Time（字符串YYYY-MM-DD / BusinessDay / 时间戳）格式化为 YYYY-MM-DD
function formatChartTime(time: Time): string {
  let y: number, m: number, d: number;
  if (typeof time === 'number') {
    const dt = new Date(time * 1000);
    y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate();
  } else if (typeof time === 'object') {
    y = time.year; m = time.month; d = time.day;
  } else {
    const parts = time.split('-').map(Number);
    // 字符串可能是 YYYY-MM-DD 或 YYYY-MM-DD HH:mm
    y = parts[0]; m = parts[1]; d = parts[2];
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${y}-${pad(m)}-${pad(d)}`;
}

// ── 公告链接跳转（与交易弹窗 StockDividendPage 同源）──
const buildAmihexinUrl = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.startsWith('amihexin://')) return trimmed;
  const seqMatch = trimmed.match(/#seq=(\d+)/);
  const seq = seqMatch ? seqMatch[1] : '';
  let newUrl = trimmed.replace('/tapp/notice.html', '/tapp/app/noticebasic/index.html');
  const base = newUrl.split('#')[0].split('?')[0];
  const finalUrl = seq ? `${base}?seq=${seq}` : base;
  return `amihexin://url=${encodeURIComponent(finalUrl)}`;
};
const openScheme = (url: string): void => {
  const a = document.createElement('a');
  a.href = url;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

export function BacktestModal({ stock, onClose, onPresetsDirty, tagParams, customTags, onQuickTrade, suspendEsc, onPendingTradeClick }: BacktestModalProps) {
  // 按下 ESC 关闭回测弹窗（挂载期内只挂一次监听；onClose 用 ref 取最新，
  // 避免父级内联 onClose 触发重挂导致"按两次才关"）
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // 长按挂单回调：图表初始化 effect 只跑一次，用 ref 取最新实现，避免闭包过期
  const quickTradeRef = useRef(onQuickTrade);
  quickTradeRef.current = onQuickTrade;
  // 上层弹窗打开时暂停 ESC：保证 ESC 只关闭上层（交易浮窗），不会连带关掉回测
  const suspendEscRef = useRef(suspendEsc);
  suspendEscRef.current = suspendEsc;
  // 挂单标签点击：同样用 ref 取最新回调
  const pendingTradeClickRef = useRef(onPendingTradeClick);
  pendingTradeClickRef.current = onPendingTradeClick;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !suspendEscRef.current) onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 策略按股票持久化到 localStorage：刷新/重开页面后自动恢复上次设置
  const strategyStorageKey = `bt_strategy_${stock.code}`;
  const loadStrategy = (): BacktestStrategy => {
    try {
      const raw = localStorage.getItem(strategyStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as BacktestStrategy;
        if (parsed && Array.isArray(parsed.rules)) return parsed;
      }
    } catch { /* 忽略损坏缓存，回退默认 */ }
    return { rules: [], initialCapital: 100000 };
  };
  const [strategy, setStrategy] = useState<BacktestStrategy>(loadStrategy);
  // 策略编辑侧栏的收起状态（设备本地记忆，下次打开回测弹窗沿用）
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('backtestSidebarCollapsed') === '1'; } catch { return false; }
  });
  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('backtestSidebarCollapsed', next ? '1' : '0'); } catch { /* 忽略写入失败 */ }
      return next;
    });
  };
  // 图表高度：null = 未手动拖拽（打开时按交易记录内容量自动分配）；拖拽后取本次会话的手动高度
  const [chartHeight, setChartHeight] = useState<number | null>(null);
  const chartWrapRef = useRef<HTMLDivElement>(null);
  const splitDragRef = useRef<{ startY: number; startH: number; maxH: number; latestH: number } | null>(null);
  const handleSplitPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const wrap = chartWrapRef.current;
    if (!wrap) return;
    const startH = wrap.getBoundingClientRect().height;
    const areaH = wrap.parentElement?.getBoundingClientRect().height ?? window.innerHeight;
    splitDragRef.current = { startY: e.clientY, startH, maxH: Math.max(120, areaH - 200), latestH: startH };
    // 拖拽期间直接改 DOM 高度（不走 React 状态），避免每帧整棵弹窗重渲染导致画面滞后
    wrap.style.flex = '0 0 auto';
    wrap.style.height = `${startH}px`;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const handleSplitPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = splitDragRef.current;
    if (!drag) return;
    const next = Math.max(120, Math.min(drag.maxH, drag.startH + (e.clientY - drag.startY)));
    drag.latestH = next;
    const wrap = chartWrapRef.current;
    if (wrap) wrap.style.height = `${next}px`;
    // 同帧重排：按新高度 resize 图表并重算覆盖层标签，K 线布局实时跟随
    const chart = chartInstance.current;
    const w = chartRef.current?.clientWidth ?? 0;
    if (chart && w > 0) {
      try { chart.resize(w, next); } catch { /* 忽略 */ }
      computeTicksRef.current?.();
    }
  };
  const handleSplitPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = splitDragRef.current;
    if (!drag) return;
    splitDragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* 忽略 */ }
    // 松手后落到状态，高度值与拖拽末帧一致，无跳动
    setChartHeight(drag.latestH);
  };

  const initialCapital = strategy.initialCapital;
  const rules = strategy.rules; // 供渲染遍历（受控）
  // 策略或初始资金变化时自动保存
  useEffect(() => {
    try { localStorage.setItem(strategyStorageKey, JSON.stringify(strategy)); } catch { /* 忽略写入失败 */ }
  }, [strategy, strategyStorageKey]);
  const [rawKlines, setRawKlines] = useState<BollKline[] | null>(null); // 已并入实时今日K线、回测信号需含 volume 的全量 K 线
  // 十字线悬浮行情面板（复用列表页"当日行情"浮窗）
  const [hoverQuote, setHoverQuote] = useState<{ name: string; price: number; changePercent: number | null; data: IndicatorResult; left: number; top: number; win: BollKline[]; idx: number } | null>(null);
  // 固定态：把某一天的弹窗"钉"住，不再随鼠标跨天切换，方便点击弹窗内标签。
  // read 走 ref（在 echarts 回调里读最新值），写走 state（驱动重渲）。cancel 时同时清 hoverQuote 隐藏弹窗。
  const [pinnedQuote, setPinnedQuote] = useState<{ name: string; price: number; changePercent: number | null; data: IndicatorResult; left: number; top: number; win: BollKline[]; idx: number } | null>(null);
  const pinnedRef = useRef<{ name: string; price: number; changePercent: number | null; data: IndicatorResult; left: number; top: number; win: BollKline[]; idx: number } | null>(null);
  const displayQuote = pinnedQuote ?? hoverQuote;
  // —— 浮窗相对鼠标的方位（方向键切换，设备本地记忆）——
  // bottom=光标正下方（默认）/ top=上方 / left=左侧 / right=右侧
  type PopoverSide = 'bottom' | 'top' | 'left' | 'right';
  const POPOVER_W = 210;
  const POPOVER_H_FALLBACK = 240; // 首帧浮窗尚未挂载时的估算高度
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverSide, setPopoverSide] = useState<PopoverSide>(() => {
    try {
      const v = localStorage.getItem('bt_popover_side');
      return v === 'top' || v === 'left' || v === 'right' ? v : 'bottom';
    } catch { return 'bottom'; }
  });
  // 图表回调/键盘监听闭包里读 ref 取最新方位，避免依赖 React 重渲染
  const popoverSideRef = useRef<PopoverSide>(popoverSide);
  useEffect(() => { popoverSideRef.current = popoverSide; }, [popoverSide]);
  // 最近一次十字线所在的视口坐标（切换方位时据此就地重排，无需等鼠标再动）
  const lastHoverPointRef = useRef<{ x: number; y: number } | null>(null);
  // 按当前方位计算浮窗左上角（px/py 为光标视口坐标）；只读 ref，可在图表回调里安全调用
  const POPOVER_GAP = 24; // 浮窗与光标的间距（越大越离手，避免遮挡十字线附近）
  const computePopoverPos = (px: number, py: number) => {
    const popH = popoverRef.current?.getBoundingClientRect().height || POPOVER_H_FALLBACK;
    const side = popoverSideRef.current;
    let left: number;
    let top: number;
    if (side === 'top') {
      left = px - POPOVER_W / 2; top = py - POPOVER_GAP - popH;
      if (top < 8) top = py + POPOVER_GAP; // 上方空间不足 → 落到下方
    } else if (side === 'left') {
      left = px - POPOVER_GAP - POPOVER_W;
      if (left < 8) left = px + POPOVER_GAP; // 左侧空间不足 → 改放右侧（避免贴边夹取后压住光标造成闪烁）
      top = py - popH / 2;
    } else if (side === 'right') {
      left = px + POPOVER_GAP;
      if (left + POPOVER_W > window.innerWidth - 8) left = px - POPOVER_GAP - POPOVER_W; // 右侧不足 → 改放左侧
      top = py - popH / 2;
    } else {
      left = px - POPOVER_W / 2; top = py + POPOVER_GAP;
      if (top + popH > window.innerHeight - 8) top = py - POPOVER_GAP - popH; // 下方空间不足 → 翻到上方
    }
    // 视口内收拢，避免越界
    left = Math.max(8, Math.min(left, window.innerWidth - 8 - POPOVER_W));
    top = Math.max(8, Math.min(top, window.innerHeight - 8 - popH));
    return { left, top };
  };
  // 方向键调整浮窗相对鼠标的方位（不影响侧栏输入框等可编辑控件）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const side: PopoverSide | null = e.key === 'ArrowUp' ? 'top'
        : e.key === 'ArrowDown' ? 'bottom'
        : e.key === 'ArrowLeft' ? 'left'
        : e.key === 'ArrowRight' ? 'right'
        : null;
      if (!side || side === popoverSideRef.current) return;
      e.preventDefault();
      popoverSideRef.current = side;
      setPopoverSide(side);
      try { localStorage.setItem('bt_popover_side', side); } catch { /* 忽略写入失败 */ }
      // 立即按新方位重排当前浮窗；固定态也跟随方位调整（锚点仍是最近的光标位置）
      const pt = lastHoverPointRef.current;
      if (!pt) return;
      const pos = computePopoverPos(pt.x, pt.y);
      if (pinnedRef.current) {
        const next = { ...pinnedRef.current, ...pos };
        pinnedRef.current = next;
        setPinnedQuote(next);
      } else {
        setHoverQuote(prev => (prev ? { ...prev, ...pos } : prev));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  const togglePin = () => {
    if (pinnedRef.current) {
      pinnedRef.current = null;
      setPinnedQuote(null);
      setHoverQuote(null); // 取消固定后隐藏弹窗（否者停留在旧位置，鼠标需重移到图上才恢复跟随）
      // 主动取消固定 = 不再记忆位置，下次打开不再自动钉住
      if (pinPosSaveTimerRef.current) window.clearTimeout(pinPosSaveTimerRef.current);
      try { localStorage.removeItem('bt_pinned_pos'); } catch { /* 忽略 */ }
    } else if (hoverQuote) {
      pinnedRef.current = hoverQuote;
      setPinnedQuote(hoverQuote);
    }
  };
  // 固定态支持拖拽标题栏移动浮窗：位置同时写回 ref 与 state，
  // 后续十字线驱动的内容刷新沿用拖动后的坐标
  const movePinned = (patch: { left?: number; top?: number }) => {
    const cur = pinnedRef.current;
    if (!cur) return;
    const next = { ...cur, ...patch };
    pinnedRef.current = next;
    setPinnedQuote(next);
  };
  // 固定态拖拽标题栏：直接用 pointer capture 在标题栏元素上接管指针（不依赖 window 监听，
  // 拖动过程中指针始终归属标题栏，浮窗不会跟丢）
  const onPinnedTitleDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = popoverRef.current;
    if (!el || !pinnedRef.current || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = el.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;
    const target = e.currentTarget;
    try { target.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
    const onMove = (ev: PointerEvent) => {
      if (!pinnedRef.current) return;
      movePinned({ left: ev.clientX - offX, top: ev.clientY - offY });
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      try { target.releasePointerCapture(e.pointerId); } catch { /* 忽略 */ }
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };
  // —— 固定位置的记忆与恢复 ——
  // 关闭回测后再次打开，浮窗仍固定在上次的位置（内容取最新一根日K，鼠标悬停后照常实时更新）
  const PIN_POS_KEY = 'bt_pinned_pos';
  const pinRestoredRef = useRef(false);
  const pinPosSaveTimerRef = useRef<number | null>(null);
  // 关闭弹窗时立即落盘（避免 300ms 防抖窗口内关闭导致最后位置丢失）
  useEffect(() => () => {
    if (pinPosSaveTimerRef.current) window.clearTimeout(pinPosSaveTimerRef.current);
    const p = pinnedRef.current;
    if (!p) return;
    try { localStorage.setItem(PIN_POS_KEY, JSON.stringify({ left: Math.round(p.left), top: Math.round(p.top) })); } catch { /* 忽略 */ }
  }, []);
  // 位置变化频繁（拖动/十字线跟随时内容刷新），延迟落盘避免每帧写 localStorage
  useEffect(() => {
    if (!pinnedQuote) return;
    const left = Math.round(pinnedQuote.left);
    const top = Math.round(pinnedQuote.top);
    if (pinPosSaveTimerRef.current) window.clearTimeout(pinPosSaveTimerRef.current);
    pinPosSaveTimerRef.current = window.setTimeout(() => {
      try { localStorage.setItem(PIN_POS_KEY, JSON.stringify({ left, top })); } catch { /* 忽略写入失败 */ }
    }, 300);
  }, [pinnedQuote]);
  useEffect(() => {
    if (pinRestoredRef.current || pinnedRef.current) return;
    const data = rawKlines;
    if (!data || data.length < 2) return;
    let pos: { left: number; top: number } | null = null;
    try {
      const raw = localStorage.getItem(PIN_POS_KEY);
      if (raw) pos = JSON.parse(raw) as { left: number; top: number };
    } catch { /* 忽略损坏缓存 */ }
    pinRestoredRef.current = true;
    if (!pos || !Number.isFinite(pos.left) || !Number.isFinite(pos.top)) return;
    // 视口变化（窗口/弹窗尺寸）后旧坐标可能出界，恢复时拉回可视区
    const left = Math.max(8, Math.min(window.innerWidth - POPOVER_W - 8, pos.left));
    const top = Math.max(8, Math.min(window.innerHeight - 80, pos.top));
    const idx = data.length - 1;
    const prefix = data.slice(0, idx + 1);
    const ind = calcIndicators(prefix);
    if (!ind) return;
    const prevClose = data[idx - 1].close;
    const changePercent = prevClose > 0 ? ((data[idx].close - prevClose) / prevClose) * 100 : null;
    const q = { name: stock.name, price: data[idx].close, changePercent, data: ind, left, top, win: prefix, idx };
    pinnedRef.current = q;
    setPinnedQuote(q);
    setHoverQuote(q);
  }, [rawKlines, stock.name]);

  const rawKlinesRef = useRef<BollKline[] | null>(null);
  const tagParamsRef = useRef<TagParams | undefined>(tagParams);
  useEffect(() => { rawKlinesRef.current = rawKlines; }, [rawKlines]);
  useEffect(() => { tagParamsRef.current = tagParams; }, [tagParams]);
  // <年份,每股派息>：供 dividendRate 自定义标签，按 K 线所属年份折算（与列表股息率曲线同源）
  const dividendByYear = stock?.dividendByYear;
  const [result, setResult] = useState<BacktestResult | null>(null);    // 回测结果（买卖点+成交+统计）
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  // 交易记录按日期排序：'desc'=最新在最上（默认）；'asc'=最旧在最上；null=不排序（保持上游原始顺序）
  const [tradeSortDir, setTradeSortDir] = useState<'desc' | 'asc'>('desc');
  // —— 策略组合模板（全局，仅规则列表，localStorage 持久化 + 云端独立字段同步）——
  const PRESET_STORAGE_KEY = 'bt_strategy_presets';
  const loadPresets = (): BacktestStrategyPreset[] => {
    try {
      const raw = localStorage.getItem(PRESET_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as BacktestStrategyPreset[];
        if (Array.isArray(parsed)) return parsed.filter(p => p && p.id && p.name);
      }
    } catch { /* 忽略损坏缓存 */ }
    return [];
  };
  const [presets, setPresets] = useState<BacktestStrategyPreset[]>(loadPresets);
  // 当前选中的策略组：null=未选中（编辑空白/新建组）
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  // 命名气泡：'new'=新建组，某 preset.id=更新该组；null=关闭
  const [namingTarget, setNamingTarget] = useState<string | null>(null);
  const [namingText, setNamingText] = useState('');
  // 命名气泡来源：true=重命名（只改名，不刷新规则），false=保存（刷新规则快照）
  const renamingRef = useRef(false);
  // 保存/删除/加载组合时同步 localStorage
  const persistPresets = (list: BacktestStrategyPreset[]) => {
    setPresets(list);
    try { localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(list)); } catch { /* 忽略 */ }
    onPresetsDirty?.();
  };
  const selectedPreset = presets.find(p => p.id === selectedPresetId) ?? null;
  // 规则深比较：判断当前 rules 与选中组是否一致（未选中时仅当存在规则才可保存）
  const rulesEqual = (a: BacktestRule[], b: BacktestRule[]) =>
    a.length === b.length && a.every((r, i) =>
      b[i] && r.id === b[i].id && r.tagKey === b[i].tagKey && r.action === b[i].action && r.pct === b[i].pct && r.enabled === b[i].enabled
      && (r.envCondition?.key ?? '') === (b[i].envCondition?.key ?? ''));
  const presetDirty = selectedPreset ? !rulesEqual(selectedPreset.rules, strategy.rules) : strategy.rules.length > 0;
  // 点击保存：打开命名气泡（新建组预填空名，更新组预填原名）
  const openNaming = () => {
    if (strategy.rules.length === 0) return;
    renamingRef.current = false;
    setNamingText(selectedPreset ? selectedPreset.name : '');
    setNamingTarget(selectedPreset ? selectedPreset.id : 'new');
  };
  const confirmSave = () => {
    const name = namingText.trim();
    if (!name || !namingTarget) return;
    const now = Date.now();
    const renaming = renamingRef.current;
    let list: BacktestStrategyPreset[];
    if (namingTarget === 'new') {
      if (strategy.rules.length === 0) return;
      // 新建：名字重复时阻止（避免误覆盖）
      if (presets.some(p => p.name === name)) { alert(`已存在同名组合「${name}」，请换个名字或先选中它修改`); return; }
      const snap = strategy.rules.map(r => ({ ...r }));
      const np: BacktestStrategyPreset = { id: `btp${now}${Math.floor(Math.random() * 1000)}`, name, rules: snap, createdAt: now, updatedAt: now };
      list = [...presets, np];
      setSelectedPresetId(np.id);
    } else {
      if (renaming) {
        // 仅重命名：改名并更新时间，不刷新规则
        list = presets.map(p => p.id === namingTarget ? { ...p, name, updatedAt: now } : p);
      } else {
        if (strategy.rules.length === 0) return;
        // 更新选中组：改名 + 刷新规则快照
        const snap = strategy.rules.map(r => ({ ...r }));
        list = presets.map(p => p.id === namingTarget ? { ...p, name, rules: snap, updatedAt: now } : p);
      }
      setSelectedPresetId(namingTarget);
    }
    persistPresets(list);
    renamingRef.current = false;
    setNamingTarget(null);
    setNamingText('');
  };
  const cancelNaming = () => { renamingRef.current = false; setNamingTarget(null); setNamingText(''); };
  // 重命名选中组合：打开命名气泡并预填原名
  const startRename = () => {
    if (!selectedPreset) return;
    renamingRef.current = true;
    setNamingText(selectedPreset.name);
    setNamingTarget(selectedPreset.id);
  };
  const deletePreset = (id: string) => {
    if (!confirm('确定删除该策略组？')) return;
    if (selectedPresetId === id) setSelectedPresetId(null);
    persistPresets(presets.filter(p => p.id !== id));
  };
  // 点击标签：选中该组，把其规则应用到当前编辑
  const applyPreset = (p: BacktestStrategyPreset) => {
    setSelectedPresetId(p.id);
    setStrategy(prev => ({ ...prev, rules: p.rules.map(r => ({ ...r })) }));
  };
  // 新建空白：取消选中并清空当前编辑（仅当存在未保存的修改时才提示）
  const startBlankPreset = () => {
    if (presetDirty && !confirm('当前编辑有未保存的规则，开始新建会清空，继续？')) return;
    setSelectedPresetId(null);
    setStrategy(prev => ({ ...prev, rules: [] }));
  };
  // 覆盖层买卖点标签的像素坐标（随缩放/平移重算）
  const [overlayTicks, setOverlayTicks] = useState<OverlayTick[]>([]);
  // 预览：当前预览的策略标签 key 数组（最多 2 个）；预览态隐藏 B/S 买卖标签，只显缩写块
  const [previewKeys, setPreviewKeys] = useState<string[]>([]);
  // 预览标签的像素坐标
  const [previewTicks, setPreviewTicks] = useState<PreviewTick[]>([]);
  // 极值标注（可视区内最高/最低价K线价格）的像素坐标，随平移/缩放重算，复用覆盖层随K线同步移动逻辑
  const [extremeTicks, setExtremeTicks] = useState<ExtremeTick[]>([]);
  // 有效挂单：挂单价格 → 右侧价格轴的像素位置，用于叠加可点击热区（点击进入该挂单的编辑）
  const [activePending, setActivePending] = useState<{ id: string; price: number; side: 'buy' | 'sell' }[]>([]);
  const [pendingAxisTicks, setPendingAxisTicks] = useState<{ id: string; y: number }[]>([]);
  // 预览标签判定依据浮窗（hover/点击预览标签时显示）
  const [previewPopup, setPreviewPopup] = useState<{ keyOf: string; date: string; x: number; y: number; detail: string[] } | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ReturnType<IChartApi['addSeries']> | null>(null);
  // 缓存最新 computeTickPositions，供图表内部事件/ResizeObserver 回调调用，避免闭包陈旧
  const computeTicksRef = useRef<(() => void) | null>(null);
  const maSeriesRef = useRef<ISeriesApi<'Line'>[] | null>(null);
  const bollSeriesRef = useRef<ISeriesApi<'Line'>[] | null>(null);
  // 缓存最新图表K线，供覆盖层极值标注（最高/最低价）随平移/缩放重算时读取
  const klinesRef = useRef<ChartCandle[] | null>(null);
  // K线周期切换（设备本地记忆）：日K取日线（含实时今日K线），周/月K取数据中心的同名周期数据
  const [klinePeriod, setKlinePeriod] = useState<KlinePeriod>(() => {
    try { const v = localStorage.getItem('bt_kline_period'); return v === 'weekly' || v === 'monthly' ? v : 'daily'; } catch { return 'daily'; }
  });
  useEffect(() => { try { localStorage.setItem('bt_kline_period', klinePeriod); } catch { /* ignore */ } }, [klinePeriod]);
  // 周/月K直接取自数据中心的同名周期数据（各 500 根），不再由日K聚合，避免历史长度被日线根数截断
  const [periodKlines, setPeriodKlines] = useState<ChartCandle[] | null>(null);
  useEffect(() => { setPeriodKlines(null); }, [stock.code]);
  const klines = useMemo<ChartCandle[] | null>(() => {
    if (klinePeriod !== 'daily') return periodKlines;
    if (!rawKlines?.length) return null;
    return [...rawKlines]
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .map(k => ({ time: k.date, open: k.open, high: k.high, low: k.low, close: k.close }));
  }, [rawKlines, klinePeriod, periodKlines]);
  useEffect(() => { klinesRef.current = klines; }, [klines]);
  // 初始真实成交记录：用父级 StockEntry.stockTrades（已成交、未软删）映射，作为"一打开就可见"的 B/S 标签和交易表。
  // 运行回测后 result 存在 → 自动优先用 result.trades，initialTrades 被覆盖。
  const initialTrades = useMemo(() => {
    const trades = stock?.stockTrades ?? [];
    if (trades.length === 0) return [] as { id: string; date: string; action: 'buy' | 'sell'; price: number; shares: number; amount: number; triggerLabel: string }[];
    const first = klines?.[0]?.time;
    if (!first) return [] as { id: string; date: string; action: 'buy' | 'sell'; price: number; shares: number; amount: number; triggerLabel: string }[];
    return trades
      .filter(t => t.status === 'filled' && !t.isDeleted)
      .map(t => {
        const ts = t.filledAt ?? t.createdAt ?? 0;
        const d = new Date(ts);
        const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return {
          id: t.id,
          date,
          action: t.side,
          price: t.price,
          shares: t.shares,
          amount: t.price * t.shares,
          triggerLabel: t.note || '',
        };
      })
      // 只保留不早于图表最早那根K线的成交（周/月K下由 demoMarkers 映射到所属周期；晚于末根的归到末根）
      .filter(t => t.date >= first);
  }, [stock?.stockTrades, klines]);
  // 初始真实统计：一打开就展示两套盈亏口径（均价 vs 做T），与列表页盈利统计同源。
  // 胜率/最大回撤属回测引擎特有概念，真实交易留 null → UI 显示 "—"。
  const initialStats = useMemo(() => {
    const trades = stock?.stockTrades ?? [];
    const filledCount = trades.filter(t => t.status === 'filled' && !t.isDeleted).length;
    if (filledCount === 0) return null;
    const s = calcTradeStats(trades, stock?.price ?? 0);
    return {
      buyAmt: s.buyAmt,
      finalValue: s.finalValue,
      totalReturnPct: s.totalReturnPct,
      tradeCount: s.tradeCount,
      winRate: null as number | null,
      maxDrawdownPct: null as number | null,
      realizedAvg: s.realizedAvg,
      unrealizedAvg: s.unrealizedAvg,
      realizedDt: s.realizedDt,
      unrealizedDt: s.unrealizedDt,
    };
  }, [stock?.stockTrades, stock?.price]);

  // 打开时按交易记录内容量自动分配高度：列表刚好能完整展示，且不超过可用高度的 50%
  // （本次会话手动拖拽过则改用手动高度）
  const statsBarRef = useRef<HTMLDivElement | null>(null);
  const tradeTableRef = useRef<HTMLTableElement | null>(null);
  const [autoChartHeight, setAutoChartHeight] = useState<number | null>(null);
  useEffect(() => {
    const wrap = chartWrapRef.current;
    const col = wrap?.parentElement as HTMLElement | null;
    if (!wrap || !col) return;
    let raf = 0;
    const compute = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // 上方指标条等固定兄弟元素占用的高度需扣除，剩下的才是图表 + 统计条 + 表格的可用空间
        const indicatorH = (wrap.previousElementSibling as HTMLElement | null)?.getBoundingClientRect().height ?? 0;
        const availH = col.getBoundingClientRect().height - indicatorH;
        const statsH = statsBarRef.current?.getBoundingClientRect().height ?? 0;
        const tableH = tradeTableRef.current?.scrollHeight ?? 0;
        if (availH <= 0 || tableH <= 0) return;
        // 列表高度 = 统计条 + 全部记录，但不允许超过可用高度的一半
        const listH = Math.min(statsH + tableH, availH * 0.5);
        setAutoChartHeight(Math.max(120, Math.round(availH - listH)));
      });
    };
    compute();
    // 弹窗/窗口尺寸变化时重新分配，保证列表始终不超过一半
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(compute) : null;
    ro?.observe(col);
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); };
  }, [result, initialStats]);
  const effectiveChartHeight = chartHeight ?? autoChartHeight;
  const [chartLoading, setChartLoading] = useState(true);
  const [chartError, setChartError] = useState<string | null>(null);
  // 图表指标模式：均线(默认) / 布林线
  const [indicatorMode, setIndicatorMode] = useState<'ma' | 'boll'>(() => {
    try {
      const v = localStorage.getItem('bt_indicator_mode');
      return v === 'boll' ? 'boll' : 'ma';
    } catch { return 'ma'; }
  });
  useEffect(() => {
    try { localStorage.setItem('bt_indicator_mode', indicatorMode); } catch { /* ignore */ }
  }, [indicatorMode]);
  // 各指标体系当前最新值：ma={5:x,...} boll={upper,mid,lower}
  const [latestInd, setLatestInd] = useState<{ ma: number[]; boll: { upper: number; mid: number; lower: number } | null }>({ ma: [], boll: null });

  // K线图初始化（占位数据，纯UI骨架；resize 后自动按容器实际尺寸重绘）
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    if (chartInstance.current) { chartInstance.current.remove(); chartInstance.current = null; }
    const chart = createChart(el, {
      autoSize: true,   // 自动跟随容器尺寸，避免 flex 布局下高度塌陷
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94a3b8',
        fontFamily: 'monospace',
      },
      localization: {
        // 十字光标悬浮时的时间标签 → 年-月-日
        timeFormatter: (time: Time) => formatChartTime(time),
        // Y 轴标尺 + 十字线价格标签的小数位：与列表页同一规则（ETF 3 位，其余 2 位）
        priceFormatter: (price: number) => price.toFixed(isEtf(stock.name) ? 3 : 2),
      },
      grid: {
        vertLines: { color: 'rgba(148,163,184,0.15)' },
        horzLines: { color: 'rgba(148,163,184,0.15)' },
      },
      timeScale: {
        borderColor: 'rgba(148,163,184,0.2)',
        rightOffset: 0,
        barSpacing: 6,
        fixLeftEdge: true,   // 滑到最左时固定边缘，不露出空白
        fixRightEdge: true,  // 滑到最右时固定边缘，不露出空白
        // x轴刻度标签：按刻度类型分级显示（年/年-月/月-日），避免拥挤
        tickMarkFormatter: (time: Time, type: TickMarkType) => {
          if (type === TickMarkType.Year) return formatChartTime(time).slice(0, 4);
          if (type === TickMarkType.Month) return formatChartTime(time).slice(0, 7);
          return formatChartTime(time).slice(5);
        },
      },
      rightPriceScale: { borderColor: 'rgba(148,163,184,0.2)' },
      crosshair: {
        // Normal：十字光标完全跟随鼠标像素，不再吸附到 K 线的开/高/低/收
        mode: CrosshairMode.Normal,
        // 十字光标 x/y 轴游走标签：底色跟挂单标签统一用深色，避免 slate-500 过亮
        vertLine: { color: 'rgba(148,163,184,0.4)', labelBackgroundColor: '#1e293b' },
        horzLine: { color: 'rgba(148,163,184,0.4)', labelBackgroundColor: '#1e293b' },
      },
    });
    chartInstance.current = chart;
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#ef4444',
      downColor: '#10b981',
      wickUpColor: '#ef4444',
      wickDownColor: '#10b981',
      borderUpColor: '#ef4444',
      borderDownColor: '#10b981',
      priceLineVisible: false,  // 不需要实时当前价虚线
      lastValueVisible: false,  // 关闭右侧标尺的最新收盘价标签（铺满标尺，观感不佳）
    });
    seriesRef.current = series;
    // 叠加均线（MA5/10/20/30/60/120/250），按 MA_SPECS 配色
    const maSeries = MA_SPECS.map(spec => chart.addSeries(LineSeries, {
      color: spec.color,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      // 指标线不参与Y轴自动缩放，Y轴标尺只由K线的最高/最低价决定，
      // 避免切换均线/布林线时整图上下位移
      autoscaleInfoProvider: () => null,
    }));
    maSeriesRef.current = maSeries;
    maSeries.forEach(s => s.setData([]));
    // 布林线三条带（上/中/下），默认隐藏，切到布林模式时显示
    const bollSeries = BOLL_SPECS.map(spec => chart.addSeries(LineSeries, {
      color: spec.color,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      visible: false,
      autoscaleInfoProvider: () => null,
    }));
    bollSeriesRef.current = bollSeries;
    bollSeries.forEach(s => s.setData([]));
    // 初始不 set(占位) 数据也不 fitContent，避免"先整段再缩回120日"的跳变；
    // 真实数据到达后由下方 effect 直接定位为 120 日。
    series.setData([]);

    // —— 统一开放原生手势 ——
    // 平移：handleScroll.mouseWheel —— 纯滚轮/触控板双指 = 原生横向平移；
    // 缩放：handleScale.{mouseWheel,pinch} —— Ctrl/⌘+滚轮 或 触控板捏合 = 原生缩放(指针/中心锚)。
    // ⚠️ lightweight 只要开启 mouseWheel 缩放，就会把"任意滚轮事件"都当缩放(不看 ctrl)，
    //    纯滚轮/双指平移会同时缩放、且无处平移。故必须在事件前置阶段按 ctrlKey(捏合/⌘滚轮) 动态开关
    //    mouseWheel：捏合→开缩放，纯双指/纯滚轮→开平移。仅切配置，不拦截、不做自定义缩放数学。
    chart.applyOptions({
      handleScroll: { mouseWheel: true, pressedMouseMove: false, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: false, axisDoubleClickReset: false, mouseWheel: false, pinch: true },
    });
    el.style.touchAction = 'none';
    // 记录上一次 mouseWheel 缩放开关，避免每帧重复 applyOptions
    const lastScaleState = { mouseWheel: false };
    const setScale = (on: boolean) => {
      if (on !== lastScaleState.mouseWheel) {
        lastScaleState.mouseWheel = on;
        chart.applyOptions({ handleScale: { mouseWheel: on, pinch: true } });
      }
    };
    // 纯纵向滚轮 → 横向平移：lightweight 原生平移只认 deltaX(横向滚轮)、对 deltaY 只缩放；
    // 故关掉原生缩放后用 deltaY 自行水平平移，避免"纯滚轮无反应"。
    const panByWheel = (px: number) => {
      const ts = chart.timeScale();
      const r = ts.getVisibleLogicalRange();
      if (!r) return;
      const span = r.to - r.from;
      const width = ts.width();
      if (!width || width <= 0 || span <= 0 || px === 0) return;
      const logical = px * (span / width); // 像素 → 逻辑单位（缩放越大每逻辑单位像素越多）
      let from = r.from + logical;
      let to = r.to + logical;
      if (from < 0) { const shift = -from; from = 0; to += shift; } // 左缘钳制
      ts.setVisibleLogicalRange({ from, to });
    };
    // Shift + 滚轮 → 以光标为锚点手动缩放（同时拦下 lightweight 原生的横向平移，避免边缩放边平移）
    const zoomByWheel = (e: WheelEvent) => {
      const ts = chart.timeScale();
      const r = ts.getVisibleLogicalRange();
      const width = el.clientWidth;
      if (!r || width <= 0) return;
      const span = r.to - r.from;
      if (span <= 0) return;
      // 部分平台 Shift+滚轮只给 deltaX，故纵向优先、横向兜底
      const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
      if (delta === 0) return;
      const px = Math.max(0, Math.min(width, e.clientX - el.getBoundingClientRect().left));
      const factor = Math.exp(delta * 0.0015); // 向下滚=缩小(视野变宽)，向上滚=放大
      const maxSpan = Math.max(10, (rawKlinesRef.current?.length ?? 0) + 10);
      const nextSpan = Math.min(maxSpan, Math.max(10, span * factor));
      const anchor = r.from + (px / width) * span; // 光标处的逻辑坐标保持不动
      let from = anchor - (px / width) * nextSpan;
      if (from < 0) from = 0;
      ts.setVisibleLogicalRange({ from, to: from + nextSpan });
    };
    // 前置capture阶段接管 wheel：捏合(ctrlKey)/⌘+滚轮 → 原生缩放；Shift+滚轮 → 手动缩放；其余 → 平移
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); // 图表接管滚轮，阻止页面随之滚动/缩放
      if (e.ctrlKey || e.metaKey) {
        setScale(true); // 交给 lightweight 原生在光标处缩放
      } else if (e.shiftKey) {
        e.stopPropagation(); // 不让 lightweight 原生滚轮横向平移同时生效
        setScale(false);
        zoomByWheel(e);
      } else {
        setScale(false);
        panByWheel(e.deltaY); // deltaX 由 handleScroll 原生平移，这里只补纵向 deltaY（取正号以反转滚动方向）
      }
    };
    el.addEventListener('wheel', onWheel, { capture: true, passive: false });

    // —— 长按快速挂单 ——
    // 在 K 线图上按住 500ms 不动：取光标所指价格为挂单价格，高于现价=挂卖、低于现价=挂买，
    // 随后调用交易弹窗继续填写数量。移动超过 6px、松手、滚轮都会取消。
    const LONG_PRESS_MS = 500;
    let pressTimer: number | undefined;
    let pressStartX = 0, pressStartY = 0;
    let suppressNextClick = false;
    const clearPress = () => {
      if (pressTimer !== undefined) { window.clearTimeout(pressTimer); pressTimer = undefined; }
    };
    const onPressDown = (e: PointerEvent) => {
      if (e.button !== 0 || !quickTradeRef.current) return;
      clearPress();
      pressStartX = e.clientX;
      pressStartY = e.clientY;
      const down = { clientX: e.clientX, clientY: e.clientY };
      pressTimer = window.setTimeout(() => {
        pressTimer = undefined;
        const s = seriesRef.current;
        if (!s) return;
        const y = down.clientY - el.getBoundingClientRect().top;
        const price = s.coordinateToPrice(y) as number | null;
        if (price == null) return;
        const lastClose = klinesRef.current?.length ? klinesRef.current[klinesRef.current.length - 1].close : 0;
        const refPrice = stock.price > 0 ? stock.price : lastClose;
        if (!(refPrice > 0)) return;
        // 上方挂卖、下方挂买（与现价相等时按挂卖处理）
        const side: 'buy' | 'sell' = price >= refPrice ? 'sell' : 'buy';
        // 长按已触发：抑制松手时被当作点击（否则会误固定行情浮窗）
        suppressNextClick = true;
        quickTradeRef.current?.(side, price, down.clientX, down.clientY);
      }, LONG_PRESS_MS);
    };
    const onPressMove = (e: PointerEvent) => {
      if (pressTimer === undefined) return;
      if (Math.abs(e.clientX - pressStartX) > 6 || Math.abs(e.clientY - pressStartY) > 6) clearPress();
    };
    const onPressEnd = () => clearPress();
    el.addEventListener('pointerdown', onPressDown);
    window.addEventListener('pointermove', onPressMove);
    window.addEventListener('pointerup', onPressEnd);
    window.addEventListener('pointercancel', onPressEnd);
    window.addEventListener('wheel', onPressEnd, { passive: true });

    // 兜底：容器尺寸变化（flex 拉伸/弹窗缩放）时强制重绘一次，并重算覆盖层标签
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && el) {
      ro = new ResizeObserver(() => {
        const w = el.clientWidth, h = el.clientHeight;
        if (w > 0 && h > 50) { try { chart.resize(w, h); } catch { /* ignore */ } }
        computeTicksRef.current?.();
      });
      ro.observe(el);
    }
    // 缩放/平移导致可视区变化时，重算覆盖层标签位置，保证跟随 K 线。
    // 「无延迟跟随」的本质：让覆盖层标签的坐标重算与 lightweight 的 canvas 绘制收尾在同一时刻。
    // 差异只在 y 轴 autoScale 的到位时机：位移不改可见 y 刻度(平移)，index 同步就位；缩放会重标 y 轴。
    // 因而必须按手势分流、不能一刀切都同步或都 rAF——位移只动可视范围宽度不变(平移)，
    // 标签与 K 线同帧、平移完全贴合(这是最初"平移无延迟"的来源)；缩放会改变可视范围宽度，
    // lightweight 要到下一渲染帧才重算 y 轴 autoScale 并重绘 canvas，此刻同步读 priceToCoordinate
    // 仍是旧 y 刻度 → 标签在高度上偏离 K 线。故缩放改为 rAF 合并到 canvas 同帧再算。
    let rafId = 0;
    let lastSpan = -1;
    const onTimeScaleChange = (range: { from: number; to: number } | null) => {
      const span = range ? range.to - range.from : lastSpan;
      const isZoom = Math.abs(span - lastSpan) > 1e-6; // 可视宽度变化 = 缩放；仅位移 = 平移
      lastSpan = span;
      if (!isZoom) {
        computeTicksRef.current?.(); // 平移：同步，保持完全贴合
      } else {
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => computeTicksRef.current?.()); // 缩放：等 y 轴稳定
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onTimeScaleChange);
    // —— 十字线悬浮行情面板（复用列表页"当日行情"浮窗 PriceInfoPopover）——
    // 仅当悬停在 K 线实体所在横带上才展示；热区外(空白/边缘)→ 隐藏。按日缓存指标，避免每像素重算。
    let cachedDay: string | null = null;
    let cachedInd: IndicatorResult | null = null;
    let cachedChange: number | null = null;
    // 从 MouseEventParams 统一构造 quote（hover 与 click 共用同一套取数/缓存逻辑）
    const tryBuildQuote = (param: MouseEventParams) => {
      const series = seriesRef.current;
      const data = rawKlinesRef.current;
      if (!series || !data || data.length === 0 || !param.time || !param.point) return null;
      const bar = param.seriesData.get(series) as (ChartCandle & { time: Time }) | undefined;
      if (!bar) return null;
      const day = String(bar.time);
      const idx = data.findIndex(k => k.date === day);
      if (idx < 0 || idx < 30) return null; // 非候选K线(如数据空洞/前段)不弹
      const prefix = data.slice(0, idx + 1);
      if (cachedDay !== day) {
        const ind = calcIndicators(prefix);
        if (!ind) return null;
        const prevClose = idx > 0 ? data[idx - 1].close : data[idx].close;
        cachedChange = prevClose && prevClose > 0 ? ((data[idx].close - prevClose) / prevClose) * 100 : null;
        cachedInd = ind;
        cachedDay = day;
      }
      if (!cachedInd) return null;
      const rect = el.getBoundingClientRect();
      // 光标视口坐标：按方向键设置的方位（上/下/左/右）换算浮窗左上角
      const px = rect.left + param.point.x;
      const py = rect.top + param.point.y;
      lastHoverPointRef.current = { x: px, y: py };
      const { left, top } = computePopoverPos(px, py);
      return { name: stock.name, price: data[idx].close, changePercent: cachedChange, data: cachedInd, left, top, win: prefix, idx };
    };
    const onCrosshairMove = (param: MouseEventParams) => {
      const q = tryBuildQuote(param);
      const pinned = pinnedRef.current;
      if (pinned) {
        // 固定态：位置保持钉住时的坐标不动，内容跟随鼠标所在的那根 K 线实时更新
        if (q) {
          const next = { ...q, left: pinned.left, top: pinned.top };
          pinnedRef.current = next;
          setPinnedQuote(next);
        }
        return; // 鼠标移出图表（q 为 null）时保留固定弹窗
      }
      // 边界处浮窗被夹取后可能压在光标上：此时图表收不到移动 → q 为 null，
      // 若立即隐藏，浮窗消失后光标又回到图表 → 反复显隐（闪烁）。光标仍落在浮窗内则保持显示。
      if (!q) {
        const box = popoverRef.current;
        const pt = lastHoverPointRef.current;
        if (box && pt) {
          const r = box.getBoundingClientRect();
          if (pt.x >= r.left && pt.x <= r.right && pt.y >= r.top && pt.y <= r.bottom) return;
        }
        if (box?.matches(':hover')) return;
      }
      setHoverQuote(q); // null 即隐藏
    };
    // 点击图表 → 钉住当前悬停那根 K 线的弹窗（进入固定模式）。
    // 固定模式下弹窗不再跟随鼠标移动，方便用户点击弹窗内标签查看「判定依据」「参考价值」。
    const onChartClick = (param: MouseEventParams) => {
      if (suppressNextClick) { suppressNextClick = false; return; } // 长按已打开挂单弹窗，松手不算点击
      if (pinnedRef.current) { togglePin(); return; } // 已固定：点击图表任意处=取消固定并隐藏，恢复指哪显示哪
      const q = tryBuildQuote(param);
      if (!q) return;
      pinnedRef.current = q;
      setPinnedQuote(q);
      setHoverQuote(q); // 同时写 hover 保证 render 时 pinned 未及时同步也能显示
    };
    chart.subscribeCrosshairMove(onCrosshairMove);
    chart.subscribeClick(onChartClick);
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onTimeScaleChange);
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      chart.unsubscribeClick(onChartClick);
      setHoverQuote(null);
      ro?.disconnect();
      el.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions);
      clearPress();
      el.removeEventListener('pointerdown', onPressDown);
      window.removeEventListener('pointermove', onPressMove);
      window.removeEventListener('pointerup', onPressEnd);
      window.removeEventListener('pointercancel', onPressEnd);
      window.removeEventListener('wheel', onPressEnd);
      el.style.touchAction = '';
      if (chartInstance.current) { chartInstance.current.remove(); chartInstance.current = null; }
      seriesRef.current = null;
      computeTicksRef.current = null;
    };
  }, []);

  // 价格小数位同步列表页规则（ETF 3 位、其余 2 位）：K 线序列 precision 决定标尺刻度步长与十字线标签，
  // chart 级 priceFormatter 兜住所有价格文本；stock 切换时一并刷新，避免沿用上一只股票的精度。
  const pricePrecision = isEtf(stock.name) ? 3 : 2;
  useEffect(() => {
    const chart = chartInstance.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    chart.applyOptions({ localization: { priceFormatter: (p: number) => p.toFixed(pricePrecision) } });
    series.applyOptions({
      priceFormat: { type: 'price', precision: pricePrecision, minMove: pricePrecision === 3 ? 0.001 : 0.01 },
    });
  }, [pricePrecision, stock.code]);

  // 有效挂单的价格虚线：一打开就在图上标出还没过期、未成交的挂单价格（过期的、已成交的不画）
  const pendingLinesRef = useRef<IPriceLine[]>([]);
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    pendingLinesRef.current.forEach(line => series.removePriceLine(line));
    pendingLinesRef.current = [];
    const now = Date.now();
    const active = (stock.stockTrades ?? []).filter(t => isPendingTradeActive(t, now));
    setActivePending(active.map(t => ({ id: t.id, price: t.price, side: t.side })));
    active.forEach(t => {
        const isBuy = t.side === 'buy';
        const line = series.createPriceLine({
          price: t.price,
          // 虚线保持实色；右侧标签用深色底 + 彩色文字（库会把 alpha 拍平，故不做半透明）
          color: isBuy ? BUY_BG : SELL_BG,
          axisLabelColor: '#1e293b',
          axisLabelTextColor: isBuy ? BUY_BG : SELL_BG,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          // 只保留右侧价格轴的标签，不再在图上重复"挂买/挂卖 + 价格"文字
          title: '',
        });
        pendingLinesRef.current.push(line);
      });
  }, [stock.stockTrades]);

  // 统一走价格数据部：取数收敛进数据中心（同一周期同源），画图用"含未收盘"形态——
  // 数据中心把自持实时现价(开/高/低/量/现价)合成进今日K线，保证与列表/浮窗显示一致。
  useEffect(() => {
    let cancelled = false;
    setChartLoading(true);
    setChartError(null);
    (async () => {
      const res = await priceBureau.fetchAndAbsorb(stock.code, 'daily', 'tencent', 'qfq');
      if (cancelled) return;
      if (res.data?.klines?.length) {
        // 画图（live）：含未收盘，末根最新价与股息页同一基准；
        // 日线基座供日K图与回测/浮窗使用，周/月K另行按周期取数
        const merged = priceBureau.getTodayDailyKlines(stock.code, stock);
        setRawKlines(merged);
      } else {
        setChartError(res.error || '无K线数据');
      }
      setChartLoading(false);
    })();
    return () => { cancelled = true; };
    // stock.priceUpdatedAt：页面刷新出新实时价时，重新合成今日K线（基座仍命中日线缓存，今日K线实时更新）
  }, [stock.code, stock.priceUpdatedAt, stock.price, stock.open, stock.high, stock.low, stock.volume]);

  // 周/月K：直接按周期向数据中心取数（各 500 根），不再由日K聚合——
  // 日线只有约 1 年，聚合出的周/月K根数会明显偏少。取数失败时回退到已缓存数据。
  useEffect(() => {
    if (klinePeriod === 'daily') return;
    let cancelled = false;
    setChartLoading(true);
    setChartError(null);
    (async () => {
      const res = await priceBureau.fetchAndAbsorb(stock.code, klinePeriod, 'tencent', 'qfq');
      if (cancelled) return;
      const src = res.data?.klines?.length ? res.data.klines : priceBureau.getClosedKlines(stock.code, klinePeriod);
      if (src?.length) {
        setPeriodKlines([...src]
          .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
          .map(k => ({ time: k.date, open: k.open, high: k.high, low: k.low, close: k.close })));
      } else {
        setPeriodKlines(null);
        setChartError(res.error || '无K线数据');
      }
      setChartLoading(false);
    })();
    return () => { cancelled = true; };
  }, [stock.code, klinePeriod]);

  // 回测买卖点：运行回测后取 result.trades；否则用初始真实成交记录（initialTrades）让用户一打开就能看到图
  const demoMarkers = useMemo<TickSpec[]>(() => {
    const src = result?.trades?.length ? result.trades : initialTrades;
    if (!src || !src.length || !klines?.length) return [];
    // 成交日期 → 所属 K 线：日K为精确匹配；周/月K取"时间戳 >= 成交日"的第一根，
    // 即包含该成交日的周期（组内时间取的是该周期最后一个交易日）
    const candleOf = (date: string): ChartCandle | undefined => {
      let lo = 0, hi = klines.length - 1, ans: ChartCandle | undefined;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (klines[mid].time >= date) { ans = klines[mid]; hi = mid - 1; } else lo = mid + 1;
      }
      return ans ?? klines[klines.length - 1]; // 晚于末根的成交归到末根
    };
    const out: TickSpec[] = [];
    for (const t of src) {
      const candle = candleOf(t.date);
      if (!candle) continue;
      out.push({
        id: t.id, time: candle.time,
        anchorPrice: t.action === 'buy' ? candle.low : candle.high,
        action: t.action as 'buy' | 'sell',
      });
    }
    return out;
  }, [result, initialTrades, klines]);

  // 预览：扫描所选（最多 2 个）标签在完整历史 K 线中的命中位置（含判定依据），预览态在图上画缩写块。
  // 组合键 "tagKey|envKey"：无环境前提时 envKey 为空 → 扫全部命中；有环境前提 → 仅扫满足该环境的命中。
  const previewOccurrences = useMemo(() => {
    if (previewKeys.length === 0 || !rawKlines) return [] as { key: string; tagKey: string; date: string; barIndex: number; detail: string[] }[];
    const out: { key: string; tagKey: string; date: string; barIndex: number; detail: string[] }[] = [];
    for (const id of previewKeys) {
      const [tagKey, envKey] = id.split('|');
      for (const o of scanTagOccurrences(rawKlines, tagKey, envKey || undefined, tagParams, customTags, dividendByYear)) out.push({ key: id, tagKey, ...o });
    }
    return out;
  }, [previewKeys, rawKlines, tagParams, customTags, dividendByYear]);

  // 覆盖层定位：把对每个标签的 time→x、anchorPrice→y 换算成像素坐标；time/price 坐标不可得（K线滚出可视区）则隐藏
  const computeTickPositions = useCallback(() => {
    const chart = chartInstance.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    const ts = chart.timeScale();
    const container = chartRef.current;
    const cw = container?.clientWidth ?? 0;
    const ch = container?.clientHeight ?? 0;
    // 右侧标尺宽度：方块右缘若越过绘图区右边界（会被标尺遮住）则直接隐藏该标签
    const priceScaleW = chart.priceScale('right').width();
    const half = TICK_SIZE / 2; // 方块半宽（右缘越界判断用）
    const rightLimit = cw - priceScaleW; // 绘图区右边界（方块右缘若越过标尺则隐藏）
    // 有效挂单价格 → 价格轴上的 y，用于覆盖在标签上的可点击热区
    const pendingAxis: { id: string; y: number }[] = [];
    for (const t of activePending) {
      const y = series.priceToCoordinate(t.price);
      if (y == null || y < 0 || y > ch) continue;
      pendingAxis.push({ id: t.id, y });
    }
    setPendingAxisTicks(pendingAxis);
    // 极值标注：可视区内最高价/最低价两条 K 线，价格数字挨着最高价尖端上方、最低价尖端下方展示，
    // 随 K 线同步移动；数字被钳制在展示区内，边缘处不会一半出屏幕。
    // 复用覆盖层随 K 线同步移动的定位逻辑：可见逻辑范围 → timeToCoordinate/priceToCoordinate 换算像素坐标。
    const extreme: ExtremeTick[] = [];
    const kdata = klinesRef.current;
    if (kdata && kdata.length > 0) {
      const vr = ts.getVisibleLogicalRange();
      if (vr) {
        const n = kdata.length;
        const s = Math.max(0, Math.floor(vr.from));
        const e = Math.min(n - 1, Math.ceil(vr.to));
        let hi = -Infinity, lo = Infinity, hiK: ChartCandle | null = null, loK: ChartCandle | null = null;
        for (let i = s; i <= e; i++) {
          const k = kdata[i];
          if (k.high > hi) { hi = k.high; hiK = k; }
          if (k.low < lo) { lo = k.low; loK = k; }
        }
        const pushExt = (k: ChartCandle | null, kind: 'high' | 'low') => {
          if (!k) return;
          const x = ts.timeToCoordinate(k.time);
          const y = series.priceToCoordinate(kind === 'high' ? k.high : k.low);
          if (x == null || y == null) return;   // K 线滚出可视区（timeToCoordinate 返回 null）则隐藏
          const txt = formatPrice(kind === 'high' ? k.high : k.low, stock.name);
          const tw = extremeTextWidth(txt);
          const side: 'top' | 'bottom' = kind === 'high' ? 'top' : 'bottom';
          const dir: 1 | -1 = side === 'top' ? -1 : 1;
          // 数字中心锚在 K 线 x 坐标，但横向钳制在展示区内：避免边缘 K 线的数字一半出屏幕/被标尺遮住
          const minX = tw / 2 + EXT_PAD;
          const maxX = rightLimit - tw / 2 - EXT_PAD;
          const cx = maxX < minX ? minX : Math.min(maxX, Math.max(minX, x));
          // 竖直：挨着尖端——最高价在上方、最低价在下方（尖端处锚定 y），同样上下钳制在展示区内
          const cyRaw = y + dir * (EXT_FONT_SZ / 2 + EXT_GAP);
          const minCy = EXT_FONT_SZ / 2 + EXT_PAD;
          const maxCy = ch - EXT_FONT_SZ / 2 - EXT_PAD;
          const cy = maxCy < minCy ? minCy : Math.min(maxCy, Math.max(minCy, cyRaw));
          extreme.push({ kind, x: cx, y: cy, price: kind === 'high' ? k.high : k.low, side });
        };
        pushExt(hiK, 'high');
        pushExt(loK, 'low');
      }
    }
    setExtremeTicks(extreme);
    // 预览态：只计算预览标签（最多 2 个），B/S 买卖标签清空
    if (previewKeys.length > 0) {
      const prev: PreviewTick[] = [];
      const defOf = new Map(BACKTEST_TAG_CATALOG.map(d => [d.key, d]));
      // 用户自定义标签预览：abbr 取名称前 2 字；颜色按标签配色 key 映射为十六进制（与标签卡片 TAG_COLOR_HEX 同一映射，标签名称渲染不进图斑）
      const customHex = TAG_COLOR_HEX as Record<string, string>;
      for (const r of (customTags || [])) {
        defOf.set(`user-${r.id}`, { key: `user-${r.id}`, abbr: r.name.slice(0, 2), color: customHex[r.color] ?? '#94a3b8' } as never);
      }
      // 标签命中日期 → 当前周期所在 K 线（周/月K下同一周期内的多次命中会落在同一根上）
      const bars = klinesRef.current;
      const barOf = (date: string): ChartCandle | undefined => {
        if (!bars?.length) return undefined;
        let lo = 0, hi = bars.length - 1, ans: ChartCandle | undefined;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (bars[mid].time >= date) { ans = bars[mid]; hi = mid - 1; } else lo = mid + 1;
        }
        return ans ?? bars[bars.length - 1]; // 晚于最后一根的成交归到末根（如当天成交而周K末根仍是上周）
      };
      const sideOf = new Map(previewKeys.map((k, i) => [k, i === 0 ? 'top' : 'bottom']));
      // 规则自定义颜色：key( tagKey|envKey ) → rule.color；未设置则回退目录/标签默认色
      const keyColorOf = new Map<string, string>();
      for (const r of strategy.rules) {
        const k = `${r.tagKey}|${r.envCondition?.key ?? ''}`;
        keyColorOf.set(k, TAG_COLOR_HEX[r.color ?? ''] ?? defOf.get(r.tagKey)?.color ?? '#94a3b8');
      }
      for (const o of previewOccurrences) {
        const def = defOf.get(o.tagKey);
        if (!def) continue;
        const side: 'top' | 'bottom' = (sideOf.get(o.key) as 'top' | 'bottom') ?? 'top';
        // 上方锚 K 线 high、下方锚 K 线 low；y 存"方块中心"，渲染时按 side 定偏移
        const bar = barOf(o.date);
        if (!bar) continue;
        const anchor = side === 'top' ? bar.high : bar.low;
        const x = ts.timeToCoordinate(bar.time);
        const y = anchor != null ? series.priceToCoordinate(anchor) : null;
        if (x == null || y == null) continue;
        if (x + half > rightLimit) continue;
        if (x < -24) continue;
        if (y < -40 || y > ch + 40) continue;
        prev.push({ keyOf: o.key, date: o.date, x, y, abbr: def.abbr, color: keyColorOf.get(o.key) ?? def.color, side, detail: o.detail });
      }
      setOverlayTicks([]);
      setPreviewTicks(prev);
      return;
    }
    const ticks: OverlayTick[] = [];
    for (const m of demoMarkers) {
      const x = ts.timeToCoordinate(m.time);
      const y = series.priceToCoordinate(m.anchorPrice);
      if (x == null || y == null) continue;
      // 贴右缘/越界：方块右缘越过绘图区右边界即隐藏（K线回到展示区时坐标回落后自现）
      if (x + half > rightLimit) continue;
      // x 已在可视区但很贴边时也保留，仅过滤出左缘/右缘完全在外的情况
      if (x < -24) continue;
      if (y < -40 || y > ch + 40) continue;
      ticks.push({ id: m.id, x, y, action: m.action });
    }
    setOverlayTicks(ticks);
    setPreviewTicks([]);
  }, [demoMarkers, previewKeys, previewOccurrences, customTags, strategy.rules, activePending]);

  // 成交记录：运行回测后取 result.trades；否则用初始真实成交记录（initialTrades）让用户一打开就能看到表
  const tradeRows = useMemo(() => {
    const src = result?.trades?.length ? result.trades : initialTrades;
    if (!src || !src.length) return [] as { id: string; time: string; action: 'buy' | 'sell'; price: number; shares: number; amount: number; triggerLabel: string }[];
    const rows = src.map(t => ({
      id: t.id,
      time: t.date,
      action: t.action,
      price: t.price,
      shares: t.shares,
      amount: t.amount,
      triggerLabel: t.triggerLabel,
    }));
    // 按日期排序（日期字符串 YYYY-MM-DD 可直接字典序比较）
    rows.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    if (tradeSortDir === 'desc') rows.reverse();
    return rows;
  }, [result, initialTrades, tradeSortDir]);

  // 双向定位：点击成交记录行时滚动图表 + 高亮；点击图表标签时仅定位表格（不移动图表可视区）
  const goToTrade = useCallback((id: string, alsoScrollChart = false) => {
    setSelectedTradeId(id);
    // 表格滚动到对应行
    document.getElementById(`bt-row-${id}`)?.scrollIntoView({ block: 'center' });
    // 仅当需要（点击表格行）时才滚动图表到对应 K 线；点击图表标签时保持当前可视区间不变
    if (alsoScrollChart) {
      const chart = chartInstance.current;
      if (!chart) return;
      const ts = chart.timeScale();
      // 由 id 定位到对应成交记录，取其 time 换算 K 线逻辑位置并滚动到可视区
      const row = tradeRows.find(r => r.id === id);
      if (row) {
        // 成交日期 → 所在 K 线下标（周/月K取包含该日期的周期，即"时间 >= 成交日"的第一根）
        let idx = -1;
        let lo = 0, hi = klines.length - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (klines[mid].time >= row.time) { idx = mid; hi = mid - 1; } else lo = mid + 1;
        }
        if (idx >= 0) {
          const n = klines.length;
          ts.setVisibleLogicalRange({ from: Math.max(0, idx - 40), to: Math.min(n, idx + 20) });
        }
      }
    }
  }, [klines, tradeRows]);

  // 让图表内部事件回调始终拿到最新版 computeTickPositions
  useEffect(() => {
    computeTicksRef.current = computeTickPositions;
  }, [computeTickPositions]);

  // 真实数据到达后更新图表
  useEffect(() => {
    if (!klines || !seriesRef.current) return;
    const chart = chartInstance.current;
    if (!chart) return;
    seriesRef.current.setData(klines);
    const closes = klines.map(k => k.close);
    // 依据收盘价计算各周期均线并填充（MA5/10/20/30/60/120/250）
    const latestMA: number[] = [];
    if (maSeriesRef.current) {
      MA_SPECS.forEach((spec, idx) => {
        const line: LineData<Time>[] = [];
        const p = spec.period;
        for (let i = p - 1; i < closes.length; i++) {
          let sum = 0;
          for (let j = i - p + 1; j <= i; j++) sum += closes[j];
          const v = sum / p;
          line.push({ time: klines[i].time, value: v });
        }
        maSeriesRef.current![idx].setData(line);
        if (line.length) latestMA.push(line[line.length - 1].value);
      });
    }
    // 依据收盘价计算布林线（BOLL 20,2）：中轨=MA20，上下轨=中轨±2*std20
    let latestBoll: { upper: number; mid: number; lower: number } | null = null;
    if (bollSeriesRef.current) {
      const upper: LineData<Time>[] = [];
      const mid: LineData<Time>[] = [];
      const lower: LineData<Time>[] = [];
      const p = BOLL_PERIOD;
      for (let i = p - 1; i < closes.length; i++) {
        let sum = 0;
        for (let j = i - p + 1; j <= i; j++) sum += closes[j];
        const m = sum / p;
        let dev = 0;
        for (let j = i - p + 1; j <= i; j++) { const d = closes[j] - m; dev += d * d; }
        const sd = Math.sqrt(dev / p);
        const t = klines[i].time;
        mid.push({ time: t, value: m });
        upper.push({ time: t, value: m + BOLL_MULT * sd });
        lower.push({ time: t, value: m - BOLL_MULT * sd });
      }
      const mids = bollSeriesRef.current;
      mids[0].setData(upper);
      mids[1].setData(mid);
      mids[2].setData(lower);
      if (upper.length && mid.length && lower.length) {
        latestBoll = { upper: upper[upper.length - 1].value, mid: mid[mid.length - 1].value, lower: lower[lower.length - 1].value };
      }
    }
    setLatestInd({ ma: latestMA, boll: latestBoll });
    // 数据到达且布局稳定后，重算覆盖层标签位置（需在设好可视范围之后）
    const raf = requestAnimationFrame(() => {
      const ts = chart.timeScale();
      const count = klines.length;
      const from = Math.max(0, count - 60);
      ts.setVisibleLogicalRange({ from, to: count });
      // 使最新一根锚定在右侧边缘：把可视范围右端对齐数据末尾
      ts.scrollToPosition(0, false);
      // 通过 ref 取最新 computeTickPositions，避免本 effect 因闭包/身份变化而重跑导致跳动
      computeTicksRef.current?.();
    });
    return () => cancelAnimationFrame(raf);
    // 仅当数据/买卖点真正变化时重置可视范围；computeTickPositions 经 ref 读取，不入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [klines, demoMarkers]);

  // 预览态变化：仅重算预览标签坐标，不重置可视范围（避免 K 线图跳动）
  useEffect(() => {
    if (previewKeys.length === 0 && previewTicks.length === 0) return;
    const raf = requestAnimationFrame(() => computeTickPositions());
    return () => cancelAnimationFrame(raf);
  }, [previewKeys, previewOccurrences, computeTickPositions]);

  // 按模式切换均线/布林线 series 的可见性
  useEffect(() => {
    if (!maSeriesRef.current || !bollSeriesRef.current) return;
    const showMA = indicatorMode === 'ma';
    maSeriesRef.current.forEach(s => s.applyOptions({ visible: showMA }));
    bollSeriesRef.current.forEach(s => s.applyOptions({ visible: !showMA }));
  }, [indicatorMode]);

  const addRule = () => setStrategy(prev => ({ ...prev, rules: [...prev.rules, { id: `r${Date.now()}`, tagKey: BACKTEST_TAG_CATALOG[0]!.key, label: BACKTEST_TAG_CATALOG[0]!.label, action: 'buy', pct: 50, enabled: true }] }));
  const removeRule = (id: string) => setStrategy(prev => ({ ...prev, rules: prev.rules.filter(x => x.id !== id) }));
  const updateRule = (id: string, patch: Partial<BacktestRule>) => setStrategy(prev => ({ ...prev, rules: prev.rules.map(r => (r.id === id ? { ...r, ...patch } : r)) }));

  // 策略变更（修改信号/环境条件、删除规则）→ 自动同步 previewKeys：
  // - 删除规则 → 清理对应组合键
  // - 修改已预览规则的信号/环境 → 用新组合键替换旧组合键（保持预览不中断）
  const prevRulesRef = useRef<BacktestRule[]>(strategy.rules);
  useEffect(() => {
    const prev = prevRulesRef.current;
    const curr = strategy.rules;
    const prevById = new Map<string, BacktestRule>(prev.map(r => [r.id, r]));
    const currById = new Map<string, BacktestRule>(curr.map(r => [r.id, r]));
    // 1. 找到"仍存在但 key 变了"的 rule：旧 key 在 previewKeys 中 → 需要替换为新 key
    const replaceMap = new Map<string, string>(); // oldKey → newKey
    for (const rule of curr) {
      const old = prevById.get(rule.id);
      if (!old) continue; // 新增的规则，不管
      const oldKey = `${old.tagKey}|${old.envCondition?.key ?? ''}`;
      const newKey = `${rule.tagKey}|${rule.envCondition?.key ?? ''}`;
      if (oldKey !== newKey) replaceMap.set(oldKey, newKey);
    }
    // 2. 找到"被删除"的 rule → 它们的旧 key 需要清理
    const removedOldKeys = prev
      .filter(r => !currById.has(r.id))
      .map(r => `${r.tagKey}|${r.envCondition?.key ?? ''}`);
    // 3. 过滤 + 替换
    const removedSet = new Set([...removedOldKeys, ...replaceMap.keys()]);
    if (removedSet.size === 0) { prevRulesRef.current = curr; return; }
    setPreviewKeys(prevKeys => {
      const result: string[] = [];
      for (const k of prevKeys) {
        if (!removedSet.has(k)) { result.push(k); continue; }
        const replacement = replaceMap.get(k);
        if (replacement) result.push(replacement);
        // 被删除的 rule → 直接丢弃（无 replacement）
      }
      return result;
    });
    prevRulesRef.current = curr;
  }, [strategy.rules]);

  // 运行回测：按所选周期截取历史K线，用当前规则+初始资金调引擎，写入 result 驱动图表买卖点/成交/统计。
  // 策略用"仅收盘"形态（未收盘不掺实时价，防前视偏差）；图表展示仍是"含未收盘"（见加载 effect）。
  const runTest = () => {
    const srcFull = priceBureau.getClosedKlines(stock.code, 'daily');
    if (!srcFull || srcFull.length === 0) return;
    const preset = RANGE_PRESETS.find(r => r.key === strategy.rangePreset) ?? RANGE_PRESETS.find(r => r.key === 'y1')!; // 默认近一年
    let src = srcFull;
    if (preset.key === 'custom') {
      // 自定义：用起止日期过滤闭区间
      const { rangeStart, rangeEnd } = strategy;
      src = srcFull.filter(k => (!rangeStart || k.date >= rangeStart) && (!rangeEnd || k.date <= rangeEnd));
    } else if (preset.days > 0) {
      // 自然日窗口：从最后一个交易日起往前推 N 个自然日，取落在该窗口内的交易日 K 线
      const last = srcFull[srcFull.length - 1];
      if (last) {
        const [y, m, d] = last.date.split('-').map(Number);
        const end = new Date(Date.UTC(y, m - 1, d));
        end.setUTCDate(end.getUTCDate() - preset.days);
        const cutoff = end.toISOString().slice(0, 10);
        src = srcFull.filter(k => k.date >= cutoff);
      }
    }
    setResult(runBacktest(src, { ...strategy }, { cfg: tagParams, customTags, dividendByYear }));
    setPreviewKeys([]); // 执行回测时取消预览态
    setPreviewPopup(null);
  };

  // 切换某策略标签的预览：已预览则移除，未预览且未满 2 个则加入（第 3 个不生效）。
  // 预览键 = 触发标签 + 环境前提的组合键，保证同标签不同环境前提可分别预览。
  const togglePreview = (tagKey: string, envKey?: string) => {
    setPreviewPopup(null);
    const id = `${tagKey}|${envKey ?? ''}`;
    setPreviewKeys(prev =>
      prev.includes(id) ? prev.filter(k => k !== id)
      : prev.length >= 2 ? prev
      : [...prev, id]
    );
  };

  const rulesForRender = useMemo(() => rules.filter(() => true), [rules]);

  // 当日股息率（回测十字线浮窗用）：口径与列表股息率曲线一致（单一事实来源 dividendRateForDay）
  const dayDividendRate = (() => {
    const qk = displayQuote ? displayQuote.win[displayQuote.idx] : null;
    if (!qk) return null;
    // 最新交易年份取自全量 K 线末根（与曲线 rateForKline 口径一致，勿用单日窗口末根）
    const currentYear = rawKlines?.length
      ? parseInt(String((rawKlines[rawKlines.length - 1]?.date || '').slice(0, 4)), 10)
      : NaN;
    // fallback（当年分红预估）：优先取当前年份已录分红，其次最新已知年份，否则 0
    const byYear = dividendByYear;
    const yearKeys = Object.keys(byYear || {}).map(Number);
    const fallback = byYear && !Number.isNaN(currentYear) && byYear[currentYear] != null
      ? byYear[currentYear]
      : (byYear && yearKeys.length ? byYear[[...yearKeys].sort((a, b) => b - a)[0]] : 0);
    return dividendRateForDay(byYear, qk.date, qk.close, currentYear, fallback ?? 0);
  })();

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-app-bg">
      {/* 十字线悬浮：复用列表页"当日行情"浮窗，底部叠加当日命中信号 */}
      {displayQuote && (
        <PriceInfoPopover
          innerRef={popoverRef}
          interactive={!!pinnedQuote} // 未固定时鼠标穿透，保证浮窗不吞掉图表的悬停跟随
          onTitlePointerDown={pinnedQuote ? onPinnedTitleDrag : undefined} // 固定后可拖标题栏挪位置
          name={displayQuote.name}
          date={displayQuote.win?.[displayQuote.idx]?.date}
          price={displayQuote.price}
          changePercent={displayQuote.changePercent}
          data={displayQuote.data}
          loading={false}
          left={displayQuote.left}
          top={displayQuote.top}
          width={210}
          dividendRate={dayDividendRate}
          headerLeft={(
              pinnedQuote ? (
                <button
                  type="button"
                  onClick={togglePin}
                  title="取消固定，恢复随鼠标显示"
                  className="flex items-center justify-center rounded p-0.5 text-app-subtext hover:text-app-subtext transition-colors"
                >
                  <Pin size={11} />
                </button>
              ) : undefined
            )}
          footer={(
            <SignalTagsFooter
              win={displayQuote.win}
              i={displayQuote.idx}
              cfg={tagParamsRef.current}
              customTags={customTags}
              dividendByYear={dividendByYear}
              onPin={() => { if (!pinnedRef.current && hoverQuote) { pinnedRef.current = hoverQuote; setPinnedQuote(hoverQuote); } }} // 点标签顺带固定，便于连续看各标签依据（幂等，不会误取消）
            />
          )}
        />
      )}
      <div className="h-full flex flex-col">
        {/* 标题栏 */}
        <div className="bg-app-bg/90 backdrop-blur-md px-3 py-2 flex items-center justify-between border-b border-app-border select-none shrink-0">
          <div className="flex items-center gap-2 text-app-subtext">
            <GripHorizontal size={15} className="opacity-80" />
            {stock.link ? (
              <button
                type="button"
                onClick={() => { const url = buildAmihexinUrl(stock.link!); if (url) openScheme(url); }}
                className="inline-flex items-center gap-1 text-app-subtext/70 hover:text-indigo-400 transition-colors min-w-0"
                title="打开公告链接"
              >
                <h4 className="text-[13px] font-bold text-app-text truncate">回测 · {stock.name}</h4>
                <Link size={13} className="shrink-0" />
              </button>
            ) : (
              <h4 className="text-[13px] font-bold text-app-text truncate">回测 · {stock.name}</h4>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={onClose} className="text-app-subtext hover:text-app-text transition-colors bg-app-text/5 hover:bg-app-text/10 rounded p-1.5" title="关闭">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 内容：左策略 + 右图表 */}
        <div className="flex-1 flex overflow-hidden">
          {/* 左：策略编辑（紧凑；移动端进一步收窄；可完全收起） */}
          {!sidebarCollapsed && (
          <div className="w-[220px] max-md:w-[170px] shrink-0 border-r border-app-border flex flex-col overflow-hidden">
            <div className="px-2.5 py-2 border-b border-app-border space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-app-subtext">策略编辑</span>
                <button type="button" onClick={runTest} className="flex items-center gap-1 rounded-lg bg-brand-red/90 hover:bg-brand-red px-2 py-1 text-xs font-semibold text-white transition-colors" title="运行回测">
                  <Play size={13} />运行
                </button>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-app-subtext">
                <span className="shrink-0">初始资金:</span>
                <input
                  type="number"
                  value={initialCapital}
                  onChange={e => setStrategy(prev => ({ ...prev, initialCapital: Math.max(0, Number(e.target.value)) }))}
                  className={`${INPUT_CLS} flex-1 min-w-0`}
                />
                <span className="shrink-0">元</span>
              </label>
              {/* A股费用（简化版：仅保留最低佣金，固定每笔费用，单行） */}
              <label className="flex items-center gap-1.5 text-xs text-app-subtext">
                <span className="shrink-0">最低佣金:</span>
                <input
                  type="number"
                  value={strategy.commissionMin ?? ''}
                  onChange={e => setStrategy(prev => ({ ...prev, commissionMin: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) }))}
                  placeholder="5"
                  className={`${INPUT_CLS} flex-1 min-w-0`}
                />
                <span className="shrink-0">元/笔</span>
              </label>
              <label className="flex items-center gap-1.5 text-xs text-app-subtext">
                <span className="shrink-0">周期:</span>
                <select
                  className="flex-1 min-w-0 bg-app-input border border-app-border rounded-lg px-2 py-1 text-xs leading-tight text-app-text outline-none"
                  value={strategy.rangePreset ?? 'y1'}
                  onChange={e => setStrategy(prev => ({ ...prev, rangePreset: e.target.value as BacktestStrategy['rangePreset'] }))}
                >
                  {RANGE_PRESETS.map(rp => (
                    <option key={rp.key} value={rp.key!}>{rp.label}</option>
                  ))}
                </select>
              </label>
              {strategy.rangePreset === 'custom' && (
                <div className="flex flex-col gap-1">
                  <label className="flex items-center gap-1.5 text-xs text-app-subtext">
                    <span className="shrink-0">起始:</span>
                    <input
                      type="date"
                      value={strategy.rangeStart ?? ''}
                      onChange={e => setStrategy(prev => ({ ...prev, rangeStart: e.target.value }))}
                      className={`${INPUT_CLS} flex-1 min-w-0`}
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-app-subtext">
                    <span className="shrink-0">结束:</span>
                    <input
                      type="date"
                      value={strategy.rangeEnd ?? ''}
                      onChange={e => setStrategy(prev => ({ ...prev, rangeEnd: e.target.value }))}
                      className={`${INPUT_CLS} flex-1 min-w-0`}
                    />
                  </label>
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar px-2 py-1.5 space-y-1.5">
              {rulesForRender.map((r, idx) => (
                  <RuleEditor key={r.id} index={idx} value={r} onChange={patch => updateRule(r.id, patch)} onRemove={() => removeRule(r.id)} previewing={previewKeys.includes(`${r.tagKey}|${r.envCondition?.key ?? ''}`)} onTogglePreview={() => togglePreview(r.tagKey, r.envCondition?.key)} customTags={customTags} />
                ))}
              {selectedPreset ? (
                <span className="block text-[11px] text-app-subtext/70 px-1">{selectedPreset.name}</span>
              ) : (
                <button type="button" onClick={addRule} className="w-full flex items-center justify-center gap-1 rounded-lg border border-dashed border-app-border hover:bg-app-text/5 py-2 text-xs text-app-subtext hover:text-indigo-300 transition-colors" title="新增策略">
                  <Plus size={14} />添加策略
                </button>
              )}
            </div>
            {/* 底部常驻：策略组合标签 + 保存操作（复用股息率颜色区间的标签排版与主题紫配色） */}
            <div className="px-2.5 py-2 border-t border-app-border shrink-0 bg-app-input/20 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-app-subtext">策略组</span>
                <button type="button" onClick={startBlankPreset} className="text-app-subtext hover:text-indigo-300 transition-colors" title="新建空白策略组">
                  <Plus size={13} />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {presets.length === 0 && (
                  <span className="text-[10px] text-app-subtext/60 px-0.5">暂无组合，编辑规则后点保存</span>
                )}
                {presets.map(p => {
                  const active = selectedPresetId === p.id;
                  return (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => applyPreset(p)}
                      className={`inline-flex items-center justify-center px-1.5 h-[22px] rounded text-[10px] font-medium border transition-all bg-indigo-500/10 text-indigo-500 border-indigo-500/20 hover:opacity-80 ${active ? 'ring-1 ring-indigo-500/50' : ''}`}
                      title={`应用「${p.name}」（${p.rules.length} 条规则）`}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
              {namingTarget ? (
                <div className="flex items-center gap-1">
                  <input
                    autoFocus
                    type="text"
                    value={namingText}
                    onChange={e => setNamingText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') confirmSave(); if (e.key === 'Escape') cancelNaming(); }}
                    placeholder={namingTarget === 'new' ? '输入策略组名称…' : '修改策略组名称…'}
                    className="flex-1 min-w-0 bg-app-input border border-indigo-500/50 rounded-lg px-2 py-1 text-xs text-app-text outline-none focus:border-indigo-500 transition-all"
                  />
                  <button type="button" onClick={confirmSave} className="shrink-0 px-2 py-1.5 bg-app-input text-app-subtext border border-white/5 rounded-lg text-xs font-semibold transition-colors hover:text-indigo-300 hover:border-indigo-500/40">确定</button>
                  <button type="button" onClick={cancelNaming} className="shrink-0 px-2 py-1.5 bg-app-input text-app-subtext border border-white/5 rounded-lg text-xs font-semibold transition-colors hover:text-indigo-300 hover:border-indigo-500/40">取消</button>
                </div>
              ) : selectedPreset ? (
                // 已选中组合：保存 / 重命名 / 删除 三按钮（统一默认样式，仅 hover 变色）
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={openNaming}
                    disabled={!presetDirty}
                    className="flex-1 min-w-0 px-2 py-1.5 bg-app-input text-app-subtext border border-white/5 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-xs font-semibold transition-colors hover:text-indigo-300 hover:border-indigo-500/40"
                    title={presetDirty ? `保存对「${selectedPreset.name}」的修改` : '当前没有可保存的修改'}
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    onClick={startRename}
                    className="flex-1 min-w-0 px-2 py-1.5 bg-app-input text-app-subtext border border-white/5 rounded-lg text-xs font-semibold transition-colors hover:text-indigo-300 hover:border-indigo-500/40"
                    title="重命名该策略组"
                  >
                    重命名
                  </button>
                  <button
                    type="button"
                    onClick={() => deletePreset(selectedPreset.id)}
                    className="flex-1 min-w-0 px-2 py-1.5 bg-app-input text-app-subtext border border-white/5 rounded-lg text-xs font-semibold transition-colors hover:text-brand-red hover:border-red-500/40"
                    title="删除该策略组"
                  >
                    删除
                  </button>
                </div>
              ) : (
                <button type="button" onClick={openNaming} disabled={!presetDirty} className="w-full px-2 py-1.5 bg-app-input text-app-text border border-white/5 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-xs font-semibold hover:bg-app-card hover:border-indigo-500/40 hover:text-indigo-300 transition-colors" title={presetDirty ? '将当前规则保存为新的策略组' : '当前没有可保存的修改'}>
                  保存
                </button>
              )}
            </div>
          </div>
          )}

          {/* 右：K线图 + 统计 + 记录表 */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* 指标控件条：切换均线/布林线 + 当前各指标值（最左侧为策略编辑侧栏的收起/展开） */}
            <div className="px-3 py-1.5 border-b border-app-border flex items-center gap-2 text-xs shrink-0 overflow-x-auto custom-scrollbar">
              <button
                type="button"
                onClick={toggleSidebar}
                className="shrink-0 flex items-center justify-center w-6 h-6 rounded-md text-app-subtext hover:text-indigo-400 hover:bg-app-input transition-colors"
                title={sidebarCollapsed ? '展开策略编辑' : '收起策略编辑'}
              >
                <PanelLeft size={15} className={sidebarCollapsed ? 'opacity-60' : ''} />
              </button>
              <div className="flex items-center rounded-md border border-app-border overflow-hidden shrink-0 bg-app-input/40">
                <button
                  type="button"
                  onClick={() => setIndicatorMode('ma')}
                  className={`px-2.5 py-1 font-medium transition-colors ${indicatorMode === 'ma' ? 'bg-app-text/10 text-indigo-400' : 'text-app-subtext hover:text-app-text'}`}
                >均线</button>
                <span className="w-px h-4 bg-app-border self-center" />
                <button
                  type="button"
                  onClick={() => setIndicatorMode('boll')}
                  className={`px-2.5 py-1 font-medium transition-colors ${indicatorMode === 'boll' ? 'bg-app-text/10 text-indigo-400' : 'text-app-subtext hover:text-app-text'}`}
                >布林线</button>
              </div>
              {/* 缩放模式切换按钮：已移至图表右下角标尺位 */}
              <div className="flex items-center rounded-md border border-app-border overflow-hidden shrink-0 bg-app-input/40">
                {KLINE_PERIODS.map((p, i) => (
                  <React.Fragment key={p.key}>
                    {i > 0 && <span className="w-px h-4 bg-app-border self-center" />}
                    <button
                      type="button"
                      onClick={() => setKlinePeriod(p.key)}
                      className={`px-2.5 py-1 font-medium transition-colors ${klinePeriod === p.key ? 'bg-app-text/10 text-indigo-400' : 'text-app-subtext hover:text-app-text'}`}
                      title={`${p.label}K`}
                    >{p.label}</button>
                  </React.Fragment>
                ))}
              </div>
              {indicatorMode === 'boll' && (
                <span className="shrink-0 bg-app-text/5 rounded-md px-2 py-1 text-app-text font-mono">BOLL (20, 2)</span>
              )}
              {indicatorMode === 'ma' ? (
                <div className="flex items-center gap-3 overflow-x-auto custom-scrollbar">
                  {MA_SPECS.map((spec, i) => (
                    <span key={spec.label} className="shrink-0 font-mono whitespace-nowrap">
                      <span style={{ color: spec.color }}>{spec.label}</span>
                      <span style={{ color: spec.color }}>:{latestInd.ma[i] != null ? latestInd.ma[i].toFixed(2) : '—'}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-3 overflow-x-auto custom-scrollbar">
                  {BOLL_SPECS.map(spec => (
                    <span key={spec.key} className="shrink-0 font-mono whitespace-nowrap">
                      <span style={{ color: spec.color }}>{spec.label}</span>
                      <span style={{ color: spec.color }}>:{latestInd.boll ? (spec.key === 'upper' ? latestInd.boll.upper : spec.key === 'mid' ? latestInd.boll.mid : latestInd.boll.lower).toFixed(2) : '—'}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* K线图：默认 flex-grow 抢空间；拖拽下方分界线后使用固定高度 */}
            <div
              ref={chartWrapRef}
              className={`relative min-h-[120px] ${effectiveChartHeight ? 'shrink-0' : 'flex-1'}`}
              style={effectiveChartHeight ? { height: effectiveChartHeight } : undefined}
            >
              <div
                ref={chartRef}
                className="absolute inset-0"
              />
              {/* 覆盖层：B/S 买卖点标签（红=买/蓝=卖 + 点划线 + 圆点，无文字），锚定并跟随 K 线
                  svg 容器 inline pointer-events:none 不拦截图表滑/捏手势；热区自身 inline all 恢复点击 */}
              <svg
                className="absolute inset-0 z-10"
                width="100%"
                height="100%"
                style={{ pointerEvents: 'none' }}
              >
                {overlayTicks.map(t => {
                  // 布局（从 K 线往外）：K线 →[SPACING]→ 圆点 →[LINE_LEN点划线]→ 方块
                  // 默认 buy 在 K 线下方、sell 在上方；dir=1下 / -1上
                  const half = TICK_SIZE / 2;
                  const dir: 1 | -1 = t.action === 'buy' ? 1 : -1;
                  const color = t.action === 'buy' ? BUY_BG : SELL_BG;
                  // 方块中心相对 K 线的总偏移
                  const offset = SPACING + LINE_LEN + half;
                  const ch = chartRef.current?.clientHeight ?? 300;
                  let centerY = t.y + dir * offset;
                  // 边界翻转：方块即将超出顶部/底部时翻转到 K 线另一侧
                  if (centerY - half < 2) centerY = t.y - dir * offset;
                  else if (centerY + half > ch - 2) centerY = t.y - dir * offset;
                  // 局部坐标（以方块中心为原点）：圆点在方块靠 K 线一侧
                  const dotLocal = -dir * (LINE_LEN + half);
                  const edgeY = -dir * half; // 方块朝向圆点的边缘
                  const selected = selectedTradeId === t.id;
                  return (
                    <g
                      key={t.id}
                      transform={`translate(${t.x} ${centerY})`}
                      className="cursor-pointer"
                      onClick={() => goToTrade(t.id)}
                    >
                      {/* 透明热区：扩展点击/手型命中面积（该批次图形在小方块外的点划线、圆点范围） */}
                      <rect
                        x={-12} y={dir * Math.min(edgeY, dotLocal) - 6}
                        width={24}
                        height={Math.abs(edgeY - dotLocal) + 12}
                        fill="transparent"
                        style={{ pointerEvents: 'all', cursor: 'pointer' }}
                      />
                      {/* 点状虚线：方块边缘 → 末端圆点 */}
                      <line
                        x1={0} y1={edgeY}
                        x2={0} y2={dotLocal}
                        stroke={color}
                        strokeWidth={1.2}
                        strokeDasharray={DOT_DA}
                        pointerEvents="none"
                      />
                      {/* 末端圆点：停在 K 线外侧 SPACING 间距处，不插入 K 线内部 */}
                      <circle
                        cx={0}
                        cy={dotLocal}
                        r={DOT_R}
                        fill={color}
                        pointerEvents="none"
                      />
                      {/* 圆角方块：底色随买卖（蓝=卖/红=买），选中态用描边高亮；方块内显示首文字母 B/S */}
                      <rect
                        x={-half} y={-half}
                        width={TICK_SIZE} height={TICK_SIZE}
                        rx={TICK_RADIUS}
                        fill={color}
                        stroke={selected ? TICK_ACTIVE : 'none'}
                        strokeWidth={selected ? 1.5 : 0}
                        pointerEvents="all"
                      />
                      {/* 首文字母：买入 B / 卖出 S */}
                      <text
                        x={0} y={0}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={8}
                        fontWeight={700}
                        fill={TICK_FG}
                        pointerEvents="none"
                      >
                        {t.action === 'buy' ? 'B' : 'S'}
                      </text>
                    </g>
                  );
                })}
                {/* 预览标签：缩写方块（无文字，颜色=标签主题色），key[0] 在 K 线上方、key[1] 下方；透明热区承载 hover/点击弹判定依据浮窗 */}
                {previewTicks.map(t => {
                  const bw = TICK_SIZE;             // 方块宽
                  const bh = TICK_SIZE;             // 方块高（无文字，固定方形）
                  const half = bw / 2;
                  const bhHalf = bh / 2;
                  const offset = SPACING + LINE_LEN + bhHalf;
                  // top：方块中心在 high 之上 offset；bottom：在 low 之下 offset
                  const dir: 1 | -1 = t.side === 'top' ? -1 : 1;
                  const centerY = t.y + dir * offset;
                  const popup = previewPopup?.date === t.date && previewPopup?.keyOf === t.keyOf;
                  return (
                    <g key={`${t.keyOf}-${t.date}`} transform={`translate(${t.x} ${centerY})`}>
                      {/* 透明热区：扩展命中面积，承载 hover/点击（容器 pointer-events:none，热区单独恢复） */}
                      <circle
                        cx={0} cy={0} r={10}
                        fill="transparent" style={{ pointerEvents: 'all', cursor: 'pointer' }}
                        onMouseEnter={() => setPreviewPopup({ keyOf: t.keyOf, date: t.date, x: t.x, y: centerY, detail: t.detail })}
                        onMouseLeave={() => setPreviewPopup(p => (p?.keyOf === t.keyOf && p?.date === t.date ? null : p))}
                        onClick={() => setPreviewPopup(popup ? null : { keyOf: t.keyOf, date: t.date, x: t.x, y: centerY, detail: t.detail })}
                      />
                      {/* 点状虚线：方块边缘 → 末端圆点 */}
                      <line x1={0} y1={-dir * bhHalf} x2={0} y2={-dir * (LINE_LEN + bhHalf)} stroke={t.color} strokeWidth={1.2} strokeDasharray={DOT_DA} pointerEvents="none" />
                      {/* 末端圆点 */}
                      <circle cx={0} cy={-dir * (LINE_LEN + bhHalf)} r={DOT_R} fill={t.color} pointerEvents="none" />
                      {/* 缩写方块（仅首字，颜色=标签主题色） */}
                      <rect x={-half} y={-bhHalf} width={bw} height={bh} rx={TICK_RADIUS} fill={t.color} pointerEvents="none" />
                      {/* 首字 */}
                      <text x={0} y={0} textAnchor="middle" dominantBaseline="central" fontSize={8} fontWeight={400} fill={TICK_FG} pointerEvents="none">
                        {(t.abbr || '').charAt(0)}
                      </text>
                    </g>
                  );
                })}
                {/* 极值标注：可视区内最高价/最低价 K 线的价格数字，紧贴尖端——最高价数字在上、最低价在下（跟随 K 线移动） */}
                {extremeTicks.map(t => {
                  const text = formatPrice(t.price, stock.name);
                  return (
                    <text
                      key={`ext-${t.kind}`}
                      x={t.x}
                      y={t.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={EXT_FONT_SZ}
                      fontWeight={700}
                      fill={EXT_COLOR}
                      pointerEvents="none"
                    >
                      {text}
                    </text>
                  );
                })}
              </svg>
              {/* 挂单价格标签的点击热区（透明覆盖在右侧价格轴标签上，点击进入该挂单编辑） */}
              {pendingAxisTicks.map(t => (
                <div
                  key={t.id}
                  className="absolute z-20 -translate-y-1/2 cursor-pointer"
                  style={{ right: 0, top: t.y, width: 64, height: 18 }}
                  title="点击编辑该挂单"
                  onClick={(e) => pendingTradeClickRef.current?.(t.id, e.clientX, e.clientY)}
                />
              ))}
              {/* 预览标签判定依据浮窗 */}
              {previewPopup && (
                <div
                  className="absolute z-30 max-w-[260px] rounded-lg border border-app-border bg-app-card px-2.5 py-2 shadow-[0_8px_30px_rgba(0,0,0,0.5)]"
                  style={{ left: Math.min(previewPopup.x + 12, (chartRef.current?.clientWidth ?? 300) - 260), top: previewPopup.y, pointerEvents: 'none' }}
                >
                  <div className="mb-1 text-[11px] font-semibold text-app-text">{previewPopup.date}</div>
                  <div className="space-y-0.5">
                    {previewPopup.detail.map((d, i) => (
                      <div key={i} className="text-[11px] leading-snug text-app-subtext">{d}</div>
                    ))}
                  </div>
                </div>
              )}
              {chartLoading && (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-app-subtext pointer-events-none">正在加载K线…</div>
              )}
              {!chartLoading && chartError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-xs text-app-subtext pointer-events-none">
                  <span>K线加载失败</span>
                  <span className="text-brand-red">{chartError}</span>
                </div>
              )}
            </div>

            {/* 交易统计条：置于操作记录表顶部；上下分割线 + 浅色底，与图表区分 */}
            <div ref={statsBarRef} className="relative px-3 py-1.5 border-y border-app-border bg-app-card flex items-center gap-4 text-xs flex-wrap shrink-0">
              {/* 图表 / 统计条交界处的拖拽手柄：命中区 8px 以边框为中心，悬停显示渐隐紫线 */}
              <div
                onPointerDown={handleSplitPointerDown}
                onPointerMove={handleSplitPointerMove}
                onPointerUp={handleSplitPointerUp}
                onPointerCancel={handleSplitPointerUp}
                className="group absolute -top-1 left-0 right-0 z-10 h-2 cursor-row-resize touch-none select-none"
                title="拖拽调整图表高度"
              >
                <div className="pointer-events-none absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px bg-gradient-to-r from-transparent via-indigo-500/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <Stat label="初始资金" value={result ? initialCapital.toLocaleString() : initialStats ? Math.round(initialStats.buyAmt).toLocaleString() : initialCapital.toLocaleString()} />
              <Stat label="期末市值" value={result ? Math.round(result.finalValue).toLocaleString() : initialStats ? Math.round(initialStats.finalValue).toLocaleString() : '—'} />
              <Stat label={result ? '总收益' : '投入收益率'} value={result ? `${result.totalReturnPct >= 0 ? '+' : ''}${result.totalReturnPct.toFixed(2)}%` : initialStats ? `${initialStats.totalReturnPct >= 0 ? '+' : ''}${initialStats.totalReturnPct.toFixed(2)}%` : '—'} className={(result ? result.totalReturnPct : initialStats?.totalReturnPct) !== undefined && (result?.totalReturnPct ?? initialStats?.totalReturnPct ?? 0) >= 0 ? 'text-brand-red' : 'text-green-500'} title={!result && initialStats ? `(期末市值 − 累计买入) / 累计买入` : undefined} />
              {!result && initialStats && (
                <Stat label="总收益额" value={`${(initialStats.finalValue - initialStats.buyAmt) >= 0 ? '+' : ''}${Math.round(initialStats.finalValue - initialStats.buyAmt).toLocaleString()}`} className={(initialStats.finalValue - initialStats.buyAmt) >= 0 ? 'text-brand-red' : 'text-green-500'} title={`期末市值 − 累计买入 = ${Math.round(initialStats.finalValue)} − ${Math.round(initialStats.buyAmt)}`} />
              )}
              {!result && initialStats && (
                <>
                  <Stat label="均价盈亏" value={`${initialStats.realizedAvg >= 0 ? '+' : ''}${Math.round(initialStats.realizedAvg).toLocaleString()}`} className={initialStats.realizedAvg >= 0 ? 'text-brand-red' : 'text-green-500'} title={`均价口径 已实现：${Math.round(initialStats.realizedAvg)}；浮动：${Math.round(initialStats.unrealizedAvg)}；合计：${Math.round(initialStats.realizedAvg + initialStats.unrealizedAvg)}（= 总收益额）`} />
                  <Stat label="T操作" value={`${initialStats.realizedDt >= 0 ? '+' : ''}${Math.round(initialStats.realizedDt).toLocaleString()}`} className={initialStats.realizedDt >= 0 ? 'text-brand-red' : 'text-green-500'} title={`做T口径 已实现：${Math.round(initialStats.realizedDt)}；浮动：${Math.round(initialStats.unrealizedDt)}；合计：${Math.round(initialStats.realizedDt + initialStats.unrealizedDt)}（与均价口径合计相等，属数学恒等式）`} />
                </>
              )}
              <Stat label="胜率" value={result ? `${(result.winRate * 100).toFixed(1)}%` : initialStats?.winRate != null ? `${(initialStats.winRate * 100).toFixed(1)}%` : '—'} />
              <Stat label="最大回撤" value={result ? `-${result.maxDrawdownPct.toFixed(2)}%` : initialStats?.maxDrawdownPct != null ? `-${initialStats.maxDrawdownPct.toFixed(2)}%` : '—'} />
              <Stat label="交易次数" value={result ? String(result.tradeCount) : initialStats ? String(initialStats.tradeCount) : '0'} />
            </div>

            {/* 操作记录表：与上方图表各占一半高度（flex-1 均分），超高滚动；浅色底与图表区分 */}
            <div className="overflow-y-auto custom-scrollbar flex-1 min-h-0 bg-app-card">
              {/* border-separate：sticky 表头在 border-collapse 下会丢失单元格边框，改用它保证表头分隔线可见 */}
              <table ref={tradeTableRef} className="w-full table-fixed text-xs font-mono text-app-subtext border-separate border-spacing-0 [&>tbody>tr>td]:border-b [&>tbody>tr>td]:border-r [&>tbody>tr>td]:border-app-border [&>thead>tr>th]:border-b [&>thead>tr>th]:border-r [&>thead>tr>th]:border-app-border">
                <colgroup>
                  <col />
                  <col />
                  <col />
                  <col />
                  <col />
                  <col />
                  <col />
                  <col style={{ width: '150px' }} />
                </colgroup>
                <thead className="sticky top-0 bg-app-card border-b border-app-border z-10">
                  <tr className="text-app-subtext text-[11px]">
                    <th
                      className="px-2 py-1.5 text-left cursor-pointer select-none hover:text-app-text transition-colors"
                      onClick={() => setTradeSortDir(prev => prev === 'desc' ? 'asc' : 'desc')}
                      title="点击切换排序（新→旧 / 旧→新）"
                    >
                      日期
                      <span className={`ml-0.5 text-[10px] ${tradeSortDir === 'desc' ? 'text-app-text' : 'opacity-40'}`}>▼</span>
                      <span className={`text-[10px] ${tradeSortDir === 'asc' ? 'text-app-text' : 'opacity-40'}`}>▲</span>
                    </th>
                    <th className="px-2 py-1.5 text-right">操作</th>
                    <th className="px-2 py-1.5 text-right">价格</th>
                    <th className="px-2 py-1.5 text-right">股数</th>
                    <th className="px-2 py-1.5 text-right">金额</th>
                    <th className="px-2 py-1.5 text-right">持仓</th>
                    <th className="px-2 py-1.5 text-right">盈亏</th>
                    <th className="px-2 py-1.5 text-right">标签</th>
                  </tr>
                </thead>
                <tbody>
                  {tradeRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-4 text-app-subtext text-[12px]">暂无交易记录</td>
                    </tr>
                  ) : tradeRows.map(r => (
                    <tr
                      key={r.id}
                      id={`bt-row-${r.id}`}
                      onClick={() => goToTrade(r.id, true)}
                      className={`cursor-pointer transition-colors ${selectedTradeId === r.id ? 'bg-indigo-500/15' : 'hover:bg-app-input/40'}`}
                    >
                      <td className="px-2 py-1.5 whitespace-nowrap">{r.time}</td>
                      <td className="px-2 py-1.5 text-right" style={{ color: r.action === 'buy' ? BUY_BG : SELL_BG }}>{r.action === 'buy' ? '买入' : '卖出'}</td>
                      <td className="px-2 py-1.5 text-right">{r.price.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-right">{r.shares}</td>
                      <td className="px-2 py-1.5 text-right">{r.amount.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-right">—</td>
                      <td className="px-2 py-1.5 text-right">—</td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-right">{r.triggerLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// 策略规则编辑行（受控：value + onChange 由父级 strategy 状态驱动）
const RuleEditor: React.FC<RuleEditorProps> = ({ index, value, onChange, onRemove, previewing, onTogglePreview, customTags }) => {
  const [colorOpen, setColorOpen] = useState(false);
  const curColor = value.color ?? 'indigo';
  const curHex = TAG_COLOR_HEX[curColor] ?? '#818cf8';
  // 按 stable key 从目录取当前标签定义（用于分组显示）
  const current = BACKTEST_TAG_CATALOG.find(t => t.key === value.tagKey);
  // 自定义标签伪定义：tagKey='user-<id>'，label=名称，归入 'custom' 分组（复用目录下拉结构）
  const customDefs = useMemo(() => (customTags || [])
    .filter(t => t.enabled)
    .map(t => ({ key: `user-${t.id}`, group: 'custom', label: t.name, signalName: t.name, action: value.action, abbr: t.name.slice(0, 2), color: '#818cf8' })), [customTags, value.action]);
  // 目录按 group 聚合，用于 <optgroup> 分组；自定义信号恒排最前（优先展示用户自定义标签）
  const groups = useMemo(() => {
    const m = new Map<string, typeof BACKTEST_TAG_CATALOG>();
    for (const t of [...customDefs, ...BACKTEST_TAG_CATALOG]) {
      const arr = m.get(t.group) || [];
      arr.push(t);
      m.set(t.group, arr);
    }
    const entries = Array.from(m.entries());
    const customIdx = entries.findIndex(([g]) => g === 'custom');
    if (customIdx > 0) {
      const [cust] = entries.splice(customIdx, 1);
      entries.unshift(cust);
    }
    return entries;
  }, [customDefs]);

  return (
    <div className="rounded-lg border border-app-border bg-app-input/30 p-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        {/* 左侧：标签颜色按钮(最左) + 策略名 */}
        <div className="relative flex items-center gap-1.5 min-w-0">
          {/* 标签颜色：标签图标(Tag)居最左，以当前所选颜色着色；点击展开调色板选色 */}
          <button
            type="button"
            onClick={() => setColorOpen(o => !o)}
            className={`shrink-0 p-0.5 rounded transition-all active:scale-90 text-app-subtext hover:opacity-90 ${colorOpen ? 'ring-1 ring-indigo-400/40' : ''}`}
            style={{ color: curHex }}
            title={`标记颜色：${curColor}（点击选择）`}
          >
            <Tag size={14} />
          </button>
          <span className={`truncate text-xs font-medium select-none text-app-text ${previewing ? 'underline underline-offset-4 decoration-indigo-400' : ''}`}>
            {value.label || '未命名策略'}
          </span>
          {/* 调色板：点 Tag 后紧贴其下方弹出，选中即着色并收起 */}
          {colorOpen && (
            <div
              className="absolute left-0 top-full mt-1 z-20 flex items-center gap-1 bg-app-bg border border-app-border rounded-lg px-1.5 py-1 shadow-[0_8px_30px_rgba(0,0,0,0.5)]"
              onClick={e => e.stopPropagation()}
            >
              {TAG_PALETTE.map(c => (
                <button key={c.key} type="button" aria-label={c.label} title={c.label}
                  onClick={() => { onChange({ color: c.key }); setColorOpen(false); }}
                  className={`w-4 h-4 rounded-full border transition-all hover:scale-110 ${c.border} ${curColor === c.key ? 'ring-1 ring-white/40 scale-110' : ''}`}
                  style={{ backgroundColor: TAG_COLOR_HEX[c.key] }}
                />
              ))}
            </div>
          )}
        </div>
        {/* 右侧按钮组：预览 / 删除 */}
        <div className="relative flex items-center gap-1 shrink-0">
          {/* 预览开关：小眼睛按钮（固定浅灰色，与删除叉默认状态同色） */}
          <button
            type="button"
            onClick={onTogglePreview}
            className="p-0.5 rounded transition-all active:scale-90 text-app-subtext"
            title={previewing ? '取消预览该标签在 K 线上的命中位置' : '预览该标签在 K 线上的命中位置'}
          >
            {previewing ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          {/* 删除：叉图标 */}
          <button type="button" onClick={onRemove} className="text-app-subtext hover:text-brand-red transition-colors p-0.5" title="删除策略">
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 text-[11px] text-app-subtext">信号</span>
        <select
          className="flex-1 min-w-0 bg-app-input border border-app-border rounded-lg px-2 py-1 text-xs leading-tight text-app-subtext outline-none"
          value={value.tagKey}
          onChange={e => {
            const key = e.target.value;
            const t = BACKTEST_TAG_CATALOG.find(x => x.key === key);
            if (t) { onChange({ tagKey: t.key, label: t.label, action: t.action as BacktestRule['action'] }); return; }
            const ct = customDefs.find(x => x.key === key);
            // 用户自定义标签颜色：先沿用该标签在设置页自带颜色，用户可在颜色按钮处自行改色
            const ctDef = (customTags || []).find(x => `user-${x.id}` === key);
            onChange(ct
              ? { tagKey: ct.key, label: ct.label, color: ctDef?.color ?? value.color }
              : { tagKey: key });
          }}
        >
          <option value="" disabled>选择标签…</option>
          {groups.map(([g, list]) => (
            <optgroup key={g} label={BT_GROUP_LABEL[g as keyof typeof BT_GROUP_LABEL] ?? g}>
              {list.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      {current && (
        <p className="text-[11px] text-app-subtext leading-tight">将触发至 {current.action === 'buy' ? '买入' : '卖出'}</p>
      )}
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 text-[11px] text-app-subtext">环境</span>
        <select
          className="flex-1 min-w-0 bg-app-input border border-app-border rounded-lg px-2 py-1 text-xs leading-tight outline-none text-app-subtext"
          value={value.envCondition?.key ?? ''}
          onChange={e => {
            const key = e.target.value;
            const c = ENV_TAG_CATALOG.find(x => x.key === key);
            onChange({ envCondition: key ? { key: key, label: c?.label ?? key } : null });
          }}
          title="可选前提：该环境状态成立时，触发标签才允许执行动作"
        >
          <option value="">-</option>
          <optgroup label="趋势结构">
            {ENV_TAG_CATALOG.filter(c => c.dim === 'trend').map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </optgroup>
          <optgroup label="布林波动">
            {ENV_TAG_CATALOG.filter(c => c.dim === 'volatility').map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </optgroup>
          <optgroup label="位置">
            {ENV_TAG_CATALOG.filter(c => c.dim === 'position').map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </optgroup>
        </select>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 text-[11px] text-app-subtext">操作</span>
        <select
          className="flex-1 min-w-0 bg-app-input border border-app-border rounded-lg px-2 py-1 text-xs leading-tight font-semibold outline-none text-app-subtext"
          value={value.action}
          onChange={e => onChange({ action: e.target.value as BacktestRule['action'] })}
        >
          <option value="buy" className="text-brand-red">买入</option>
          <option value="sell" className="text-blue-500">卖出</option>
        </select>
        <div className="w-14 shrink-0">
          <InputGroup
            value={value.pct}
            onChange={v => onChange({ pct: Math.max(1, Math.min(100, Number(v) || 0)) })}
            min={1}
            max={100}
            step={5}
            precision={0}
            touchMode
            hideControls
            className="!py-1 !pl-2 !pr-2 !text-xs !text-right !text-app-subtext"
          />
        </div>
        <span className="text-xs text-app-subtext">%</span>
      </div>
    </div>
  );
};

// 统计概览条目
const Stat: React.FC<StatProps> = ({ label, value, className }) => (
  <div className="flex items-center gap-1">
    <span className="text-app-subtext text-xs">{label}</span>
    <span className={`font-mono font-semibold text-xs ${className || 'text-app-text'}`}>{value}</span>
  </div>
);