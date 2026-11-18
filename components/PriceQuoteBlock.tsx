import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useStepWheel } from '../hooks/useStepWheel';
import { snapToStep } from '../utils/stepSnap';

interface PriceQuoteBlockProps {
  /** 标题；不传则不渲染标题行 */
  label?: string;
  marketPrice: string;
  onMarketPriceChange: (value: string) => void;
  effectiveFxRate: number;
  /** 换算系数（1 盎司 = N 克） */
  ozPerGram: number;
  touchMode: boolean;
  /** 人民币步长（元/克） */
  rmbStep: number;
  /** 美元步长（美元/盎司） */
  usdStep: number;
  /** 人民币/克 标签右侧的操作区（如刷新伦敦金价按钮） */
  headerAction?: ReactNode;
  /** 是否渲染外层边框容器（嵌在已有卡片内时可关闭） */
  bordered?: boolean;
}

/** 人民币/克 → 美元/盎司；汇率或价格无效时返回 null */
function toUsdPerOz(rmb: number, rate: number, ozPerGram: number): number | null {
  return rate > 0 && ozPerGram > 0 && rmb > 0 ? (rmb / rate) * ozPerGram : null;
}

/**
 * 双行价格输入块（人民币/克 + 美元/盎司），价格换算弹窗与主页面「参考市价」共用。
 * 滚轮 / 触屏 / 上下按钮调节时按整步长对齐；直接键入则保留任意两位小数。
 */
export function PriceQuoteBlock({
  label,
  marketPrice,
  onMarketPriceChange,
  effectiveFxRate,
  ozPerGram,
  touchMode,
  rmbStep,
  usdStep,
  headerAction,
  bordered = true,
}: PriceQuoteBlockProps) {
  const mkPrice = parseFloat(marketPrice) || 0;
  const usdShown = toUsdPerOz(mkPrice, effectiveFxRate, ozPerGram) ?? 0;
  const usdAvailable = effectiveFxRate > 0 && ozPerGram > 0;

  const rmbInputRef = useRef<HTMLInputElement>(null);
  // 美元字段整体作为滚轮/触屏热区（含 $ 与增减按钮），避免只有数字窄条能响应
  const usdGroupRef = useRef<HTMLDivElement>(null);
  // 事件闭包读取的最新值；提交后同步为对齐后的值，避免连续滚动从非整步长叠加
  const rmbValueRef = useRef(mkPrice);
  const usdValueRef = useRef(usdShown);
  // 步长调节基准：始终保存「上一次已对齐」的值
  const rmbBaseRef = useRef(mkPrice);
  const usdBaseRef = useRef(usdShown);
  // 本组件刚提交的值，用于跳过紧随其后的外部同步（保留整步长基准）
  const lastCommitRef = useRef<string | null>(null);
  // 汇率变化时即使价格字符串没变，也要重新换算并清除钉住的美元展示值
  const lastRateRef = useRef(effectiveFxRate);

  const [rmbFocused, setRmbFocused] = useState(false);
  const [usdFocused, setUsdFocused] = useState(false);
  const [usdDraft, setUsdDraft] = useState<string | null>(null);
  // 美元价格的展示值：步进/键入后按原值展示，避免人民币两位小数反算导致 4400.00 显示成 4399.98。
  // 外部值（人民币键入、刷新、云同步）变化时清除，回到实时换算值。
  const [usdPinned, setUsdPinned] = useState<number | null>(null);
  const usdDisplay = usdPinned ?? usdShown;

  // 外部值变化（键入、刷新、云端同步）时重置调节基准；本组件自身提交的值不重置
  useEffect(() => {
    const rateChanged = lastRateRef.current !== effectiveFxRate;
    lastRateRef.current = effectiveFxRate;
    if (!rateChanged && lastCommitRef.current !== null && marketPrice === lastCommitRef.current) {
      lastCommitRef.current = null;
      return;
    }
    lastCommitRef.current = null;
    setUsdPinned(null);
    const rmb = parseFloat(marketPrice) || 0;
    const usd = toUsdPerOz(rmb, effectiveFxRate, ozPerGram) ?? 0;
    rmbValueRef.current = rmb;
    rmbBaseRef.current = rmb;
    usdValueRef.current = usd;
    usdBaseRef.current = usd;
  }, [marketPrice, effectiveFxRate, ozPerGram]);

  const commitRmb = (next: number) => {
    const clamped = Math.max(0, next);
    const str = Number.isInteger(clamped) ? clamped.toString() : clamped.toFixed(2);
    const usd = toUsdPerOz(clamped, effectiveFxRate, ozPerGram) ?? 0;
    lastCommitRef.current = str;
    rmbValueRef.current = clamped;
    rmbBaseRef.current = clamped;
    usdValueRef.current = usd;
    usdBaseRef.current = usd;
    setUsdPinned(null);
    setUsdDraft(null);
    onMarketPriceChange(str);
  };

  const commitUsd = (nextUsd: number) => {
    const clamped = Math.max(0, nextUsd);
    const nextRmb = (clamped / ozPerGram) * effectiveFxRate;
    const str = Number.isInteger(nextRmb) ? nextRmb.toString() : nextRmb.toFixed(2);
    lastCommitRef.current = str;
    usdValueRef.current = clamped;
    usdBaseRef.current = clamped;
    rmbValueRef.current = parseFloat(str);
    rmbBaseRef.current = parseFloat(str);
    setUsdPinned(clamped);
    setUsdDraft(null);
    onMarketPriceChange(str);
  };

  const stepRmb = (direction: 1 | -1, steps = 1) => {
    commitRmb(snapToStep(rmbBaseRef.current, direction, steps, rmbStep));
  };

  const stepUsd = (direction: 1 | -1, steps = 1) => {
    commitUsd(snapToStep(usdBaseRef.current, direction, steps, usdStep));
  };

  // 人民币：滚轮 / 触屏调节，按整步长对齐
  useStepWheel({
    ref: rmbInputRef,
    valueRef: rmbValueRef,
    step: rmbStep,
    min: 0,
    precision: 2,
    touch: touchMode,
    onChange: (next) => {
      const base = rmbBaseRef.current;
      const direction: 1 | -1 = next >= base ? 1 : -1;
      const steps = Math.max(1, Math.round(Math.abs(next - base) / rmbStep));
      stepRmb(direction, steps);
    },
  });

  // 美元：滚轮 / 触屏调节，按整步长对齐后反推人民币价格
  useStepWheel({
    ref: usdGroupRef,
    valueRef: usdValueRef,
    step: usdStep,
    min: 0,
    precision: 2,
    touch: touchMode && usdAvailable,
    disabled: () => !usdAvailable,
    onChange: (next) => {
      const base = usdBaseRef.current;
      const direction: 1 | -1 = next >= base ? 1 : -1;
      const steps = Math.max(1, Math.round(Math.abs(next - base) / usdStep));
      stepUsd(direction, steps);
    },
  });

  const handleRmbInput = (raw: string) => {
    lastCommitRef.current = null;
    onMarketPriceChange(raw);
  };

  const handleUsdInput = (raw: string) => {
    if (!/^\d*\.?\d*$/.test(raw)) return;
    setUsdDraft(raw);
    const usd = parseFloat(raw);
    if (!Number.isFinite(usd) || !usdAvailable) return;
    const nextRmb = (Math.max(0, usd) / ozPerGram) * effectiveFxRate;
    const str = nextRmb.toFixed(2);
    lastCommitRef.current = str;
    usdValueRef.current = usd;
    usdBaseRef.current = usd;
    rmbValueRef.current = parseFloat(str);
    rmbBaseRef.current = parseFloat(str);
    setUsdPinned(usd);
    onMarketPriceChange(str);
  };

  return (
    <div className="space-y-1.5">
      {label && (
        <div className="text-sm font-medium text-app-text pl-0.5">{label}</div>
      )}
      <div className={`space-y-1.5 ${bordered ? 'bg-app-bg border border-app-border rounded-lg px-3.5 py-2' : ''}`}>
        <div className="flex items-center justify-between gap-2 text-sm font-mono">
          <div className="flex items-center gap-1">
            <span className="text-xs text-app-subtext">人民币/克</span>
            {headerAction}
          </div>
          <div className="flex items-center gap-1">
            <input
              ref={rmbInputRef}
              type="text"
              inputMode="decimal"
              value={rmbFocused ? marketPrice : (marketPrice ? `¥${marketPrice}` : '')}
              onChange={(e) => handleRmbInput(e.target.value)}
              onFocus={() => setRmbFocused(true)}
              onBlur={() => setRmbFocused(false)}
              placeholder="0.00"
              className={`no-spinners bg-transparent border-none p-0 w-20 outline-none text-right text-sm font-bold font-mono text-app-text ${touchMode ? 'cursor-ns-resize' : ''}`}
            />
            <div className="flex flex-col gap-0.5 shrink-0">
              <button onClick={() => stepRmb(1)} className="bg-app-text/5 hover:bg-brand-yellow/20 text-app-subtext hover:text-brand-yellow rounded-sm px-0.5"><ChevronUp size={12} strokeWidth={3} /></button>
              <button onClick={() => stepRmb(-1)} className="bg-app-text/5 hover:bg-brand-yellow/20 text-app-subtext hover:text-brand-yellow rounded-sm px-0.5"><ChevronDown size={12} strokeWidth={3} /></button>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 text-sm font-mono">
          <span className="text-xs text-app-subtext">美元/盎司</span>
          <div ref={usdGroupRef} className={`flex items-center gap-1 ${usdAvailable ? (touchMode ? 'cursor-ns-resize' : '') : ''}`}>
            {usdAvailable ? (
              <>
                <input
                  type="text"
                  inputMode="decimal"
                  value={usdFocused ? (usdDraft ?? usdDisplay.toFixed(2)) : `$${usdDisplay.toFixed(2)}`}
                  onChange={(e) => handleUsdInput(e.target.value)}
                  onFocus={() => setUsdFocused(true)}
                  onBlur={() => { setUsdFocused(false); setUsdDraft(null); }}
                  className="no-spinners bg-transparent border-none p-0 w-20 outline-none text-right text-sm font-bold font-mono text-app-text"
                />
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button onClick={() => stepUsd(1)} className="bg-app-text/5 hover:bg-brand-yellow/20 text-app-subtext hover:text-brand-yellow rounded-sm px-0.5"><ChevronUp size={12} strokeWidth={3} /></button>
                  <button onClick={() => stepUsd(-1)} className="bg-app-text/5 hover:bg-brand-yellow/20 text-app-subtext hover:text-brand-yellow rounded-sm px-0.5"><ChevronDown size={12} strokeWidth={3} /></button>
                </div>
              </>
            ) : (
              <span className="text-app-subtext text-xs">--</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
