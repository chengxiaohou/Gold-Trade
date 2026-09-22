// ─────────────────────────────────────────────────────────────
// 信号标签部 —— 唯一权威接口 getDayTagSet
// 产出"某交易日"的完整信号 chip 集（量能5档 + 价格态原子 + K线形态 + 破位观测态）。
// 所有消费方（价格浮窗底栏 SignalTagsFooter、标签弹窗"近10交易日"逐日区、回测、单元测试）
// 一律从本接口取数，禁止在别处重复拼装。判定复用 tagAnalyzers，配色复用共享 CHIP_CLS，本文件不写判定。
// ─────────────────────────────────────────────────────────────
import type { BollKline } from './bollService';
import type { TagParams, UserTagRule } from '../types';
import { DEFAULT_TAG_PARAMS } from '../types';
import {
  analyzeKlinePatternsAt, analyzeKlineCombo, classifyVolumeAt, classifyPriceStateAt,
  analyzeMarketConditions, buildBreakExplainLines, stabilizeComboReference, volBucket,
  analyzeUserTagRule,
  PATTERN_CHIP_CLS, VOLUME5_CHIP_CLS, PRICESTATE_CHIP_CLS, BREAK_CHIP_CLS,
  CHIP_CLS_RED, CHIP_SEL_RED, CHIP_CLS_INDIGO, CHIP_SEL_INDIGO, CHIP_CLS_BLUE, CHIP_SEL_BLUE,
  CHIP_CLS_GREEN, CHIP_SEL_GREEN, CHIP_CLS_SLATE, CHIP_SEL_SLATE,
  type KlineVolume5, type MarketEvent,
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

// chip 种类：volume/pricestate/pattern = 原子信号；break = 破位触发；break-obs = 观察；break-status = 真/假破位定论；user = 用户自定义
export type DayTagKind = 'volume' | 'pricestate' | 'pattern' | 'break' | 'break-obs' | 'break-status' | 'user';
export interface DayTag extends SignalTagDetail { key: string; kind: DayTagKind; }

export interface GetDayTagSetOptions { events?: MarketEvent[]; customTags?: UserTagRule[]; dividendByYear?: Record<number, number> }

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

  // 量能5档（弹窗 volChip 同源）
  const vol = classifyVolumeAt(win, i, cfg);
  const volChip = VOLUME5_CHIP_CLS[vol];
  out.push({ key: `vol-${vol}`, kind: 'volume', label: vol, cls: volChip.cls, sel: volChip.sel, detail: volumeDetail(win, i, vol), reference: VOL_REFERENCE });

  // 价格态原子（弹窗 priceStateChip 同源）
  const ps = classifyPriceStateAt(win, i, fmt, cfg);
  if (ps && ps.name) {
    const psChip = PRICESTATE_CHIP_CLS[ps.color === 'green' ? 'green' : 'red'];
    out.push({ key: `ps-${ps.name}`, kind: 'pricestate', label: ps.name, cls: psChip.cls, sel: psChip.sel, detail: ps.detail, reference: stabilizeComboReference(ps.name, vol, ps.sub) });
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

  // 破位观测态：复用弹窗 statusChip/repairChip 的完整映射
  const events = opts.events ?? analyzeMarketConditions(win, Math.min(10, win.length - 1));
  for (const ev of events) {
    const w = ev.window.findIndex(x => x.date === date);
    if (w === -1) continue;
    const N = ev.brokenCount;
    // 破位触发日：window 首日恒出"破位 xN"（破位当天=window[0]）
    if (w === 0) {
      out.push({ key: `break-${ev.date}`, kind: 'break', label: `破位 x${N}`, cls: BREAK_CHIP_CLS.cls, sel: BREAK_CHIP_CLS.sel, detail: buildBreakExplainLines(ev, 'event', fmt, fmtDay, fmtShort), reference: '' });
    }
    // 观测/定论 chip：MID（单日 window 或中间观测日或待定末日起点）→"观察 xN"；定论日 →"真/假破位 xN"
    if (ev.window.length === 1) {
      // 单日 window：破位当天即观测起点 → 观察 xN（与破位 xN 并存）
      out.push({ key: `obs-${ev.date}`, kind: 'break-obs', label: `观察 x${N}`, cls: OBS_CHIP_CLS.cls, sel: OBS_CHIP_CLS.sel, detail: buildBreakExplainLines(ev, 'repair', fmt, fmtDay, fmtShort), reference: '' });
    } else if (w > 0 && w < ev.window.length - 1) {
      // 中间观测日 → 观察 xN
      out.push({ key: `obs-${ev.date}`, kind: 'break-obs', label: `观察 x${N}`, cls: OBS_CHIP_CLS.cls, sel: OBS_CHIP_CLS.sel, detail: buildBreakExplainLines(ev, 'repair', fmt, fmtDay, fmtShort), reference: '' });
    } else if (w === ev.window.length - 1) {
      // 末日起点（定论窗）：观察中(confirming) → 观察 xN；定论 → 真/假破位 xN
      if (ev.status === 'confirming') {
        out.push({ key: `obs-${ev.date}`, kind: 'break-obs', label: `观察 x${N}`, cls: OBS_CHIP_CLS.cls, sel: OBS_CHIP_CLS.sel, detail: buildBreakExplainLines(ev, 'repair', fmt, fmtDay, fmtShort), reference: '' });
      } else {
        const trueBreak = ev.status === 'trueBreak';
        const stCls = trueBreak ? BREAK_CHIP_CLS : FALSE_CHIP_CLS;
        out.push({ key: `status-${ev.date}`, kind: 'break-status', label: `${trueBreak ? '真破位' : '假破位'} x${N}`, cls: stCls.cls, sel: stCls.sel, detail: buildBreakExplainLines(ev, 'status', fmt, fmtDay, fmtShort), reference: '' });
      }
    }
  }

  // 用户自定义动态信号标签（追加在最后）
  out.push(...collectUserTags(win, i, opts.customTags, opts.dividendByYear));

  return out;
}