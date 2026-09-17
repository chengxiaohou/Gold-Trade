import type { TagParams } from '../types';
import { DEFAULT_TAG_PARAMS } from '../types';
import type { BollKline } from './bollService';
import { getMarketStatus } from './cacheService';

// ─────────────────────────────────────────────────────────────
// 标签/信号判定分析器（共享模块）
// 从 components/StockDividendPage.tsx 抽取，供股息页面与回测引擎共用。
// 判定函数均为纯函数，输入完整 K 线序列（BollKline[]，date 升序），输出当日命中的标签/信号。
// ─────────────────────────────────────────────────────────────

// K 线形态标签（十字星 / 金针探底 / 吊颈线 / 射击之星 / 倒锤子线）
export interface KlinePattern {
  type: 'doji' | 'hammer' | 'hangingMan' | 'shootingStar' | 'invertedHammer';
  date: string;   // 形态当天日期 YYYY-MM-DD
  label: string;  // 完整名称（十字星 / 金针探底 / 吊颈线 / 射击之星 / 倒锤子线）
  single: string; // 列表单元格单字（十 / 金 / 吊 / 射 / 倒）
  color: 'green' | 'red' | 'slate'; // 红=买/看多 绿=卖/看空 灰=中性
  boosted?: boolean;   // 放量金针：当日成交量 > 前5日均量
  direction?: 'high' | 'low' | 'flat'; // 十字星趋势上下文
  detail: string[];    // 判定依据文案
}

// 每日量价信号（MACD 金叉/死叉 + 放量/缩量）
export interface DailySignal {
  date: string;   // YYYY-MM-DD
  kind: 'macd-gold' | 'macd-dead' | 'vol-up' | 'vol-down' | 'vol-shrink';
  ratio: number | null;      // 量/5日均量 倍数（量价类；MACD 类为 null）
  detail: string[];          // 判定依据
}

// 风系（风轻云淡）加/减仓信号的单条命中
export interface FengHit { name: string; score: number; detail: string[] }
export interface FengDaySignal { date: string; add: FengHit[]; reduce: FengHit[] }

// ── K 线形态分析：十字星 / 金针探底 / 吊颈线 / 射击之星 / 倒锤子线 ──
// 基础数据单元（基于 OHLC）：
//   实体高度 = |收盘-开盘|；上影线 = 最高-MAX(开,收)；下影线 = MIN(开,收)-最低；振幅 = 最高-最低
// 通用阈值：小实体 ≤ 振幅*10%；长影线 ≥ 实体*2；极短影线 ≤ 振幅*5%；十字星实体 ≤ 振幅*5%
export function analyzeKlinePatterns(klines: BollKline[], fmt: (v: number) => string, cfg: TagParams = DEFAULT_TAG_PARAMS): KlinePattern[] {
  const classic = cfg.classic;
  const dojiBody = classic.classicDojiBody, smallBodyP = classic.classicSmallBody, nearHighP = classic.classicNearHigh, nearLowP = classic.classicNearLow;
  const n = klines.length;
  if (n < 21) return []; // 需 ≥21 根K线（前20日趋势 / 平均振幅）
  const i = n - 1; // 仅分析最新收盘交易日
  const k = klines[i];
  const body = Math.abs(k.close - k.open);
  const upper = k.high - Math.max(k.open, k.close);
  const lower = Math.min(k.open, k.close) - k.low;
  const range = k.high - k.low;
  if (range <= 0) return [];
  const smallBody = smallBodyP.enabled && body <= range * smallBodyP.value; // 小实体
  const tinyBody = dojiBody.enabled && body <= range * dojiBody.value; // 十字星实体
  // 前20日均线方向（今日 vs 昨日）
  let sum = 0, sumPrev = 0;
  for (let j = i - 19; j <= i; j++) sum += klines[j].close;
  for (let j = i - 20; j <= i - 1; j++) sumPrev += klines[j].close;
  const ma20Up = sum / 20 > sumPrev / 20;
  const ma20Down = sum / 20 < sumPrev / 20;
  // 近20日高低点与平均振幅（十字星用于排除一字板）
  let high20 = -Infinity, low20 = Infinity, rangeSum = 0;
  for (let j = i - 19; j <= i; j++) {
    if (klines[j].high > high20) high20 = klines[j].high;
    if (klines[j].low < low20) low20 = klines[j].low;
    rangeSum += klines[j].high - klines[j].low;
  }
  const avgRange = rangeSum / 20;
  const nearHigh = nearHighP.enabled && k.close >= high20 * nearHighP.value; // 位于近20日最高价区间
  const nearLow = nearLowP.enabled && k.close <= low20 * nearLowP.value;   // 位于近20日最低价区间
  // 放量增强：当日成交量 > 前5日均量
  let avgVolPrev = 0;
  for (let j = i - 5; j <= i - 1; j++) avgVolPrev += klines[j].volume;
  avgVolPrev /= 5;
  const boostedVol = k.volume > avgVolPrev;
  const fmtVol = (v: number) => (v >= 1e8 ? `${(v / 1e8).toFixed(2)}亿` : v >= 1e4 ? `${(v / 1e4).toFixed(1)}万` : `${v.toFixed(0)}`);
  const ds = k.date.slice(5).replace('-', '/'); // MM/DD
  const pct = (body / range * 100).toFixed(1);
  const patterns: KlinePattern[] = [];
  // 1. 十字星：实体 ≤ 振幅*5%，且振幅 > 平均振幅*10%（区分一字板）；结合前20日趋势定方向
  if (tinyBody && range > avgRange * 0.1) {
    const dir: 'high' | 'low' | 'flat' = nearHigh ? 'high' : nearLow ? 'low' : 'flat';
    patterns.push({
      type: 'doji', date: k.date, label: '十字星', single: '十', color: 'slate', direction: dir,
      detail: [
        `${ds} 十字星：开 ${fmt(k.open)} ≈ 收 ${fmt(k.close)}`,
        `实体占比 ${pct}% ≤ ${(dojiBody.value * 100).toFixed(1)}%（多空平衡）`,
        dir === 'high' ? `现价贴近近20日高点（≥${(nearHighP.value * 100).toFixed(1)}%区间）→ 高位警示`
          : dir === 'low' ? `现价贴近近20日低点（≤${(nearLowP.value * 100).toFixed(1)}%区间）→ 低位关注`
          : '趋势方向中性',
      ],
    });
    return patterns; // 十字星优先：实体过小，其余形态不再判定
  }
  // 2/3. 金针探底 & 吊颈线：下影线长、上影线短、实体小，仅前置趋势不同
  if (smallBody && upper <= body * 0.3) {
    if (lower >= body * 2.5 && (ma20Down || nearLow)) {
      patterns.push({
        type: 'hammer', date: k.date, label: boostedVol ? '放量金针' : '金针探底', single: '针', color: 'red', boosted: boostedVol,
        detail: [
          `${ds} ${boostedVol ? '放量金针' : '金针探底'}：收 ${fmt(k.close)}`,
          `下影 ${fmt(lower)} ≥ 实体×2.5（${fmt(body)}），上影 ${fmt(upper)} ≤ 实体×30%`,
          `${ma20Down ? 'MA20 方向向下' : '现价贴近近20日低点'} → 下跌末端承接`,
          ...(boostedVol ? [`成交量 ${fmtVol(k.volume)} > 前5日均量 ${fmtVol(avgVolPrev)} → 放量金针（权重提升）`] : []),
        ],
      });
    } else if (lower >= body * 2 && ma20Up && nearHigh) {
      patterns.push({
        type: 'hangingMan', date: k.date, label: '吊颈线', single: '吊', color: 'green',
        detail: [
          `${ds} 吊颈线：收 ${fmt(k.close)}`,
          `下影 ${fmt(lower)} ≥ 实体×2（${fmt(body)}），上影 ${fmt(upper)} ≤ 实体×30%`,
          'MA20 方向向上 且 现价贴近近20日高点 → 上涨末端假承接',
        ],
      });
    }
  }
  // 4/5. 射击之星 & 倒锤子线：上影线长、下影线短、实体小，仅前置趋势不同
  if (smallBody && lower <= body * 0.3) {
    if (upper >= body * 2 && (ma20Up || nearHigh)) {
      patterns.push({
        type: 'shootingStar', date: k.date, label: '射击之星', single: '射', color: 'green',
        detail: [
          `${ds} 射击之星：收 ${fmt(k.close)}`,
          `上影 ${fmt(upper)} ≥ 实体×2（${fmt(body)}），下影 ${fmt(lower)} ≤ 实体×30%`,
          `${ma20Up ? 'MA20 方向向上' : '现价贴近近20日高点'} → 冲高诱多砸盘`,
        ],
      });
    } else if (upper >= body * 2 && (ma20Down || nearLow)) {
      patterns.push({
        type: 'invertedHammer', date: k.date, label: '倒锤子线', single: '倒', color: 'red',
        detail: [
          `${ds} 倒锤子线：收 ${fmt(k.close)}`,
          `上影 ${fmt(upper)} ≥ 实体×2（${fmt(body)}），下影 ${fmt(lower)} ≤ 实体×30%`,
          `${ma20Down ? 'MA20 方向向下' : '现价贴近近20日低点'} → 下跌末端试盘`,
        ],
      });
    }
  }
  return patterns;
}

// ── 序列化指标计算（供环境分析/每日信号/风系分析使用，输入为完整K线序列）──
export function calcMaSeries(klines: BollKline[], period: number): (number | null)[] {
  const closes = klines.map(k => k.close);
  const res: (number | null)[] = new Array(klines.length).fill(null);
  let sum = 0;
  for (let i = 0; i < klines.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) res[i] = sum / period;
  }
  return res;
}
export function calcRsiSeries(klines: BollKline[], n: number): (number | null)[] {
  const res: (number | null)[] = new Array(klines.length).fill(null);
  for (let i = 0; i < klines.length; i++) {
    if (i < n) continue;
    let up = 0, down = 0;
    for (let j = i - n + 1; j <= i; j++) {
      const diff = klines[j].close - klines[j - 1].close;
      if (diff > 0) up += diff; else down -= diff;
    }
    if (down === 0) res[i] = up === 0 ? 50 : 100;
    else res[i] = 100 - 100 / (1 + up / down);
  }
  return res;
}
export function calcMacdSeries(klines: BollKline[]): { dif: number | null; dea: number | null }[] {
  const closes = klines.map(k => k.close);
  const ema = (arr: number[], n: number): number[] => {
    const res: number[] = [];
    const alpha = 2 / (n + 1);
    let prev = 0;
    arr.forEach((v, i) => {
      if (i === 0) { prev = v; res.push(v); }
      else { prev = alpha * v + (1 - alpha) * prev; res.push(prev); }
    });
    return res;
  };
  const res: { dif: number | null; dea: number | null }[] = new Array(klines.length).fill({ dif: null, dea: null });
  if (closes.length >= 26) {
    const ema12 = ema(closes, 12);
    const ema26 = ema(closes, 26);
    const difArr = closes.map((_, i) => ema12[i] - ema26[i]);
    const deaArr = ema(difArr, 9);
    for (let i = 0; i < closes.length; i++) res[i] = { dif: difArr[i], dea: deaArr[i] };
  }
  return res;
}
export function calcBollSeries(klines: BollKline[]): { mid: number | null; upper: number | null; lower: number | null }[] {
  const closes = klines.map(k => k.close);
  const res: { mid: number | null; upper: number | null; lower: number | null }[] = new Array(klines.length).fill({ mid: null, upper: null, lower: null });
  for (let i = 19; i < klines.length; i++) {
    let sum = 0;
    for (let j = i - 19; j <= i; j++) sum += closes[j];
    const mid = sum / 20;
    const variance = closes.slice(i - 19, i + 1).reduce((s, v) => s + Math.pow(v - mid, 2), 0) / 20;
    const std = Math.sqrt(variance);
    res[i] = { mid, upper: mid + 2 * std, lower: mid - 2 * std };
  }
  return res;
}

// 量价判定资格：最新K线若是"未收盘的今日"，盘中（距收盘>30分钟）不给出任何量价关系标签，
// 避免量价未定型误导；当日交易时间还剩最后半小时（14:30 后）才开始计算展示今日量价标签。
function canJudgeTodayVolume(date: Date = new Date()): boolean {
  const status = getMarketStatus(date);
  if (status === 'closed') return true; // 15:00后已收盘
  if (status === 'afternoon_session') {
    return date.getHours() + date.getMinutes() / 60 >= 14.5; // 13:00-15:00：仅最后半小时
  }
  return false; // 盘前/上午时段/午间休市/全天休市
}
export function isTodayVolumeEligible(klines: BollKline[]): boolean {
  if (!klines || klines.length === 0) return false;
  const lastDate = klines[klines.length - 1].date;
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (lastDate !== today) return true; // 最新K线为历史交易日（已收盘）
  return canJudgeTodayVolume(d);
}

// 每日行情信号（近10日）：MACD 金叉/死叉 + 量价显著信号（放量≥1.5×/极度缩量≤0.5×，按涨跌红绿）。
// 只展示足够明显/典型的信号，量价一般波动不标信号；与"环境量价（当前状态截面）"区分。
export function analyzeDailySignals(klines: BollKline[], allowTodayVolume = true): DailySignal[] {
  const n = klines.length;
  if (n < 30) return [];
  const macd = calcMacdSeries(klines);
  const volMa5s: number[] = new Array(n).fill(0);
  {
    let s = 0;
    for (let i = 0; i < n; i++) {
      s += klines[i].volume;
      if (i >= 5) s -= klines[i - 5].volume;
      volMa5s[i] = i >= 4 ? s / 5 : (i > 0 ? s / i : 0); // 前5日（不含当日）
    }
  }
  const fmtV = (v: number) => (v >= 1e8 ? `${(v / 1e8).toFixed(2)}亿` : v >= 1e4 ? `${(v / 1e4).toFixed(1)}万` : `${v.toFixed(0)}`);
  const start = Math.max(5, n - 10);
  const signals: DailySignal[] = [];
  const latestDate = klines[n - 1].date; // 最新K线日（未收盘的今日：非最后半小时不判定量价）
  for (let i = start; i < n; i++) {
    const k2 = klines[i], pk = klines[i - 1];
    const date = k2.date;
    // ── MACD 金叉/死叉（事件性）──
    if (i >= 1) {
      const m = macd[i], pm = macd[i - 1];
      if (m.dif != null && m.dea != null && pm.dif != null && pm.dea != null) {
        if (pm.dif < pm.dea && m.dif >= m.dea) {
          signals.push({ date, kind: 'macd-gold', ratio: null, detail: [`DIF ${m.dif.toFixed(3)} 上穿 DEA ${m.dea.toFixed(3)}`, '短期动能转强，若伴随放量更具确认性'] });
        } else if (pm.dif > pm.dea && m.dif <= m.dea) {
          signals.push({ date, kind: 'macd-dead', ratio: null, detail: [`DIF ${m.dif.toFixed(3)} 下穿 DEA ${m.dea.toFixed(3)}`, '短期动能转弱，警惕回调/转跌'] });
        }
      }
    }
    // ── 量价显著信号（未收盘的今日：非最后半小时不判定）──
    const vol = k2.volume, ma5 = volMa5s[i];
    if (ma5 <= 0) continue;
    if (date === latestDate && !allowTodayVolume) continue;
    const ratio = vol / ma5;
    const up = k2.close > pk.close;
    if (ratio >= 1.5) {
      signals.push({ date, kind: up ? 'vol-up' : 'vol-down', ratio, detail: [`量 ${fmtV(vol)} ≥ 5日均量 ${fmtV(ma5)}×${ratio.toFixed(1)}，收盘${up ? '涨' : '跌'}`, up ? '放量上攻：多方真实进场' : '放量下跌：抛压集中释放，警惕主力出逃'] });
    } else if (ratio <= 0.5) {
      signals.push({ date, kind: 'vol-shrink', ratio, detail: [`量 ${fmtV(vol)} 仅 5日均量 ${fmtV(ma5)}×${ratio.toFixed(1)}`, '极度缩量：多空观望，往往是变盘前的宁静'] });
    }
  }
  return signals;
}

// 风系（风轻云淡）加/减仓复合信号：按日线可算数据判定，输出当日命中的加仓/减仓信号列表。
// 列表单元格展示红色"加"/绿色"减"单字（优先级最高）；浮窗近10日按日展示"加仓 总分 / 减仓 总分"明细，判定依据逐条列出。
export function analyzeFengSignals(klines: BollKline[], fmt: (v: number) => string, allowTodayVolume = true, cfg: TagParams = DEFAULT_TAG_PARAMS): { latest: FengDaySignal; days: FengDaySignal[] } {
  const feng = cfg.feng;
  const lowBuy = feng.fengLowBuy, pullback = feng.fengPullback, volBreak = feng.fengVolBreak;
  const n = klines.length;
  const empty = (date: string): FengDaySignal => ({ date, add: [], reduce: [] });
  if (n < 25) return { latest: empty(klines[n - 1]?.date ?? ''), days: [] };
  const fmtV = (v: number) => (v >= 1e8 ? `${(v / 1e8).toFixed(2)}亿` : v >= 1e4 ? `${(v / 1e4).toFixed(1)}万` : `${v.toFixed(0)}`);
  const ma5s = calcMaSeries(klines, 5), ma10s = calcMaSeries(klines, 10), ma20s = calcMaSeries(klines, 20);
  const volMa5s: number[] = new Array(n).fill(0);
  {
    let s = 0;
    for (let i = 0; i < n; i++) { s += klines[i].volume; if (i >= 5) s -= klines[i - 5].volume; volMa5s[i] = i >= 4 ? s / 5 : (i > 0 ? s / i : 0); } // 前5日（不含当日）
  }
  const high20 = (i: number) => { let h = -Infinity, d = ''; for (let j = Math.max(0, i - 19); j <= i - 1; j++) if (klines[j].close > h) { h = klines[j].close; d = klines[j].date; } return { v: h, d }; }; // 前高：不含当日近20日最高收盘价
  const low20 = (i: number) => { let l = Infinity; for (let j = Math.max(0, i - 19); j <= i; j++) l = Math.min(l, klines[j].low); return l; };

  // ── 置信度打分（0~2 尺度，与 docs/风轻云淡选股择时方法论.md 4.1/4.2/4.4 一致）───────────
  // 规则：标准(不含容差参数)达成 = 0.5 基础分；超额每优于标准 1% 加 0.15、超额窗口 W 内到满 2.0；
  //      依赖容差(tol)才达成时按"用掉容差比例"0.5*(1-用掉比例) 线性扣到 0；离散验证条款加固定权重。
  // ⚠️ 维护约定：今后改任何打分数值/窗口 W/离散权重，必须同步更新 docs/风轻云淡选股择时方法论.md 4.4《实现采纳的参数清单》。
  const cl = (v: number) => Math.max(0, Math.min(1.5, v)); // 超额加成上限 +1.5（单条款封顶 2.0）
  // 越大越好（比值型，无容差）：达成线 std，超额外窗口 W（默认超额10%到满）
  const scUp = (x: number, std: number, W = 0.1) => (x < std ? 0 : 0.5 + cl(((x - std) / std) * (1.5 / W)));
  // 越小越好（比值型）：标准 std，容差上限 tol（std<x<=tol 线性扣到 0）
  const scLow = (x: number, std: number, tol: number, W = 0.1) => {
    if (x > tol) return 0;
    if (x <= std) return 0.5 + cl(((std - x) / std) * (1.5 / W));
    return 0.5 * (1 - (x - std) / (tol - std));
  };
  const V = (v: number) => Math.round(v * 100) / 100; // 保留 2 位
  const longWick = (k: BollKline) => k.high > 0 && k.high - k.close > 0.02 * k.high; // 收远离日高(长上影)≥2%
  const evalDay = (i: number): FengDaySignal => {
    const res = empty(klines[i].date);
    if (i < 6 || ma5s[i] == null || ma10s[i] == null || ma20s[i] == null || volMa5s[i] <= 0) return res;
    if (i === n - 1 && !allowTodayVolume) return res; // 未收盘的今日不判定量价类信号
    const k = klines[i], pk = klines[i - 1];
    const c = k.close, v = k.volume, ma5 = ma5s[i]!, ma10 = ma10s[i]!, ma20 = ma20s[i]!, volMa5 = volMa5s[i];
    const h20 = high20(i), l20 = low20(i);
    const pct = pk.close ? ((c - pk.close) / pk.close) * 100 : 0;
    const vb = volMa5 > 0 ? v / volMa5 : 0; // 量比：今量/5日均量
    const shrink = v < volMa5;
    // ── 加仓信号（每信号：score = Σ 条款分；判定依据第一行列出得分公式）──
    if (lowBuy.enabled && c <= l20 * lowBuy.value && shrink) {
      const sLow = scLow(c / l20, 1.0, lowBuy.value);       // ①低位：标准≤1.000，容差=tagParams.fengLowBuy
      const sShrink = scLow(vb, 1.0, 1.0);                  // ②缩量：量比越小越典型
      const sStop = c >= pk.close ? 0.2 : 0;                // ③今收不创新低(止跌验证)：0.2
      const score = V(sLow + sShrink + sStop);
      res.add.push({ name: '缩量入场（低位）', score, detail: [`得分 ${score.toFixed(2)} = 低位 ${V(sLow).toFixed(2)} + 缩量 ${V(sShrink).toFixed(2)} + 止跌 ${sStop.toFixed(2)}`, `现价 ${fmt(c)} ≤ 近20日低点 ${fmt(l20)}×${lowBuy.value} = ${fmt(l20 * lowBuy.value)}（低位，价/低点=${(c / l20).toFixed(3)}）`, `今量 ${fmtV(v)} < 5日均量 ${fmtV(volMa5)}（量比 ${vb.toFixed(2)}，缩量）`, '低位+缩量 → 连续下跌抛压衰竭，可低吸/试探仓'] });
    }
    if (i >= 2 && v < klines[i - 1].volume && klines[i - 1].volume < klines[i - 2].volume) {
      const sCont = 1.0;                                    // ①连缩：触发即严格3日逐日递减=1.0
      const sDepth = scLow(v / klines[i - 2].volume, 0.7, 1.0); // ②萎缩：今量/首日量 标准≤0.7
      const sFlat = c >= pk.close ? 0.2 : 0;                // ③今收平/阳：0.2
      const score = V(sCont + sDepth + sFlat);
      const firstVol = klines[i - 2].volume;
      res.add.push({ name: '缩量续加', score, detail: [`得分 ${score.toFixed(2)} = 连缩 ${sCont.toFixed(2)} + 萎缩 ${V(sDepth).toFixed(2)} + 止跌 ${sFlat.toFixed(2)}`, `连续3日量能递减：${fmtV(firstVol)} → ${fmtV(klines[i - 1].volume)} → ${fmtV(v)}（今/首=${(v / firstVol).toFixed(2)}）`, '缩量续跌 → 抛压逐步衰竭，按计划逐级加仓'] });
    }
    const crossMA5 = c > ma5 && klines[i - 1].close <= ma5s[i - 1]!;
    const crossMA10 = c > ma10 && klines[i - 1].close <= ma10s[i - 1]!;
    if (volBreak.enabled && (crossMA5 || crossMA10) && v >= volMa5 * volBreak.value) {
      const bundle = crossMA5 && crossMA10;
      const sCross = bundle ? 0.8 : 0.5;                    // ①穿线：同破MA5+MA10=0.8，单破=0.5
      const sVol = scUp(vb, volBreak.value);                // ②放量：量比 标准≥tagParams.fengVolBreak
      const lowStart = i >= 5 && Math.max(...klines.slice(i - 5, i).map(x => x.close)) < ma20 ? 0.3 : 0; // ③低位启动：前5日收均<MA20
      const score = V(sCross + sVol + lowStart);
      res.add.push({ name: '放量突破均线', score, detail: [`得分 ${score.toFixed(2)} = 穿线 ${sCross.toFixed(2)} + 放量 ${V(sVol).toFixed(2)} + 低位 ${lowStart.toFixed(2)}`, `收 ${fmt(c)} ${crossMA5 ? `上穿 MA5 ${fmt(ma5)}（前收 ${fmt(klines[i - 1].close)} ≤ MA5 ${fmt(ma5s[i - 1])}）` : ''}${crossMA10 ? `上穿 MA10 ${fmt(ma10)}（前收 ${fmt(klines[i - 1].close)} ≤ MA10 ${fmt(ma10s[i - 1])}）` : ''}`, `今量 ${fmtV(v)} ≥ 5日均量 ${fmtV(volMa5)}×${volBreak.value} = ${fmtV(volMa5 * volBreak.value)}（量比 ${vb.toFixed(2)}，放量）`, '放量突破 → 真突破概率大，加仓跟随'] });
    }
    if (pullback.enabled && i >= 1 && klines[i - 1].close >= ma5s[i - 1]! && k.low <= ma5 * pullback.value && c > ma5 && v >= volMa5) {
      const sTouch = scLow(k.low / ma5, 1.0, pullback.value);  // ①触达：标准≤1.000，容差=tagParams.fengPullback
      const sRec = c > ma5 ? scUp(c / ma5, 1.0) : 0;           // ②收回：收/MA5 越大越典型（c>ma5 已保证）
      const sVol = scUp(vb, 1.0);                              // ③放量：量比
      const sTrend = ma5s[i] > ma5s[i - 1] ? 0.3 : 0;          // ④MA5上行：0.3
      const score = V(sTouch + sRec + sVol + sTrend);
      res.add.push({ name: '回踩放量', score, detail: [`得分 ${score.toFixed(2)} = 触达 ${V(sTouch).toFixed(2)} + 收回 ${V(sRec).toFixed(2)} + 放量 ${V(sVol).toFixed(2)} + 上升 ${sTrend.toFixed(2)}`, `前日收 ${fmt(klines[i - 1].close)} 在 MA5 ${fmt(ma5s[i - 1])} 上方；盘中低 ${fmt(k.low)} 触及 MA5 ${fmt(ma5)} 后收回 ${fmt(c)}（低/MA5=${(k.low / ma5).toFixed(3)}，收/MA5=${(c / ma5).toFixed(3)}）`, `今量 ${fmtV(v)} ≥ 5日均量 ${fmtV(volMa5)}（量比 ${vb.toFixed(2)}，放量）`, '放量回踩支撑 → 主力回补，加仓'] });
    }
    if (i >= 3 && klines[i - 1].close < klines[i - 2].close && klines[i - 2].close < klines[i - 3].close && shrink && k.low >= klines[i - 1].low) {
      const sShrink = scLow(vb, 1.0, 1.0);                    // ①缩量：量比
      const sUp2 = c >= pk.close ? 0.5 : 0;                   // ②今收≥前收：0.5
      const sNoLow = k.low >= klines[i - 1].low ? 0.3 : 0;    // ③不创新低：0.3
      const depth = (klines[i - 3].close - klines[i - 1].close) / klines[i - 3].close; // ④近3日累计跌幅
      const sDeep = depth >= 0.08 ? 0.2 : depth >= 0.04 ? 0.1 : 0;
      const score = V(sShrink + sUp2 + sNoLow + sDeep);
      res.add.push({ name: '缩量止跌', score, detail: [`得分 ${score.toFixed(2)} = 缩量 ${V(sShrink).toFixed(2)} + 收升 ${sUp2.toFixed(2)} + 不创新低 ${sNoLow.toFixed(2)} + 超跌 ${sDeep.toFixed(2)}`, `前3日连续收跌：${fmt(klines[i - 3].close)} → ${fmt(klines[i - 2].close)} → ${fmt(klines[i - 1].close)}（累计跌 ${(depth * 100).toFixed(1)}%）`, `当日低 ${fmt(k.low)} 未破前日低 ${fmt(klines[i - 1].low)}（止跌）`, `今量 ${fmtV(v)} < 5日均量 ${fmtV(volMa5)}（量比 ${vb.toFixed(2)}，缩量）`, '缩量止跌 → 抛压枯竭，可低吸/加满'] });
    }
    if (c < ma5 && c >= ma10 && pct >= -3) {
      const sMa10 = scUp(c / ma10, 1.0);                      // ①站稳MA10：收/MA10
      const sDrop = scLow(Math.abs(pct) / 100, 0.01, 0.03, 0.5); // ②跌幅：标准≤1%，容差3%（W=0.5）
      const sShrink = shrink ? 0.3 : 0;                       // ③缩量回踩(非放量出货)：0.3
      const sBull = ma5 > ma10 ? 0.2 : 0;                     // ④MA5>MA10：0.2
      const score = V(sMa10 + sDrop + sShrink + sBull);
      res.add.push({ name: '主力不破位', score, detail: [`得分 ${score.toFixed(2)} = 站稳MA10 ${V(sMa10).toFixed(2)} + 跌幅 ${V(sDrop).toFixed(2)} + 缩量 ${sShrink.toFixed(2)} + 多头 ${sBull.toFixed(2)}`, `收 ${fmt(c)} 跌破 MA5 ${fmt(ma5)}，但守住 MA10 ${fmt(ma10)}（收/MA10=${(c / ma10).toFixed(3)}）`, `跌幅 ${pct.toFixed(2)}%（≤ 3%，未深砸）`, '主力洗盘不破位 → 反而可加仓'] });
    }
    // ── 减仓信号（越危险越典型）──
    if (c > pk.close && pct >= 5 && shrink) {
      const sRise = scUp(pct / 100, 0.05, 0.5);               // ①涨幅：标准≥5%（W=0.5）
      const sShrink = scLow(vb, 1.0, 1.0);                    // ②缩量：量比越小越诱多
      const sWick = longWick(k) ? 0.3 : 0;                    // ③长上影/近涨停：0.3
      const score = V(sRise + sShrink + sWick);
      res.reduce.push({ name: '无量/缩量急拉', score, detail: [`得分 ${score.toFixed(2)} = 涨幅 ${V(sRise).toFixed(2)} + 缩量 ${V(sShrink).toFixed(2)} + 上影 ${sWick.toFixed(2)}`, `收 ${fmt(c)} 较昨收 ${fmt(pk.close)} 涨 ${pct.toFixed(2)}%（≥ 5%，急拉）`, `今量 ${fmtV(v)} < 5日均量 ${fmtV(volMa5)}（量比 ${vb.toFixed(2)}，无量）`, '无量急拉 → 诱多风险高，减仓'] });
    }
    if (c > h20.v && shrink) {
      const sShrink = scLow(vb, 1.0, 1.0);                    // ①缩量：量比
      const sWeak = scLow(c / h20.v, 1.005, 1.010);           // ②虚破：破前高越勉强越典型（标准<1.005，容差1.010）
      const sWick = longWick(k) ? 0.3 : 0;                    // ③收远离日高(长上影)：0.3
      const score = V(sShrink + sWeak + sWick);
      res.reduce.push({ name: '新高量能不足', score, detail: [`得分 ${score.toFixed(2)} = 缩量 ${V(sShrink).toFixed(2)} + 虚破 ${V(sWeak).toFixed(2)} + 上影 ${sWick.toFixed(2)}`, `收 ${fmt(c)} 突破前高 ${fmt(h20.v)}（${h20.d.slice(5)}，近20日最高收盘），收盘创新高（收/前高=${(c / h20.v).toFixed(3)}）`, `今量 ${fmtV(v)} < 5日均量 ${fmtV(volMa5)}（量比 ${vb.toFixed(2)}，量能不足）`, '新高无量 → 价量背离，获利减仓'] });
    }
    if (c < ma20 && klines[i - 1].close >= ma20s[i - 1]! && pct <= -3) {
      const sDeep = scLow(c / ma20, 0.970, 0.985);            // ①下穿深度：收/MA20 标准≤0.970，容差0.985
      const sDrop = scUp(Math.abs(pct) / 100, 0.03, 0.5);     // ②跌幅：越大越危险（W=0.5）
      const sVol = v >= volMa5 ? 0.3 : 0;                     // ③放量下杀确认：量≥5日均
      const score = V(sDeep + sDrop + sVol);
      res.reduce.push({ name: '急跌破20日线止损', score, detail: [`得分 ${score.toFixed(2)} = 下穿 ${V(sDeep).toFixed(2)} + 跌幅 ${V(sDrop).toFixed(2)} + 放量 ${sVol.toFixed(2)}`, `收 ${fmt(c)} 当天下穿 MA20 ${fmt(ma20)}（前收 ${fmt(klines[i - 1].close)} ≥ MA20 ${fmt(ma20s[i - 1])}；收/MA20=${(c / ma20).toFixed(3)}）`, `跌幅 ${Math.abs(pct).toFixed(2)}%（≥ 3%，急跌）收盘未拉回`, '急跌破20日线 → 中期趋势破坏，止损'] });
    }
    if (c < ma5 && c < ma10 && v >= volMa5 && i + 2 < n && klines[i + 1].close < ma10s[i + 1]! && klines[i + 2].close < ma10s[i + 2]!) {
      const sVol = scUp(vb, 1.0);                             // ①放量：量比
      const sDeep = scLow(c / ma10, 0.970, 0.985);            // ②击穿MA10：标准≤0.970，容差0.985
      const sNoRec = klines[i + 2].close < klines[i + 1].close ? 0.5 : 0.3; // ③不收复：后2日续跌=0.5/横盘=0.3
      const score = V(sVol + sDeep + sNoRec);
      res.reduce.push({ name: '放量破位+2日不收复', score, detail: [`得分 ${score.toFixed(2)} = 放量 ${V(sVol).toFixed(2)} + 击穿 ${V(sDeep).toFixed(2)} + 不收复 ${sNoRec.toFixed(2)}`, `收 ${fmt(c)} 放量跌破 MA5 ${fmt(ma5)}、MA10 ${fmt(ma10)}`, `今量 ${fmtV(v)} ≥ 5日均量 ${fmtV(volMa5)}（量比 ${vb.toFixed(2)}，放量）`, `此后2日收盘 ${fmt(klines[i + 1].close)} / ${fmt(klines[i + 2].close)}，仍低于 MA10 ${fmt(ma10s[i + 1])} / ${fmt(ma10s[i + 2])}（${klines[i + 1].date.slice(5)} / ${klines[i + 2].date.slice(5)}）`, '2日不收复 → 转震荡，减仓'] });
    }
    return res;
  };
  const days: FengDaySignal[] = [];
  for (let i = Math.max(22, n - 10); i < n; i++) days.push(evalDay(i));
  return { latest: evalDay(n - 1), days };
}