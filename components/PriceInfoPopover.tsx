// 「当日行情」浮窗 —— 单一实现，列表页价格列悬浮 与 回测图十字线悬浮 共用。
// 输入统一为 name/price/changePercent + 指标数据 + 定位坐标；顶部 OHLC、KDJ/RSI/MACD 只在这里写一份。
// 价格数据区（8 项基础行情 + KDJ/RSI/MACD）抽成 PriceIndicatorSection，供价格浮窗与标签弹窗复用，
// 确保两处数据与样式的实现完全一致，绝不各自另写一套。
import React from 'react';
import type { IndicatorResult } from '../services/indicators';
import { formatPrice, formatVolume } from '../services/indicators';

// 价格弹窗的「两组数据」渲染：
//   第一组：开/现/低/高/额/幅/量/量比（8 项）
//   第二组：KDJ (9,3,3) / RSI (6,12,24) / MACD (12,26,9)
// 标签弹窗把它放到「环境」区上方；价格浮窗用它作为主体。单一实现、共用同一份代码。
export function PriceIndicatorSection({ name, price, data }: { name: string; price: number | null; data: IndicatorResult }) {
  const d = data;
  const fmt = (v: number | null) => v == null ? '-' : formatPrice(v, name);
  const pctColor = d.changePct == null ? 'text-app-subtext' : d.changePct >= 0 ? 'text-brand-red' : 'text-brand-green';
  // 昨收价：现价 / (1 + 涨跌幅)
  const prevClose = (d.changePct == null || price == null || price <= 0) ? null : price / (1 + d.changePct / 100);
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
    if (d.changePct == null || price == null || price <= 0) return '-';
    return formatPrice(price - price / (1 + d.changePct / 100), name);
  })();
  const subRows = (label: string, vals: [string, string | null, string?][]) => (
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
  // 超买(数值偏高)用红色，超卖(数值偏低)用绿色
  const rsiColor = (v: number | null) => v == null ? undefined : (v > 70 ? 'text-brand-red' : v < 30 ? 'text-brand-green' : undefined);
  const kdjColor = (v: number | null, buyHigh: number, sellLow: number) => v == null ? undefined : (v > buyHigh ? 'text-brand-red' : v < sellLow ? 'text-brand-green' : undefined);
  return (
    <>
      <div className="mb-1 space-y-1">
        <div className="grid grid-cols-2 gap-x-4">{cell2('开', fmt(d.open), priceColor(d.open))}{cell2('现', price != null ? formatPrice(price, name) : '-', priceColor(price))}</div>
        <div className="grid grid-cols-2 gap-x-4">{cell2('低', fmt(d.low), priceColor(d.low))}{cell2('高', fmt(d.high), priceColor(d.high))}</div>
        <div className="grid grid-cols-2 gap-x-4">{cell2('额', changeAmount, pctColor)}{cell2('幅', fmtPct(d.changePct), pctColor)}</div>
        <div className="grid grid-cols-2 gap-x-4">{cell2('量', formatVolume(d.volume), volumeColor)}{cell2('量比', volumeRatioText, volumeColor)}</div>
      </div>
      <div className="border-t border-app-border my-1" />
      {subRows('KDJ (9, 3, 3)', [['K', numFmt(d.kdj.k), kdjColor(d.kdj.k, 80, 20)], ['D', numFmt(d.kdj.d), kdjColor(d.kdj.d, 80, 20)], ['J', numFmt(d.kdj.j), kdjColor(d.kdj.j, 100, 0)]])}
      {subRows('RSI (6, 12, 24)', [['6', numFmt(d.rsi.rsi6), rsiColor(d.rsi.rsi6)], ['12', numFmt(d.rsi.rsi12), rsiColor(d.rsi.rsi12)], ['24', numFmt(d.rsi.rsi24), rsiColor(d.rsi.rsi24)]])}
      {subRows('MACD (12, 26, 9)', [['DIF', numFmt(d.macd.dif, 3)], ['DEA', numFmt(d.macd.dea, 3)], ['MACD', numFmt(d.macd.macd, 3)]])}
    </>
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
  headerLeft?: React.ReactNode;      // 可选标题行左侧操作区（回测放"取消固定"按钮）
  dividendRate?: number | null;      // 当日股息率（%）；null/undefined 时不显示该行（仅回测十字线悬浮传）
}

export default function PriceInfoPopover({
  name, date, price, changePercent, data, loading, left, top, width = 210,
  innerRef, onMouseEnter, onMouseLeave, footer, headerLeft, dividendRate,
}: PriceInfoPopoverProps) {
  return (
    <div
      ref={innerRef}
      className="fixed z-[59] bg-app-input border border-slate-500/40 rounded-lg shadow-[0_8px_30px_rgba(0,0,0,0.55)] overflow-hidden"
      style={{ top, left, width }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="px-2.5 py-1.5 border-b border-app-border bg-app-input flex items-center relative">
        {headerLeft && <div className="flex items-center mr-1.5">{headerLeft}</div>}
        <span className="text-[11px] font-bold text-app-subtext">{name}</span>
        {date && <span className="ml-1 font-mono text-[10px] text-app-subtext font-normal leading-none">{date}</span>}
      </div>
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