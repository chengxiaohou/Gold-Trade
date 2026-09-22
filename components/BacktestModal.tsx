import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, GripHorizontal, Play, Eye, EyeOff, Pin } from 'lucide-react';
import { createChart, ColorType, CandlestickSeries, LineSeries, TickMarkType } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, LineData, MouseEventParams, Time } from 'lightweight-charts';
import type { StockEntry, BacktestStrategy, BacktestRule, BacktestResult, BacktestTrade, BacktestStrategyPreset, TagParams, UserTagRule } from '../types';
import { fetchBollData } from '../services/bollService';
import type { BollKline } from '../services/bollService';
import { mergeTodayBarToKlines } from '../services/bollService';
import { priceBureau } from '../services/priceBureau';
import { getMarketStatus } from '../services/cacheService';
import { runBacktest, scanTagOccurrences, BACKTEST_TAG_CATALOG, BT_GROUP_LABEL } from '../services/backtestEngine';
import { ENV_TAG_CATALOG, dividendRateForDay } from '../services/tagAnalyzers';
import { calcIndicators, type IndicatorResult } from '../services/indicators';
import PriceInfoPopover from './PriceInfoPopover';
import SignalTagsFooter from './SignalTagsFooter';
import { InputGroup } from './InputGroup';

type ChartCandle = { time: string; open: number; high: number; low: number; close: number };

// 覆盖层买卖点标签规格：锚定 K 线的 time 与锚定价（卖=high/买=low），使圆点贴 K 线实体边缘外侧
type TickSpec = { id: string; time: string; anchorPrice: number; action: 'buy' | 'sell' };
// 覆盖层标签计算后的像素坐标（已在可视区内的标签）
type OverlayTick = { id: string; x: number; y: number; action: 'buy' | 'sell' };
// 预览标签：某策略标签命中的 K 线像素坐标（缩写块，置于 K 线上下；color 用标签本身主题色）
type PreviewTick = { keyOf: string; date: string; x: number; y: number; abbr: string; color: string; side: 'top' | 'bottom'; detail: string[] };

export interface BacktestModalProps {
  stock: StockEntry;
  onClose: () => void;
  onPresetsDirty?: () => void; // 策略组有增删改时调用，用于告知上层"有改动需上传"
  tagParams?: TagParams; // 标签判定参数：与弹窗同一份，保证回测与弹窗信号判定严格一致
  customTags?: UserTagRule[]; // 用户自定义动态信号标签（随云端同步）
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

// 覆盖层标签：纯圆点（不再显示方块/文字/点划线），仅靠颜色区分买卖/信号
const DOT_R = 3;              // 圆点半径
const SPACING = 4;            // 圆点距 K 线实体边缘（high/low）的固定间距
const SELL_BG = '#4A90D9';   // 卖出圆点颜色（蓝）
const BUY_BG = '#ef4444';    // 买入圆点颜色（红）
const DOT_ACTIVE = '#94a3b8'; // 选中态描边色（浅灰）

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

export function BacktestModal({ stock, onClose, onPresetsDirty, tagParams, customTags }: BacktestModalProps) {
  // 按下 ESC 关闭回测弹窗（挂载期内全局监听）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
  const togglePin = () => {
    if (pinnedRef.current) {
      pinnedRef.current = null;
      setPinnedQuote(null);
      setHoverQuote(null); // 取消固定后隐藏弹窗（否者停留在旧位置，鼠标需重移到图上才恢复跟随）
    } else if (hoverQuote) {
      pinnedRef.current = hoverQuote;
      setPinnedQuote(hoverQuote);
    }
  };
  const rawKlinesRef = useRef<BollKline[] | null>(null);
  const tagParamsRef = useRef<TagParams | undefined>(tagParams);
  useEffect(() => { rawKlinesRef.current = rawKlines; }, [rawKlines]);
  useEffect(() => { tagParamsRef.current = tagParams; }, [tagParams]);
  // <年份,每股派息>：供 dividendRate 自定义标签，按 K 线所属年份折算（与列表股息率曲线同源）
  const dividendByYear = stock?.dividendByYear;
  const [result, setResult] = useState<BacktestResult | null>(null);    // 回测结果（买卖点+成交+统计）
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
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
  // 预览标签判定依据浮窗（hover/点击预览标签时显示）
  const [previewPopup, setPreviewPopup] = useState<{ keyOf: string; date: string; x: number; y: number; detail: string[] } | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ReturnType<IChartApi['addSeries']> | null>(null);
  // 缓存最新 computeTickPositions，供图表内部事件/ResizeObserver 回调调用，避免闭包陈旧
  const computeTicksRef = useRef<(() => void) | null>(null);
  const maSeriesRef = useRef<ISeriesApi<'Line'>[] | null>(null);
  const bollSeriesRef = useRef<ISeriesApi<'Line'>[] | null>(null);
  const [klines, setKlines] = useState<ChartCandle[] | null>(null); // 图表 K 线（含实时今日K线）
  const [chartLoading, setChartLoading] = useState(true);
  const [chartError, setChartError] = useState<string | null>(null);
  // 图表指标模式：均线(默认) / 布林线
  const [indicatorMode, setIndicatorMode] = useState<'ma' | 'boll'>('ma');
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
        vertLine: { color: 'rgba(148,163,184,0.4)', labelBackgroundColor: '#64748b' },
        horzLine: { color: 'rgba(148,163,184,0.4)', labelBackgroundColor: '#64748b' },
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
    // 前置capture阶段接管 wheel：捏合(ctrlKey)/⌘+滚轮 → 开原生缩放；纯滚轮/双指平移 → 关缩放、按 deltaY 自行平移
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); // 图表接管滚轮，阻止页面随之滚动/缩放
      if (e.ctrlKey || e.metaKey) {
        setScale(true); // 交给 lightweight 原生在光标处缩放
      } else {
        setScale(false);
        panByWheel(-e.deltaY); // deltaX 由 handleScroll 原生平移，这里只补纵向 deltaY
      }
    };
    el.addEventListener('wheel', onWheel, { capture: true, passive: false });

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
      const popW = 210;
      let left = rect.left + param.point.x + 12;
      if (left + popW > window.innerWidth - 8) left = Math.max(8, rect.left + param.point.x - popW - 12);
      let top = rect.top + param.point.y + 12;
      if (top + 240 > window.innerHeight - 8) top = Math.max(8, rect.top + param.point.y - 240 - 12);
      return { name: stock.name, price: data[idx].close, changePercent: cachedChange, data: cachedInd, left, top, win: prefix, idx };
    };
    const onCrosshairMove = (param: MouseEventParams) => {
      if (pinnedRef.current) return; // 固定中：冻结弹窗，不随鼠标跨天切换也不关闭
      const q = tryBuildQuote(param);
      setHoverQuote(q); // null 即隐藏
    };
    // 点击图表 → 钉住当前悬停那根 K 线的弹窗（进入固定模式）。
    // 固定模式下弹窗不再跟随鼠标移动，方便用户点击弹窗内标签查看「判定依据」「参考价值」。
    const onChartClick = (param: MouseEventParams) => {
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
      el.style.touchAction = '';
      if (chartInstance.current) { chartInstance.current.remove(); chartInstance.current = null; }
      seriesRef.current = null;
      computeTicksRef.current = null;
    };
  }, []);

  // 加载真实日线K线数据
  // ⚠️ 把"实时今日K线"并入日线基座（mergeTodayBarToKlines，与股息页同一来源）：日线接口本身带 120 分钟 BOLL 缓存，
  // 若直接拿末根今日K线会滞后；用页面已刷新的实时现价(开/高/低/量/现价)覆盖今日K线，保证与页面显示一致。
  useEffect(() => {
    let cancelled = false;
    setChartLoading(true);
    setChartError(null);
    (async () => {
      const res = await fetchBollData(stock.code, 'daily', 'qfq');
      if (cancelled) return;
      priceBureau.absorb(stock.code, 'daily', res);
      if (res.data?.klines?.length) {
        const base = [...res.data.klines].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        const merged = mergeTodayBarToKlines(base, stock, getMarketStatus());
        const candles: ChartCandle[] = merged.map(k => ({ time: k.date, open: k.open, high: k.high, low: k.low, close: k.close })).sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
        setKlines(candles);
        setRawKlines(merged);
      } else {
        setChartError(res.error || '无K线数据');
      }
      setChartLoading(false);
    })();
    return () => { cancelled = true; };
    // stock.priceUpdatedAt：页面刷新出新实时价时，用新实时价重新合并今日K线（基座仍命中日线缓存，今日K线实时更新）
  }, [stock.code, stock.priceUpdatedAt, stock.price, stock.open, stock.high, stock.low, stock.volume]);

  // 回测买卖点：由真实回测结果的成交记录映射为覆盖层标签（图⇄表一一对应）
  const demoMarkers = useMemo<TickSpec[]>(() => {
    if (!result || !result.trades) return [];
    const priceOf = new Map<string, ChartCandle>(klines?.map(k => [k.time, k]) ?? []);
    return result.trades.map(t => {
      const candle = priceOf.get(t.date);
      return {
        id: t.id, time: t.date,
        // 锚定价：买=B(下方)锚 low、卖=S(上方)锚 high，圆点贴实体边缘外侧固定间距
        anchorPrice: t.action === 'buy' ? (candle?.low ?? t.price) : (candle?.high ?? t.price),
        action: t.action as 'buy' | 'sell',
      };
    });
  }, [result, klines]);

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
    const rightLimit = cw - priceScaleW; // 绘图区右边界（圆点右缘若越过标尺则隐藏）
    // 预览态：只计算预览标签（最多 2 个），B/S 买卖标签清空
    if (previewKeys.length > 0) {
      const prev: PreviewTick[] = [];
      const defOf = new Map(BACKTEST_TAG_CATALOG.map(d => [d.key, d]));
      // 用户自定义标签预览：abbr 取名称前 2 字；颜色按标签配色 key 映射为十六进制（标签名称渲染不进图斑）
      const customHex: Record<string, string> = { red: '#ef4444', green: '#22c55e', blue: '#60a5fa', indigo: '#818cf8', slate: '#94a3b8', orange: '#fb923c', pink: '#fb7299' };
      for (const r of (customTags || [])) {
        defOf.set(`user-${r.id}`, { key: `user-${r.id}`, abbr: r.name.slice(0, 2), color: customHex[r.color] ?? '#94a3b8' } as never);
      }
      const highOf = new Map<string, number>(rawKlines?.map(k => [k.date, k.high]) ?? []);
      const lowOf = new Map<string, number>(rawKlines?.map(k => [k.date, k.low]) ?? []);
      const sideOf = new Map(previewKeys.map((k, i) => [k, i === 0 ? 'top' : 'bottom']));
      for (const o of previewOccurrences) {
        const def = defOf.get(o.tagKey);
        if (!def) continue;
        const side: 'top' | 'bottom' = (sideOf.get(o.key) as 'top' | 'bottom') ?? 'top';
        // 上方锚 K 线 high、下方锚 K 线 low；y 存"方块中心"，渲染时按 side 定偏移
        const anchor = side === 'top' ? highOf.get(o.date) : lowOf.get(o.date);
        const x = ts.timeToCoordinate(o.date);
        const y = anchor != null ? series.priceToCoordinate(anchor) : null;
        if (x == null || y == null) continue;
        if (x + DOT_R > rightLimit) continue;
        if (x < -24) continue;
        if (y < -40 || y > ch + 40) continue;
        prev.push({ keyOf: o.key, date: o.date, x, y, abbr: def.abbr, color: def.color, side, detail: o.detail });
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
      // 贴右缘/越界：圆点右缘越过绘图区右边界即隐藏（K线回到展示区时坐标回落后自现）
      if (x + DOT_R > rightLimit) continue;
      // x 已在可视区但很贴边时也保留，仅过滤出左缘/右缘完全在外的情况
      if (x < -24) continue;
      if (y < -40 || y > ch + 40) continue;
      ticks.push({ id: m.id, x, y, action: m.action });
    }
    setOverlayTicks(ticks);
    setPreviewTicks([]);
  }, [demoMarkers, previewKeys, previewOccurrences, customTags]);

  // 成交记录：直接取真实回测结果，图的标签与表的行共用同一批 id，实现双向往返定位
  const tradeRows = useMemo(() => {
    if (!result) return [] as { id: string; time: string; action: 'buy' | 'sell'; price: number; shares: number; amount: number; triggerLabel: string }[];
    return result.trades.map(t => ({
      id: t.id,
      time: t.date,
      action: t.action,
      price: t.price,
      shares: t.shares,
      amount: t.amount,
      triggerLabel: t.tagName,
    }));
  }, [result]);

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
        const idx = klines.findIndex(k => k.time === row.time);
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

  // 运行回测：按所选周期截取历史K线，用当前规则+初始资金调引擎，写入 result 驱动图表买卖点/成交/统计
  const runTest = () => {
    if (!rawKlines) return;
    const preset = RANGE_PRESETS.find(r => r.key === strategy.rangePreset) ?? RANGE_PRESETS.find(r => r.key === 'y1')!; // 默认近一年
    let src = rawKlines;
    if (preset.key === 'custom') {
      // 自定义：用起止日期过滤闭区间
      const { rangeStart, rangeEnd } = strategy;
      src = rawKlines.filter(k => (!rangeStart || k.date >= rangeStart) && (!rangeEnd || k.date <= rangeEnd));
    } else if (preset.days > 0) {
      // 自然日窗口：从最后一个交易日起往前推 N 个自然日，取落在该窗口内的交易日 K 线
      const last = rawKlines[rawKlines.length - 1];
      if (last) {
        const [y, m, d] = last.date.split('-').map(Number);
        const end = new Date(Date.UTC(y, m - 1, d));
        end.setUTCDate(end.getUTCDate() - preset.days);
        const cutoff = end.toISOString().slice(0, 10);
        src = rawKlines.filter(k => k.date >= cutoff);
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
            <h4 className="text-[13px] font-bold text-app-text">回测 · {stock.name}</h4>
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={onClose} className="text-app-subtext hover:text-app-text transition-colors bg-app-text/5 hover:bg-app-text/10 rounded p-1.5" title="关闭">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 内容：左策略 + 右图表 */}
        <div className="flex-1 flex overflow-hidden">
          {/* 左：策略编辑（紧凑；移动端进一步收窄） */}
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

          {/* 右：K线图 + 统计 + 记录表 */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-3 py-1.5 border-b border-app-border flex items-center gap-4 text-xs flex-wrap shrink-0">
              <Stat label="初始资金" value={initialCapital.toLocaleString()} />
              <Stat label="期末市值" value={result ? Math.round(result.finalValue).toLocaleString() : '—'} />
              <Stat label="总收益" value={result ? `${result.totalReturnPct >= 0 ? '+' : ''}${result.totalReturnPct.toFixed(2)}%` : '—'} className={result && result.totalReturnPct >= 0 ? 'text-brand-red' : 'text-green-500'} />
              <Stat label="胜率" value={result ? `${(result.winRate * 100).toFixed(1)}%` : '—'} />
              <Stat label="最大回撤" value={result ? `-${result.maxDrawdownPct.toFixed(2)}%` : '—'} />
              <Stat label="交易次数" value={result ? String(result.tradeCount) : '0'} />
            </div>

            {/* 指标控件条：切换均线/布林线 + 当前各指标值 */}
            <div className="px-3 py-1.5 border-b border-app-border flex items-center gap-2 text-xs shrink-0 overflow-x-auto custom-scrollbar">
              <div className="flex items-center rounded-md border border-app-border overflow-hidden shrink-0 bg-app-input/40">
                <button
                  type="button"
                  onClick={() => setIndicatorMode('ma')}
                  className={`px-2.5 py-1 font-medium transition-colors ${indicatorMode === 'ma' ? 'bg-app-text/10 text-app-text' : 'text-app-subtext hover:text-app-text'}`}
                >均线</button>
                <span className="w-px h-4 bg-app-border self-center" />
                <button
                  type="button"
                  onClick={() => setIndicatorMode('boll')}
                  className={`px-2.5 py-1 font-medium transition-colors ${indicatorMode === 'boll' ? 'bg-app-text/10 text-app-text' : 'text-app-subtext hover:text-app-text'}`}
                >布林线</button>
              </div>
              {/* 缩放模式切换按钮：已移至图表右下角标尺位 */}
              <span className="shrink-0 bg-app-text/5 rounded-md px-2 py-1 text-app-text font-mono">{indicatorMode === 'ma' ? '日线' : 'BOLL (20, 2)'}</span>
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

            {/* K线图：flex-grow 抢剩余大部分空间，表格靠 min-h + 自身滚动兜底，任何屏幕都可用 */}
            <div className="relative flex-1 min-h-[150px]">
              <div
                ref={chartRef}
                className="absolute inset-0"
              />
              {/* 覆盖层：买卖点纯圆点（红=买/蓝=卖），锚定并跟随 K 线
                  svg 容器 inline pointer-events:none 不拦截图表滑/捏手势；热区自身 inline all 恢复点击 */}
              <svg
                className="absolute inset-0 z-10"
                width="100%"
                height="100%"
                style={{ pointerEvents: 'none' }}
              >
                {overlayTicks.map(t => {
                  // 布局：buy 在 K 线下方、sell 在上方；圆点贴 K 线外侧 SPACING 间距处
                  const dir: 1 | -1 = t.action === 'buy' ? 1 : -1;
                  const color = t.action === 'buy' ? BUY_BG : SELL_BG;
                  const ch = chartRef.current?.clientHeight ?? 300;
                  let centerY = t.y + dir * (SPACING + DOT_R);
                  // 边界翻转：圆点即将超出顶部/底部时翻转到 K 线另一侧
                  if (centerY - DOT_R < 2) centerY = t.y - dir * (SPACING + DOT_R);
                  else if (centerY + DOT_R > ch - 2) centerY = t.y - dir * (SPACING + DOT_R);
                  const selected = selectedTradeId === t.id;
                  return (
                    <g
                      key={t.id}
                      transform={`translate(${t.x} ${centerY})`}
                      className="cursor-pointer"
                      onClick={() => goToTrade(t.id)}
                    >
                      {/* 透明热区：扩展点击/手型命中面积 */}
                      <circle
                        cx={0} cy={0} r={8}
                        fill="transparent"
                        style={{ pointerEvents: 'all', cursor: 'pointer' }}
                      />
                      {/* 纯圆点：颜色区分买卖，选中态加描边 */}
                      <circle
                        cx={0} cy={0} r={DOT_R}
                        fill={color}
                        stroke={selected ? DOT_ACTIVE : 'none'}
                        strokeWidth={selected ? 1.5 : 0}
                        pointerEvents="none"
                      />
                    </g>
                  );
                })}
                {/* 预览标签：纯圆点（颜色=标签主题色），key[0] 在 K 线上方、key[1] 下方；透明热区承载 hover/点击弹判定依据浮窗 */}
                {previewTicks.map(t => {
                  const dir: 1 | -1 = t.side === 'top' ? -1 : 1;
                  const centerY = t.y + dir * (SPACING + DOT_R);
                  const popup = previewPopup?.date === t.date && previewPopup?.keyOf === t.keyOf;
                  return (
                    <g key={`${t.keyOf}-${t.date}`} transform={`translate(${t.x} ${centerY})`}>
                      {/* 透明热区：扩展命中面积，承载 hover/点击（容器 pointer-events:none，热区单独恢复） */}
                      <circle
                        cx={0} cy={0} r={8}
                        fill="transparent" style={{ pointerEvents: 'all', cursor: 'pointer' }}
                        onMouseEnter={() => setPreviewPopup({ keyOf: t.keyOf, date: t.date, x: t.x, y: centerY, detail: t.detail })}
                        onMouseLeave={() => setPreviewPopup(p => (p?.keyOf === t.keyOf && p?.date === t.date ? null : p))}
                        onClick={() => setPreviewPopup(popup ? null : { keyOf: t.keyOf, date: t.date, x: t.x, y: centerY, detail: t.detail })}
                      />
                      {/* 纯圆点：颜色取自标签自身主题色 */}
                      <circle cx={0} cy={0} r={DOT_R} fill={t.color} pointerEvents="none" />
                    </g>
                  );
                })}
              </svg>
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

            {/* 操作记录表：与上方图表各占一半高度（flex-1 均分），超高滚动 */}
            <div className="border-t border-app-border overflow-y-auto custom-scrollbar flex-1 min-h-0">
              <table className="w-full table-fixed text-xs font-mono text-app-subtext">
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
                <thead className="sticky top-0 bg-app-bg border-b border-app-border z-10">
                  <tr className="text-app-subtext text-[11px]">
                    <th className="px-2 py-1.5 text-left">日期</th>
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
                      <td className="px-2 py-1.5 text-right">{r.amount}</td>
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
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-xs text-app-subtext cursor-pointer" onClick={e => e.preventDefault()}>
          <input type="checkbox" checked={value.enabled} onChange={e => onChange({ enabled: e.target.checked })} className="w-3.5 h-3.5 accent-indigo-500" />
          启用
        </label>
        <span className="text-xs text-app-rowtext">策略 {index + 1}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onTogglePreview}
            className={`p-0.5 rounded transition-all active:scale-90 ${previewing ? 'text-indigo-300' : 'text-app-subtext hover:text-indigo-300'}`}
            title={previewing ? '取消预览该标签在 K 线上的命中位置' : '预览该标签在 K 线上的命中位置'}
          >
            {previewing ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
          <button type="button" onClick={onRemove} className="text-app-subtext hover:text-brand-red transition-colors p-0.5" title="删除策略">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 text-[11px] text-app-subtext">信号</span>
        <select
          className="flex-1 min-w-0 bg-app-input border border-app-border rounded-lg px-2 py-1 text-xs leading-tight text-app-text outline-none"
          value={value.tagKey}
          onChange={e => {
            const key = e.target.value;
            const t = BACKTEST_TAG_CATALOG.find(x => x.key === key);
            if (t) { onChange({ tagKey: t.key, label: t.label, action: t.action as BacktestRule['action'] }); return; }
            // 用户自定义标签：tagKey='user-<id>'，label=名称；动作保留当前选择（自定义标签无内置买卖方向）
            const ct = customDefs.find(x => x.key === key);
            onChange(ct ? { tagKey: ct.key, label: ct.label } : { tagKey: key });
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
          className="flex-1 min-w-0 bg-app-input border border-app-border rounded-lg px-2 py-1 text-xs leading-tight outline-none text-app-text"
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
          className="flex-1 min-w-0 bg-app-input border border-app-border rounded-lg px-2 py-1 text-xs leading-tight font-semibold outline-none"
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
            className="!py-1 !pl-2 !pr-2 !text-xs !text-right"
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