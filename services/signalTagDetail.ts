// ─────────────────────────────────────────────────────────────
// 信号标签部 —— 唯一权威接口 getDayTagSet
// 产出"某交易日"的完整信号 chip 集（量能5档 + K线形态 + 破位观测态）。
// 所有消费方（价格浮窗底栏 SignalTagsFooter、标签弹窗"近10交易日"逐日区、回测、单元测试）
// 一律从本接口取数，禁止在别处重复拼装。判定复用 tagAnalyzers，配色复用共享 CHIP_CLS，本文件不写判定。
// ─────────────────────────────────────────────────────────────
import type { BollKline } from './bollService';
import type { TagParams, UserTagRule } from '../types';
import { DEFAULT_TAG_PARAMS } from '../types';
import { calcIndicators, countIndicatorExtremes, EXTREME_LEVELS } from './indicators';
import {
  analyzeKlinePatternsAt, analyzeKlineCombo, classifyVolumeAt,
  analyzeMarketConditions, analyzeStandEvents, buildBreakExplainLines, buildStandExplainLines, volBucket,
  analyzeUserTagRule, isTodayVolumeEligible,
  PATTERN_CHIP_CLS, VOLUME5_CHIP_CLS, BREAK_CHIP_CLS,
  CHIP_CLS_RED, CHIP_SEL_RED, CHIP_CLS_INDIGO, CHIP_SEL_INDIGO, CHIP_CLS_BLUE, CHIP_SEL_BLUE,
  CHIP_CLS_GREEN, CHIP_SEL_GREEN, CHIP_CLS_SLATE, CHIP_SEL_SLATE,
  type KlineVolume5, type MarketEvent, type StandEvent,
} from './tagAnalyzers';

// cls/sel = 标签弹窗同款语义 chip 配色（单一数据源：tagAnalyzers）
export interface SignalTagDetail { label: string; cls: string; sel: string; detail: string[]; reference: string; }

// 破位观测态配色（与弹窗 statusChip/repairChip 逐字一致：观察=indigo、真破位=绿、假破位=红）
const OBS_CHIP_CLS = { cls: CHIP_CLS_INDIGO, sel: CHIP_SEL_INDIGO };
const FALSE_CHIP_CLS = { cls: CHIP_CLS_RED, sel: CHIP_SEL_RED };

export const fmtDay = (d: string) => d;
export const fmtShort = (d: string) => d.slice(5).replace('-', '/');
const fmtP = (v: number) => v.toFixed(2);

// volday 参考价值：与标签弹窗参考价值区逐字一致
export const VOL_REFERENCE = '量能标签：放量=资金活跃/量增价升有持续性；缩量=动能减弱，高位缩量防滞涨、低位缩量常为见底前兆；平量=势均力敌的信息量低。需结合价格方向与所处位置综合判断。'

// 量能判定依据：当日量/前5日均量/量比（与标签弹窗判定依据区同一拼装）
function volumeDetail(win: BollKline[], i: number, v: KlineVolume5): string[] {
  const kd = win[i];
  const date = win[win.length - 1].date;
  const fix = (x: number) => (x >= 1e8 ? `${(x / 1e8).toFixed(2)}亿` : x >= 1e4 ? `${(x / 1e4).toFixed(1)}万` : `${x.toFixed(0)}`);
  let ratio = 0;
  if (i >= 5) { let s = 0; for (let j = i - 5; j <= i - 1; j++) s += win[j].volume; ratio = s > 0 ? kd.volume / (s / 5) : 0; }
  const detail = [`${fmtDay(date)} 量能 ${v}`];
  detail.push(`当日量 ${fix(kd.volume)}，前5日均量 ${fix(ratio > 0 ? kd.volume / ratio : 0)}`);
  if (ratio > 0) {
    const vb = volBucket(v); // 复用 tagAnalyzers 粗分（勿自行重写）
    detail.push(`量比 ${ratio.toFixed(2)}，收${kd.close < win[i - 1].close ? '跌' : '涨'}，${vb === '放量' ? '资金活跃' : vb === '缩量' ? '动能减弱' : '势均力敌'}`);
  }
  return detail;
}

// 用户自定义标签配色：color key → 共享 chip 配色（与设置页 TAG_PALETTE 的 key 对齐）
const USER_CHIP_CLS: Record<string, { cls: string; sel: string }> = {
  gray: { cls: CHIP_CLS_SLATE, sel: CHIP_SEL_SLATE },
  indigo: { cls: CHIP_CLS_INDIGO, sel: CHIP_SEL_INDIGO },
  red: { cls: CHIP_CLS_RED, sel: CHIP_SEL_RED },
  green: { cls: CHIP_CLS_GREEN, sel: CHIP_SEL_GREEN },
  blue: { cls: CHIP_CLS_BLUE, sel: CHIP_SEL_BLUE },
  orange: { cls: CHIP_CLS_RED, sel: CHIP_SEL_RED }, // 橙归并到红系（无独立橙色 chip）
};

// 自定义标签参考价值：由规则字段拼出通用文案
const USER_REFERENCE = '用户自定义信号标签：依据设定数据点与目标（固定值或均线/BOLL动态值）判定触发，作观察信号辅助判断，结合仓位与市场环境综合决策。'

// chip 种类：volume/pricestate/pattern = 原子信号；break = 破位触发；break-obs = 观察；break-status = 真/假破位定论；user = 用户自定义；extreme = 超买/超卖
export type DayTagKind = 'volume' | 'pricestate' | 'pattern' | 'break' | 'break-obs' | 'break-status' | 'stand' | 'user' | 'extreme';
export interface DayTag extends SignalTagDetail { key: string; kind: DayTagKind; }

export interface GetDayTagSetOptions {
  events?: MarketEvent[];
  standEvents?: StandEvent[];
  customTags?: UserTagRule[];
  dividendByYear?: Record<number, number>;
  /** 回测暂不接入「超买/超卖」标签（产品决定，非遗漏）：传入 true 时不产出该系列 chip。 */
  excludeExtreme?: boolean;
  /** 实时视图模式：盘中一律拦截量能（无论 K 线末根日期）；默认 false（历史/回测场景，仅"末根=今日"时卡 14:30）。 */
  liveMode?: boolean;
}

// 判定某日命中的用户自定义标签（复用 analyzeUserTagRule），逐条装配 chip
function collectUserTags(win: BollKline[], i: number, rules: UserTagRule[] | undefined, dividendByYear?: Record<number, number>): DayTag[] {
  if (!rules || rules.length === 0) return [];
  const out: DayTag[] = [];
  for (const r of rules) {
    if (!r.enabled) continue;
    const detail = analyzeUserTagRule(win, i, r, dividendByYear);
    if (!detail) continue;
    const chip = USER_CHIP_CLS[r.color] ?? USER_CHIP_CLS.indigo;
    out.push({ key: `user-${r.id}`, kind: 'user', label: r.name, cls: chip.cls, sel: chip.sel, detail, reference: USER_REFERENCE });
  }
  return out;
}

// 主入口：对某交易日（win=klines[0..i] 且末根=当日）提取完整信号 chip 集，
// 顺序与标签弹窗"近10交易日"当日行一致：量能 → 价格态 → 形态 → 破位观测。
// 破位观测态精确复刻弹窗逻辑：破位触发日恒出"破位 xN"；单日/观测中/待定当日行再叠"观察 xN"；
// 定论日出"真破位 xN"/"假破位 xN"。
export function getDayTagSet(
  win: BollKline[],
  cfg: TagParams = DEFAULT_TAG_PARAMS,
  fmt: (v: number) => string = fmtP,
  opts: GetDayTagSetOptions = {},
): DayTag[] {
  if (!win || win.length === 0) return [];
  const out: DayTag[] = [];
  const i = win.length - 1;
  const date = win[i].date;

  // 量能5档（弹窗 volChip 同源）：
  // 1. 平量信息量低 → 跳过；
  // 2. 放量/缩量属日终信号，当日交易日 <14:30 未定型 → 跳过；历史行（i 非末根）不受影响。
  //    liveMode=true（实时视图）时，盘中一律拦截——不依赖 K 线末根是否为今日（行情未合并/停牌时末根可能停留在历史日）。
  const isLatest = i === win.length - 1;
  if (!isLatest || isTodayVolumeEligible(win, opts.liveMode === true)) {
    const vol = classifyVolumeAt(win, i, cfg);
    if (vol !== '平量') {
    const prevClose = i >= 1 ? win[i - 1].close : win[i].close;
    const up = win[i].close >= prevClose;
    const cls = up ? CHIP_CLS_RED : CHIP_CLS_GREEN;
    const sel = up ? CHIP_SEL_RED : CHIP_SEL_GREEN;
      out.push({ key: `vol-${vol}`, kind: 'volume', label: vol, cls, sel, detail: volumeDetail(win, i, vol), reference: VOL_REFERENCE });
    }
  }

  // K线形态（弹窗 patternChip 同源）：每个命中形态一个 chip
  const patterns = analyzeKlinePatternsAt(win, i, fmt, cfg);
  if (patterns.length > 0) {
    const combos = analyzeKlineCombo(win, patterns, cfg);
    for (const p of patterns) {
      const combo = combos.find(c => c.type === p.type && c.date === p.date);
      const chip = PATTERN_CHIP_CLS[p.color];
      out.push({ key: `pat-${p.type}`, kind: 'pattern', label: p.label, cls: chip.cls, sel: chip.sel, detail: p.detail, reference: combo?.reference ?? '' });
    }
  }

  // 破位观测态：每条均线独立事件 + 独立 3 天窗口；复用弹窗 statusChip/repairChip 的完整映射
  const events = opts.events ?? analyzeMarketConditions(win, Math.min(10, win.length - 1));
  for (const ev of events) {
    const w = ev.window.findIndex(x => x.date === date);
    if (w === -1) continue;
    const p = ev.period;
    // 破位触发日：window 首日恒出"破{period}"
    if (w === 0) {
      out.push({ key: `break-${ev.date}-${p}`, kind: 'break', label: `破${p}`, cls: BREAK_CHIP_CLS.cls, sel: BREAK_CHIP_CLS.sel, detail: buildBreakExplainLines(ev, 'event', fmt, fmtDay, fmtShort), reference: '' });
    }
    // 观测/定论 chip：MID（单日 window 或中间观测日或待定末日起点）→"观察{period}"；定论日 →"真/假破位{period}"
    if (ev.window.length === 1) {
      out.push({ key: `obs-${ev.date}-${p}`, kind: 'break-obs', label: `观察${p}`, cls: OBS_CHIP_CLS.cls, sel: OBS_CHIP_CLS.sel, detail: buildBreakExplainLines(ev, 'repair', fmt, fmtDay, fmtShort), reference: '' });
    } else if (w > 0 && w < ev.window.length - 1) {
      out.push({ key: `obs-${ev.date}-${p}`, kind: 'break-obs', label: `观察${p}`, cls: OBS_CHIP_CLS.cls, sel: OBS_CHIP_CLS.sel, detail: buildBreakExplainLines(ev, 'repair', fmt, fmtDay, fmtShort), reference: '' });
    } else if (w === ev.window.length - 1) {
      if (ev.status === 'confirming') {
        out.push({ key: `obs-${ev.date}-${p}`, kind: 'break-obs', label: `观察${p}`, cls: OBS_CHIP_CLS.cls, sel: OBS_CHIP_CLS.sel, detail: buildBreakExplainLines(ev, 'repair', fmt, fmtDay, fmtShort), reference: '' });
      } else if (ev.status === 'trueBreak') {
        out.push({ key: `status-${ev.date}-${p}`, kind: 'break-status', label: `真破位${p}`, cls: BREAK_CHIP_CLS.cls, sel: BREAK_CHIP_CLS.sel, detail: buildBreakExplainLines(ev, 'status', fmt, fmtDay, fmtShort), reference: '' });
      }
      // falseBreak（3天内回到均线上方）静默结束——定论日本身就是站上事件，由站{period}替代
    }
  }

  // 站上均线事件：当日上穿即展示，无观察窗口
  const standEvents = opts.standEvents ?? analyzeStandEvents(win, Math.min(10, win.length - 1));
  for (const se of standEvents) {
    if (se.date !== date) continue;
    const p = se.period;
    out.push({ key: `stand-${date}-${p}`, kind: 'stand', label: `站${p}`, cls: CHIP_CLS_RED, sel: CHIP_SEL_RED, detail: buildStandExplainLines(se, fmt, fmtDay), reference: '' });
  }

  // 超买/超卖（指标极值投票）：KDJ(K/D/J) + RSI(6/12/24) 共 6 项，命中几项就显示"N"（1~6），不设最低票数门槛。
  // 阈值与价格浮窗着色同源（EXTREME_LEVELS），保证"看到几个绿字就有几个票"。
  // 双向冲突（KDJ 与 RSI 不同步）时只显示票数多的一侧；两侧相等（如 3:3）则两侧都显示。
  if (!opts.excludeExtreme) {
    const ind = calcIndicators(win);
    if (ind) {
      const { over, under } = countIndicatorExtremes(ind);
      const fmtV = (v: number | null) => (v == null ? '-' : v.toFixed(2));
      const values = [
        `K ${fmtV(ind.kdj.k)} / D ${fmtV(ind.kdj.d)} / J ${fmtV(ind.kdj.j)}`,
        `RSI6 ${fmtV(ind.rsi.rsi6)} / RSI12 ${fmtV(ind.rsi.rsi12)} / RSI24 ${fmtV(ind.rsi.rsi24)}`,
      ];
      const pushExtreme = (side: 'over' | 'under', n: number) => {
        if (side === 'under') {
          out.push({
            key: 'extreme-under', kind: 'extreme', label: `超卖${n}`,
            cls: CHIP_CLS_GREEN, sel: CHIP_SEL_GREEN,
            detail: [
              `${date} 六项指标中 ${n} 项进入超卖区`,
              ...values,
              `超卖阈值：K<${EXTREME_LEVELS.kdjLow}、D<${EXTREME_LEVELS.kdjLow}、J<${EXTREME_LEVELS.jLow}、RSI<${EXTREME_LEVELS.rsiLow}`,
            ],
            reference: '超卖标签：KDJ 与 RSI 共六项中有数值处于超卖区，后缀即命中项数，数字越大越极端。超卖只是状态，不等于见底，需结合量能、趋势位置与支撑位判断。',
          });
        } else {
          out.push({
            key: 'extreme-over', kind: 'extreme', label: `超买${n}`,
            cls: CHIP_CLS_RED, sel: CHIP_SEL_RED,
            detail: [
              `${date} 六项指标中 ${n} 项进入超买区`,
              ...values,
              `超买阈值：K>${EXTREME_LEVELS.kdjHigh}、D>${EXTREME_LEVELS.kdjHigh}、J>${EXTREME_LEVELS.jHigh}、RSI>${EXTREME_LEVELS.rsiHigh}`,
            ],
            reference: '超买标签：KDJ 与 RSI 共六项中有数值处于超买区，后缀即命中项数，数字越大越极端。超买只是状态，不等于见顶，强势趋势中可长时间钝化，需结合量能与位置判断。',
          });
        }
      };
      if (over > under) pushExtreme('over', over);
      else if (under > over) pushExtreme('under', under);
      else if (over > 0) { pushExtreme('over', over); pushExtreme('under', under); }
    }
  }

  // 用户自定义动态信号标签（追加在最后）
  out.push(...collectUserTags(win, i, opts.customTags, opts.dividendByYear));

  return out;
}