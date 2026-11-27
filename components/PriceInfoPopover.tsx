// 「当日行情」浮窗 —— 单一实现，列表页价格列悬浮 与 回测图十字线悬浮 共用。
// 输入统一为 name/price/changePercent + 指标数据 + 定位坐标；顶部 OHLC、KDJ/RSI/MACD 只在这里写一份。
// 价格数据区（8 项基础行情 + KDJ/RSI/MACD）抽成 PriceIndicatorSection，供价格浮窗与标签弹窗复用，
// 确保两处数据与样式的实现完全一致，绝不各自另写一套。
import React from 'react';
import { GripHorizontal } from 'lucide-react';
import type { IndicatorResult } from '../services/indicators';
import { formatPrice, formatVolume, prevCloseFromChange, priceVsPrevCloseBrandCls, EXTREME_LEVELS, extremeOf } from '../services/indicators';

// 价格弹窗的「两组数据」渲染：
//   第一组：开/现/低/高/额/幅/量/量比（8 项）
//   第二组：KDJ (9,3,3) / RSI (6,12,24) / MACD (12,26,9)
// 标签弹窗把它放到「环境」区上方；价格浮窗用它作为主体。单一实现、共用同一份代码。
// 回测页的"悬停行情信息栏"（PriceIndicatorBar）也复用同一份取值/配色模型，
// 保证浮窗与信息栏的数值与颜色口径完全一致。
export interface PriceIndicatorCell { key: string; label: string; text: string; cls: string }
export interface PriceIndicatorGroup { key: string; label: string; items: Array<{ key: string; label: string; text: string; cls?: string }> }
export interface PriceIndicatorModel {
  cells: PriceIndicatorCell[];
  groups: PriceIndicatorGroup[];
}

export function buildPriceIndicatorModel(name: string, price: number | null, data: IndicatorResult): PriceIndicatorModel {
  const d = data;
  const fmt = (v: number | null) => v == null ? '-' : formatPrice(v, name);
  const pctColor = d.changePct == null ? 'text-app-subtext' : d.changePct >= 0 ? 'text-brand-red' : 'text-brand-green';
  // 昨收价：现价 / (1 + 涨跌幅)，复用共享推导（与列表页价格列同一来源）
  const prevClose = prevCloseFromChange(price, d.changePct);
  // 开/现/低/高 各自与昨收价比较着色（符合正规交易软件规则）；判定与配色方案均复用共享实现
  const priceColor = (v: number | null) => priceVsPrevCloseBrandCls(v, prevClose);
  const fmtPct = (v: number | null) => v == null ? '-' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
  const numFmt = (v: number | null, dec = 2) => v == null ? '-' : v.toFixed(dec);
  const volumeRatioText = (() => {
    if (d.volume == null || d.volumeMa5 == null || d.volumeMa5 === 0) return '-';
    return (d.volume / d.volumeMa5).toFixed(2);
  })();
  const volumeColor = d.volume != null && d.volumeMa5 != null && d.volumeMa5 !== 0
    ? (d.volume >= d.volumeMa5 ? 'text-brand-red' : 'text-brand-green')
    : 'text-app-rowtext';
  const changeAmount = (() => {
    if (d.changePct == null || price == null || price <= 0) return '-';
    return formatPrice(price - price / (1 + d.changePct / 100), name);
  })();
  // 超买(数值偏高)用红色，超卖(数值偏低)用绿色；阈值与超买/超卖标签共用 EXTREME_LEVELS
  const extremeCls = (v: number | null, high: number, low: number) => {
    const side = extremeOf(v, high, low);
    return side === 'over' ? 'text-brand-red' : side === 'under' ? 'text-brand-green' : undefined;
  };
  const rsiColor = (v: number | null) => extremeCls(v, EXTREME_LEVELS.rsiHigh, EXTREME_LEVELS.rsiLow);
  const kdjColor = (v: number | null, high: number, low: number) => extremeCls(v, high, low);
  return {
    cells: [
      { key: 'price', label: '现', text: price != null ? formatPrice(price, name) : '-', cls: priceColor(price) },
      { key: 'high', label: '高', text: fmt(d.high), cls: priceColor(d.high) },
      { key: 'open', label: '开', text: fmt(d.open), cls: priceColor(d.open) },
      { key: 'low', label: '低', text: fmt(d.low), cls: priceColor(d.low) },
      { key: 'amount', label: '额', text: changeAmount, cls: pctColor },
      { key: 'pct', label: '幅', text: fmtPct(d.changePct), cls: pctColor },
      { key: 'volume', label: '量', text: formatVolume(d.volume).replace(/手$/, ''), cls: volumeColor },
      { key: 'volumeRatio', label: '量比', text: volumeRatioText, cls: volumeColor },
    ],
    groups: [
      {
        key: 'kdj',
        label: 'KDJ (9, 3, 3)',
        items: [
          { key: 'k', label: 'K', text: numFmt(d.kdj.k), cls: kdjColor(d.kdj.k, 80, 20) },
          { key: 'd', label: 'D', text: numFmt(d.kdj.d), cls: kdjColor(d.kdj.d, 80, 20) },
          { key: 'j', label: 'J', text: numFmt(d.kdj.j), cls: kdjColor(d.kdj.j, 100, 0) },
        ],
      },
      {
        key: 'rsi',
        label: 'RSI (6, 12, 24)',
        items: [
          { key: '6', label: '6', text: numFmt(d.rsi.rsi6), cls: rsiColor(d.rsi.rsi6) },
          { key: '12', label: '12', text: numFmt(d.rsi.rsi12), cls: rsiColor(d.rsi.rsi12) },
          { key: '24', label: '24', text: numFmt(d.rsi.rsi24), cls: rsiColor(d.rsi.rsi24) },
        ],
      },
      {
        key: 'macd',
        label: 'MACD (12, 26, 9)',
        items: [
          { key: 'dif', label: 'DIF', text: numFmt(d.macd.dif, 3), cls: '' },
          { key: 'dea', label: 'DEA', text: numFmt(d.macd.dea, 3), cls: '' },
          { key: 'macd', label: 'MACD', text: numFmt(d.macd.macd, 3), cls: '' },
        ],
      },
    ],
  };
}

export function PriceIndicatorSection({ name, price, data }: { name: string; price: number | null; data: IndicatorResult }) {
  const { cells, groups } = buildPriceIndicatorModel(name, price, data);
  const cell2 = (label: string, val: React.ReactNode, colorClass = 'text-app-rowtext') => (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[10px] text-app-subtext whitespace-nowrap">{label}</span>
      <span className={`font-mono text-[11px] ${colorClass}`}>{val}</span>
    </div>
  );
  const subRows = (label: string, vals: Array<[string, string, string?]>) => (
    <div className="py-[3px]">
      <div className="text-[10px] text-app-subtext mb-0.5">{label}</div>
      <div className="flex gap-2">
        {vals.map(([k, v, c]) => (
          <span key={k} className="flex-1 text-center font-mono text-[10px] text-app-rowtext">
            <span>{k}<span>:</span></span>
            <span className={c ?? ''}>{v}</span>
          </span>
        ))}
      </div>
    </div>
  );
  return (
    <>
      <div className="mb-1 space-y-1">
        {[0, 2, 4, 6].map(i => (
          <div key={i} className="grid grid-cols-2 gap-x-4">
            {cell2(cells[i].label, cells[i].text, cells[i].cls)}
            {cell2(cells[i + 1].label, cells[i + 1].text, cells[i + 1].cls)}
          </div>
        ))}
      </div>
      <div className="border-t border-app-border my-1" />
      {groups.map(g => subRows(g.label, g.items.map(it => [it.label, it.text, it.cls] as [string, string, string?])))}
    </>
  );
}

// 回测页「悬停行情信息」：把价格浮窗里的数据区拆成两块，供页面上不同位置复用。
// 与浮窗共用 buildPriceIndicatorModel，数值/配色口径一致。
//   PriceIndicatorCells —— 日期 + 现/高/开/低/额/幅/量/量比 + 股息率（接在指标控件条 BOLL/MA 数值右侧）
//   PriceIndicatorGroups —— KDJ / RSI / MACD（单独一行，右侧可挂当日信号）
function cellItem(label: string, text: string, cls?: string) {
  return (
    <span key={label} className="shrink-0 inline-flex items-baseline gap-1.5 font-mono text-xs whitespace-nowrap">
      <span className="text-app-subtext">{label}</span>
      <span className={cls ?? 'text-app-rowtext'}>{text}</span>
    </span>
  );
}

export function PriceIndicatorCells({
  name, price, data, dividendRate,
}: {
  name: string;
  price: number | null;
  data: IndicatorResult | null;
  dividendRate?: number | null;
}) {
  if (!data) return null;
  const { cells } = buildPriceIndicatorModel(name, price, data);
  return (
    <div className="flex items-center gap-3 shrink-0 ml-auto">
      {[...cells].reverse().map(c => cellItem(c.label, c.text, c.cls))}
      {dividendRate != null && cellItem('股息率', `${dividendRate.toFixed(2)}%`)}
    </div>
  );
}

export function PriceIndicatorGroups({
  name, price, data, date, signal, pinned,
}: {
  name: string;
  price: number | null;
  data: IndicatorResult | null;
  date?: string | null;
  /** 同行左侧：当日信号（chip 行 + 浮层详情）。 */
  signal?: React.ReactNode;
  /** 已固定：日期用主题色标出，提示当前数据已钉住不再跟随鼠标。 */
  pinned?: boolean;
}) {
  // 固定行高 + 隐藏滚动条：避免不同交易日的数字宽度/信号数量变化触发横向滚动条显隐，
  // 导致信息栏高度抖动（连带 K 线图上下跳）。
  const ROW = 'flex-1 min-w-0 overflow-x-auto flex items-center gap-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
  if (!data) {
    return (
      <div className="px-3 h-6 flex items-center text-[10px] text-app-subtext select-none">
        将鼠标移到 K 线上查看该交易日的行情与指标
      </div>
    );
  }
  const { groups } = buildPriceIndicatorModel(name, price, data);
  return (
    <div className="relative px-3 h-6 flex items-center gap-3 select-none">
      <div className={ROW}>
        {groups.map(g => (
          <span key={g.key} className="shrink-0 inline-flex items-baseline gap-2 whitespace-nowrap">
            <span className="text-[10px] text-app-subtext">{g.label}</span>
            {g.items.map(it => (
              <span key={it.key} className="inline-flex items-baseline gap-1 font-mono text-[10px]">
                <span className="text-app-subtext">{it.label}</span>
                <span className={it.cls || 'text-app-rowtext'}>{it.text}</span>
              </span>
            ))}
          </span>
        ))}
      </div>
      {/* 当日信号紧挨日期左侧，两者一起贴最右 */}
      {signal && <div className="shrink-0 flex items-center">{signal}</div>}
      {date && (
        <span
          className={`shrink-0 ml-auto font-mono text-[10px] ${pinned ? 'text-indigo-400 font-semibold' : 'text-app-subtext'}`}
          title={pinned ? '已固定：再次点击图表取消固定' : '点击图表固定当日数据'}
        >
          {date}
        </span>
      )}
    </div>
  );
}

export interface PriceInfoPopoverProps {
  name: string;
  date?: string | null;              // 该行情对应的交易日（如 '2026-09-22'）；标题股票名后展示
  price: number | null;              // 现价：列表页=实时价；回测=悬停那根的收盘价
  changePercent: number | null;      // 涨跌幅（%）：列表页=实时；回测=该根相对昨收
  data: IndicatorResult | null;
  loading: boolean;
  left: number;
  top: number;
  width?: number;
  innerRef?: React.Ref<HTMLDivElement>;
  onMouseEnter?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave?: (e: React.MouseEvent<HTMLDivElement>) => void;
  footer?: React.ReactNode;          // 可选底部追加区（回测叠"当日信号标签"行）
  headerLeft?: React.ReactNode;      // 可选标题栏右侧操作区（回测放"取消固定"按钮）
  dividendRate?: number | null;      // 当日股息率（%）；null/undefined 时不显示该行（仅回测十字线悬浮传）
  interactive?: boolean;             // 是否接收鼠标事件；false=鼠标穿透（不拦截图表的十字线悬停），默认 true
  onTitlePointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void; // 标题栏拖拽（传入即可拖动浮窗）
}

// 弹窗标题栏 —— 单一实现：价格弹窗（列表页价格列悬浮）、支撑/压力位弹窗 共用。
// 样式照搬价格弹窗：左侧拖拽把手 + 加粗标题（+可选小号日期），右侧操作按钮区。
export function PopoverTitleBar({
  title,
  date,
  onPointerDown,
  onMouseDown,
  onClick,
  right,
}: {
  title: React.ReactNode;
  date?: string | null;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  right?: React.ReactNode;
}) {
  return (
    <div
      onPointerDown={onPointerDown}
      onMouseDown={onMouseDown}
      onClick={onClick}
      className={`bg-app-bg/80 backdrop-blur-md px-3 py-2 flex items-center justify-between border-b border-app-border${onPointerDown ? ' cursor-grab active:cursor-grabbing touch-none select-none group' : ''}`}
    >
      <div className="flex items-center gap-2 text-app-subtext pointer-events-none">
        <GripHorizontal size={15} className="opacity-80 shrink-0" />
        <h4 className="text-[12px] font-bold tracking-wider text-app-rowtext">
          {title}
          {date && <span className="font-mono text-[9px] font-normal text-app-rowtext ml-1">{date}</span>}
        </h4>
      </div>
      {right && <div className="flex items-center gap-1">{right}</div>}
    </div>
  );
}

// 弹窗标题栏拖拽 —— 单一实现：价格弹窗与支撑/压力位弹窗共用同一套拖动逻辑。
// 传入浮窗 ref 与设置 top/left 的 setter，返回的 onPointerDown 交给 PopoverTitleBar 即可拖动。
export function usePopoverDrag(
  ref: React.RefObject<HTMLElement | null>,
  setTop: (n: number) => void,
  setLeft: (n: number) => void,
) {
  const offset = React.useRef({ x: 0, y: 0 });
  const onMove = React.useCallback((e: PointerEvent) => {
    setLeft(e.clientX - offset.current.x);
    setTop(e.clientY - offset.current.y);
  }, [setLeft, setTop]);
  const onEnd = React.useCallback(() => {
    document.body.style.cursor = '';
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onEnd);
    window.removeEventListener('pointercancel', onEnd);
  }, [onMove]);
  // 卸载时兜底移除监听，避免拖拽过程中浮窗被关闭造成监听泄漏
  React.useEffect(() => () => onEnd(), [onEnd]);
  const onPointerDown = React.useCallback((e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = el.getBoundingClientRect();
    offset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    document.body.style.cursor = 'grabbing';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  }, [ref, onMove, onEnd]);
  return { onPointerDown };
}

export default function PriceInfoPopover({
  name, date, price, changePercent, data, loading, left, top, width = 210,
  innerRef, onMouseEnter, onMouseLeave, footer, headerLeft, dividendRate, interactive = true, onTitlePointerDown,
}: PriceInfoPopoverProps) {
  return (
    <div
      ref={innerRef}
      className="fixed z-[59] bg-app-input border border-slate-500/40 rounded-lg shadow-[0_8px_30px_rgba(0,0,0,0.55)] overflow-hidden"
      style={{ top, left, width, pointerEvents: interactive ? undefined : 'none' }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <PopoverTitleBar title={name} date={date} right={headerLeft} onPointerDown={onTitlePointerDown} />
      <div className="px-2.5 py-1.5 bg-app-card">
        {loading && <div className="text-[10px] text-app-subtext py-2 text-center">加载中…</div>}
        {!loading && !data && <div className="text-[10px] text-app-subtext py-2 text-center">暂无数据</div>}
        {!loading && data && <PriceIndicatorSection name={name} price={price} data={data} />}
        {dividendRate != null && (
          <div className="flex items-baseline justify-start gap-2 border-t border-app-border pt-1 mt-1">
            <span className="text-[10px] text-app-subtext whitespace-nowrap">股息率</span>
            <span className="font-mono text-[10px] text-app-rowtext">{dividendRate.toFixed(2)}%</span>
          </div>
        )}
        {footer}
      </div>
    </div>
  );
}