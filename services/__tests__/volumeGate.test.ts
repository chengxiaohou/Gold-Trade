// 量能标签「收盘前半小时（14:30）才放出」门槛的回归测试。
// 两套模式：
//   liveMode=true  — 实时视图（列表缩略 / 价格浮窗底栏 / 弹窗最新行）。盘中一律拦截，
//                    不依赖 K 线末根日期（今日 bar 可能未合并进数组、停牌/未刷新时末根停留在历史日）。
//   liveMode=false — 历史视图（默认）。末根=历史日 → 放行；末根=今日 → 卡 14:30。
//                    给回测引擎 / 弹窗历史行 / 单元测试复用。
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { BollKline } from '../bollService';
import { isTodayVolumeEligible, classifyVolumeAt, buildLatestShrinkTags } from '../tagAnalyzers';
import { getDayTagSet } from '../signalTagDetail';

function mkK(date: string, close: number, volume: number): BollKline {
  return { date, open: close, high: close, low: close, close, volume } as unknown as BollKline;
}
function buildKlines(n: number): BollKline[] {
  const out: BollKline[] = [];
  const base = Date.UTC(2026, 8, 15);
  for (let j = 0; j < n; j++) {
    const d = new Date(base + j * 86400000);
    const s = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    out.push(mkK(s, 10 + j * 0.1, 100));
  }
  out[out.length - 1].volume = 500;
  return out;
}

const TODAY = '2026-10-14'; // 测试里"现在"固定为这一天（周三）
const PREV = '2026-10-13';

afterEach(() => vi.useRealTimers());

describe('量能标签 14:30 门槛（liveMode=true 实时视图）', () => {
  it('末根=今天且盘中 10:00 → 拦截', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 14, 10, 0, 0));
    const k = buildKlines(30);
    expect(k[k.length - 1].date).toBe(TODAY);
    expect(isTodayVolumeEligible(k, true)).toBe(false);
    expect(getDayTagSet(k, undefined, (v) => String(v), { liveMode: true }).some((t) => t.kind === 'volume')).toBe(false);
  });

  it('末根=今天且 14:31 → 放行', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 14, 14, 31, 0));
    const k = buildKlines(30);
    expect(isTodayVolumeEligible(k, true)).toBe(true);
  });

  it('末根=今天且已收盘 15:01 → 放行', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 14, 15, 1, 0));
    const k = buildKlines(30);
    expect(isTodayVolumeEligible(k, true)).toBe(true);
  });

  it('关键回归：盘中 10:00 + 末根=昨天（行情未合并/停牌）→ 必须拦截（旧实现靠 lastDate !== today 放行是 bug）', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 14, 10, 0, 0));
    const k = buildKlines(29); // 末根 2026-10-13
    expect(k[k.length - 1].date).toBe(PREV);
    expect(isTodayVolumeEligible(k, true)).toBe(false);
    expect(getDayTagSet(k, undefined, (v) => String(v), { liveMode: true }).some((t) => t.kind === 'volume')).toBe(false);
  });

  it('午休 12:30 → 一律拦截', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 14, 12, 30, 0));
    const k = buildKlines(30);
    expect(isTodayVolumeEligible(k, true)).toBe(false);
  });

  it('盘前 9:10 / 全天休市 → 放行（量能天然定型）', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 14, 9, 10, 0));
    const k = buildKlines(30);
    expect(isTodayVolumeEligible(k, true)).toBe(true);
    // 周末全天休市
    vi.setSystemTime(new Date(2026, 9, 17, 10, 0, 0)); // 周六
    expect(isTodayVolumeEligible(k, true)).toBe(true);
  });
});

describe('量能标签 14:30 门槛（liveMode=false 默认 历史/回测）', () => {
  // 历史/回测：fixture 末根是过去日期 → 天然放行；不受"现在是盘中还是已收盘"影响
  it('末根=历史日 + 盘中 10:00 → 放行（历史量能早已定型）', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 14, 10, 0, 0));
    const k = buildKlines(29);
    expect(isTodayVolumeEligible(k)).toBe(true);
    expect(getDayTagSet(k, undefined, (v) => String(v)).some((t) => t.kind === 'volume')).toBe(true);
  });

  it('末根=今天 + 盘中 10:00 → 拦截（默认历史场景也卡今日未定型）', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 14, 10, 0, 0));
    const k = buildKlines(30);
    expect(isTodayVolumeEligible(k)).toBe(false);
  });
});
