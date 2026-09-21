// 技术指标计算 —— 单一事实来源(SSOT)。
// 列表页「当日行情」浮窗、回测图十字线悬浮详情共用同一份：改一处，两边改动同步生效。
import type { BollKline } from './bollService';

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

// 价格格式化：股票 2 位小数、ETF 3 位小数（复用同一规则保证两处一致）
export function formatPrice(price: number | undefined | null, name?: string): string {
  if (price == null || !Number.isFinite(price)) return '-';
  const isETF = name?.includes('ETF') || name?.includes('etf');
  return isETF ? price.toFixed(3) : price.toFixed(2);
}

// 成交量格式化（万/亿,单位手）
export function formatVolume(v: number | null): string {
  if (v == null) return '-';
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}亿手`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(2)}万手`;
  return `${Math.round(v)}手`;
}