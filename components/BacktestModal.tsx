import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, GripHorizontal, Play } from 'lucide-react';
import { createChart, ColorType, CandlestickSeries, LineSeries, TickMarkType } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, LineData, Time } from 'lightweight-charts';
import type { StockEntry } from '../types';
import { fetchBollData } from '../services/bollService';

type ChartCandle = { time: string; open: number; high: number; low: number; close: number };

export interface BacktestModalProps {
  stock: StockEntry;
  onClose: () => void;
}

interface RuleEditorProps {
  index: number;
  onRemove: () => void;
}

interface StatProps {
  label: string;
  value: string;
  className?: string;
}

const INPUT_CLS = 'bg-app-input border border-app-border rounded-lg px-2 py-1 text-[13px] leading-tight font-mono text-app-text outline-none';

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
  const [initialCapital, setInitialCapital] = useState(100000);
  const [rules, setRules] = useState<string[]>(['r1', 'r2']);
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ReturnType<IChartApi['addSeries']> | null>(null);
  const maSeriesRef = useRef<ISeriesApi<'Line'>[] | null>(null);
  const bollSeriesRef = useRef<ISeriesApi<'Line'>[] | null>(null);
  const [klines, setKlines] = useState<ChartCandle[] | null>(null);
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

    const zoomAnchorRight = (deltaY: number) => {
      const ts = chart.timeScale();
      const r = ts.getVisibleLogicalRange();
      if (!r) return;
      const width = r.to - r.from;
      const newWidth = clampBars(width * Math.pow(1.1, deltaY));
      ts.setVisibleLogicalRange({ from: Math.max(0, r.to - newWidth), to: r.to });
    };

    // 双指捏合(wheel 以 ctrlKey 标记)：捕获阶段拦截，阻断事件到达 lightweight 的原生 mouseWheel
    // 以免两套逻辑同时作用导致缩放几乎无效。灵敏度系数 1.004，比 1.0015 灵敏约 2.7 倍。
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // 非捏合：放行，交给 lightweight 原生 mouseWheel 平移
      if (e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      zoomAnchorRight(e.deltaY);
    };

    // 触屏 pinch：手势起始右缘为锚，随双指距离等比缩放左缘
    let pinchStart: { dist: number; range: { from: number; to: number } } | null = null;
    let pinchDist = 1;
    const distOf = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTouchStart = (e: TouchEvent) => {
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
        ts.setVisibleLogicalRange({
          from: Math.max(0, pinchStart.range.to - clampBars(width)),
          to: pinchStart.range.to,
        });
      }
    };
    const onTouchEnd = () => { pinchStart = null; };

    // 用捕获阶段接管 wheel：先于 lightweight 的 canvas 监听，避免捏合事件被原生平移截获
    el.addEventListener('wheel', onWheel, { capture: true, passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);

    // 兜底：容器尺寸变化（flex 拉伸/弹窗缩放）时强制重绘一次
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && el) {
      ro = new ResizeObserver(() => {
        const w = el.clientWidth, h = el.clientHeight;
        if (w > 0 && h > 50) { try { chart.resize(w, h); } catch { /* ignore */ } }
      });
      ro.observe(el);
    }
    return () => {
      ro?.disconnect();
      el.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.style.touchAction = '';
      if (chartInstance.current) { chartInstance.current.remove(); chartInstance.current = null; }
      seriesRef.current = null;
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
      } else {
        setChartError(res.error || '无K线数据');
      }
      setChartLoading(false);
    })();
    return () => { cancelled = true; };
  }, [stock.code]);

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
    // 布局稳定后再设置可视范围，确保默认精准显示最后 60 根（最新一根贴右缘）
    const raf = requestAnimationFrame(() => {
      const ts = chart.timeScale();
      const count = klines.length;
      const from = Math.max(0, count - 60);
      ts.setVisibleLogicalRange({ from, to: count });
      // 使最新一根锚定在右侧边缘：把可视范围右端对齐数据末尾
      ts.scrollToPosition(0, false);
    });
    return () => cancelAnimationFrame(raf);
  }, [klines]);

  // 按模式切换均线/布林线 series 的可见性
  useEffect(() => {
    if (!maSeriesRef.current || !bollSeriesRef.current) return;
    const showMA = indicatorMode === 'ma';
    maSeriesRef.current.forEach(s => s.applyOptions({ visible: showMA }));
    bollSeriesRef.current.forEach(s => s.applyOptions({ visible: !showMA }));
  }, [indicatorMode]);

  const addRule = () => setRules(prev => [...prev, `r${Date.now()}`]);
  const removeRule = (id: string) => setRules(prev => prev.filter(x => x !== id));

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
            <button type="button" className="flex items-center gap-1 rounded-lg bg-brand-red/90 hover:bg-brand-red px-2.5 py-1.5 text-xs font-semibold text-white transition-colors" title="运行回测">
              <Play size={13} />运行
            </button>
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
                <button type="button" onClick={addRule} className="flex items-center gap-0.5 rounded-lg hover:bg-app-text/5 px-2 py-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors" title="新增规则">
                  <Plus size={14} />规则
                </button>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-app-subtext">
                <span className="shrink-0">初始资金:</span>
                <input
                  type="number"
                  value={initialCapital}
                  onChange={e => setInitialCapital(Math.max(0, Number(e.target.value)))}
                  className={`${INPUT_CLS} flex-1 min-w-0`}
                />
                <span className="shrink-0">元</span>
              </label>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar px-2 py-1.5 space-y-1.5">
              {rulesForRender.length === 0 && (
                <p className="text-xs text-app-subtext text-center py-4">点击「+规则」添加策略</p>
              )}
              {rulesForRender.map(id => (
                <RuleEditor key={id} index={rules.indexOf(id)} onRemove={() => removeRule(id)} />
              ))}
            </div>
          </div>

          {/* 右：K线图 + 统计 + 记录表 */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-3 py-1.5 border-b border-app-border flex items-center gap-4 text-xs flex-wrap shrink-0">
              <Stat label="初始资金" value="100,000" />
              <Stat label="期末市值" value="—" />
              <Stat label="总收益" value="—" />
              <Stat label="胜率" value="—" />
              <Stat label="最大回撤" value="—" />
              <Stat label="交易次数" value="0" />
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
              <table className="w-full text-xs font-mono">
                <thead className="sticky top-0 bg-app-bg border-b border-app-border z-10">
                  <tr className="text-app-subtext text-[11px]">
                    <th className="px-2 py-1.5 text-left">日期</th>
                    <th className="px-2 py-1.5 text-left">标签</th>
                    <th className="px-2 py-1.5 text-center">操作</th>
                    <th className="px-2 py-1.5 text-right">价格</th>
                    <th className="px-2 py-1.5 text-right">股数</th>
                    <th className="px-2 py-1.5 text-right">金额</th>
                    <th className="px-2 py-1.5 text-right">持仓</th>
                    <th className="px-2 py-1.5 text-right">盈亏</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td colSpan={8} className="text-center py-4 text-app-subtext text-[12px]">{selectedTradeId ? '已选中一条记录（占位）' : '暂无交易记录'}</td>
                  </tr>
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

// 策略规则编辑行（纯UI）
const RuleEditor: React.FC<RuleEditorProps> = ({ index, onRemove }) => (
  <div className="rounded-lg border border-app-border bg-app-input/30 p-2 space-y-2">
    <div className="flex items-center justify-between">
      <label className="flex items-center gap-1.5 text-xs text-app-subtext cursor-pointer" onClick={e => e.preventDefault()}>
        <input type="checkbox" defaultChecked className="w-3.5 h-3.5 accent-indigo-500" />
        启用
      </label>
      <span className="text-xs text-app-rowtext">规则 {index + 1}</span>
      <button type="button" onClick={onRemove} className="text-app-subtext hover:text-brand-red transition-colors p-0.5" title="删除规则">
        <Trash2 size={13} />
      </button>
    </div>
    <select className="w-full bg-app-input border border-app-border rounded-lg px-2 py-1 text-xs leading-tight text-app-text outline-none">
      <option value="">选择标签…</option>
      <optgroup label="风系加仓"><option>缩量入场（低位）</option><option>放量突破均线</option></optgroup>
      <optgroup label="风系减仓"><option>缩量急拉</option><option>放量破位不收复</option></optgroup>
      <optgroup label="K线形态"><option>十字星</option><option>金针探底</option></optgroup>
    </select>
    <div className="flex items-center gap-1.5">
      <select className="flex-1 bg-app-input border border-app-border rounded-lg px-2 py-1 text-xs leading-tight font-semibold text-brand-red outline-none">
        <option>买入</option>
        <option>卖出</option>
      </select>
      <input type="number" min={1} max={100} defaultValue={50} className="w-14 bg-app-input border border-app-border rounded-lg px-2 py-1 text-xs leading-tight font-mono text-app-text text-right outline-none" />
      <span className="text-xs text-app-subtext">%</span>
    </div>
  </div>
);

// 统计概览条目
const Stat: React.FC<StatProps> = ({ label, value, className }) => (
  <div className="flex items-center gap-1">
    <span className="text-app-subtext text-xs">{label}</span>
    <span className={`font-mono font-semibold text-xs ${className || 'text-app-text'}`}>{value}</span>
  </div>
);