// 滚动播报条：把「持仓买入单涨跌提醒」做成广告牌式横向循环滚动。
// 数据由 services/tradeTicker.buildTickerItems 统一计算（与交易弹窗做T浮盈同源），本组件只负责展示与动画。
// 动画用 rAF 手动推进 transform（合成层），不触发重排：
//   · 鼠标移入暂停，移出继续（从当前位置续播，不回到开头）；
//   · 滚轮/触控板可手动横向拨动（触控板双指左右 = deltaX，普通鼠标滚轮 = deltaY，统一换算成横向位移），
//     拨动后位置会被归一化到 [−内容宽, 0]，循环依旧无缝。
import React, { useEffect, useRef, useState } from 'react';
import type { TickerItem } from '../services/tradeTicker';

const SCROLL_SPEED = 55; // 像素/秒

const formatDay = (ts: number): string => {
  if (!ts) return '-';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};
const fmtAmount = (v: number): string => `¥${Math.abs(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// 涨跌幅展示与列表「涨跌幅」列同口径：带正负号，如 +5.23% / -3.10%
const formatPct = (v: number): string => `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(2)}%`;

function TickerGroup({ items, groupKey, trailingSeparator }: { items: TickerItem[]; groupKey?: string; trailingSeparator?: boolean }) {
  return (
    <div className="flex items-center shrink-0" aria-hidden={groupKey ? true : undefined}>
      {items.map((item, i) => {
        const color = item.dir === 'up' ? 'text-brand-red' : 'text-brand-green';
        return (
          <span key={`${groupKey ?? ''}${item.stockId}-${item.dir}-${item.kind}`} className="flex items-baseline whitespace-nowrap text-[11px] font-semibold leading-none">
            {i > 0 && <span className="text-app-border mx-3">｜</span>}
            <span className={color}>【{item.stockName}】</span>
            {item.lots.map((lot, j) => (
              <span key={j} className="flex items-baseline">
                {/* 同一只股票不同单子之间用 & 分隔（股票之间仍用 ｜） */}
                {j > 0 && <span className="text-app-subtext mx-1.5">{'&'}</span>}
                <span className="text-app-subtext font-mono">{formatDay(lot.date)}</span>
                {/* 整行统一字号/字重，只用颜色区分主次与涨跌 */}
                <span className={`${color} mx-1`}>{lot.statusLabel}</span>
                {lot.pct != null && (
                  // 涨跌幅与列表涨跌幅列一致：正负号 + 数字整体着色（红涨绿跌）
                  <span className={`font-mono ${color}`}>{formatPct(lot.pct)}</span>
                )}
                {lot.amount != null && (
                  <>
                    <span className="text-app-subtext ml-1">可获利</span>
                    <span className="font-mono text-brand-red ml-1">{fmtAmount(lot.amount)}</span>
                  </>
                )}
                {/* 挂单补充说明：即将成交用中性色，即将过期用橙色提醒 */}
                {lot.note && (
                  <span className={`ml-1 ${item.kind === 'expiring' ? 'text-orange-400' : 'text-app-subtext'}`}>{lot.note}</span>
                )}
              </span>
            ))}
            {item.hiddenCount > 0 && <span className="text-app-subtext ml-1">等 {item.hiddenCount} 单</span>}
          </span>
        );
      })}
      {/* 两份内容首尾相接时，用统一的尾部分隔符保证两组宽度完全一致（循环位移无接缝） */}
      {trailingSeparator && <span className="text-app-border mx-3">｜</span>}
    </div>
  );
}

export default function TickerBanner({ items, emptyText }: { items: TickerItem[]; emptyText?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  // 位移与内容宽度放在 ref 里：动画/滚轮都直接写 transform，不触发 React 重渲染
  const offsetRef = useRef(0);
  const contentWidthRef = useRef(0);
  const pausedRef = useRef(false);

  const applyTransform = () => {
    const el = trackRef.current;
    if (el) el.style.transform = `translate3d(${offsetRef.current}px, 0, 0)`;
  };
  // 位移归一化到 (-内容宽, 0]：手动拨动越界后仍能无缝循环
  const normalize = () => {
    const w = contentWidthRef.current;
    if (!(w > 0)) return;
    while (offsetRef.current <= -w) offsetRef.current += w;
    while (offsetRef.current > 0) offsetRef.current -= w;
  };

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const apply = () => setReduceMotion(mq.matches);
    apply();
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, []);

  // 内容比容器宽才滚动。
  // 只做「测量 + 归一化」，绝不重置位移：价格刷新/BOLL 拉取等后台动作导致的重渲染
  // 会让 items 引用变化、ResizeObserver 触发，如果这里归零就会表现为「滚动顿一下」。
  const hasItems = items.length > 0;
  useEffect(() => {
    const wrap = wrapRef.current;
    const group = groupRef.current;
    if (!wrap || !group) return;
    const measure = () => {
      const w = group.scrollWidth;
      contentWidthRef.current = w;
      const need = w > wrap.clientWidth + 4;
      setScrollable(prev => (prev === need ? prev : need));
      normalize();
      applyTransform();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    ro.observe(group);
    return () => ro.disconnect();
  }, [hasItems]);

  const animate = scrollable && !reduceMotion;

  // rAF 推进：暂停时只保留当前位移，不前进（滚轮仍可改 offset）
  useEffect(() => {
    if (!animate) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      if (!pausedRef.current) {
        offsetRef.current -= (SCROLL_SPEED * dt) / 1000;
        normalize();
      }
      applyTransform();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animate]);

  // 滚轮 / 触控板横向拨动：主轴是 deltaX（双指左右）就用 deltaX，否则用 deltaY（鼠标滚轮竖向）换算成横向
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !scrollable) return;
    const onWheel = (e: WheelEvent) => {
      if (!(contentWidthRef.current > 0)) return;
      e.preventDefault();
      // 方向取反：与用户直觉一致（横向拨动的位移方向整体反转）
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? -e.deltaX : e.deltaY;
      offsetRef.current += delta;
      normalize();
      applyTransform();
    };
    wrap.addEventListener('wheel', onWheel, { passive: false });
    return () => wrap.removeEventListener('wheel', onWheel);
  }, [scrollable]);

  if (items.length === 0) {
    return (
      <div className="flex-1 min-w-0 h-5 flex items-center text-[11px] font-semibold text-app-subtext whitespace-nowrap truncate">
        {emptyText ?? '暂无触发播报的持仓'}
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      className="flex-1 min-w-0 h-5 flex items-center overflow-hidden select-none"
      onMouseEnter={() => { pausedRef.current = true; }}
      onMouseLeave={() => { pausedRef.current = false; }}
    >
      <div ref={trackRef} className="flex w-max items-center will-change-transform">
        <div ref={groupRef} className="shrink-0">
          <TickerGroup items={items} trailingSeparator={animate} />
        </div>
        {animate && <TickerGroup items={items} groupKey="dup-" trailingSeparator />}
      </div>
    </div>
  );
}
