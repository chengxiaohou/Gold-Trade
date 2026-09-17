import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, GripHorizontal, Play } from 'lucide-react';
import { createChart, ColorType, CandlestickSeries, LineSeries, TickMarkType } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, LineData, Time } from 'lightweight-charts';
import type { StockEntry, BacktestStrategy, BacktestRule, BacktestResult, BacktestTrade } from '../types';
import { fetchBollData } from '../services/bollService';
import type { BollKline } from '../services/bollService';
import { runBacktest, BACKTEST_TAG_CATALOG } from '../services/backtestEngine';

type ChartCandle = { time: string; open: number; high: number; low: number; close: number };

// 覆盖层买卖点标签规格：锚定 K 线的 time 与锚定价（卖=high/买=low），使圆点贴 K 线实体边缘外侧
type TickSpec = { id: string; time: string; anchorPrice: number; action: 'buy' | 'sell' };
// 覆盖层标签计算后的像素坐标（已在可视区内的标签）
type OverlayTick = { id: string; x: number; y: number; action: 'buy' | 'sell' };

export interface BacktestModalProps {
  stock: StockEntry;
  onClose: () => void;
}

interface RuleEditorProps {
  index: number;
  value: BacktestRule;
  onChange: (patch: Partial<BacktestRule>) => void;
  onRemove: () => void;
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

// 覆盖层买卖点标签几何：圆角方块 + 白色字母 + 点划线 + 末端圆点（与参考图一致）
const TICK_SIZE = 12;        // 方块宽高（较上一版 9 略微增大）
const TICK_RADIUS = 2.5;     // 方块圆角
const LINE_LEN = 15;         // 点状虚线（方块边缘→圆点）长度，约3-4个点
const DOT_R = TICK_SIZE / 6; // 末端圆点半径 = 标签宽度 1/3 直径 / 2
const DOT_DA = '2 3';        // 点状虚线 pattern（短点+较大间隔，形成独立小点）
const SPACING = 6;           // 圆点距 K 线实体边缘（high/low）的固定间距，上下一致
const SELL_BG = '#4A90D9';   // 卖出标签底色（蓝，对齐参考图）
const BUY_BG = '#C44A3D';    // 买入标签底色（砖红，对齐参考图）
const TICK_FG = '#ffffff';   // 字母色（白）
const TICK_ACTIVE = '#94a3b8'; // 选中态描边色（浅灰，暗底醒目）

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

export function BacktestModal({ stock, onClose }: BacktestModalProps) {
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
  const [rawKlines, setRawKlines] = useState<BollKline[] | null>(null); // 回测信号需含 volume 的全量 K 线
  const [result, setResult] = useState<BacktestResult | null>(null);    // 回测结果（买卖点+成交+统计）
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  // 覆盖层买卖点标签的像素坐标（随缩放/平移重算）
  const [overlayTicks, setOverlayTicks] = useState<OverlayTick[]>([]);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ReturnType<IChartApi['addSeries']> | null>(null);
  // 缓存最新 computeTickPositions，供图表内部事件/ResizeObserver 回调调用，避免闭包陈旧
  const computeTicksRef = useRef<(() => void) | null>(null);
  const maSeriesRef = useRef<ISeriesApi<'Line'>[] | null>(null);
  const bollSeriesRef = useRef<ISeriesApi<'Line'>[] | null>(null);
  const [klines, setKlines] = useState<ChartCandle[] | null>(null);
  const [chartLoading, setChartLoading] = useState(true);
  const [chartError, setChartError] = useState<string | null>(null);
  // 图表指标模式：均线(默认) / 布林线
  const [indicatorMode, setIndicatorMode] = useState<'ma' | 'boll'>('ma');
  // 缩放模式：latest=锁定最新价(右缘锚定) / cursor=鼠标指向的日期为中心
  const [zoomMode, setZoomMode] = useState<'latest' | 'cursor'>(() => {
    // 从本地记忆初始缩放模式（指向锚 / 右缘锚），无记录默认右缘锚
    try { return localStorage.getItem('bt_zoom_mode') === 'cursor' ? 'cursor' : 'latest'; }
    catch { return 'latest'; }
  });
  const zoomModeRef = useRef<'latest' | 'cursor'>('latest');
  useEffect(() => { zoomModeRef.current = zoomMode; }, [zoomMode]);
  // 缩放模式选择本地持久化，刷新/重开弹窗后保留
  useEffect(() => {
    try { localStorage.setItem('bt_zoom_mode', zoomMode); } catch { /* 忽略存储异常 */ }
  }, [zoomMode]);
  // cursor 模式：触屏 pinch 放行框架原生（中心锚定）；wheel 由上面 onWheel 统一接管（灵敏度可调）。
  // latest 模式：触屏 pinch 走自接管右缘锚（关闭原生 pinch）。
  // mouseWheel 全程置 false：捏合(ctrlKey)缩放已由 onWheel 按模式接管，非捏合平移走 handleScroll。
  useEffect(() => {
    const chart = chartInstance.current;
    if (!chart) return;
    const isCursor = zoomMode === 'cursor';
    chart.applyOptions({ handleScale: { mouseWheel: false, pinch: isCursor } });
    if (chartRef.current) chartRef.current.style.touchAction = isCursor ? 'none' : 'pan-y';
  }, [zoomMode]);
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
      lineWidth: spec.key === 'mid' ? 1 : 2,
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

    // —— 接管缩放手势，实现 B 方案：右缘就近锚定，缩放只朝左侧扩展/收缩 ——
    // 禁用内置围绕中心/鼠标的缩放，改为右缘锚定的自定义缩放
    // 关掉鼠标滚轮缩放与捏合缩放（内置围绕中心），保留 handleScroll.mouseWheel
    // 让 lightweight 原生处理双指左/右滑的平移（换算精确），我们只接管捏合缩放。
    chart.applyOptions({
      handleScroll: { mouseWheel: true, pressedMouseMove: false, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: false, axisDoubleClickReset: false, mouseWheel: false, pinch: false },
    });
    // 图表区触摸交给本组件与 lightweight 平移处理：允许页面竖向滚动，pinch 由 onTouchMove 接管
    el.style.touchAction = 'pan-y';

    const clampBars = (n: number) => Math.max(8, Math.min(300, n));

    // —— 桌面/触控板手势（wheel 事件统一承载）——
    // 双指捏合缩放（浏览器以 ctrlKey 标记）→ 右缘锚定缩放；其余交给 lightweight 原生 mouseWheel 平移

    const tsSet = () => chart.timeScale();

    // 双指捏合(wheel 以 ctrlKey 标记)：捕获阶段拦截，阻断事件到达 lightweight 的原生 mouseWheel
    // 以免两套逻辑同时作用导致缩放几乎无效。灵敏度系数 1.004，比 1.0015 灵敏约 2.7 倍。
    const onWheel = (e: WheelEvent) => {
      // 非捏合：放行，交给 lightweight 原生 mouseWheel 平移
      if (!e.ctrlKey) return;
      if (e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      const ts = tsSet();
      const r = ts.getVisibleLogicalRange();
      if (!r) return;
      const span = r.to - r.from;
      if (span <= 0) return;
      const factor = Math.pow(1.1, e.deltaY); // 灵敏度对齐右缘锚（1.1^deltaY）
      const newSpan = span * factor;
      const newWidth = clampBars(newSpan);
      let from: number;
      if (zoomModeRef.current === 'cursor') {
        // 指向锚：指针锚定缩放。与原生一致——按像素把"指针下方那一根 K 线"保持在原位、向两边缩放。
        // 关键：全程浮点不取整，锚点按指针像素逐级重锚 → 指针不动则该 K 线分毫不动（无取整漂移）。
        const rect = el.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const L = ts.coordinateToLogical(px);
        if (L == null) {
          // 指针落在图表区外（如右侧标尺）：退化为右缘锚
          from = Math.max(0, r.to - newWidth);
        } else {
          const spacing = (ts.width() / span) || 1; // 每逻辑单位像素
          // 目标 barSpacing' 与当前比：newWidth / span 倍；为让 L 像素不变：from = L - (L - r.from) * (spacing/spacing')
          from = L - (L - r.from) * (newSpan / span);
          // 左缘越界保护：整体右移，尽量保留锚定（右移量越小锚定损失越小）
          if (from < 0) { const shift = -from; from = 0; }
        }
        ts.setVisibleLogicalRange({ from, to: from + newWidth });
      } else {
        // 右缘锚：最新价锚定
        ts.setVisibleLogicalRange({ from: Math.max(0, r.to - newWidth), to: r.to });
      }
    };

    // 触屏 pinch：latest 模式右缘锚定；cursor 模式放行给原生 pinch
    let pinchStart: { dist: number; range: { from: number; to: number } } | null = null;
    let pinchDist = 1;
    const distOf = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTouchStart = (e: TouchEvent) => {
      if (zoomModeRef.current === 'cursor') return; // 原生 pinch 接管
      if (e.touches.length === 2) {
        const ts = chart.timeScale();
        const r = ts.getVisibleLogicalRange();
        if (!r) return;
        pinchDist = distOf(e.touches);
        pinchStart = { dist: pinchDist, range: { from: r.from, to: r.to } };
      } else if (e.touches.length < 2) {
        pinchStart = null;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchStart) {
        e.preventDefault();
        const ts = chart.timeScale();
        const d = distOf(e.touches);
        if (d <= 0 || pinchStart.dist <= 0) return;
        const width = (pinchStart.range.to - pinchStart.range.from) * (pinchDist / d);
        const newWidth = clampBars(width);
        // latest 模式：右缘（最新价）锚定（cursor 模式走原生 pinch，不进入此处）
        ts.setVisibleLogicalRange({ from: Math.max(0, pinchStart.range.to - newWidth), to: pinchStart.range.to });
      }
    };
    const onTouchEnd = () => { pinchStart = null; };

    // 用捕获阶段接管 wheel：先于 lightweight 的 canvas 监听，避免捏合事件被原生平移截获
    el.addEventListener('wheel', onWheel, { capture: true, passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);

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
    // 缩放/平移导致可视区变化时，重算覆盖层标签位置，保证跟随 K 线
    const onTimeScaleChange = () => computeTicksRef.current?.();
    chart.timeScale().subscribeVisibleLogicalRangeChange(onTimeScaleChange);
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onTimeScaleChange);
      ro?.disconnect();
      el.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.style.touchAction = '';
      if (chartInstance.current) { chartInstance.current.remove(); chartInstance.current = null; }
      seriesRef.current = null;
      computeTicksRef.current = null;
    };
  }, []);

  // 加载真实日线K线数据
  useEffect(() => {
    let cancelled = false;
    setChartLoading(true);
    setChartError(null);
    (async () => {
      const res = await fetchBollData(stock.code, 'daily', 'qfq');
      if (cancelled) return;
      if (res.data?.klines?.length) {
        const candles: ChartCandle[] = res.data.klines
          .map(k => ({ time: k.date, open: k.open, high: k.high, low: k.low, close: k.close }))
          .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
        setKlines(candles);
        setRawKlines([...res.data.klines].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)));
      } else {
        setChartError(res.error || '无K线数据');
      }
      setChartLoading(false);
    })();
    return () => { cancelled = true; };
  }, [stock.code]);

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
    const half = TICK_SIZE / 2;
    const rightLimit = cw - priceScaleW; // 绘图区右边界
    const ticks: OverlayTick[] = [];
    for (const m of demoMarkers) {
      const x = ts.timeToCoordinate(m.time);
      const y = series.priceToCoordinate(m.anchorPrice);
      if (x == null || y == null) continue;
      // 贴右缘/越界：方块右缘越过绘图区右边界即隐藏（K线回到展示区时坐标回落后自现）
      if (x + half > rightLimit) continue;
      // x 已在可视区但很贴边时也保留（方块相对较小），仅过滤出左缘/右缘完全在外的情况
      if (x < -24) continue;
      if (y < -40 || y > ch + 40) continue;
      ticks.push({ id: m.id, x, y, action: m.action });
    }
    setOverlayTicks(ticks);
  }, [demoMarkers]);

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
      computeTickPositions();
    });
    return () => cancelAnimationFrame(raf);
  }, [klines, demoMarkers, computeTickPositions]);

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
    setResult(runBacktest(src, { rules: strategy.rules, initialCapital: strategy.initialCapital, rangePreset: strategy.rangePreset, rangeStart: strategy.rangeStart, rangeEnd: strategy.rangeEnd }));
  };

  const rulesForRender = useMemo(() => rules.filter(() => true), [rules]);

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-app-bg">
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
                  <RuleEditor key={r.id} index={idx} value={r} onChange={patch => updateRule(r.id, patch)} onRemove={() => removeRule(r.id)} />
                ))}
              <button type="button" onClick={addRule} className="w-full flex items-center justify-center gap-1 rounded-lg border border-dashed border-app-border hover:bg-app-text/5 py-2 text-xs text-app-subtext hover:text-indigo-300 transition-colors" title="新增策略">
                <Plus size={14} />添加策略
              </button>
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
              {/* 覆盖层：B/S 买卖点标签（蓝框=卖/砖红框=买 + 点划线 + 圆点），锚定并跟随 K 线
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
                      {/* 圆角方块：底色随买卖（蓝=卖/砖红=买），选中态用描边高亮 */}
                      <rect
                        x={-half} y={-half}
                        width={TICK_SIZE} height={TICK_SIZE}
                        rx={TICK_RADIUS}
                        fill={color}
                        stroke={selected ? TICK_ACTIVE : 'none'}
                        strokeWidth={selected ? 1.5 : 0}
                        pointerEvents="all"
                      />
                      {/* 白色字母 */}
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
              </svg>
              {/* 缩放模式切换（单个按钮，点击在两种形态间切换）：置于左下角标尺空位 */}
              <button
                type="button"
                onClick={() => setZoomMode(prev => (prev === 'latest' ? 'cursor' : 'latest'))}
                className="absolute right-1 bottom-1 z-20 flex items-center gap-1 rounded-md border border-app-border bg-app-bg/80 px-1.5 py-0.5 text-[11px] font-medium text-app-subtext hover:text-app-text transition-colors"
                title={`缩放模式：${zoomMode === 'latest' ? '右缘锚（锚定最新价，缩放时最新K线不动）' : '指向锚（以指针指向的日期为中心）'}（点击切换）`}
              >
                {zoomMode === 'latest' ? '右缘锚' : '指向锚'}
              </button>
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
const RuleEditor: React.FC<RuleEditorProps> = ({ index, value, onChange, onRemove }) => {
  // 按 stable key 从目录取当前标签定义（用于分组显示）
  const current = BACKTEST_TAG_CATALOG.find(t => t.key === value.tagKey);
  // 目录按 group 聚合，用于 <optgroup> 分组
  const groups = useMemo(() => {
    const m = new Map<string, typeof BACKTEST_TAG_CATALOG>();
    for (const t of BACKTEST_TAG_CATALOG) {
      const arr = m.get(t.group) || [];
      arr.push(t);
      m.set(t.group, arr);
    }
    return Array.from(m.entries());
  }, []);

  return (
    <div className="rounded-lg border border-app-border bg-app-input/30 p-2 space-y-2">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-xs text-app-subtext cursor-pointer" onClick={e => e.preventDefault()}>
          <input type="checkbox" checked={value.enabled} onChange={e => onChange({ enabled: e.target.checked })} className="w-3.5 h-3.5 accent-indigo-500" />
          启用
        </label>
        <span className="text-xs text-app-rowtext">策略 {index + 1}</span>
        <button type="button" onClick={onRemove} className="text-app-subtext hover:text-brand-red transition-colors p-0.5" title="删除策略">
          <Trash2 size={13} />
        </button>
      </div>
      <select
        className="w-full bg-app-input border border-app-border rounded-lg px-2 py-1 text-xs leading-tight text-app-text outline-none"
        value={value.tagKey}
        onChange={e => {
          const t = BACKTEST_TAG_CATALOG.find(x => x.key === e.target.value);
          onChange(t ? { tagKey: t.key, label: t.label, action: t.action as BacktestRule['action'] } : { tagKey: e.target.value });
        }}
      >
        <option value="" disabled>选择标签…</option>
        {groups.map(([g, list]) => (
          <optgroup key={g} label={g}>
            {list.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </optgroup>
        ))}
      </select>
      {current && (
        <p className="text-[11px] text-app-subtext leading-tight">将触发至 {current.action === 'buy' ? '买入' : '卖出'}</p>
      )}
      <div className="flex items-center gap-1.5">
        <select
          className="flex-1 bg-app-input border border-app-border rounded-lg px-2 py-1 text-xs leading-tight font-semibold outline-none"
          value={value.action}
          onChange={e => onChange({ action: e.target.value as BacktestRule['action'] })}
        >
          <option value="buy" className="text-brand-red">买入</option>
          <option value="sell" className="text-blue-500">卖出</option>
        </select>
        <input
          type="number"
          min={1}
          max={100}
          value={value.pct}
          onChange={e => onChange({ pct: Math.max(1, Math.min(100, Number(e.target.value) || 0)) })}
          className="w-14 bg-app-input border border-app-border rounded-lg px-2 py-1 text-xs leading-tight font-mono text-app-text text-right outline-none"
        />
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