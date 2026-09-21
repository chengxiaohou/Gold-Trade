// ─────────────────────────────────────────────────────────────
// 每日信号标签的「判定依据 + 参考价值」共享提取器 —— 单一实现。
// 供 列表页价格浮窗、回测图十字线悬浮 的底部信号栏（SignalTagsFooter）复用，
// 与 股票标签弹窗（StockDividendPage 判定依据区/参考价值区）完全同源：
//   - 命中标签集合：复用回测引擎 getDaySignalLabels（→ collectSignalsOnDay → tagAnalyzers）
//   - 判定依据/参考价值：逐类复用 tagAnalyzers 的判定函数与映射，绝不在本文件另写判定。
// 改动任一侧只改 tagAnalyzers / backtestEngine 一处，本文件自动同步。
// ─────────────────────────────────────────────────────────────
import type { BollKline } from './bollService';
import type { TagParams } from '../types';
import { DEFAULT_TAG_PARAMS } from '../types';
import { getDaySignalLabels } from './backtestEngine';
import {
  analyzeKlinePatternsAt, analyzeKlineCombo, classifyVolumeAt, classifyPriceStateAt,
  volBucket, analyzeMarketConditions, buildBreakExplainLines, DAILY_SIGNAL_CATALOG, stabilizeComboReference,
  type BacktestTagDef,
} from './tagAnalyzers';

export interface SignalTagDetail { label: string; color: string; detail: string[]; reference: string; }

export const fmtDay = (d: string) => d;
export const fmtShort = (d: string) => d.slice(5).replace('-', '/');
const fmtP = (v: number) => v.toFixed(2);

// volday 参考价值：与标签弹窗参考价值区（L6074）逐字一致，务必保持同一文案。
const VOL_REFERENCE = '量能标签：放量=资金活跃/量增价升有持续性；缩量=动能减弱，高位缩量防滞涨、低位缩量常为见底前兆；平量=势均力敌的信息量低。需结合价格方向与所处位置综合判断。';

// 找到标签对应的目录条目（供取主题色）。signalName 与命中标签串匹配；破位 token 也登记在目录里。
function findCatalog(label: string): BacktestTagDef | undefined {
  return DAILY_SIGNAL_CATALOG.find(d => d.signalName === label);
}

// ── 各 source 的判定依据/参考价值：全部复用 tagAnalyzers 输出，禁止复制判定逻辑 ──

// pattern：形态判定依据 + 组合参考价值（位置×量能×形态）
function buildPattern(label: string, win: BollKline[], i: number, cfg: TagParams, fmt: (v: number) => string): { detail: string[]; reference: string } | null {
  const patterns = analyzeKlinePatternsAt(win, i, fmt, cfg);
  const p = patterns.find(x => x.label === label);
  if (!p) return null;
  const combo = analyzeKlineCombo(win, patterns, cfg).find(c => c.type === p.type && c.date === p.date);
  return { detail: p.detail, reference: combo?.reference ?? '' };
}

// break：判定位 event 的判定依据；弹窗参考价值区对破位无映射 → 参考为空
function buildBreak(win: BollKline[], i: number, fmt: (v: number) => string): { detail: string[]; reference: string } | null {
  const last = win[win.length - 1];
  const ev = analyzeMarketConditions(win, 1).find(x => x.date === last.date && x.brokenCount > 0);
  if (!ev) return null;
  return { detail: buildBreakExplainLines(ev, 'event', fmt, fmtDay, fmtShort), reference: '' };
}

// volume：量能5档判定依据（当日量/前5日均量/量比）+ volday 静态参考，与弹窗逐字一致
function buildVolume(label: string, win: BollKline[], i: number, cfg: TagParams): { detail: string[]; reference: string } | null {
  const v = classifyVolumeAt(win, i, cfg);
  if (v !== label) return null;
  const kd = win[i];
  const date = win[win.length - 1].date;
  const fix = (x: number) => (x >= 1e8 ? `${(x / 1e8).toFixed(2)}亿` : x >= 1e4 ? `${(x / 1e4).toFixed(1)}万` : `${x.toFixed(0)}`);
  let ratio = 0;
  if (i >= 5) { let s = 0; for (let j = i - 5; j <= i - 1; j++) s += win[j].volume; ratio = s > 0 ? kd.volume / (s / 5) : 0; }
  const detail = [`${fmtDay(date)} 量能 ${v}`];
  detail.push(`当日量 ${fix(kd.volume)}，前5日均量 ${fix(ratio > 0 ? kd.volume / ratio : 0)}`);
  if (ratio > 0) {
    const vb = volBucket(v);
    detail.push(`量比 ${ratio.toFixed(2)}，收${kd.close < win[i - 1].close ? '跌' : '涨'}，${vb === '放量' ? '资金活跃' : vb === '缩量' ? '动能减弱' : '势均力敌'}`);
  }
  return { detail, reference: VOL_REFERENCE };
}

// stabilize：价格态×量能组合（价态判定依据 + 组合参考价值），sub 分档与弹窗一致
function buildStabilize(label: string, win: BollKline[], i: number, cfg: TagParams, fmt: (v: number) => string): { detail: string[]; reference: string } | null {
  const ps = classifyPriceStateAt(win, i, fmt, cfg);
  if (!ps || !ps.name) return null;
  const vol = classifyVolumeAt(win, i, cfg);
  const psName = ps.kind === 'pullback' ? (ps.sub === 'weak' ? '弱势回踩' : '健康回踩') : ps.name;
  if (`${volBucket(vol)}${psName}` !== label) return null;
  return { detail: ps.detail, reference: stabilizeComboReference(ps.name, vol, ps.sub) };
}

// 主入口：对某交易日（win=klines[0..i] 末根=当日）提取全部命中信号标签的
// {label, color, detail, reference}。信号集合与回测悬浮一致（getDaySignalLabels）。
export function getSignalTagDetail(
  win: BollKline[],
  i: number,
  cfg: TagParams = DEFAULT_TAG_PARAMS,
  fmt: (v: number) => string = fmtP,
): SignalTagDetail[] {
  if (!win || win.length === 0) return [];
  const labels = getDaySignalLabels(win, i, cfg);
  const out: SignalTagDetail[] = [];
  for (const label of labels) {
    const catalog = findCatalog(label);
    let detail: string[] = [];
    let reference = '';
    if (label === 'break-event') {
      const b = buildBreak(win, i, fmt);
      if (b) { detail = b.detail; reference = b.reference; }
    } else if (catalog?.source === 'pattern') {
      const b = buildPattern(label, win, i, cfg, fmt);
      if (b) { detail = b.detail; reference = b.reference; }
    } else if (catalog?.source === 'volume') {
      const b = buildVolume(label, win, i, cfg);
      if (b) { detail = b.detail; reference = b.reference; }
    } else if (catalog?.source === 'stabilize') {
      const b = buildStabilize(label, win, i, cfg, fmt);
      if (b) { detail = b.detail; reference = b.reference; }
    }
    out.push({
      label: label === 'break-event' ? '破位' : label,
      color: catalog?.color ?? '',
      detail,
      reference,
    });
  }
  return out;
}