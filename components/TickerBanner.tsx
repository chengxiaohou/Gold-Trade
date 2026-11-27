// 滚动播报条：把「持仓买入单涨跌提醒」做成广告牌式横向循环滚动。
// 数据由 services/tradeTicker.buildTickerItems 统一计算（与交易弹窗做T浮盈同源），本组件只负责展示与动画。
// 动画用 rAF 手动推进 transform（合成层），不触发重排：
//   · 鼠标移入暂停，移出继续（从当前位置续播，不回到开头）；
//   · 滚轮/触控板可手动横向拨动（触控板双指左右 = deltaX，普通鼠标滚轮 = deltaY，统一换算成横向位移），
//     拨动后位置会被归一化到 [−内容宽, 0]，循环依旧无缝。
import React, { useEffect, useRef, useState } from 'react';
import type { TickerItem } from '../services/tradeTicker';

const SCROLL_SPEED = 55; // 像素/秒
const RESUME_DELAY_MS = 500; // 暂停解除后等待多久才继续滚动（毫秒）

const formatDay = (ts: number): string => {
  if (!ts) return '-';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};
const fmtAmount = (v: number): string => `¥${Math.abs(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// 涨跌幅展示与列表「涨跌幅」列同口径：带正负号，如 +5.23% / -3.10%
const formatPct = (v: number): string => `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(2)}%`;

function TickerGroup({ items, groupKey, trailingSeparator, onLotClick }: {
  items: TickerItem[];
  groupKey?: string;
  trailingSeparator?: boolean;
  onLotClick?: (stockId: string, anchor: HTMLElement) => void;
}) {
  // 悬停某一笔播报时，只给该笔里的着色文字加下划线（颜色随自身文字色）
  const U = 'group-hover/lot:underline decoration-1 underline-offset-2';
  const clickable = !!onLotClick && !groupKey;
  const open = (stockId: string, e: React.MouseEvent<HTMLElement>) => {
    if (clickable) onLotClick?.(stockId, e.currentTarget as HTMLElement);
  };
  return (
    <div className="flex items-center shrink-0" aria-hidden={groupKey ? true : undefined}>
      {items.map((item, i) => {
        // 挂单条目统一用交易列的「挂单橙」（text-orange-400）；持仓买入仍按涨红跌绿
        const isPending = item.kind !== 'position';
        const color = isPending ? 'text-orange-400' : item.dir === 'up' ? 'text-brand-red' : 'text-brand-green';
        return (
          <span key={`${groupKey ?? ''}${item.stockId}-${item.dir}-${item.kind}`} className="flex items-baseline whitespace-nowrap text-[11px] font-semibold leading-none">
            {i > 0 && <span className="text-app-border mx-2">｜</span>}
            {/* 股票名可点但不加下划线 */}
            <span
              onClick={(e) => open(item.stockId, e)}
              className={`${color}${clickable ? ' cursor-pointer' : ''}`}
            >【{item.stockName}】</span>
            {item.lots.map((lot, j) => (
              // 按交易单区分点击区域：整笔（含灰色文字）可点，下划线只出现在该笔的着色文字上
              <button
                key={j}
                type="button"
                disabled={!clickable}
                onClick={(e) => { if (clickable) onLotClick?.(item.stockId, e.currentTarget); }}
                className={`inline-flex items-baseline bg-transparent border-0 p-0 m-0 text-left font-semibold group/lot${clickable ? ' cursor-pointer' : ''}`}
              >
                {/* 同一只股票不同单子之间用 - 分隔（股票之间仍用 ｜） */}
                {j > 0 && <span className="text-app-subtext mx-1.5">{'-'}</span>}
                <span className="text-app-subtext font-mono">{formatDay(lot.date)}</span>
                {/* 整行统一字号/字重，只用颜色区分主次与涨跌 */}
                <span className={`${color} mx-1 ${U}`}>{lot.statusLabel}</span>
                {lot.pct != null && (
                  // 涨跌幅与列表涨跌幅列一致：正负号 + 数字整体着色（红涨绿跌）
                  <span className={`font-mono ${color} ${U}`}>{formatPct(lot.pct)}</span>
                )}
                {lot.amount != null && (
                  <>
                    <span className="text-app-subtext ml-1">可获利</span>
                    <span className={`font-mono text-brand-red ml-1 ${U}`}>{fmtAmount(lot.amount)}</span>
                  </>
                )}
                {/* 挂单价差：着色规则与列表「交易」列一致 —— 只有已到价（可能已成交）才橙，
                    未到价保持普通行文字灰；「即将成交 / 当日过期」等说明文字一律中性灰 */}
                {lot.gapPct != null && (
                  <span className={`font-mono ml-1 ${lot.likelyFill ? `text-orange-400 ${U}` : 'text-app-subtext'}`}>{formatPct(lot.gapPct)}</span>
                )}
                {lot.note && <span className="text-app-subtext ml-1">{lot.note}</span>}
              </button>
            ))}
            {item.hiddenCount > 0 && <span className="text-app-subtext ml-1">等 {item.hiddenCount} 单</span>}
          </span>
        );
      })}
      {/* 两份内容首尾相接时，用统一的尾部分隔符保证两组宽度完全一致（循环位移无接缝） */}
      {trailingSeparator && <span className="text-app-border mx-2">｜</span>}
    </div>
  );
}

export default function TickerBanner({ items, emptyText, onLotClick }: {
  items: TickerItem[];
  emptyText?: string;
  onLotClick?: (stockId: string, anchor: HTMLElement) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  // 位移与内容宽度放在 ref 里：动画/滚轮都直接写 transform，不触发 React 重渲染
  const offsetRef = useRef(0);
  const contentWidthRef = useRef(0);
  const pausedRef = useRef(false);
  // 恢复滚动的等待截止时间（performance.now 口径）：暂停解除后需等待 RESUME_DELAY_MS 才继续滚动
  const resumeAtRef = useRef(0);
  const pauseAuto = () => { pausedRef.current = true; };
  const resumeAuto = () => {
    pausedRef.current = false;
    resumeAtRef.current = performance.now() + RESUME_DELAY_MS;
  };

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
  // 恢复滚动统一走 resumeAuto()：解除暂停后再等 0.5 秒才继续，避免刚松手/刚移出就突然动起来
  useEffect(() => {
    if (!animate) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      if (!pausedRef.current && now >= resumeAtRef.current) {
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

  // 触屏 / 指针拖动：手指按下即暂停滚动，横向拖动直接跟手移动内容；纵向滑动则让给页面滚动。
  // 用原生 pointer 事件（而非 React 合成事件）直接写 transform，减少一层事件派发与批处理延迟。
  const suppressClickRef = useRef(false);
  // 指针（手指/笔）是否仍按在屏幕上：用于屏蔽 iOS 在触摸期间合成的 mouseleave，
  // 避免手指滑出热区就被误判为「悬停结束」而恢复自动滚动。
  const pointerActiveRef = useRef(false);
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let drag: { x: number; y: number; lastX: number; moved: number; locked: boolean } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, lastX: e.clientX, moved: 0, locked: false };
      pointerActiveRef.current = true;
      pauseAuto();
      // 立即捕获指针：手指滑出热区后仍能持续收到 move 事件（与原生可滚动控件一致）
      try { wrap.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      if (!drag.locked) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        // 纵向意图更明显（且超过阈值）时放弃横向拖动，交给页面纵向滚动
        if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
          drag = null;
          pointerActiveRef.current = false;
          resumeAuto();
          return;
        }
        if (Math.abs(dx) < 4) return;
        drag.locked = true;
        drag.lastX = e.clientX;
        return;
      }
      const step = e.clientX - drag.lastX;
      drag.lastX = e.clientX;
      drag.moved += Math.abs(step);
      if (!(contentWidthRef.current > 0)) return;
      offsetRef.current += step; // 1:1 跟手，不取反
      normalize();
      applyTransform();
    };
    const onUp = () => {
      const d = drag;
      drag = null;
      pointerActiveRef.current = false;
      if (d && d.moved > 8) {
        // 拖动后抬手不应触发播报条的点击（打开交易弹窗）
        suppressClickRef.current = true;
        window.setTimeout(() => { suppressClickRef.current = false; }, 0);
      }
      resumeAuto();
    };
    wrap.addEventListener('pointerdown', onDown);
    wrap.addEventListener('pointermove', onMove);
    wrap.addEventListener('pointerup', onUp);
    wrap.addEventListener('pointercancel', onUp);
    return () => {
      wrap.removeEventListener('pointerdown', onDown);
      wrap.removeEventListener('pointermove', onMove);
      wrap.removeEventListener('pointerup', onUp);
      wrap.removeEventListener('pointercancel', onUp);
    };
  }, []);

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
      // 横向手势由本组件接管，纵向仍交给页面滚动
      style={{ touchAction: 'pan-y' }}
      onMouseEnter={() => { pauseAuto(); }}
      onMouseLeave={() => { if (!pointerActiveRef.current) resumeAuto(); }}
      onClickCapture={(e) => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <div ref={trackRef} className="flex w-max items-center will-change-transform">
        <div ref={groupRef} className="shrink-0">
          <TickerGroup items={items} trailingSeparator={animate} onLotClick={onLotClick} />
        </div>
        {animate && <TickerGroup items={items} groupKey="dup-" trailingSeparator />}
      </div>
    </div>
  );
}
