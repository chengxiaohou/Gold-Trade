import { RefreshCw, X } from 'lucide-react';
import { PriceQuoteBlock } from './PriceQuoteBlock';

// 价格换算窗口内美元输入框的滑动步长（美元/盎司）
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
  /** 人民币输入框的步长（元/克） */
  priceStep: number;
}

/** 价格换算弹窗内容卡片：参考市价复用主页面同款 PriceQuoteBlock */
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
  const usdOfOz = (rmb: number) =>
    effectiveFxRate > 0 && ozPerGram > 0 && rmb > 0
      ? (rmb / effectiveFxRate) * ozPerGram
      : null;

  // 只读换算行（回本价 / 持仓均价）
  const readOnlyBlock = (label: string, rmb: number) => {
    const uoz = usdOfOz(rmb);
    return (
      <div key={label} className="space-y-1.5">
        <div className="text-sm font-medium text-app-text pl-0.5">{label}</div>
        <div className="bg-app-bg border border-app-border rounded-lg px-3.5 py-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-sm font-mono">
            <span className="text-xs text-app-subtext">人民币/克</span>
            <span className="font-bold text-app-text">¥{rmb.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-sm font-mono">
            <span className="text-xs text-app-subtext">美元/盎司</span>
            {uoz != null
              ? <span className="font-bold text-app-text">${uoz.toFixed(2)}</span>
              : <span className="text-app-subtext text-xs">--</span>}
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
        <PriceQuoteBlock
          label="参考市价"
          marketPrice={marketPrice}
          onMarketPriceChange={onMarketPriceChange}
          effectiveFxRate={effectiveFxRate}
          ozPerGram={ozPerGram}
          touchMode={touchMode}
          rmbStep={priceStep}
          usdStep={USD_STEP}
        />
        {readOnlyBlock('回本价', breakEvenPrice)}
        {readOnlyBlock('持仓均价', avgCost)}
      </div>
    </div>
  );
}
