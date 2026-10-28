// 技术指标计算 —— 单一事实来源(SSOT)。
// 列表页「当日行情」浮窗、回测图十字线悬浮详情共用同一份：改一处，两边改动同步生效。
import type { BollKline } from './bollService';
import { isEtf } from './realizedPnl';

export interface IndicatorResult {
  open: number | null;   // 最新一根K线的开盘价
  high: number | null;   // 最新一根K线的最高价
  low: number | null;    // 最新一根K线的最低价
  changePct: number | null; // 最新收盘较昨收涨跌幅
  volume: number | null; // 最新一根K线的成交量
  volumeMa5: number | null; // 最近5根K线成交量均值
  kdj: { k: number | null; d: number | null; j: number | null };
  rsi: { rsi6: number | null; rsi12: number | null; rsi24: number | null };
  macd: { dif: number | null; dea: number | null; macd: number | null };
}

// 基于K线序列计算技术指标（KDJ/RSI/MACD、最高/最低/成交量及涨跌幅等）。
// 传入"截至某日的前缀 K 线"即得到那天收盘后的技术指标 → 回测悬浮历史某天复用同一实现。
export function calcIndicators(klines: BollKline[]): IndicatorResult | null {
  if (!klines || klines.length === 0) return null;
  const last = klines[klines.length - 1];
  const prev = klines.length >= 2 ? klines[klines.length - 2] : null;

  const high = last.high ?? null;
  const low = last.low ?? null;
  const volume = last.volume ?? null;
  const volumeMa5 = klines.length >= 5
    ? klines.slice(-5).reduce((sum, k) => sum + (k.volume ?? 0), 0) / 5
    : null;
  const changePct = prev && prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : null;

  // ---- KDJ (9) ----
  let kv: number | null = null, dv: number | null = null, jv: number | null = null;
  if (klines.length >= 9) {
    let k = 50, d = 50, prevK = 50;
    for (let i = 0; i < klines.length; i++) {
      const start = Math.max(0, i - 9 + 1);
      let hh = -Infinity, ll = Infinity;
      for (let j = start; j <= i; j++) {
        if (klines[j].high > hh) hh = klines[j].high;
        if (klines[j].low < ll) ll = klines[j].low;
      }
      const rsv = hh === ll ? 50 : ((klines[i].close - ll) / (hh - ll)) * 100;
      k = (2 / 3) * (prevK === 50 ? k : prevK) + (1 / 3) * rsv;
      prevK = k;
      d = (2 / 3) * d + (1 / 3) * k;
    }
    kv = parseFloat(k.toFixed(2));
    dv = parseFloat(d.toFixed(2));
    jv = parseFloat((3 * k - 2 * d).toFixed(2));
  }

  // ---- RSI (6/12/24) ----
  const calcRsi = (n: number): number | null => {
    if (klines.length <= n) return null;
    let up = 0, down = 0;
    for (let i = klines.length - n; i < klines.length; i++) {
      const diff = klines[i].close - klines[i - 1].close;
      if (diff > 0) up += diff; else down -= diff;
    }
    if (down === 0) return up === 0 ? 50 : 100;
    return parseFloat((100 - 100 / (1 + up / down)).toFixed(2));
  };

  // ---- MACD (12,26,9) ----
  const ema = (arr: number[], n: number): number[] => {
    const res: number[] = [];
    const alpha = 2 / (n + 1);
    let prevEma = 0;
    arr.forEach((v, i) => {
      if (i === 0) { prevEma = v; res.push(v); }
      else { prevEma = alpha * v + (1 - alpha) * prevEma; res.push(prevEma); }
    });
    return res;
  };
  const closes = klines.map(k => k.close);
  let dif: number | null = null, dea: number | null = null, macd: number | null = null;
  if (closes.length >= 26) {
    const ema12 = ema(closes, 12);
    const ema26 = ema(closes, 26);
    const n = closes.length;
    const difArr = closes.map((_, i) => ema12[i] - ema26[i]);
    const deaArr = ema(difArr, 9);
    dif = parseFloat(difArr[n - 1].toFixed(3));
    dea = parseFloat(deaArr[deaArr.length - 1].toFixed(3));
    macd = parseFloat((2 * (difArr[n - 1] - deaArr[deaArr.length - 1])).toFixed(3));
  }

  return { open: last.open ?? null, high, low, changePct, volume, volumeMa5, kdj: { k: kv, d: dv, j: jv }, rsi: { rsi6: calcRsi(6), rsi12: calcRsi(12), rsi24: calcRsi(24) }, macd: { dif, dea, macd } };
}

// 超买/超卖阈值 —— 单一事实来源：价格浮窗着色、超买/超卖标签共用。
// 高于 high = 超买（红），低于 low = 超卖（绿），恰好等于阈值不算。
export const EXTREME_LEVELS = { kdjHigh: 80, jHigh: 100, rsiHigh: 70, kdjLow: 20, jLow: 0, rsiLow: 30 } as const;

export type ExtremeSide = 'over' | 'under' | null;

// 单个指标值的极值方向
export function extremeOf(v: number | null | undefined, high: number, low: number): ExtremeSide {
  if (v == null || !Number.isFinite(v)) return null;
  return v > high ? 'over' : v < low ? 'under' : null;
}

// KDJ(K/D/J) + RSI(6/12/24) 共 6 项中，进入超买区 / 超卖区的项数
export function countIndicatorExtremes(ind: IndicatorResult): { over: number; under: number } {
  const { kdj, rsi } = ind;
  const sides: ExtremeSide[] = [
    extremeOf(kdj.k, EXTREME_LEVELS.kdjHigh, EXTREME_LEVELS.kdjLow),
    extremeOf(kdj.d, EXTREME_LEVELS.kdjHigh, EXTREME_LEVELS.kdjLow),
    extremeOf(kdj.j, EXTREME_LEVELS.jHigh, EXTREME_LEVELS.jLow),
    extremeOf(rsi.rsi6, EXTREME_LEVELS.rsiHigh, EXTREME_LEVELS.rsiLow),
    extremeOf(rsi.rsi12, EXTREME_LEVELS.rsiHigh, EXTREME_LEVELS.rsiLow),
    extremeOf(rsi.rsi24, EXTREME_LEVELS.rsiHigh, EXTREME_LEVELS.rsiLow),
  ];
  return { over: sides.filter(s => s === 'over').length, under: sides.filter(s => s === 'under').length };
}

// 价格格式化：股票 2 位小数、ETF 3 位小数（复用同一规则保证两处一致）
export function formatPrice(price: number | undefined | null, name?: string): string {
  if (price == null || !Number.isFinite(price)) return '-';
  return isEtf(name) ? price.toFixed(3) : price.toFixed(2);
}

// 成交量格式化（万/亿,单位手）
export function formatVolume(v: number | null): string {
  if (v == null) return '-';
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}亿手`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(2)}万手`;
  return `${Math.round(v)}手`;
}

// 昨收价推导（单一来源）：昨收 = 现价 / (1 + 涨跌幅%)；现价或涨跌幅无效返回 null。
// 列表页价格列、行情浮窗「开/现/低/高」着色共用这一份推导，不得各处另算一遍。
export function prevCloseFromChange(price: number | null | undefined, changePercent: number | null | undefined): number | null {
  if (price == null || changePercent == null || !(price > 0) || !Number.isFinite(changePercent)) return null;
  return price / (1 + changePercent / 100);
}

// 某价格相对「前一交易日收盘价」的涨跌幅（单一来源计算）：与 prevCloseFromChange 共用同一参考价口径。
// 列表页涨跌幅列的「最高价涨幅 / 最低价跌幅」等派生百分比统一走这里，展示层不得另写一份算式。
// 价格或参考价无效（缺失/非有限/参考价 ≤ 0）返回 null，交由各消费方按自身形态渲染占位符。
export function changePctVsPrevClose(v: number | null | undefined, prevClose: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v) || prevClose == null || !Number.isFinite(prevClose) || prevClose <= 0) return null;
  return ((v - prevClose) / prevClose) * 100;
}

// 价格相对「前一交易日收盘价」的位置判定（单一来源判定）：高于 / 低于 / 相等 / 参考价缺失。
// 判定只此一份，各消费方按自身展示形态映射颜色，不得各自另写一套比较逻辑。
export type PriceVsPrev = 'above' | 'below' | 'equal' | 'unknown';

export function priceVsPrevClose(v: number | null | undefined, prevClose: number | null | undefined): PriceVsPrev {
  if (v == null || !Number.isFinite(v) || prevClose == null || !Number.isFinite(prevClose)) return 'unknown';
  if (v > prevClose) return 'above';
  if (v < prevClose) return 'below';
  return 'equal';
}

// 「高于红、低于绿、相等或参考价缺失灰」的统一着色：行情浮窗「近10交易日」最高价/最低价 与 列表页价格列 共用。
export function priceVsPrevCloseCls(v: number | null | undefined, prevClose: number | null | undefined): string {
  const pos = priceVsPrevClose(v, prevClose);
  return pos === 'above' ? 'text-red-500' : pos === 'below' ? 'text-green-500' : 'text-app-rowtext';
}

// 同一判定下的 brand 配色展示方案：价格列现价行（涨跌色）与行情浮窗「开/现/低/高」共用这一套。
export function priceVsPrevCloseBrandCls(v: number | null | undefined, prevClose: number | null | undefined): string {
  const pos = priceVsPrevClose(v, prevClose);
  return pos === 'above' ? 'text-brand-red'
    : pos === 'below' ? 'text-brand-green'
      : pos === 'equal' ? 'text-app-rowtext'
        : 'text-app-subtext';
}