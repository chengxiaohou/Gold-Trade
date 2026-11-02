import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, RefreshCw, X } from 'lucide-react';
import { useStepWheel } from '../hooks/useStepWheel';

// 价格换算窗口内两个输入框的滑动步长（人民币 5 元/克，美元 25 美元/盎司）
const RMB_STEP = 5;
const USD_STEP = 25;

interface FxConverterCardProps {
  marketPrice: string;
  onMarketPriceChange: (value: string) => void;
  effectiveFxRate: number;
  fxLoading: boolean;
  fxError: string | null;
  onRefresh: () => void;
  onClose: () => void;
  breakEvenPrice: number;
  avgCost: number;
  /** 换算系数（1 盎司 = N 克），由调用方传入，避免在此处重复硬编码 */
  ozPerGram: number;
  touchMode: boolean;
  /** 人民币输入框旁 +/- 按钮的步长（沿用全局价格步长，滑动步长另有 5 的固定值） */
  priceStep: number;
}

/** 价格换算弹窗内容卡片：人民币输入框与美元输入框共用项目统一的 useStepWheel 滑动调节实现 */
export function FxConverterCard({
  marketPrice,
  onMarketPriceChange,
  effectiveFxRate,
  fxLoading,
  fxError,
  onRefresh,
  onClose,
  breakEvenPrice,
  avgCost,
  ozPerGram,
  touchMode,
  priceStep,
}: FxConverterCardProps) {
  const rmbInputRef = useRef<HTMLInputElement>(null);
  // 美元字段整体作为滚轮/触屏热区（含 $ 与增减按钮），避免只有数字窄条能响应
  const usdGroupRef = useRef<HTMLDivElement>(null);

  const mkPrice = parseFloat(marketPrice) || 0;
  const usdOfOz = (rmb: number) => effectiveFxRate > 0 && rmb > 0 ? (rmb / effectiveFxRate) * ozPerGram : null;
  const rmbToUsd = usdOfOz(mkPrice);

  // 输入框数值 ref：滚轮/触屏事件闭包里读取最新值，hook 提交时也会就地更新
  const rmbValueRef = useRef(mkPrice);
  useEffect(() => { rmbValueRef.current = parseFloat(marketPrice) || 0; }, [marketPrice]);

  const usdValueRef = useRef(rmbToUsd ?? 0);
  useEffect(() => { usdValueRef.current = rmbToUsd ?? 0; }, [rmbToUsd]);

  // 美元输入框编辑中的原始文本（避免受控格式化打断输入），失焦或滚动调节后恢复实时值
  const [usdDraft, setUsdDraft] = useState<string | null>(null);
  // 聚焦时隐藏 $ 前缀，便于直接编辑数字；失焦后恢复为 $xxx.xx 展示
  const [usdFocused, setUsdFocused] = useState(false);
  // 人民币输入框聚焦时隐藏 ¥ 前缀，便于直接编辑数字；失焦后与其它行统一展示 ¥xxx
  const [rmbFocused, setRmbFocused] = useState(false);

  const commitRmb = (next: number) => {
    const clamped = Math.max(0, next);
    onMarketPriceChange(Number.isInteger(clamped) ? clamped.toString() : clamped.toFixed(2));
  };

  // 人民币输入框：滑动调节步长 5
  useStepWheel({
    ref: rmbInputRef,
    valueRef: rmbValueRef,
    step: RMB_STEP,
    min: 0,
    precision: 2,
    touch: touchMode,
    onChange: commitRmb,
  });

  // 美元输入框：滑动调节步长 25，调节后按既有换算关系反推人民币价格
  const applyUsd = useStepWheel({
    ref: usdGroupRef,
    valueRef: usdValueRef,
    step: USD_STEP,
    min: 0,
    precision: 2,
    touch: touchMode && effectiveFxRate > 0,
    disabled: () => !(effectiveFxRate > 0),
    onChange: (nextUsd) => {
      setUsdDraft(null);
      const nextRmb = (Math.max(0, nextUsd) / ozPerGram) * effectiveFxRate;
      onMarketPriceChange(Number.isInteger(nextRmb) ? nextRmb.toString() : nextRmb.toFixed(2));
    },
  });

  const handleUsdInputChange = (raw: string) => {
    if (!/^\d*\.?\d*$/.test(raw)) return;
    setUsdDraft(raw);
    const usd = parseFloat(raw);
    if (!Number.isFinite(usd) || effectiveFxRate <= 0) return;
    const nextRmb = (Math.max(0, usd) / ozPerGram) * effectiveFxRate;
    onMarketPriceChange(Number.isInteger(nextRmb) ? nextRmb.toString() : nextRmb.toFixed(2));
  };

  const priceBlock = (label: string, rmb: number, editable: boolean) => {
    const uoz = usdOfOz(rmb);
    // 美元输入框的可编辑态：汇率就绪后可输入；展示值在价格为 0/空时按 0 处理，
    // 保证滚轮能从 0 开始调节。热区容器无论汇率是否就绪都渲染，确保 useStepWheel 挂载时能拿到 ref。
    const usdShown = uoz ?? 0;
    const usdAvailable = effectiveFxRate > 0 && ozPerGram > 0;
    return (
      <div key={label} className="space-y-1.5">
        <div className="text-sm font-medium text-app-text pl-0.5">{label}</div>
        <div className="bg-app-bg border border-app-border rounded-lg px-3.5 py-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-sm font-mono">
            <span className="text-xs text-app-subtext">人民币/克</span>
            {editable ? (
              <div className="flex items-center gap-1">
                <input
                  ref={rmbInputRef}
                  type="text"
                  inputMode="decimal"
                  value={rmbFocused ? marketPrice : (marketPrice ? `¥${marketPrice}` : '')}
                  onChange={(e) => onMarketPriceChange(e.target.value)}
                  onFocus={() => setRmbFocused(true)}
                  onBlur={() => setRmbFocused(false)}
                  placeholder="0.00"
                  className={`no-spinners bg-transparent border-none p-0 w-20 outline-none text-right text-sm font-bold font-mono text-app-text ${touchMode ? 'cursor-ns-resize' : ''}`}
                />
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button onClick={() => commitRmb((parseFloat(marketPrice) || 0) + priceStep)} className="bg-app-text/5 hover:bg-brand-yellow/20 text-app-subtext hover:text-brand-yellow rounded-sm px-0.5"><ChevronUp size={12} strokeWidth={3} /></button>
                  <button onClick={() => commitRmb((parseFloat(marketPrice) || 0) - priceStep)} className="bg-app-text/5 hover:bg-brand-yellow/20 text-app-subtext hover:text-brand-yellow rounded-sm px-0.5"><ChevronDown size={12} strokeWidth={3} /></button>
                </div>
              </div>
            ) : (
              <span className="font-bold text-app-text">¥{rmb.toFixed(2)}</span>
            )}
          </div>
          <div className="flex items-center justify-between text-sm font-mono">
            <span className="text-xs text-app-subtext">美元/盎司</span>
            {editable ? (
              <div ref={usdGroupRef} className={`flex items-center gap-1 ${usdAvailable ? (touchMode ? 'cursor-ns-resize' : '') : ''}`}>
                {usdAvailable ? (
                  <>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={usdFocused ? (usdDraft ?? usdShown.toFixed(2)) : `$${usdShown.toFixed(2)}`}
                      onChange={(e) => handleUsdInputChange(e.target.value)}
                      onFocus={() => setUsdFocused(true)}
                      onBlur={() => { setUsdFocused(false); setUsdDraft(null); }}
                      className="no-spinners bg-transparent border-none p-0 w-20 outline-none text-right text-sm font-bold font-mono text-app-text"
                    />
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button onClick={() => applyUsd(USD_STEP)} className="bg-app-text/5 hover:bg-brand-yellow/20 text-app-subtext hover:text-brand-yellow rounded-sm px-0.5"><ChevronUp size={12} strokeWidth={3} /></button>
                      <button onClick={() => applyUsd(-USD_STEP)} className="bg-app-text/5 hover:bg-brand-yellow/20 text-app-subtext hover:text-brand-yellow rounded-sm px-0.5"><ChevronDown size={12} strokeWidth={3} /></button>
                    </div>
                  </>
                ) : (
                  <span className="text-app-subtext text-xs">--</span>
                )}
              </div>
            ) : (
              uoz != null
                ? <span className="font-bold text-app-text">${uoz.toFixed(2)}</span>
                : <span className="text-app-subtext text-xs">--</span>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-app-card border border-app-border rounded-xl w-full max-w-[19rem] shadow-2xl relative p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold text-app-text">价格换算</h3>
        <button onClick={onClose} className="text-app-subtext hover:text-app-text transition-colors"><X size={20} /></button>
      </div>

      {/* 实时汇率 */}
      <div className="flex items-center gap-2 justify-between bg-app-bg border border-app-border rounded-lg px-3 py-2">
        <span className="text-xs text-app-subtext">汇率 美元/人民币</span>
        <div className="flex items-center gap-2">
          {fxLoading ? (
            <RefreshCw size={14} className="text-app-subtext animate-spin" />
          ) : (
            effectiveFxRate > 0
              ? <span className="font-mono font-bold text-app-text">1:{effectiveFxRate.toFixed(2)}</span>
              : <span className="text-app-subtext text-xs">--</span>
          )}
          <button onClick={onRefresh} className="text-app-subtext hover:text-app-text" title="">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
      {fxError && <p className="text-xs text-orange-400 text-center">{fxError}</p>}

      {/* 换算项 */}
      <div className="space-y-3">
        {priceBlock('参考市价', mkPrice, true)}
        {priceBlock('回本价', breakEvenPrice, false)}
        {priceBlock('持仓均价', avgCost, false)}
      </div>
    </div>
  );
}
