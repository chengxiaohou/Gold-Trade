// ─────────────────────────────────────────────────────────────
// 每日信号标签的「判定依据 + 参考价值」共享提取器 —— 单一实现。
// 供 列表页价格浮窗、回测图十字线悬浮 的底部信号栏（SignalTagsFooter）复用。
// 与 股票标签弹窗（StockDividendPage 每日信号区）输出【同一批判定】：
//   每日标签集合 = 量能5档(vol) + 价格态原子(ps.name) + K线形态(pattern) + 破位
//   —— 与标签弹窗逐日的 volChip / priceStateChip / patternChip / 破位 chip 完全一致。
// 绝不走回测的组合路径（放量企稳/健康回踩），避免出现两套标签版本。
// 判定依据/参考价值 逐类复用 tagAnalyzers，配色复用共享 CHIP_CLS，本文件不写任何判定。
// 改动任一侧只改 tagAnalyzers / StockDividendPage 一处，本文件自动同步。
// ─────────────────────────────────────────────────────────────
import type { BollKline } from './bollService';
import type { TagParams } from '../types';
import { DEFAULT_TAG_PARAMS } from '../types';
import {
  analyzeKlinePatternsAt, analyzeKlineCombo, classifyVolumeAt, classifyPriceStateAt,
  analyzeMarketConditions, buildBreakExplainLines, stabilizeComboReference, volBucket,
  PATTERN_CHIP_CLS, VOLUME5_CHIP_CLS, PRICESTATE_CHIP_CLS, BREAK_CHIP_CLS,
  type KlineVolume5,
} from './tagAnalyzers';

// cls/sel = 标签弹窗同款语义 chip 配色（单一数据源：tagAnalyzers），与弹窗逐字一致。
export interface SignalTagDetail { label: string; cls: string; sel: string; detail: string[]; reference: string; }

export const fmtDay = (d: string) => d;
export const fmtShort = (d: string) => d.slice(5).replace('-', '/');
const fmtP = (v: number) => v.toFixed(2);

// volday 参考价值：与标签弹窗参考价值区逐字一致，务必保持同一文案。
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

// 主入口：对某交易日（win=klines[0..i] 末根=当日）提取全部命中信号标签，
// 与 标签弹窗每日信号区 volChip+priceStateChip+patternChip+破位 同一集合与顺序。
export function getSignalTagDetail(
  win: BollKline[],
  i: number,
  cfg: TagParams = DEFAULT_TAG_PARAMS,
  fmt: (v: number) => string = fmtP,
): SignalTagDetail[] {
  if (!win || win.length === 0) return [];
  const out: SignalTagDetail[] = [];

  // 量能5档（标签弹窗 volChip 同源）
  const vol = classifyVolumeAt(win, i, cfg);
  const volChip = VOLUME5_CHIP_CLS[vol];
  out.push({ label: vol, cls: volChip.cls, sel: volChip.sel, detail: volumeDetail(win, i, vol), reference: VOL_REFERENCE });

  // 价格态原子（标签弹窗 priceStateChip 同源）：反弹/企稳/回踩/底部确认
  const ps = classifyPriceStateAt(win, i, fmt, cfg);
  if (ps && ps.name) {
    const psChip = PRICESTATE_CHIP_CLS[ps.color === 'green' ? 'green' : 'red'];
    out.push({ label: ps.name, cls: psChip.cls, sel: psChip.sel, detail: ps.detail, reference: stabilizeComboReference(ps.name, vol, ps.sub) });
  }

  // K线形态（标签弹窗 patternChip 同源）：每个命中形态一个 chip
  const patterns = analyzeKlinePatternsAt(win, i, fmt, cfg);
  if (patterns.length > 0) {
    const combos = analyzeKlineCombo(win, patterns, cfg);
    for (const p of patterns) {
      const combo = combos.find(c => c.type === p.type && c.date === p.date);
      const chip = PATTERN_CHIP_CLS[p.color];
      out.push({ label: p.label, cls: chip.cls, sel: chip.sel, detail: p.detail, reference: combo?.reference ?? '' });
    }
  }

  // 破位事件（标签弹窗 破位 chip 同源）：看空绿色，参考价值无映射
  const last = win[win.length - 1];
  const broken = analyzeMarketConditions(win, 1).find(e => e.date === last.date && e.brokenCount > 0);
  if (broken) {
    out.push({ label: '破位', cls: BREAK_CHIP_CLS.cls, sel: BREAK_CHIP_CLS.sel, detail: buildBreakExplainLines(broken, 'event', fmt, fmtDay, fmtShort), reference: '' });
  }

  return out;
}