import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { bollBandLabel, buildBollBandTextParts } from '../services/bollService';
import type { BollBandInfo, BollPeriod, BollStreakExplain, BollStreakStep } from '../services/bollService';

/**
 * 布林线「连续天数」解释浮窗：长按日线单元格触发，无论是否有计数都给出带数据的解释。
 * 架构与 PairTip / FeeTip 一致：骨架 DOM 一次性渲染（Portal 到 body，初始隐藏），
 * 触发时直接操作 DOM 重建内容并读取真实宽高后定位，避免大列表 React 重渲染。
 * 交互：长按 600ms 出现并固定，点击浮窗外部或再次按下单元格收起；
 * 长按后随后的 click 会被拦截，避免同时打开 BOLL 弹窗（沿用页面既有长按标记拦截约定）。
 * 内容全部来自 bollService 的 explainBollBandStreak（SSOT），本组件不做任何计数判定。
 */

const BAND_CLS: Record<BollBandInfo['band'], string> = {
  upper: 'text-brand-red',
  mid: 'text-blue-500',
  lower: 'text-brand-green',
};
const REASON_TEXT: Record<BollStreakStep['reason'], string> = {
  counted: '计入',
  'counter-arrow': '反向箭头',
  'band-mid': '日中',
  'no-boll': '无BOLL',
  insufficient: '不足20根',
};

// 列宽固定，header 与数据行共用，保证对齐
const COL_DATE = 'w-[42px] text-left';
const COL_CLOSE = 'w-[52px] text-right';
const COL_TRACK = 'w-[46px] text-center';
const COL_PCT = 'w-[48px] text-right';
const COL_VERDICT = 'w-[62px] text-right';

const ROW_CLS = 'flex items-center gap-1.5 whitespace-nowrap';

function fmtDate(d: string): string {
  const parts = d.split('-');
  return parts.length === 3 ? `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}` : d;
}

/** 轨道列文字：与列表单元格同一套拼装（SSOT）——连续天数数字写在「日上/日下」前面 */
function trackText(step: BollStreakStep, period: BollPeriod): string {
  if (!step.band) return '-';
  const parts = buildBollBandTextParts(
    period, step.band,
    { arrowCount: step.arrowCount, dir: step.dir, counterArrow: step.counterArrow },
    step.streak,
  );
  return `${parts.streakText}${parts.arrowBefore}${parts.label}${parts.arrowAfter}`;
}

interface Props {
  /** 来自 explainBollBandStreak；null = K 线不足 20 根，无法回溯 */
  explain: BollStreakExplain | null;
  /** 当前单元格的轨道判定（来自 getBollPosition） */
  pos: BollBandInfo | null;
  /** 周期（日线为 daily）：轨道标签与展示口径统一由 bollService 的共享实现产出 */
  period: BollPeriod;
  fmtPrice: (v: number) => string;
  children: React.ReactNode;
}

const BollStreakTip: React.FC<Props> = ({ explain, pos, period, fmtPrice, children }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const conclusionRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const rafRef = useRef<number | null>(null);
  const pressTimerRef = useRef<number | null>(null);
  /** 长按是否已触发：用于拦截随后的 click，避免同时打开 BOLL 弹窗 */
  const longPressFiredRef = useRef(false);
  /** 浮窗是否已固定（固定后点击外部收起） */
  const pinnedRef = useRef(false);

  // 结论行文案 + 配色（有计数用轨道色，不计入用正文色）
  const buildConclusion = (): { text: string; cls: string } => {
    if (!pos) return { text: '无数据', cls: 'text-app-subtext' };
    const bandName = bollBandLabel(period, pos.band);
    if (pos.band === 'mid') {
      return { text: `不计入 · 最新一根为${bandName}，不参与连续天数统计`, cls: 'text-app-rowtext' };
    }
    if (!explain) {
      return { text: '不计入 · K线不足 20 根，无法回溯计算连续天数', cls: 'text-app-rowtext' };
    }
    if (explain.steps[0]?.reason === 'counter-arrow') {
      return {
        text: `不计入 · 最新一根归入${bandName}（${pos.percent >= 0 ? '+' : ''}${pos.percent.toFixed(2)}%），但收盘未越轨、出现反向箭头，按规则不计入`,
        cls: 'text-app-rowtext',
      };
    }
    if (explain.streak <= 0) {
      const r = explain.steps[0]?.reason;
      const why = r === 'band-mid' ? '最新一根位于日中区间'
        : r === 'insufficient' ? 'K线不足 20 根'
        : r === 'no-boll' ? '该根无法算出 BOLL 轨道'
        : r === 'counter-arrow' ? '最新一根出现反向箭头'
        : '最新一根不满足计数条件';
      return { text: `不计入 · ${why}`, cls: 'text-app-rowtext' };
    }
    if (explain.streak === 1) {
      return { text: `连续 1 天 · ${bandName}（第 1 天按展示规则不显示数字）`, cls: BAND_CLS[pos.band] };
    }
    return { text: `连续 ${explain.streak} 天 · ${bandName}（展示为数字 ${explain.streak}）`, cls: BAND_CLS[pos.band] };
  };

  const buildRow = (step: BollStreakStep, isHeader: boolean): HTMLDivElement => {
    const row = document.createElement('div');
    row.className = ROW_CLS;

    const mk = (text: string, cls: string): HTMLSpanElement => {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = text;
      return span;
    };

    if (isHeader) {
      row.className = `${ROW_CLS} text-[9px] text-app-subtext`;
      row.appendChild(mk('日期', COL_DATE));
      row.appendChild(mk('收盘', COL_CLOSE));
      row.appendChild(mk('轨道', COL_TRACK));
      row.appendChild(mk('偏离', COL_PCT));
      row.appendChild(mk('判定', COL_VERDICT));
      return row;
    }

    row.appendChild(mk(fmtDate(step.date), `${COL_DATE} font-mono text-app-subtext`));
    row.appendChild(mk(fmtPrice(step.close), `${COL_CLOSE} font-mono text-app-rowtext`));
    row.appendChild(mk(
      trackText(step, period),
      `${COL_TRACK} font-semibold ${step.band ? BAND_CLS[step.band] : 'text-app-subtext'}`
    ));
    row.appendChild(mk(
      step.percent == null ? '-' : `${step.percent >= 0 ? '+' : ''}${step.percent.toFixed(2)}%`,
      `${COL_PCT} font-mono text-app-rowtext`
    ));
    row.appendChild(mk(
      REASON_TEXT[step.reason],
      `${COL_VERDICT} ${step.counted ? 'text-app-rowtext' : 'text-app-subtext'}`
    ));
    return row;
  };

  const showAt = (rect: DOMRect) => {
    const el = containerRef.current;
    if (!el) return;

    // 1) 先写内容：结论 + 明细表（有明细时连表头一起重建）
    const c = buildConclusion();
    if (conclusionRef.current) {
      conclusionRef.current.textContent = c.text;
      conclusionRef.current.className = `text-[10px] font-semibold ${c.cls} whitespace-nowrap`;
    }

    const steps = explain ? explain.steps : [];
    const head = headRef.current;
    const body = bodyRef.current;
    if (head && body) {
      head.textContent = '';
      body.textContent = '';
      if (steps.length === 0) {
        head.style.display = 'none';
        body.style.display = 'none';
      } else {
        head.style.display = '';
        body.style.display = '';
        head.appendChild(buildRow(steps[0], true));
        for (const s of steps) body.appendChild(buildRow(s, false));
      }
    }

    // 2) 明细区夹到视口内：先量出「非滚动部分」高度（结论行 + 规则行 + 内外边距），
    //    再把明细区限制在剩余高度内，超出的 60 根明细走内部滚动
    const scroll = scrollRef.current;
    if (scroll) {
      scroll.style.maxHeight = '';
      const chromeH = el.offsetHeight - scroll.offsetHeight;
      const avail = window.innerHeight - 20 - chromeH;
      if (scroll.scrollHeight > avail) scroll.style.maxHeight = `${Math.max(60, avail)}px`;
    }

    // 3) 强制 reflow 读取真实尺寸后再定位（上下左右各留 10px）
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let x = rect.left + rect.width / 2;
    let y = rect.top - h - 8;
    if (x - w / 2 < 10) x = w / 2 + 10;
    if (x + w / 2 > window.innerWidth - 10) x = window.innerWidth - w / 2 - 10;
    if (y < 10) y = rect.bottom + 8;
    if (y + h > window.innerHeight - 10) y = Math.max(10, window.innerHeight - h - 10);

    el.style.transform = `translate(${x - w / 2}px, ${y}px)`;
    el.style.opacity = '1';
    // 显示后才允许命中：固定态下浮窗要能承接点击/框选（隐藏态 opacity:0 仍会挡住下方元素）
    el.style.pointerEvents = 'auto';
  };

  const hide = () => {
    const el = containerRef.current;
    if (!el) return;
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
  };

  const requestShowAt = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      showAt(rect);
    });
  };

  const cancelPressTimer = () => {
    if (pressTimerRef.current !== null) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };

  // 长按 600ms 出现并固定（与页面既有长按约定同值）
  const startLongPress = () => {
    if (pinnedRef.current) {
      // 已固定：再次按下直接收起，并拦截随后的 click（避免同时打开 BOLL 弹窗）
      pinnedRef.current = false;
      longPressFiredRef.current = true;
      hide();
      return;
    }
    if (pressTimerRef.current !== null) return;
    longPressFiredRef.current = false;
    pressTimerRef.current = window.setTimeout(() => {
      pressTimerRef.current = null;
      longPressFiredRef.current = true;
      pinnedRef.current = true;
      requestShowAt();
    }, 600);
  };

  // 长按触发后拦截随后的 click。注意：本组件不阻止单元格自身的 onClick（短按仍打开 BOLL 弹窗），
  // 仅当长按已触发时截断，避免一次操作同时弹两个浮层。
  const guardLongPressClick = (e: React.MouseEvent) => {
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      e.stopPropagation();
    }
  };

  // 全局点外部收起已固定的浮窗；ESC 同样收起
  useEffect(() => {
    const onGlobalDown = (e: MouseEvent | TouchEvent) => {
      if (!pinnedRef.current) return;
      const t = e.target as Node;
      const c = containerRef.current;
      const tr = triggerRef.current;
      if (c && c.contains(t)) return;
      if (tr && tr.contains(t)) return; // 触发器由 startLongPress 自行收起
      pinnedRef.current = false;
      hide();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !pinnedRef.current) return;
      pinnedRef.current = false;
      hide();
    };
    window.addEventListener('mousedown', onGlobalDown);
    window.addEventListener('touchstart', onGlobalDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onGlobalDown);
      window.removeEventListener('touchstart', onGlobalDown);
      window.removeEventListener('keydown', onKeyDown);
      cancelPressTimer();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <>
      <span
        ref={triggerRef}
        className="inline-flex flex-col items-center w-full select-none"
        onPointerDown={startLongPress}
        onPointerUp={cancelPressTimer}
        onPointerLeave={cancelPressTimer}
        onPointerCancel={cancelPressTimer}
        onClick={guardLongPressClick}
      >
        {children}
      </span>
      {typeof document !== 'undefined' && createPortal(
        <div
          ref={containerRef}
          style={{ width: 'max-content', minWidth: 240, opacity: 0, pointerEvents: 'none' }}
          className="fixed left-0 top-0 z-[9999] bg-app-card border border-app-border rounded-lg shadow-[0_8px_30px_rgba(0,0,0,0.55)] px-2.5 py-2 text-[10px] text-app-text transition-opacity duration-100 select-text flex flex-col"
        >
          <div ref={conclusionRef} className="text-[10px] font-semibold text-app-rowtext whitespace-nowrap" />
          {/* 明细区：60 根可能超出视口，由 showAt 按可用高度夹住并内部滚动（结论行与规则行固定） */}
          <div ref={scrollRef} className="mt-1.5 overflow-y-auto custom-scrollbar">
            <div ref={headRef} style={{ display: 'none' }} />
            <div ref={bodyRef} className="flex flex-col gap-px" style={{ display: 'none' }} />
          </div>
          <div className="mt-1.5 pt-1 border-t border-app-border/60 text-[9px] text-app-subtext leading-snug max-w-[280px]">
            规则：回溯最近 60 根（表格可滚动查看），从最新一根往前逐根用「该根及之前 19 根」重算当时的 BOLL 轨道，并按该根自己当时的轨道计段——上轨段与下轨段各计各的，落到日中、切到另一轨或出现反向箭头（日上↓／日下↑）都会开启新的一段且该根不计入。「轨道」列即该根当日列表里的显示内容：连续天数数字写在轨道前面（仅 &gt;1 时显示，段首日为 1、按规则不显示）。
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default BollStreakTip;
