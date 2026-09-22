import type { TagParams, BacktestTagGroup } from '../types';
import { DEFAULT_TAG_PARAMS, type UserTagRule, type SignalDataSource, type SignalTargetIndicator } from '../types';
import type { BollKline } from './bollService';
import { getMarketStatus } from './cacheService';
import { calcIndicators } from './indicators';

// ─────────────────────────────────────────────────────────────
// 标签/信号判定分析器（共享模块）
// 从 components/StockDividendPage.tsx 抽取，供股息页面与回测引擎共用。
// 判定函数均为纯函数，输入完整 K 线序列（BollKline[]，date 升序），输出当日命中的标签/信号。
// ─────────────────────────────────────────────────────────────

// ── 回测可选信号【单一数据源】──────────────────────────────
// 这里是"哪些每日信号能作为回测触发标签"的唯一注册表（形态/破位/量能/企稳）。
// 股息页标签弹窗的每日信号与回测可选信号都以本清单为准：
// 弹窗从下方各分析函数即时渲染，回测目录直接 = 本清单。
// ✅ 新增一个弹窗每日信号 → 只在本清单加一行（label 用对应分析函数的产出值），
//    回测与弹窗自动同步，无需在回测引擎再写一遍。
// ⚠️ 环境标签（趋势/波动/位置=高位/低位）走另一套 ENV_TAG_CATALOG（envCondition 前提门控），不在此列。
export interface BacktestTagDef {
  key: string;
  label: string;            // UI 展示名 / 成交记录触发标签名
  abbr: string;             // 预览/单元格单字缩写
  group: BacktestTagGroup;
  source: 'pattern' | 'break' | 'volume' | 'stabilize';
  signalName?: string;      // 各 source 用其判定函数返回的 label 匹配（pattern=analyzeKlinePatterns 的 label；break=固定 token 'break-event'；volume=classifyVolumeAt 5档；stabilize=`${volBucket(量能)}${价格态}` 组合）
  action: 'buy' | 'sell';   // 语义方向提示（执行仍以规则 action 为准）
  color: string;            // 标签主题色：买=砖红、卖=蓝（与 B/S 买卖标签同一套）
}
export const DAILY_SIGNAL_CATALOG: BacktestTagDef[] = [
  // K 线形态（signalName = analyzeKlinePatterns 的 label，弹窗形态 chip 同一来源）
  { key: 'pattern-doji', label: '十字星', abbr: '十', group: 'pattern', source: 'pattern', signalName: '十字星', action: 'sell', color: '#4A90D9' },
  { key: 'pattern-hammer', label: '金针探底', abbr: '针', group: 'pattern', source: 'pattern', signalName: '金针探底', action: 'buy', color: '#C44A3D' },
  { key: 'pattern-boosted-hammer', label: '放量金针', abbr: '针', group: 'pattern', source: 'pattern', signalName: '放量金针', action: 'buy', color: '#C44A3D' },
  { key: 'pattern-hanging', label: '吊颈线', abbr: '吊', group: 'pattern', source: 'pattern', signalName: '吊颈线', action: 'sell', color: '#4A90D9' },
  { key: 'pattern-shooting', label: '射击之星', abbr: '射', group: 'pattern', source: 'pattern', signalName: '射击之星', action: 'sell', color: '#4A90D9' },
  { key: 'pattern-inverted-hammer', label: '倒锤子线', abbr: '倒', group: 'pattern', source: 'pattern', signalName: '倒锤子线', action: 'buy', color: '#C44A3D' },
  // 破位事件（source=break，走弹窗 analyzeMarketConditions 破位事件；signalName 为固定 token）
  { key: 'break-event', label: '破位', abbr: '破', group: 'break', source: 'break', signalName: 'break-event', action: 'sell', color: '#4A90D9' },
  // 每日量能（source=volume，signalName = classifyVolumeAt 5档返回值；弹窗量能 chip 同源）
  { key: 'volume-up-strong', label: '明显放量', abbr: '大放', group: 'volume', source: 'volume', signalName: '明显放量', action: 'buy', color: '#C44A3D' },
  { key: 'volume-up-mid', label: '温和放量', abbr: '小放', group: 'volume', source: 'volume', signalName: '温和放量', action: 'buy', color: '#C44A3D' },
  { key: 'volume-flat', label: '平量', abbr: '平', group: 'volume', source: 'volume', signalName: '平量', action: 'buy', color: '#C44A3D' },
  { key: 'volume-down-mid', label: '温和缩量', abbr: '小缩', group: 'volume', source: 'volume', signalName: '温和缩量', action: 'sell', color: '#4A90D9' },
  { key: 'volume-down-strong', label: '明显缩量', abbr: '大缩', group: 'volume', source: 'volume', signalName: '明显缩量', action: 'sell', color: '#4A90D9' },
  // 位置(高位/低位)属于"环境前提"(ENV_TAG_CATALOG)，不作为每日信号——不在此列
  // 底部企稳（source=stabilize，signalName = `${volBucket(量能)}${价格态}` 组合，如 放量企稳；弹窗企稳 chip 由其两个原子派生）
  // 回踩按 sub 分档：健康回踩（低点抬高）/ 弱势回踩（低点下移）；底部确认是反弹的强化态（放量+收复MA10+低点连抬+MA5走平）
  { key: 'stabilize-confirm-volup', label: '放量企稳', abbr: '放稳', group: 'stabilize', source: 'stabilize', signalName: '放量企稳', action: 'buy', color: '#C44A3D' },
  { key: 'stabilize-stable-voldn', label: '缩量企稳', abbr: '缩稳', group: 'stabilize', source: 'stabilize', signalName: '缩量企稳', action: 'buy', color: '#C44A3D' },
  { key: 'stabilize-stable-flat', label: '平量企稳', abbr: '平稳', group: 'stabilize', source: 'stabilize', signalName: '平量企稳', action: 'buy', color: '#C44A3D' },
  { key: 'stabilize-bounce-volup', label: '放量反弹', abbr: '放反', group: 'stabilize', source: 'stabilize', signalName: '放量反弹', action: 'buy', color: '#C44A3D' },
  { key: 'stabilize-bounce-voldn', label: '缩量反弹', abbr: '缩反', group: 'stabilize', source: 'stabilize', signalName: '缩量反弹', action: 'buy', color: '#C44A3D' },
  { key: 'stabilize-bottom-confirm-volup', label: '放量底部确认', abbr: '放底', group: 'stabilize', source: 'stabilize', signalName: '放量底部确认', action: 'buy', color: '#C44A3D' },
  { key: 'stabilize-retrace-health-voldn', label: '缩量健康回踩', abbr: '健回', group: 'stabilize', source: 'stabilize', signalName: '缩量健康回踩', action: 'buy', color: '#C44A3D' },
  { key: 'stabilize-retrace-weak-voldn', label: '缩量弱势回踩', abbr: '弱回', group: 'stabilize', source: 'stabilize', signalName: '缩量弱势回踩', action: 'sell', color: '#4A90D9' },
];

// K 线形态标签（十字星 / 金针探底 / 吊颈线 / 射击之星 / 倒锤子线）
export interface KlinePattern {
  type: 'doji' | 'hammer' | 'hangingMan' | 'shootingStar' | 'invertedHammer';
  date: string;   // 形态当天日期 YYYY-MM-DD
  label: string;  // 完整名称（十字星 / 金针探底 / 吊颈线 / 射击之星 / 倒锤子线）
  single: string; // 列表单元格单字（十 / 金 / 吊 / 射 / 倒）
  color: 'green' | 'red' | 'slate' | 'blue'; // 红=买/看多 绿=卖/看空 蓝=中性 灰=中性(旧)
  boosted?: boolean;   // 放量金针：当日成交量 > 前5日均量
  direction?: 'high' | 'low' | 'flat'; // 十字星趋势上下文
  detail: string[];    // 判定依据文案
}

// ── K 线形态原子信号：位置 / 量能 维度（同一根K线对所有形态共享同值）──
export type KlinePosition = '高位' | '低位' | '中位';
export type KlineVolume = '放量' | '缩量' | '平量';
export interface KlineDimensions { position: KlinePosition; volume: KlineVolume }
// 组合词条：一个命中的形态，由 位置 + 量能 + 形态名 三个 token 拼装，附组合参考价值
export interface PatternCombo {
  type: KlinePattern['type'];
  date: string;
  tokens: { text: string; cls: string }[];   // 位置 / 量能 / 形态 三 token
  reference: string;                         // 预定义组合参考价值
}
// 形态 token 用纯形态名（避免 label 里"放量金针"污染量能维度）
const PURESHAPE: Record<KlinePattern['type'], string> = {
  doji: '十字星', hammer: '金针探底', hangingMan: '吊颈线', shootingStar: '射击之星', invertedHammer: '倒锤子线',
};
// 位置/量能 token 着色（看多=红 / 看空=绿 / 中性=蓝）
const POS_CLS: Record<KlinePosition, string> = { 低位: 'text-red-500', 高位: 'text-brand-green', 中位: 'text-blue-500' };
const VOL_CLS: Record<KlineVolume, string> = { 放量: 'text-red-500', 缩量: 'text-brand-green', 平量: 'text-blue-500' };
// 非十字星形态 token 着色
const SHAPE_CLS: Record<Exclude<KlinePattern['color'], 'slate'>, string> = { red: 'text-red-500', green: 'text-brand-green', blue: 'text-blue-500' };

// 归一化：老缓存/云端同步的 tagParams 可能缺少新版新增的字段（如量能5档阈值 classicVolHighStrong），
// 缺失项回落默认值，避免 `undefined.enabled` 崩溃。组合词条判定一律经此归一。
function normalizeTagParams(cfg: TagParams = DEFAULT_TAG_PARAMS): TagParams {
  const merge = (src: Record<string, { enabled: boolean; value: number }> | undefined, defaults: Record<string, { enabled: boolean; value: number }>) => {
    const out: Record<string, { enabled: boolean; value: number }> = {};
    for (const k of Object.keys(defaults)) {
      out[k] = { ...defaults[k], ...(src?.[k] || {}) };
    }
    return out as any;
  };
  return { feng: merge(cfg.feng, DEFAULT_TAG_PARAMS.feng), classic: merge(cfg.classic, DEFAULT_TAG_PARAMS.classic) };
}

// 位置维度（按指定日期索引 i）：贴近近20日高点→高位，贴近近20日低点→低位，否则中位。
// 逐日展示/回测“高位/低位”信号时，对任意一天索引用此函数判定。
export function classifyPositionAt(klines: BollKline[], i: number, cfg: TagParams = DEFAULT_TAG_PARAMS): KlinePosition {
  const classic = normalizeTagParams(cfg).classic;
  if (i < 20) return '中位'; // 需 ≥21 根K线（20日窗口）
  const k = klines[i];
  let high20 = -Infinity, low20 = Infinity;
  for (let j = i - 19; j <= i; j++) {
    if (klines[j].high > high20) high20 = klines[j].high;
    if (klines[j].low < low20) low20 = klines[j].low;
  }
  if (classic.classicNearHigh.enabled && k.close >= high20 * classic.classicNearHigh.value) return '高位';
  if (classic.classicNearLow.enabled && k.close <= low20 * classic.classicNearLow.value) return '低位';
  return '中位';
}

// 位置维度（最新一根K线）：委托归类到最近索引
export function classifyPosition(klines: BollKline[], cfg: TagParams = DEFAULT_TAG_PARAMS): KlinePosition {
  return classifyPositionAt(klines, (klines?.length ?? 1) - 1, cfg);
}

// 量能维度（按指定日期索引 i）：当日量/5日均量(含当日) → 5档原词，全模块唯一量能口径。
// 阈值可配置（classicVolHighStrong/HighMid/LowMid/LowStrong），开关关闭时该档不参与。
// 5日均量(含当日) = volMa(t,5) = t-4..t 的平均。索引 <5 视为平量（均量不足不判定、不越界）。
// ── 口径备注（待定）─────────────────────────────────────────────
// 目前使用「5日均量含当日」口径，与交易软件 MA5 线一致、直观好核对；
// 但当日量会自我稀释（放量日抬高均量使 ratio 偏小、缩量日反之）。
// 候选改为「前5日均量不含当日」ratio = V_t / volMa(t-5..t-1)，更稳、避免自我稀释，
// 但会与软件 MA5 线不一致、并随当日量变化引入与曲线图对不上的偏差。
// 如需切换：改本处分母为 t-5..t-1 的平均，并同步核查 classifyVolumeAt 全部调用方
// （含“底部确认”的放量判定 volBucket(classifyVolumeAt(...))、回测 collectSignalsOnDay、
// 弹窗逐日量能 chip）。展示层文案“5日均量含当日口径”也需一并更新。
export type KlineVolume5 = '明显放量' | '温和放量' | '平量' | '温和缩量' | '明显缩量';
export function classifyVolumeAt(klines: BollKline[], i: number, cfg: TagParams = DEFAULT_TAG_PARAMS): KlineVolume5 {
  const classic = normalizeTagParams(cfg).classic;
  if (!klines || klines.length === 0 || i < 5) return '平量';
  const nn = 5;
  let sum = 0;
  for (let j = i - nn + 1; j <= i; j++) sum += klines[j].volume;
  if (sum <= 0) return '平量';
  const ratio = klines[i].volume / (sum / nn);
  if (classic.classicVolHighStrong.enabled && ratio >= classic.classicVolHighStrong.value) return '明显放量';
  if (classic.classicVolHighMid.enabled && ratio >= classic.classicVolHighMid.value) return '温和放量';
  if (classic.classicVolLowStrong.enabled && ratio <= classic.classicVolLowStrong.value) return '明显缩量';
  if (classic.classicVolLowMid.enabled && ratio < classic.classicVolLowMid.value) return '温和缩量';
  return '平量';
}

// 量能维度（最新一根K线）：委托分类到最近索引
export function classifyVolume(klines: BollKline[], cfg: TagParams = DEFAULT_TAG_PARAMS): KlineVolume5 {
  return classifyVolumeAt(klines, (klines?.length ?? 1) - 1, cfg);
}

// ── 用户自定义动态信号标签：快照判定 ────────────────────────────
// 对"某交易日 i"解析：① 触发数据点实际值 resolveSignalValue；② 目标值 resolveTargetValue
// （targetType=fixed 直接用固定值；indicator 则取当日均线 / BOLL 轨，每日动态变化）。
// 均线 / BOLL 均在此由 K 线直接计算（自包含，不依赖 bollService 的周期/前复校设置），
// 与回测热悬浮、弹窗指标保持同源口径。判定封装在 analyzeUserTagRule 供各展示面共用。

// 每股股息率（%）唯一实现：按 K 线所属年份取分红，当年份用 fallback（预估分红）兜底。
// 与列表页股息率曲线 rateForKline 同源（单一事实来源），避免"同一口径写两份实现"。
// byYear: 年份 → 每股税前派息（元）；dateStr/close 为该日 K 线；currentYear 应为"整个数据集最新交易年份"，
// 不可用单日窗口的末根年份（否则每个历史日都会被误判为当年，全部落到 fallback，导致股息率偏离真实历史值）。
export function dividendRateForDay(byYear: Record<number, number> | undefined, dateStr: string | undefined, close: number, currentYear: number, fallback: number): number | null {
  if (!byYear || !dateStr || !(close > 0)) return null;
  const y = parseInt(dateStr.slice(0, 4), 10);
  // 今年分红未完成 → 用选中年份预估分红 fallback；历史年份优先取当年，缺失回退前一年
  let pointDividend = fallback;
  if (!isNaN(y) && Number.isFinite(currentYear) && y === currentYear) pointDividend = fallback;
  else if (!isNaN(y) && byYear[y]) pointDividend = byYear[y];
  else if (!isNaN(y) && byYear[y - 1]) pointDividend = byYear[y - 1];
  else pointDividend = fallback;
  if (pointDividend <= 0) return null;
  return (pointDividend / close) * 100;
}

// 取"整个数据集最新交易年份"，用于股息率按年份折算的 currentYear（须用全量数据，勿用单日窗口）
function latestKlineYear(klines: BollKline[] | undefined): number {
  if (!klines || klines.length === 0) return NaN;
  return parseInt(String((klines[klines.length - 1]?.date || '').slice(0, 4)), 10);
}

// 最新有分红的年份的每股派息：作为当年份的预估分红 fallback（默认选中即最新分红年）
function latestYearDividend(byYear: Record<number, number>): number {
  let bestYear = -1;
  let best = 0;
  for (const key in byYear) {
    const yy = Number(key);
    if (byYear[key] > 0 && yy > bestYear) { bestYear = yy; best = byYear[key]; }
  }
  return best;
}

// 触发数据点实际值（i 越界或数据不足返回 null）
// dividendByYear：<年份, 每股税前派息>，来自股票该字段；股息率按 K 线所属年份折算（与列表股息率曲线同源）
// currentYear：整个数据集最新交易年份（供股息率按年份折算，缺省时退化为以传入 klines 末根推导，须传全量数据才正确）
export function resolveSignalValue(klines: BollKline[], i: number, source: SignalDataSource, dividendByYear?: Record<number, number>, currentYear?: number): number | null {
  if (!klines || klines.length === 0 || i < 0 || i >= klines.length) return null;
  const k = klines[i];
  switch (source) {
    case 'price': return k.close;
    case 'volume': return k.volume;
    case 'changePct': {
      if (i < 1 || !klines[i - 1].close) return null;
      return ((k.close - klines[i - 1].close) / klines[i - 1].close) * 100;
    }
    case 'volumeRatio': {
      if (i < 5) return null;
      let sum = 0;
      for (let j = i - 5; j <= i - 1; j++) sum += klines[j].volume;
      return sum > 0 ? k.volume / (sum / 5) : null;
    }
    case 'kdj':
    case 'rsi': {
      const ind = calcIndicators(klines.slice(0, i + 1));
      if (!ind) return null;
      if (source === 'kdj') return ind.kdj.j;
      return ind.rsi.rsi6;
    }
    case 'dividendRate':
      if (!dividendByYear) return null;
      return dividendRateForDay(dividendByYear, k.date, k.close, currentYear !== undefined ? currentYear : latestKlineYear(klines), latestYearDividend(dividendByYear));
  }
}

// 动态目标值：均线滑动均值 / BOLL 轨（upper/mid/lower，mid=MA20，±2σ）
export function resolveTargetValue(klines: BollKline[], i: number, target: SignalTargetIndicator): number | null {
  if (!klines || klines.length === 0 || i < 0 || i >= klines.length) return null;
  const ma = (n: number): number | null => {
    if (i < n - 1) return null;
    let sum = 0;
    for (let j = i - n + 1; j <= i; j++) sum += klines[j].close;
    return sum / n;
  };
  switch (target) {
    case 'ma5': return ma(5);
    case 'ma10': return ma(10);
    case 'ma20': return ma(20);
    case 'ma60': return ma(60);
    case 'ma120': return ma(120);
    case 'bollMid': return ma(20);
    case 'bollUpper':
    case 'bollLower': {
      const mid = ma(20);
      if (mid === null) return null;
      let variance = 0;
      for (let j = i - 19; j <= i; j++) variance += Math.pow(klines[j].close - mid, 2);
      const std = Math.sqrt(variance / 20);
      return target === 'bollUpper' ? mid + 2 * std : mid - 2 * std;
    }
  }
}

// 单条规则判定：命中返回依据文案数组，未命中返回 null
// dividendByYear：<年份, 每股税前派息>，供 dividendRate 数据点判定（按 K 线所属年份折算，同列表股息率曲线口径）
export const DEFAULT_TOUCH_TOL = 0.5; // 触达容差已从 UI 隐藏，不再使用
export function analyzeUserTagRule(klines: BollKline[], i: number, rule: UserTagRule, dividendByYear?: Record<number, number>, currentYear?: number): string[] | null {
  if (!rule || !rule.enabled) return null;
  const v = resolveSignalValue(klines, i, rule.source, dividendByYear, currentYear);
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  const t = rule.targetType === 'fixed' ? rule.targetValue : resolveTargetValue(klines, i, rule.targetIndicator as SignalTargetIndicator);
  if (t === null || t === undefined || Number.isNaN(t)) return null;
  let hit = false;
  if (rule.direction === 'touch') {
    // 触达：连续值（价格/股息率/指标等）跨越目标线即为"触达"（任一边均可）——
    // 从下方上穿至 ≥目标，或从上方下穿至 ≤目标，命中发生"到达目标线"的那一天。
    const pre = resolveSignalValue(klines, i - 1, rule.source, dividendByYear, currentYear);
    hit = pre !== null && pre !== undefined && !Number.isNaN(pre) && ((pre < t && v >= t) || (pre > t && v <= t));
  } else {
    hit = rule.direction === 'up' ? v >= t : v <= t;
  }
  if (!hit) return null;
  const fmt = (x: number) => (Math.abs(x) >= 1000 ? x.toFixed(0) : x.toFixed(2));
  const dirLabel = rule.direction === 'up' ? '增至' : rule.direction === 'down' ? '降至' : '触达';
  return [`${rule.name}：${dirLabel} ${rule.targetType === 'fixed' ? fmt(t) : t.toFixed(2)}，当日值 ${fmt(v)} 达到目标`, `触发：${rule.targetType === 'fixed' ? '固定目标' : `${rule.targetIndicator as string} 动态目标`}`];
}

// 内部粗分辅助：5档 → 3档（温和/明显 折叠），供 dojiColorByDim、PATTERN_COMBO_REFERENCE 的 key、
// 组合方向判断，以及“价格态×量能”组合信号的拼装使用。对外展示的 chip 文本仍用 5 档原词。
export function volBucket(v5: KlineVolume5): '放量' | '缩量' | '平量' {
  if (v5 === '明显放量' || v5 === '温和放量') return '放量';
  if (v5 === '明显缩量' || v5 === '温和缩量') return '缩量';
  return '平量';
}

// ── 每日信号 chip 配色【单一数据源】──────────────────────────────
// 标签弹窗（StockDividendPage 每日信号区）与 底部信号栏（SignalTagsFooter）共用，
// 语义：红=偏多/放量/看多，绿=偏空/缩量/看空，蓝=中性，slate=平量/中性弱。
// 任何一侧改色只改此处，两侧自动一致。
type ChipCls = { cls: string; sel: string };
export const CHIP_CLS_RED = 'bg-red-500/10 text-red-500 border-red-500/20';
export const CHIP_CLS_GREEN = 'bg-green-500/10 text-green-500 border-green-500/20';
export const CHIP_CLS_BLUE = 'bg-blue-500/10 text-blue-400 border-blue-500/30';
export const CHIP_CLS_SLATE = 'bg-slate-500/10 text-slate-400 border-slate-500/30';
export const CHIP_CLS_INDIGO = 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30';
export const CHIP_SEL_RED = ' border-red-500/60';
export const CHIP_SEL_GREEN = ' border-green-500/60';
export const CHIP_SEL_BLUE = ' border-blue-400/60';
export const CHIP_SEL_SLATE = ' border-slate-400/60';
export const CHIP_SEL_INDIGO = ' border-indigo-400/60';
// K 线形态 chip：按 KlinePattern.color（red/green/blue/slate）
export const PATTERN_CHIP_CLS: Record<KlinePattern['color'], ChipCls> = {
  red: { cls: CHIP_CLS_RED, sel: CHIP_SEL_RED },
  green: { cls: CHIP_CLS_GREEN, sel: CHIP_SEL_GREEN },
  blue: { cls: CHIP_CLS_BLUE, sel: CHIP_SEL_BLUE },
  slate: { cls: CHIP_CLS_SLATE, sel: CHIP_SEL_SLATE },
};
// 每日量能 5 档 chip：放量红、缩量绿、平量 slate（明显级加深底色）
export const VOLUME5_CHIP_CLS: Record<KlineVolume5, ChipCls> = {
  明显放量: { cls: 'bg-red-600/10 text-red-500 border-red-500/30', sel: ' border-red-500/70' },
  温和放量: { cls: CHIP_CLS_RED, sel: CHIP_SEL_RED },
  平量: { cls: CHIP_CLS_SLATE, sel: CHIP_SEL_SLATE },
  温和缩量: { cls: CHIP_CLS_GREEN, sel: CHIP_SEL_GREEN },
  明显缩量: { cls: 'bg-green-600/10 text-green-500 border-green-500/30', sel: ' border-green-500/70' },
};
// 价格态 chip：偏多红、看空绿（clean 按 ps.color 取）
export const PRICESTATE_CHIP_CLS: Record<'red' | 'green', ChipCls> = {
  red: { cls: CHIP_CLS_RED, sel: CHIP_SEL_RED },
  green: { cls: CHIP_CLS_GREEN, sel: CHIP_SEL_GREEN },
};
// 破位事件 chip：看空 → 绿色
export const BREAK_CHIP_CLS: ChipCls = { cls: CHIP_CLS_GREEN, sel: CHIP_SEL_GREEN };

// 十字星形态 token 着色：结合位置×量能的整体多空倾向（理财 AI 语义）
export function dojiColorByDim(position: KlinePosition, volume: KlineVolume): 'red' | 'green' | 'blue' {
  if (position === '低位' && volume === '缩量') return 'red';  // 抛压衰竭/底部信号
  if (position === '高位' && volume === '放量') return 'green'; // 抛压增加/顶部风险高
  return 'blue';  // 其余：多空分歧/滞涨/整理/变盘前夜 → 中性
}

// 预定义组合参考价值：key 为 `${position}-${volume}-${type}`；未预定义的回落形态兜底文案
const PATTERN_COMBO_REFERENCE: Record<string, string> = {
  '低位-缩量-hammer': '下跌末端承接较强的底部信号。下影长、缩量说明抛压衰竭，买盘开始接管；可视为底部企稳的候选，仍待次日阳线确认。',
  '高位-放量-shootingStar': '放量滞涨的冲高诱多。上影长且放量说明上方抛压沉重、主力诱多出货嫌疑大，顶部风险高。',
  '高位-放量-hangingMan': '上涨末端假承接。长下影被放量拉回但高位滞涨，空头反扑迹象明显，应警惕顶部。',
  '低位-放量-invertedHammer': '低位放量试盘。冲高回落但放量说明有资金试探，若次阳确认则可能启动；否则仍需观察。',
};
// 十字星参考价值：已能确定具体位置×量能，直接给出该组合的具体判断（不再回落“需结合位置量能”的通用文案）
function dojiReferenceByDim(position: KlinePosition, volume: KlineVolume): string {
  switch (`${position}-${volume}`) {
    case '低位-缩量': return '抛压衰竭的底部变盘信号。空头力竭、多头开始抵抗，需随后出现阳线（尤其放量阳线）收复短期均线方可确认底部；若继续缩量阴跌则只是下跌中继。';
    case '低位-平量': return '低位整理中的变盘前夜。多空暂时平衡但方向未明、量能未放量确认；需等待放量阳线选择方向，未破前低前不宜直接抄底。';
    case '低位-放量': return '低位多空分歧剧烈。量能放大但价格横盘，说明有资金试盘也有抛压；需后续阳线确认方向，未确认前不构成直接买卖依据。';
    case '中位-缩量': return '区间中部的缩量十字星。抛压减弱但多头也未发力，方向中性；等量能选择方向，跌破或放量上破均线再定夺。';
    case '中位-平量': return '中位多空暂时平衡的变盘前夜。本身不是买卖指令，需等下一根K线结合量能确认方向。';
    case '中位-放量': return '中位放量十字星。多空分歧显著放大，往往是变盘启动点；放量后方向一旦明确，波动会快速放大。';
    case '高位-缩量': return '上涨乏力的滞涨警示。动能衰减但抛压未明显放大，方向未明；若出现放量阴线则转空，需防诱多。';
    case '高位-平量': return '高位盘整的滞涨信号。多空分歧暂平衡，但处于高位本身风险偏高；后续放量阴线或跌破短期均线，则顶部概率上升。';
    case '高位-放量': return '放量滞涨的顶部预警。多空分歧剧烈、抛压增加，主力有兑现嫌疑；后随出现放量阴线并跌破短期均线，则顶部风险明显升高。';
  }
  return '';
}
// 形态基础参考价值兜底
const PATTERN_BASE_REFERENCE: Record<KlinePattern['type'], string> = {
  doji: '十字星是多空暂时平衡的变盘预警，本身不是买卖指令。必须结合位置（低位看止跌、高位看滞涨）与量能，并等下一根K线确认方向。',
  hammer: '金针探底是下跌末端的承接信号，偏看多。示意下方有买盘托底，但仍需阳线确认与放量配合，未确认前不急于抄底。',
  hangingMan: '吊颈线是上涨末端的假承接，偏看空。形态似金针但出现在高位，需警惕冲高回落与顶部反转。',
  shootingStar: '射击之星是冲高诱多的看空信号。上影越长、放量越大，见顶概率越高。',
  invertedHammer: '倒锤子线是下跌末端的试盘信号，偏看多。冲高回落后若能阳线确认，可能启动反弹。',
};

// 组合词条：对每个命中形态组装 位置·量能·形态 三元 token + 参考价值（位置/量能全形态共享）
export function analyzeKlineCombo(klines: BollKline[], patterns: KlinePattern[], cfg: TagParams = DEFAULT_TAG_PARAMS): PatternCombo[] {
  if (!patterns || patterns.length === 0) return [];
  const dims: KlineDimensions = { position: classifyPosition(klines, cfg), volume: volBucket(classifyVolume(klines, cfg)) };
  return patterns.map(p => {
    const shapeCls = p.type === 'doji'
      ? SHAPE_CLS[dojiColorByDim(dims.position, dims.volume)]
      : SHAPE_CLS[p.color as Exclude<KlinePattern['color'], 'slate'>];
    const reference = p.type === 'doji'
      ? dojiReferenceByDim(dims.position, dims.volume)
      : PATTERN_COMBO_REFERENCE[`${dims.position}-${dims.volume}-${p.type}`] ?? PATTERN_BASE_REFERENCE[p.type] ?? '';
    return {
      type: p.type,
      date: p.date,
      tokens: [
        { text: dims.position, cls: POS_CLS[dims.position] },
        { text: dims.volume, cls: VOL_CLS[dims.volume] },
        { text: PURESHAPE[p.type], cls: shapeCls },
      ],
      reference,
    };
  });
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
// 按指定日期索引 i 判定当日 K 线形态（十字星/金针/吊颈/射击之星/倒锤子线）。
// 基础指标（前20日均线方向 / 近20日高低点与平均振幅 / 前5日均量 / 位置 / 量能）均基于 i 之前的数据计算，
// 与回测“以该日为末端的窗口”判定同一索引时结果一致；越界保护要求 i≥20（前20日窗口 / 前5日均量不越界）。
export function analyzeKlinePatternsAt(klines: BollKline[], i: number, fmt: (v: number) => string, cfg: TagParams = DEFAULT_TAG_PARAMS): KlinePattern[] {
  const classic = cfg.classic;
  const dojiBody = classic.classicDojiBody, smallBodyP = classic.classicSmallBody, nearHighP = classic.classicNearHigh, nearLowP = classic.classicNearLow;
  const n = klines.length;
  if (n < 21 || i < 20 || i >= n) return []; // 需 ≥21 根K线（前20日趋势 / 平均振幅），且 i≥20 保证窗口不越界
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
    const pos = classifyPositionAt(klines, i, cfg);
    const vol = volBucket(classifyVolumeAt(klines, i, cfg));
    const dojiColor = dojiColorByDim(pos, vol);
    patterns.push({
      type: 'doji', date: k.date, label: '十字星', single: '十', color: dojiColor, direction: dir,
      detail: [
        `${ds} 十字星：开 ${fmt(k.open)} ≈ 收 ${fmt(k.close)}`,
        `实体占比 ${pct}% ≤ ${(dojiBody.value * 100).toFixed(1)}%（多空平衡）`,
        dir === 'high' ? `现价贴近近20日高点（≥${(nearHighP.value * 100).toFixed(1)}%区间）→ 高位警示`
          : dir === 'low' ? `现价贴近近20日低点（≤${(nearLowP.value * 100).toFixed(1)}%区间）→ 低位关注`
          : '趋势方向中性',
        `${pos} · ${vol} → ${dojiColor === 'red' ? '偏多（低位缩量，抛压衰竭）' : dojiColor === 'green' ? '偏空（高位放量，顶部风险）' : '中性（方向未明）'}`,
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

// 全部形态判定（K线形态，最新收盘交易日）：委托到最近索引，保持既有调用兼容（回测/列表缩略仍复用同一判定）
export function analyzeKlinePatterns(klines: BollKline[], fmt: (v: number) => string, cfg: TagParams = DEFAULT_TAG_PARAMS): KlinePattern[] {
  return analyzeKlinePatternsAt(klines, (klines?.length ?? 1) - 1, fmt, cfg);
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

// ── 破位事件分析：近 N 个交易日“破位”事件（自 components/StockDividendPage.tsx 迁入）──
export const MARKET_MA_PERIODS = [5, 10, 20, 30, 60, 120, 250, 500];

// 被跌破的均线明细
export interface MarketMaInfo {
  period: number;
  value: number; // 破位当天的均线值
}

export interface MarketEvent {
  date: string; // 破位当天日期 YYYY-MM-DD
  brokenCount: number; // 当日跌破的均线条数 N
  brokenList: MarketMaInfo[]; // 当日下穿的均线明细（按周期升序）
  ref: MarketMaInfo; // 参照均线：被跌破中数值最高的一条
  close: number; // 破位当天收盘价
  status: 'confirming' | 'trueBreak' | 'falseBreak'; // 修复观察 / 真破位 / 假破位
  returnDay?: { date: string; close: number; refMa: number }; // 假破位：回到均线上方那天
  window: { date: string; close: number; refMa: number }[]; // 观测窗口每日数据（破位日起）
}

// 破位：当日收盘价下穿若干条均线（前一日收盘≥均线、当日收盘<均线）
// 真/假破位：以被跌破均线中数值最高的一条为参照，破位当天算第1天，3天内
// 收盘价（每日对比该日最新均线值）回到其上方即假破位，否则第3天收盘后判真破位；
// 数据不足（事件距今天太近）时保持“修复观察”。
export function analyzeMarketConditions(klines: BollKline[], lastDays = 5): MarketEvent[] {
  const n = klines.length;
  if (n < lastDays + 1) return [];
  const closes = klines.map(k => k.close);
  // 各周期均线序列：maSeries[pi][i] 为第 i 天该周期均线值，历史不足时为 null
  const maSeries = MARKET_MA_PERIODS.map(period => {
    const res: (number | null)[] = new Array(n).fill(null);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += closes[i];
      if (i >= period) sum -= closes[i - period];
      if (i >= period - 1) res[i] = sum / period;
    }
    return res;
  });
  const events: MarketEvent[] = [];
  for (let t = n - lastDays; t < n; t++) {
    if (t - 1 < 0) continue;
    // 统计当日下穿的均线集合
    const broken: MarketMaInfo[] = [];
    for (let pi = 0; pi < MARKET_MA_PERIODS.length; pi++) {
      const period = MARKET_MA_PERIODS[pi];
      const maT = maSeries[pi][t];
      const maPrev = maSeries[pi][t - 1];
      if (maT == null || maPrev == null) continue;
      if (closes[t] < maT && closes[t - 1] >= maPrev) broken.push({ period, value: maT });
    }
    if (broken.length === 0) continue;
    // 参照均线：被跌破中数值最高的一条（价格下跌时最先触到）
    const ref = broken.reduce((a, b) => (b.value > a.value ? b : a));
    const refPi = MARKET_MA_PERIODS.indexOf(ref.period);
    // 3 天观测：破位当天为第 1 天，记录每日收盘与当日最新参照均线值
    const window: { date: string; close: number; refMa: number }[] = [];
    let returned = false;
    for (let d = t; d <= t + 2 && d < n; d++) {
      const maD = maSeries[refPi][d];
      const refMa = maD ?? 0;
      window.push({ date: klines[d].date, close: closes[d], refMa });
      if (maD != null && closes[d] >= maD) { returned = true; break; }
    }
    let status: MarketEvent['status'];
    if (returned) status = 'falseBreak';
    else if (n - 1 >= t + 2) status = 'trueBreak';
    else status = 'confirming';
    const ev: MarketEvent = {
      date: klines[t].date,
      brokenCount: broken.length,
      brokenList: broken.slice().sort((a, b) => a.period - b.period),
      ref,
      close: closes[t],
      status,
      window,
    };
    if (status === 'falseBreak') ev.returnDay = window[window.length - 1];
    events.push(ev);
  }
  return events;
}

// ── 交易环境标签体系：趋势结构 / 量价关系 / 动能背离 / 波动率 / 综合强弱周期 ──
// 参考 docs/行情标签体系说明书.md 实现。打分制：均线40% + 量价40% + 波动(BOLL)20%（MACD 已移除，改由每日信号展示），
// 总分 ≥0.6 强周期 / ≤-0.6 弱周期，中间为震荡/变盘期；强弱细分再叠加关键信号确认。
export interface EnvTag {
  key: string;      // 唯一标识（cycle 或维度标签）
  label: string;    // 完整名称
  single: string;   // 单字（单元格备用）
  color: 'red' | 'green' | 'orange' | 'indigo' | 'slate';
  score: number;    // 得分 -1~1
  dim: 'cycle' | 'trend' | 'volume' | 'volatility' | 'position';
  detail: string[]; // 判定依据
}
export interface EnvResult {
  tags: EnvTag[]; // cycle + 各维度触发的标签
  total: number;  // 综合得分
  dimScores: { trend: number; volume: number; volatility: number };
}

export function analyzeEnvironment(klines: BollKline[], fmt: (v: number) => string, allowVolume = true, cfg: TagParams = DEFAULT_TAG_PARAMS): EnvResult | null {
  const nearHighP = cfg.classic.classicNearHigh, nearLowP = cfg.classic.classicNearLow, masSqueezeP = cfg.classic.classicMaSqueeze;
  const n = klines.length;
  if (n < 130) return null; // 需 120 日均线 + 近20日高低点 + 近60日带宽分位
  const i = n - 1;
  const k = klines[i];
  const close = k.close;
  const prev = klines[i - 1];
  const fmtVol = (v: number) => (v >= 1e8 ? `${(v / 1e8).toFixed(2)}亿` : v >= 1e4 ? `${(v / 1e4).toFixed(1)}万` : `${v.toFixed(0)}`);
  const fmtScore = (s: number) => (s >= 0 ? '+' : '') + s.toFixed(2);
  const ds = k.date.slice(5).replace('-', '/'); // MM/DD
  // 近20日高低点
  let high20 = -Infinity, low20 = Infinity;
  for (let j = i - 19; j <= i; j++) {
    if (klines[j].high > high20) high20 = klines[j].high;
    if (klines[j].low < low20) low20 = klines[j].low;
  }
  const nearHigh = nearHighP.enabled && close >= high20 * nearHighP.value;

  // 序列指标
  const m5s = calcMaSeries(klines, 5), m10s = calcMaSeries(klines, 10), m20s = calcMaSeries(klines, 20),
    m60s = calcMaSeries(klines, 60), m120s = calcMaSeries(klines, 120);
  const bolls = calcBollSeries(klines);

  const m5 = m5s[i], m10 = m10s[i], m20 = m20s[i], m60 = m60s[i], m120 = m120s[i];
  const m5p = m5s[i - 1], m10p = m10s[i - 1], m20p = m20s[i - 1], m60p = m60s[i - 1], m120p = m120s[i - 1];

  // ── 趋势结构维度（30%）──
  let trendScore = 0;
  let trendTag: EnvTag | null = null;
  if (m5 && m10 && m20 && m60 && m120 && m5p && m10p && m20p && m60p && m120p) {
    const spread = Math.max(m5, m10, m20, m60) - Math.min(m5, m10, m20, m60);
    if (masSqueezeP.enabled && spread < close * masSqueezeP.value) {
      trendScore = 0;
      trendTag = { key: 'trend-squeeze', label: '均线粘合', single: '粘', color: 'slate', score: 0, dim: 'trend', detail: [
        `${ds} 5/10/20/60 均线最大差值 ${fmt(spread)} < 股价×${(masSqueezeP.value * 100).toFixed(1)}%（${fmt(close)}）`,
        '方向选择的前夜：上破粘合区进强周期，下破进弱周期',
      ] };
    } else if (m5 > m10 && m10 > m20 && m20 > m60 && m60 > m120
      && m5 > m5p && m10 > m10p && m20 > m20p && m60 > m60p && m120 > m120p) {
      trendScore = 1;
      trendTag = { key: 'trend-strong-up', label: '多头强排列', single: '多', color: 'red', score: 1, dim: 'trend', detail: [
        `5>10>20>60>120（${fmt(m5)}>${fmt(m10)}>${fmt(m20)}>${fmt(m60)}>${fmt(m120)}）且斜率全部向上`,
        '主升浪进攻期：回踩 5/10 日线是高胜算买点',
      ] };
    } else if (m5 < m10 && m10 < m20 && m20 < m60 && m60 < m120
      && m5 < m5p && m10 < m10p && m20 < m20p && m60 < m60p && m120 < m120p) {
      trendScore = -1;
      trendTag = { key: 'trend-strong-down', label: '空头强排列', single: '空', color: 'green', score: -1, dim: 'trend', detail: [
        `120>60>20>10>5（${fmt(m120)}>${fmt(m60)}>${fmt(m20)}>${fmt(m10)}>${fmt(m5)}）且斜率全部向下`,
        '主跌浪/系统性风险：反弹到 5/10 日线是逃命线',
      ] };
    } else if (m5 > m10 && m10 > m20 && m20 > m60) {
      trendScore = 0.4;
      trendTag = { key: 'trend-weak-up', label: '多头弱排列', single: '弱', color: 'orange', score: 0.4, dim: 'trend', detail: [
        `5/10/20 短中期均线在 60 日之上（${fmt(m5)}>${fmt(m10)}>${fmt(m20)}>${fmt(m60)}）但缠绕粘合、斜率未全向上`,
        '高位震荡/上涨中继：适合高抛低吸，不宜追涨',
      ] };
    } else if (m5 < m10 && m10 < m20 && m20 < m60) {
      trendScore = -0.4;
      trendTag = { key: 'trend-weak-down', label: '空头弱排列', single: '衰', color: 'slate', score: -0.4, dim: 'trend', detail: [
        `5/10/20 短中期均线在 60 日之下（${fmt(m5)}<${fmt(m10)}<${fmt(m20)}<${fmt(m60)}）且走平粘合`,
        '震荡筑底期：小仓位试盘，等短期均线上穿的金叉确认',
      ] };
    }
  }

  // ── 量价关系维度（40%：未收盘的今日非最后半小时不判定，量价缺席不参与打分）──
  let volumeScore = 0;
  let volTag: EnvTag | null = null;
  const up = close > prev.close;
  const down = close < prev.close;
  let volUp = false;
  let isLowVol = false;
  if (allowVolume) {
    let volMa5 = 0;
    for (let j = i - 5; j <= i - 1; j++) volMa5 += klines[j].volume;
    volMa5 /= 5;
    volUp = k.volume >= volMa5;
    let minVol = Infinity;
    for (let j = i - 19; j <= i; j++) minVol = Math.min(minVol, klines[j].volume);
    isLowVol = k.volume <= minVol;
    if (up && volUp) {
      volumeScore = 1;
      volTag = { key: 'vol-up-up', label: '量增价升', single: '增', color: 'red', score: 1, dim: 'volume', detail: [
        `${ds} 收 ${fmt(close)} > 昨收 ${fmt(prev.close)}，量 ${fmtVol(k.volume)} ≥ 5日均量 ${fmtVol(volMa5)}`,
        '真金白银的拉升：趋势具持续性，持仓不动是最优解',
      ] };
    } else if (up) {
      volumeScore = 0.2;
      volTag = { key: 'vol-up-down', label: '量缩价升', single: '缩', color: 'red', score: 0.2, dim: 'volume', detail: [
        `${ds} 收 ${fmt(close)} > 昨收 ${fmt(prev.close)}，但量 ${fmtVol(k.volume)} < 5日均量 ${fmtVol(volMa5)}`,
        '动能衰竭警告：高位易形成诱多陷阱，需提高警惕',
      ] };
    } else if (down && volUp) {
      volumeScore = -1;
      volTag = { key: 'vol-down-up', label: '量增价跌', single: '增', color: 'green', score: -1, dim: 'volume', detail: [
        `${ds} 收 ${fmt(close)} < 昨收 ${fmt(prev.close)}，量 ${fmtVol(k.volume)} ≥ 5日均量 ${fmtVol(volMa5)}`,
        nearHigh ? '出现在高位：机构高位出货，坚决离场' : '出现在大跌末端：恐慌盘涌出，往往接近最后一跌',
      ] };
    } else {
      volumeScore = -0.2;
      volTag = { key: 'vol-down-down', label: '量缩价跌', single: '缩', color: 'green', score: -0.2, dim: 'volume', detail: [
        `${ds} 收 ${fmt(close)} < 昨收 ${fmt(prev.close)}，量 ${fmtVol(k.volume)} < 5日均量 ${fmtVol(volMa5)}`,
        '无人接盘的阴跌：除非放量恐慌盘或大阳线，否则不抄底',
      ] };
    }
    if (isLowVol) {
      volumeScore = Math.min(1, volumeScore + 0.4);
      volTag.detail.push(`量 ${fmtVol(k.volume)} 创近20日最低 → 地量见地价（抛售枯竭）`);
    }
  }

  // ── 动能/MACD 维度（已移除：金叉/死叉改由每日行情信号展示，不参与环境打分）──

  // ── 波动率维度（15%：BOLL 20,2）──
  let bollScore = 0;
  let bollTag: EnvTag | null = null;
  let squeeze = false;
  const b = bolls[i], b3 = bolls[i - 3];
  if (b.mid && b.upper && b.lower && b3.upper && b3.lower) {
    const band = (b.upper - b.lower) / b.mid;
    const start = Math.max(0, i - 59);
    const bands: number[] = [];
    for (let j = start; j <= i; j++) {
      const bb = bolls[j];
      if (bb.mid && bb.upper && bb.lower) bands.push((bb.upper - bb.lower) / bb.mid);
    }
    bands.sort((a, b2) => a - b2);
    const p20 = bands[Math.floor(bands.length * 0.2)];
    squeeze = band < p20;
    const touchUpper = close >= b.mid + (b.upper - b.mid) * 0.7;
    const touchLower = close <= b.mid - (b.mid - b.lower) * 0.7;
    const upperRising = b.upper > b3.upper;
    const lowerFalling = b.lower < b3.lower;
    if (squeeze) {
      bollScore = 0;
      bollTag = { key: 'vol-squeeze', label: '布林收口', single: '收', color: 'slate', score: 0, dim: 'volatility', detail: [
        `带宽 ${(band * 100).toFixed(1)}% 低于近60日20%分位（${(p20 * 100).toFixed(1)}%）`,
        '大变盘前的宁静：盯方向，上破中轨做多、下破做空/离场',
      ] };
    } else if (touchUpper && upperRising) {
      bollScore = 1;
      bollTag = { key: 'vol-up', label: '上轨扩张', single: '扩', color: 'red', score: 1, dim: 'volatility', detail: [
        `上轨 ${fmt(b.upper)} 向上翘起，价 ${fmt(close)} 贴上轨运行`,
        '单边强趋势进行中：持仓者拿住，追高风险极大',
      ] };
    } else if (touchLower && lowerFalling) {
      bollScore = -1;
      bollTag = { key: 'vol-down', label: '下轨扩张', single: '扩', color: 'green', score: -1, dim: 'volatility', detail: [
        `下轨 ${fmt(b.lower)} 向下翘起，价 ${fmt(close)} 贴下轨运行`,
        '单边下跌恐慌中：不接飞刀，等价格站回下轨上方',
      ] };
    } else {
      bollScore = close >= b.mid ? 0.3 : -0.3;
    }
  }

  // ── 综合强弱周期（打分定档 + 关键信号确认）──
  // 权重重分配：均线40% + 量价40% + 波动20%（MACD已移除，权重归一）；量价缺席时剔除并归一
  const total = allowVolume
    ? 0.4 * trendScore + 0.4 * volumeScore + 0.2 * bollScore
    : (0.4 * trendScore + 0.2 * bollScore) / 0.6;
  const dimLine = allowVolume
    ? `均线 ${fmtScore(trendScore)} · 量价 ${fmtScore(volumeScore)} · 波动 ${fmtScore(bollScore)}`
    : `均线 ${fmtScore(trendScore)} · 量价 -- · 波动 ${fmtScore(bollScore)}`;
  const bear = trendScore <= -0.4;
  let cycle: EnvTag;
  if (total >= 0.6) {
    cycle = { key: 'cycle', label: '强进攻周期', single: '攻', color: 'red', score: total, dim: 'cycle', detail: [`综合得分 ${fmtScore(total)}`, dimLine, '趋势/量价/波动共振：重仓持有，逢回踩均线加仓'] };
  } else if (total <= -0.6) {
    cycle = { key: 'cycle', label: '弱筑底周期', single: '筑', color: 'indigo', score: total, dim: 'cycle', detail: [`综合得分 ${fmtScore(total)}`, dimLine, '下跌力量衰竭：轻仓试盘，等放量大阳线确认反转'] };
  } else if (total >= 0.2 && ((allowVolume && up && !volUp) || squeeze)) {
    cycle = { key: 'cycle', label: '强防守周期', single: '防', color: 'orange', score: total, dim: 'cycle', detail: [`综合得分 ${fmtScore(total)}`, dimLine, '趋势还在但内核转弱：只出不进，锁定利润，等方向明朗'] };
  } else if (total <= -0.2 && bear && ((allowVolume && isLowVol) || squeeze)) {
    cycle = { key: 'cycle', label: '弱筑底周期', single: '筑', color: 'indigo', score: total, dim: 'cycle', detail: [`综合得分 ${fmtScore(total)}`, dimLine, '空头衰竭信号（地量/收口）：轻仓试盘，急跌敢买'] };
  } else if (total <= -0.2 && bear) {
    cycle = { key: 'cycle', label: '弱反弹周期', single: '弹', color: 'green', score: total, dim: 'cycle', detail: [`综合得分 ${fmtScore(total)}`, dimLine, '空头下的超跌反抽：借反弹坚决减仓，绝不追高'] };
  } else {
    cycle = { key: 'cycle', label: '震荡变盘期', single: '震', color: 'slate', score: total, dim: 'cycle', detail: [`综合得分 ${fmtScore(total)}`, dimLine, '方向未明：控制仓位，等待突破确认'] };
  }
  const tags: EnvTag[] = [cycle];
  // 位置维度（长期稳定标签）：贴近近20日高/低点 → 高位/低位，归入环境区展示（低位红=偏多、高位绿=偏空、中位灰=中性）
  const pos = classifyPosition(klines, cfg);
  if (pos === '高位') {
    tags.push({ key: 'pos-high', label: '高位', single: '高', color: 'green', score: -0.5, dim: 'position', detail: [
      `${ds} 现价 ${fmt(close)} 贴近近20日高点（≥${(nearHighP.value * 100).toFixed(1)}%）→ 中期位置偏高`,
      '高位追涨性价比低：结合量能，若放量滞涨/冲高回落则顶部风险大',
    ] });
  } else if (pos === '低位') {
    tags.push({ key: 'pos-low', label: '低位', single: '低', color: 'red', score: 0.5, dim: 'position', detail: [
      `${ds} 现价 ${fmt(close)} 贴近近20日低点（≤${(nearLowP.value * 100).toFixed(1)}%）→ 中期位置偏低`,
      '低位关注止跌：缩量十字星/放量金针等企稳信号出现后再考虑介入',
    ] });
  } else {
    tags.push({ key: 'pos-mid', label: '中位', single: '中', color: 'slate', score: 0, dim: 'position', detail: [
      `${ds} 现价 ${fmt(close)} 处于近20日区间中部 → 位置中性`,
      '无明确高低位倾向：方向取决于趋势结构与量价配合',
    ] });
  }
  if (trendTag) tags.push(trendTag);
  if (volTag) tags.push(volTag);
  if (bollTag) tags.push(bollTag);
  return { tags, total, dimScores: { trend: trendScore, volume: volumeScore, volatility: bollScore } };
}

// ── 展示辅助（列表缩略 + 弹窗共用，纯函数，便于测试）──
// 列表缩略展示标签（单字 + 底色 CLS）
export interface MktTag { key: string; text: string; cls: string }

// 环境维度单字底色：按 EnvTag.color 映射 Tailwind CLS
const ENV_SINGLE_CLS: Record<EnvTag['color'], string> = {
  red: 'bg-red-500/10 text-red-500 border-red-500/20',
  green: 'bg-green-500/10 text-green-500 border-green-500/20',
  orange: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  indigo: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
  slate: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
};

// 弹窗“环境”区与列表缩略共用：只保留当前启用的 趋势结构 + 布林波动 + 位置（cycle/volume 已注释）。
// 将来要恢复综合周期/量价时，改这里一处即可。
export function selectEnvDisplayTags(tags: EnvTag[]): EnvTag[] {
  // 环境区显示"可作为回测环境前提"的维度：趋势结构 + 布林波动 + 位置(高位/低位)。
  // 位置属于环境前提（回测走 envCondition 门控），不属于每日信号——与 ENV_TAG_CATALOG 保持一致。
  return tags.filter(t => t.dim === 'trend' || t.dim === 'volatility' || t.dim === 'position');
}

// 回测可用的"环境条件"候选目录：趋势结构 + 布林波动 + 位置（与弹窗 selectEnvDisplayTags 同维度，不含已注释的周期/量价）。
// 作为回测规则的辅助前提：当且仅当当日环境状态命中该标签（AND 门控），对应的触发标签才允许执行动作。
export interface EnvConditionDef {
  key: string;      // 稳定 key（= analyzeEnvironment 产出的 EnvTag.key）
  label: string;    // 完整名称
  single: string;   // 单字
  color: EnvTag['color'];
  dim: 'trend' | 'volatility' | 'position';
}
export const ENV_TAG_CATALOG: EnvConditionDef[] = [
  // 趋势结构（dim: trend）
  { key: 'trend-strong-up', label: '多头强排列', single: '多', color: 'red', dim: 'trend' },
  { key: 'trend-weak-up', label: '多头弱排列', single: '弱', color: 'orange', dim: 'trend' },
  { key: 'trend-squeeze', label: '均线粘合', single: '粘', color: 'slate', dim: 'trend' },
  { key: 'trend-weak-down', label: '空头弱排列', single: '衰', color: 'slate', dim: 'trend' },
  { key: 'trend-strong-down', label: '空头强排列', single: '空', color: 'green', dim: 'trend' },
  // 布林波动（dim: volatility）
  { key: 'vol-squeeze', label: '布林收口', single: '收', color: 'slate', dim: 'volatility' },
  { key: 'vol-up', label: '上轨扩张', single: '扩', color: 'red', dim: 'volatility' },
  { key: 'vol-down', label: '下轨扩张', single: '扩', color: 'green', dim: 'volatility' },
  // 位置（dim: position）——环境前提，非每日信号；高位/低位/中位全量可选
  { key: 'pos-high', label: '高位', single: '高', color: 'green', dim: 'position' },
  { key: 'pos-mid', label: '中位', single: '中', color: 'slate', dim: 'position' },
  { key: 'pos-low', label: '低位', single: '低', color: 'red', dim: 'position' },
];

// 环境条件是否成立：当日分析结果里，展示维度（trend/volatility/position）命中了指定 key。
// 不判断"状态切换"——只要当日处于该状态即视为成立（贴合"当前条件成立才考虑其他标签"的语义）。
export function envHasCondition(env: EnvResult | null, key: string): boolean {
  if (!env) return false;
  return selectEnvDisplayTags(env.tags).some(t => t.key === key);
}

// 最新（实时/live）K线的内容指纹：今天这根 bar 会在盘中原地更新，仅用数组引用做缓存键
// 无法识别这种变化，导致缩略标签（尤其对"今日"敏感的形态如十字星）缓存过期。
// 把金额——开/高/低/收/量 + 日期——纳入指纹，让 live bar 每次变动都刷新缓存。
export function latestBarFingerprint(klines: BollKline[]): string {
  const k = klines[klines.length - 1];
  if (!k) return '';
  return `${k.date}|${k.open}|${k.high}|${k.low}|${k.close}|${k.volume}`;
}

// ── 价格态原子（作用于当日，互斥 + 无态，按强度优先：底部确认(反弹强化) > 反弹 > 企稳 > 回踩）──
//   反弹 = C > MA10 ∧ C ≥ 昨收；若同时 放量 ∧ L≥昨低 ∧ 近3日低点至少2日抬高 ∧ MA5走平/上翘 → 升级"底部确认"
//   企稳 = L ≥ 昨低 ∧ C ≥ 昨收 ∧ MA5 ≤ C < MA10 ∧ 前段下跌背景（近5日 t-5..t-1 存在某日 close<该日MA5）
//   回踩 = C < MA5 ∧ 前段曾站上MA5；按 L vs 昨低 分健康/弱势两档
//   都不满足 → 无态（null）。量能是另一独立原子，参考价值在弹窗按“价格态×量能”组合呈现。
export interface PriceStateTag {
  date: string;
  kind: 'bounce' | 'stable' | 'pullback' | 'bottom-confirm' | null; // 反弹 / 企稳 / 回踩 / 底部确认 / 无态
  name: '反弹' | '企稳' | '回踩' | '底部确认' | null;
  single: string;           // 反 / 稳 / 回 / 底
  color: 'red' | 'green' | 'neutral'; // 红=偏多 绿=偏空 中性=无态（不返回）
  sub?: 'health' | 'weak';  // 回踩分档：health=健康（低点抬高）、weak=弱势（低点未抬高/下移）
  detail: string[];         // 判定依据（含 C/MA5/MA10/昨收/昨低/前段下跌背景等具体数值）
  reference: string;        // 价格态自身参考价值（组合参考价值由弹窗按 价态×量能 单独呈现）
}

const PRICE_STATE_REFERENCE: Record<'bounce' | 'stable' | 'pullback' | 'bottom-confirm', string> = {
  bounce: '反弹状态：价格站上10日线并当日走强，若放量则追势信号强、可参与；缺量则属弱反弹，追高需谨慎。',
  stable: '企稳状态：低点不再创新低、收盘回到短均线上方（尚未站上MA10）且前段有下跌背景，属止跌观察期，需量能与后续阳线确认，非直接买点。',
  pullback: '回踩状态：价格仍弱于5日线。低点抬高（健康回踩）可等企稳信号；低点下移（弱势回踩）更可能是下跌中继，不宜急于介入。',
  'bottom-confirm': '底部确认状态：放量收复10日线、低点连续抬高、MA5走平/上翘，量价结构同步确认，是可交易的高价值信号。',
};

// 价格态×量能组合参考价值：key = `${价态}-${量能粗分(volBucket)}`；未命中回落中性兜底文案。
// 量能用粗分（温和/明显 折叠），因“企稳-缩量（温和/明显）”等共享同一参考口径。
// 回踩按 sub 分档：健康回踩（低点抬高）/ 弱势回踩（低点下移）；底部确认只出现在 放量 组合。
export const STABILIZE_COMBO_REFERENCE: Record<string, string> = {
  '反弹-放量': '高 —— 放量反弹，量价配合向上、资金真实进场，可交易追势信号。',
  '反弹-缩量': '中 —— 反弹缺量，动能不足，追高需谨慎，防冲高回落。',
  '反弹-平量': '中 —— 平量反弹，方向略偏多但量能未放大，观望为主。',
  '企稳-放量': '中高 —— 放量企稳，资金进场迹象明显（如放量收复短均线），可小仓位试盘。',
  '企稳-缩量': '中 —— 缩量企稳，止跌观察、非买点，等放量阳线确认。',
  '企稳-平量': '中 —— 平量企稳，止跌但动能不足，继续观察。',
  '底部确认-放量': '高 —— 底部结构确认：放量+收复MA10+低点连抬+MA5走平，量价同步，可交易确认信号。',
  '健康回踩-放量': '中低 —— 健康回踩但放量：低点抬高说明有承接，放量却提示分歧仍在，等企稳或缩量再介入。',
  '健康回踩-缩量': '中 —— 健康回踩缩量：低点抬高、量缩价稳，属正常回踩，等企稳信号出现再介入。',
  '健康回踩-平量': '中 —— 健康回踩平量：低点抬高但动能未放大，观望等企稳。',
  '弱势回踩-放量': '低 —— 弱势回踩放量：低点下移且放量，抛压仍重，下跌中继风险高。',
  '弱势回踩-缩量': '低 —— 弱势回踩缩量：低点下移、动能不足，更可能是下跌中继，不宜急于抄底。',
  '弱势回踩-平量': '低 —— 弱势回踩平量：低点下移、价格偏弱，观望等待企稳信号。',
};
const STABILIZE_COMBO_FALLBACK = '中性 —— 价格态与量能的组合未在预设映射中，需结合趋势与位置综合判断。';
export function stabilizeComboReference(name: PriceStateTag['name'] & string, vol5: KlineVolume5, sub?: 'health' | 'weak'): string {
  // 回踩按 sub 分档：弱势/健康 分别映射不同参考价值（无 sub 时按健康处理）
  const keyName = name === '回踩' ? (sub === 'weak' ? '弱势回踩' : '健康回踩') : name;
  return STABILIZE_COMBO_REFERENCE[`${keyName}-${volBucket(vol5)}`] ?? STABILIZE_COMBO_FALLBACK;
}

// 价格态判定（按指定日期索引 t）：底部确认(反弹强化) > 反弹 > 企稳 > 回踩 强度优先，互斥命中其一，否则返回 null。
export function classifyPriceStateAt(
  klines: BollKline[],
  t: number,
  fmt: (v: number) => string = (v) => v.toFixed(2),
  cfg: TagParams = DEFAULT_TAG_PARAMS,
): PriceStateTag | null {
  if (!klines || klines.length === 0 || t <= 0 || t >= klines.length) return null;
  const k = klines[t], pk = klines[t - 1];
  const C = k.close, L = k.low, PKC = pk.close, PKL = pk.low;
  const ma5 = calcMaSeries(klines, 5);
  const ma10 = calcMaSeries(klines, 10);
  const MA5 = ma5[t], MA10 = ma10[t];
  const ds = k.date.slice(5).replace('-', '/');
  // 前段背景（近 5 日内 t-5..t-1）：
  //  hadDown = 曾跌破该日 MA5（企稳需此，证明刚从下跌中爬回，避免上涨中企稳刷屏）
  //  hadUp   = 曾站上该日 MA5（回踩需此，证明是从上方跌回，避免持续弱势阴跌天天叫回踩）
  let hadDown = false, downCnt = 0, hadUp = false, upCnt = 0;
  for (let j = t - 1; j >= Math.max(1, t - 5); j--) {
    const m = ma5[j];
    if (m == null) continue;
    if (klines[j].close < m) { hadDown = true; downCnt++; }
    else { hadUp = true; upCnt++; }
  }
  // 反弹（含强化"底部确认"）：C > MA10 ∧ C ≥ 昨收
  if (MA10 != null && C > MA10 && C >= PKC) {
    // 底部确认 = 反弹 + 放量 + L≥昨低 + 近3日低点至少2日抬高 + MA5走平/上翘（t≥5 保证 t-4..t-1 索引有效）
    if (t >= 5 && L >= PKL) {
      const vol = classifyVolumeAt(klines, t, cfg);
      const L1 = klines[t - 1].low, L2 = klines[t - 2].low, L3 = klines[t - 3].low;
      const lowUp2 = L >= L1 && (L1 >= L2 || L2 >= L3); // 近3日低点至少2日抬高
      const MA5Prev = ma5[t - 1];
      if (volBucket(vol) === '放量' && lowUp2 && MA5Prev != null && MA5 != null && MA5 >= MA5Prev) {
        let volSum = 0;
        for (let j = t - 4; j <= t; j++) volSum += klines[j].volume;
        const volRatio = volSum > 0 ? k.volume / (volSum / 5) : 0;
        return {
          date: k.date, kind: 'bottom-confirm', name: '底部确认', single: '底', color: 'red',
          detail: [
            `${ds} 底部确认：收 ${fmt(C)} > MA10 ${fmt(MA10)}，且收 ≥ 昨收 ${fmt(PKC)}（收复10日线）`,
            `放量确认：${vol}，量比 ${volRatio.toFixed(2)}（5日均量含当日口径）`,
            `低点连抬：L ${fmt(L)} ≥ L-1 ${fmt(L1)}，近3日低点 ${fmt(L3)} → ${fmt(L2)} → ${fmt(L1)} → ${fmt(L)} 至少2日抬高；L ${fmt(L)} ≥ 昨低 ${fmt(PKL)}`,
            `MA5 ${fmt(MA5)} ≥ 昨日 MA5 ${fmt(MA5Prev)}（走平/上翘）`,
            `放量 + 收复MA10 + 低点连抬 + MA5走平 → 底部结构确认，可交易高价值信号`,
          ],
          reference: PRICE_STATE_REFERENCE['bottom-confirm'],
        };
      }
    }
    return {
      date: k.date, kind: 'bounce', name: '反弹', single: '反', color: 'red',
      detail: [
        `${ds} 反弹：收 ${fmt(C)} > MA10 ${fmt(MA10)}，且收 ≥ 昨收 ${fmt(PKC)}`,
        `价格站上10日线且日内走强 → 反弹（偏多）状态`,
      ],
      reference: PRICE_STATE_REFERENCE.bounce,
    };
  }
  // 企稳（需前段下跌背景 + 尚未站上MA10：C<MA10 与反弹严格互斥，底部修复收MA5=企稳 → 收MA10=反弹自然过渡）
  if (hadDown && MA5 != null && MA10 != null && C < MA10 && C >= MA5 && C >= PKC && L >= PKL) {
    return {
      date: k.date, kind: 'stable', name: '企稳', single: '稳', color: 'red',
      detail: [
        `${ds} 企稳：低点 ${fmt(L)} ≥ 昨低 ${fmt(PKL)}，收 ${fmt(C)} ≥ 昨收 ${fmt(PKC)}，且 MA5 ${fmt(MA5)} ≤ 收 ${fmt(C)} < MA10 ${fmt(MA10)}（尚未站上MA10）`,
        `前段下跌背景：近5日内 ${downCnt} 日收盘跌破其 MA5；低点不创新低 + 收上短均线 → 企稳（止跌观察）状态`,
      ],
      reference: PRICE_STATE_REFERENCE.stable,
    };
  }
  // 回踩（需前段曾站上 MA5，即从上方跌回；持续弱势阴跌、从未站上 5 日线则不叫回踩，避免刷屏）
  // 按低点分两档：L ≤ 昨低 → 弱势回踩（下跌中继风险）；L > 昨低 → 健康回踩（正常回踩、等企稳）
  if (MA5 != null && C < MA5 && hadUp) {
    if (L <= PKL) {
      return {
        date: k.date, kind: 'pullback', name: '回踩', single: '回', color: 'green', sub: 'weak',
        detail: [
          `${ds} 弱势回踩：收 ${fmt(C)} < MA5 ${fmt(MA5)}，低点 ${fmt(L)} ≤ 昨低 ${fmt(PKL)}`,
          `前段曾站上5日线（近5日内 ${upCnt} 日收 ≥ 其MA5）后跌破；低点未抬高/下移 → 偏下跌中继风险，不宜急于介入`,
        ],
        reference: PRICE_STATE_REFERENCE.pullback,
      };
    }
    return {
      date: k.date, kind: 'pullback', name: '回踩', single: '回', color: 'green', sub: 'health',
      detail: [
        `${ds} 健康回踩：收 ${fmt(C)} < MA5 ${fmt(MA5)}，低点 ${fmt(L)} > 昨低 ${fmt(PKL)}`,
        `前段曾站上5日线（近5日内 ${upCnt} 日收 ≥ 其MA5）后跌破；低点抬高、量缩则属正常回踩 → 等企稳信号`,
      ],
      reference: PRICE_STATE_REFERENCE.pullback,
    };
  }
  return null;
}

export function classifyPriceState(
  klines: BollKline[],
  fmt: (v: number) => string = (v) => v.toFixed(2),
  cfg: TagParams = DEFAULT_TAG_PARAMS,
): PriceStateTag | null {
  return classifyPriceStateAt(klines, (klines?.length ?? 1) - 1, fmt, cfg);
}

// 列表页缩略展示：封装原 getLatestDayTags 的拼装体——破位单字(破/真/假) → K线形态单字 → 环境(trend/volatility)单字
// 从"已判定的结果"生成列表页缩略单字标签（纯映射，不再重复判定）。
// events / patterns / env 由调用方对"同一组（含实时价覆盖后的）K 线"只计算一遍，
// 列表缩略与弹窗详细共用同一份结果 → 两者判定天然一致，不会因喂不同数据而漂移。
export function buildLatestShrinkTags(
  events: MarketEvent[] | null,
  patterns: KlinePattern[] | null,
  env: EnvResult | null,
  lastDate: string,
  priceState: PriceStateTag | null,
  latestVol: KlineVolume5 | null,
): MktTag[] {
  // 破位类事件标签（不含“修复观察”）
  const breakTags: MktTag[] = [];
  if (events) {
    for (const ev of events) {
      // 仅保留“观测窗口覆盖最新交易日”的事件标签（含当天新破位）
      if (!ev.window.some(w => w.date === lastDate)) continue;
      if (ev.date === lastDate) {
        // 当天破位
        breakTags.push({ key: `r-${lastDate}`, text: '破', cls: ENV_SINGLE_CLS.green });
      } else if (ev.status !== 'confirming') {
        // 观测窗口恰好在最新交易日收盘后定论（仍在观测中的“修”不展示）
        breakTags.push({ key: `d-${ev.date}`, text: ev.status === 'trueBreak' ? '真' : '假', cls: ev.status === 'trueBreak' ? ENV_SINGLE_CLS.green : ENV_SINGLE_CLS.red });
      }
    }
  }
  // 依次拼装：K线形态 → 趋势/布林 → 破位
  const tags: MktTag[] = [];
  for (const p of patterns ?? []) {
    tags.push({
      key: `p-${p.type}`,
      text: p.single,
      cls: p.color === 'red' ? ENV_SINGLE_CLS.red : p.color === 'green' ? ENV_SINGLE_CLS.green : p.color === 'blue' ? ENV_SINGLE_CLS.indigo : ENV_SINGLE_CLS.slate,
    });
  }
  // 综合周期/量价标签注释掉，仅保留 趋势结构 + 布林波动
  if (env) {
    for (const t of selectEnvDisplayTags(env.tags)) {
      tags.push({ key: `env-${t.key}`, text: t.single, cls: ENV_SINGLE_CLS[t.color] });
    }
  }
  // 量能单字（最新日 5 档 → 放/平/缩，粗分着色；与弹窗逐日量能 chip 同一口径）
  if (latestVol) {
    const bucket = volBucket(latestVol);
    tags.push({
      key: `vol-${bucket}`,
      text: bucket === '放量' ? '放' : bucket === '缩量' ? '缩' : '平',
      cls: bucket === '放量' ? ENV_SINGLE_CLS.red : bucket === '缩量' ? ENV_SINGLE_CLS.green : ENV_SINGLE_CLS.slate,
    });
  }
  // 价格态：反弹/企稳/回踩（最新日有态则给出，无态不刷屏；单字精简保留在列表缩略）
  if (priceState && priceState.name) {
    tags.push({ key: `ps-${priceState.kind}`, text: priceState.single, cls: priceState.color === 'green' ? ENV_SINGLE_CLS.green : ENV_SINGLE_CLS.red });
  }
  tags.push(...breakTags);
  return tags;
}

// 便捷入口：给定 K 线序列（未覆盖实时价），内部判定一遍再生成缩略标签。
// 组件层不应直接用它做列表/弹窗两套判定——应先用 computeAnalyzed 统一算一次，
// 再调 buildLatestShrinkTags 复用同一结果。此函数仅作独立快捷用途（含单测）。
export function buildLatestDayTags(klines: BollKline[], fmt: (v: number) => string, cfg: TagParams = DEFAULT_TAG_PARAMS): MktTag[] {
  const events = analyzeMarketConditions(klines);
  const lastDate = klines[klines.length - 1].date;
  const patterns = analyzeKlinePatterns(klines, fmt, cfg);
  const allowVol = isTodayVolumeEligible(klines);
  const env = analyzeEnvironment(klines, fmt, allowVol, cfg);
  const priceState = classifyPriceState(klines, fmt, cfg);
  const latestVol = classifyVolume(klines, cfg);
  return buildLatestShrinkTags(events, patterns, env, lastDate, priceState, latestVol);
}

// 弹窗破位事件“判断依据”文案拼接（封装原 explainLines 中 selEv 分支）
export function buildBreakExplainLines(
  ev: MarketEvent,
  kind: 'event' | 'status' | 'repair',
  fmt: (v: number) => string,
  fmtDay: (d: string) => string,
  fmtShort: (d: string) => string,
): string[] {
  const maStr = ev.brokenList.map(b => `MA${b.period} ${fmt(b.value)}`).join(' · ');
  if (kind === 'event') {
    return [`${fmtDay(ev.date)} 收盘 ${fmt(ev.close)}`, `当日下穿 ${ev.brokenCount} 条均线：${maStr}`];
  }
  if (ev.status === 'trueBreak') {
    return [
      `${fmtDay(ev.date)} 收盘 ${fmt(ev.close)}，下穿 ${ev.brokenCount} 条均线`,
      `参照均线 MA${ev.ref.period}（破位日 ${fmt(ev.ref.value)}）`,
      ...ev.window.map((w, i) => `${i + 1}天 ${fmtShort(w.date)}：收 ${fmt(w.close)} < 均线 ${fmt(w.refMa)}`),
      `3 天观测收盘均未回到均线上方 → 真破位`,
    ];
  }
  if (ev.status === 'falseBreak') {
    const r = ev.returnDay!;
    return [
      `${fmtDay(ev.date)} 收盘 ${fmt(ev.close)}，下穿 ${ev.brokenCount} 条均线`,
      `参照均线 MA${ev.ref.period}（破位日 ${fmt(ev.ref.value)}）`,
      `${fmtShort(r.date)} 收盘 ${fmt(r.close)} 回到均线上方（MA${ev.ref.period} ${fmt(r.refMa)}）→ 假破位`,
    ];
  }
  const last = ev.window[ev.window.length - 1];
  return [
    `${fmtDay(ev.date)} 收盘 ${fmt(ev.close)}，下穿 ${ev.brokenCount} 条均线`,
    `参照均线 MA${ev.ref.period}（破位日 ${fmt(ev.ref.value)}）`,
    `已观测 ${ev.window.length}/3 天，最新 ${fmtShort(last.date)} 收盘 ${fmt(last.close)} 仍低于均线 ${fmt(last.refMa)}`,
    `观测未满 3 天 → 修复观察`,
  ];
}