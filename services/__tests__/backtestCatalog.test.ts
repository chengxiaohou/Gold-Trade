import { describe, it, expect } from 'vitest';
import type { BollKline } from '../bollService';
import { BACKTEST_TAG_CATALOG, runBacktest, scanTagOccurrences } from '../backtestEngine';
import { analyzeKlinePatterns, analyzeEnvironment, envHasCondition, ENV_TAG_CATALOG, classifyVolumeAt, classifyPositionAt, analyzeStabilizeAt, DAILY_SIGNAL_CATALOG } from '../tagAnalyzers';
import type { BacktestStrategy } from '../../types';

const fmt = (v: number) => v.toFixed(2);

// 生成从 2026-01-01 起的第 i 天日期
function date(i: number): string {
  return new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
}

// 便捷构造 K 线序列；base 为收盘均值函数，可用 overrides 覆盖任意索引的 OHLC
function mkKlines(
  n: number,
  base: (i: number) => number = i => 10 + i * 0.05,
  overrides: Record<number, Partial<BollKline>> = {},
): BollKline[] {
  const arr: BollKline[] = [];
  for (let i = 0; i < n; i++) {
    const c = base(i);
    arr.push({ date: date(i), open: c, high: c + 0.1, low: c - 0.1, close: c, volume: 1_000_000 });
  }
  for (const [idx, o] of Object.entries(overrides)) arr[Number(idx)] = { ...arr[Number(idx)], ...o };
  return arr;
}

//
// 1. 目录与"标签弹窗展示集"严格同步
// 弹窗当前只展示：K线形态(十字星/金针探底/放量金针/吊颈线/射击之星/倒锤子线) + 破位事件
// 被注释（不得出现在回测目录）：每日信号(macd-gold/macd-dead/vol-up/vol-down/vol-shrink)、
// 风系加/减(缩量入场/放量突破/无量急拉/缩量续加/回踩放量/缩量止跌/主力不破位/新高量能不足/急跌破20日线止损/放量破位+2日不收复)、综合周期/量价
//
describe('BACKTEST_TAG_CATALOG 与标签弹窗展示集同步', () => {
  // 弹窗形态 chip 实际展示的完整 label 集（来自 analyzeKlinePatterns 的产出）
  const PATTERN_LABELS = ['十字星', '金针探底', '放量金针', '吊颈线', '射击之星', '倒锤子线'];
  // 已被弹窗注释、不得进入回测的信号
  const EXCLUDED = [
    // daily 信号
    'macd-gold', 'MACD 金叉', 'MACD金叉', 'macd-dead', 'vol-up', 'vol-down', 'vol-shrink',
    // feng 风系标签
    '缩量入场（低位）', '放量突破均线', '无量/缩量急拉', '缩量续加', '回踩放量', '缩量止跌',
    '主力不破位', '新高量能不足', '急跌破20日线止损', '放量破位+2日不收复',
  ];

  it('所有 pattern 条目完整覆盖弹窗形态展示集、不遗漏、无多余', () => {
    const catLabels = BACKTEST_TAG_CATALOG.filter(d => d.source === 'pattern').map(d => d.signalName).sort();
    const expectLabels = [...PATTERN_LABELS].sort();
    expect(catLabels).toEqual(expectLabels);
  });

  it('绝不含每日信号 / 风系 / 周期 / 量价等已被弹窗注释的标签', () => {
    for (const d of BACKTEST_TAG_CATALOG) {
      expect(EXCLUDED).not.toContain(d.label);
      if (d.signalName) expect(EXCLUDED).not.toContain(d.signalName);
    }
  });

  it('每个 pattern 条目 signalName 都能被 analyzeKlinePatterns 实际产出（不悬空、复用同一判断）', () => {
    // 逐个构造可触发对应形态的 K 线窗口，验证分析器能产生该 label —— 而不是回测自造一套
    const N = 140;
    const cases: [string, BollKline[]][] = [
      // 十字星：末根 开=收（高/低对称）
      ['十字星', mkKlines(N, undefined, { 139: { open: 100, close: 100, high: 105, low: 95 } })],
      // 金针探底：下行序列末根小实体长下影（ma20Down）
      ['金针探底', mkKlines(N, i => 200 - i * 0.5, { 139: { open: 100, close: 100.34, high: 100.36, low: 95 } })],
      // 放量金针：同上但放量
      ['放量金针', mkKlines(N, i => 200 - i * 0.5, { 139: { open: 100, close: 100.34, high: 100.36, low: 95, volume: 5_000_000 } })],
      // 吊颈线：上行序列末根小实体长下影（ma20Up）
      ['吊颈线', mkKlines(N, undefined, { 139: { open: 100, close: 100.2, high: 100.22, low: 97 } })],
      // 射击之星：上行序列末根长上影短下影（实体稍大避开十字星抢占）
      ['射击之星', mkKlines(N, undefined, { 139: { open: 100, close: 100.4, high: 105, low: 100 } })],
      // 倒锤子线：下行序列末根长上影短下影（实体稍大避开十字星抢占）
      ['倒锤子线', mkKlines(N, i => 200 - i * 0.5, { 139: { open: 100, close: 100.5, high: 105, low: 99.95 } })],
    ];
    for (const [label, ks] of cases) {
      const got = analyzeKlinePatterns(ks, fmt).map(p => p.label);
      expect(got, `${label} 应被 analyzeKlinePatterns 产出，实得 ${JSON.stringify(got)}`).toContain(label);
    }
  });

  it('目录条目元数据齐全（abbr/signalName/color/action），且买=红、卖=蓝', () => {
    for (const d of BACKTEST_TAG_CATALOG) {
      expect(d.abbr).toBeTruthy();
      expect(d.color).toBeTruthy();
      expect(d.signalName).toBeTruthy();
      expect(['buy', 'sell']).toContain(d.action);
      if (d.action === 'buy') expect(d.color).toBe('#C44A3D');
      else expect(d.color).toBe('#4A90D9');
    }
  });

  it('反向兜底：回测目录穷尽弹窗全部可选信号（新增弹窗信号但漏登记回测目录时此处必然卡住）', () => {
    // 弹窗“每日类”可选信号全集（与 StockDividendPage.tsx 弹窗 chip 来源一致）：
    // 形态 + 破位 + 量能 + 位置 + 企稳，label 均为对应分析函数的产出值
    const POPUP_SIGNALS = [
      '十字星', '金针探底', '放量金针', '吊颈线', '射击之星', '倒锤子线', // pattern
      '破位',                                                          // break
      '放量', '缩量', '平量',                                          // volume
      '高位', '低位',                                                  // position
      '有效企稳', '缩量企稳', '缩量回踩',                              // stabilize
    ];
    expect(BACKTEST_TAG_CATALOG.map(d => d.label).sort()).toEqual([...POPUP_SIGNALS].sort());
    expect(DAILY_SIGNAL_CATALOG.map(d => d.label).sort()).toEqual([...POPUP_SIGNALS].sort());
  });

  it('单一数据源：回测目录与分析器的信号清单是同一份引用（从此彻底杜绝“回测忘了登记”式漂移）', () => {
    // 回测不再自建清单，而是直接引用 tagAnalyzers 的 DAILY_SIGNAL_CATALOG
    expect(BACKTEST_TAG_CATALOG).toBe(DAILY_SIGNAL_CATALOG);
    // 每个条目元数据完整且同源一致（key 唯一）
    expect(new Set(BACKTEST_TAG_CATALOG.map(d => d.key)).size).toBe(BACKTEST_TAG_CATALOG.length);
  });

  it('新 signal source 都能被对应 tagAnalyzers 判定函数真实产出（不悬空、复用同一判断）', () => {
    // 量能：末根放量（高量）/缩量（低量）
    expect(classifyVolumeAt(mkKlines(140, undefined, { 139: { volume: 5_000_000 } }), 139)).toBe('放量');
    expect(classifyVolumeAt(mkKlines(140, undefined, { 139: { volume: 100_000 } }), 139)).toBe('缩量');
    expect(classifyVolumeAt(mkKlines(140), 139)).toBe('平量');
    // 位置：下行序列末位=低位，上行序列末位=高位
    expect(classifyPositionAt(mkKlines(140, i => 200 - i * 0.5), 139)).toBe('低位');
    expect(classifyPositionAt(mkKlines(140, i => 10 + i * 0.2), 139)).toBe('高位');
    // 企稳：缩量回踩（下跌序列 + 末根缩量）
    const stz = analyzeStabilizeAt(mkKlines(40, i => 100 - i * 0.1, { 39: { volume: 200_000 } }), 39, fmt, true);
    expect(stz?.label).toBe('缩量回踩');
  });
});

// 构造末根为某形态时，analyzeKlinePatterns 产出的 label 集合（与 catalog 匹配用）
function hitPattern(klines: BollKline[]): string[] {
  return analyzeKlinePatterns(klines, fmt).map(p => p.label);
}

//
// 2. scanTagOccurrences 逐日扫描：volume 信号目录里的每个标签确实能在合法输入上被命中
//
describe('scanTagOccurrences（预览扫描，复用弹窗判定）', () => {
  it('十字星命中：末根十字星 → 返回该日', () => {
    const ks = mkKlines(140, undefined, { 139: { open: 100, close: 100, high: 105, low: 95 } });
    expect(scanTagOccurrences(ks, 'pattern-doji').length).toBeGreaterThan(0);
  });

  it('破位事件命中：应用于合法输入不抛错且末根跌破均线 → 破位', () => {
    const k2 = mkKlines(83, i => 200 - i * 0.5, {
      81: { close: 170 },                          // 前日收在均线上方
      82: { open: 165, high: 166, low: 90, close: 95 }, // 当日大幅跌破均线 → 破位
    });
    const hits = scanTagOccurrences(k2, 'break-event');
    expect(hits.length).toBeGreaterThan(0);
  });

  it('未知 tagKey → 空结果', () => {
    const ks = mkKlines(140);
    expect(scanTagOccurrences(ks, 'no-such-key')).toEqual([]);
  });

  it('量能信号命中：末根放量 → volume-up 命中；末根缩量 → volume-down 命中', () => {
    expect(scanTagOccurrences(mkKlines(140, undefined, { 139: { volume: 5_000_000 } }), 'volume-up').length).toBeGreaterThan(0);
    expect(scanTagOccurrences(mkKlines(140, undefined, { 139: { volume: 100_000 } }), 'volume-down').length).toBeGreaterThan(0);
  });

  it('位置信号命中：下行序列末位 → position-low；上行序列末位 → position-high', () => {
    expect(scanTagOccurrences(mkKlines(140, i => 200 - i * 0.5), 'position-low').length).toBeGreaterThan(0);
    expect(scanTagOccurrences(mkKlines(140, i => 10 + i * 0.2), 'position-high').length).toBeGreaterThan(0);
  });

  it('企稳信号命中：下跌序列 + 末根缩量 → stabilize-retrace 命中', () => {
    expect(scanTagOccurrences(mkKlines(40, i => 100 - i * 0.1, { 39: { volume: 200_000 } }), 'stabilize-retrace').length).toBeGreaterThan(0);
  });
});

//
// 3. 环境条件（envCondition）：作为规则的可选前提做 AND 门控
// 只含趋势结构 + 布林波动（与弹窗 selectEnvDisplayTags 同维度，不含周期/量价）
//
describe('环境前提（envCondition）', () => {
  it('ENV_TAG_CATALOG 全部为趋势/波动维度，不与弹窗注释的周期/量价冲突', () => {
    expect(ENV_TAG_CATALOG.length).toBeGreaterThan(0);
    for (const c of ENV_TAG_CATALOG) {
      expect(['trend', 'volatility']).toContain(c.dim);
      expect(c.key).toBeTruthy();
      expect(c.label).toBeTruthy();
    }
  });

  it('环境标签与信号标签两套不混：env 键互不重复、且与回测触发信号键不重叠', () => {
    const envKeys = ENV_TAG_CATALOG.map(c => c.key);
    expect(new Set(envKeys).size).toBe(envKeys.length);                       // 环境键自身唯一
    const sigKeys = new Set(BACKTEST_TAG_CATALOG.map(d => d.key));
    for (const k of envKeys) expect(sigKeys.has(k)).toBe(false);              // 环境键 ≠ 信号键
  });

  it('envHasCondition：状态成立返回 true、其它状态 false、空结果 false', () => {
    // 单边上行 140 根 → 趋势结构定为"多头强排列"（trend-strong-up）
    const env = analyzeEnvironment(mkKlines(140, i => 10 + i * 0.2), fmt, true);
    expect(env).not.toBeNull();
    expect(envHasCondition(env, 'trend-strong-up')).toBe(true);
    expect(envHasCondition(env, 'trend-strong-down')).toBe(false);
    expect(envHasCondition(null, 'trend-strong-up')).toBe(false);
  });

  it('预览扫描带 envKey：不成立态过滤为空、成立态保留命中', () => {
    // 长上行序列 + 末根十字星（≤130 根的早期命中会被环境盲区过滤，但末根成立态应保留）
    const ks = mkKlines(160, i => 10 + i * 0.2, { 159: { open: 100, close: 100, high: 105, low: 95 } });
    const all = scanTagOccurrences(ks, 'pattern-doji');
    const withUp = scanTagOccurrences(ks, 'pattern-doji', 'trend-strong-up');
    const withDown = scanTagOccurrences(ks, 'pattern-doji', 'trend-strong-down');
    expect(all.length).toBeGreaterThan(0);
    expect(withDown).toEqual([]);                       // 环境不成立 → 全部过滤
    expect(withUp.length).toBeGreaterThan(0);           // 环境成立 → 命中保留
    expect(withUp[withUp.length - 1].date).toBe(ks[159].date); // 末根在成立态下被保留
  });

  it('runBacktest 门控：同一触发规则，无前提触发、绑定不成立前提不触发、绑定成立前提触发', () => {
    const ks = mkKlines(160, i => 10 + i * 0.2, { 159: { open: 100, close: 100, high: 105, low: 95 } });
    const base = { id: 'r1', tagKey: 'pattern-doji', label: '十字星', action: 'buy' as const, pct: 10, enabled: true };
    const strategies: Array<{ name: string; envCondition?: { key: string; label: string } }> = [
      { name: '无环境前提' },
      { name: '空头前提（不成立）', envCondition: { key: 'trend-strong-down', label: '空头强排列' } },
      { name: '多头前提（成立）', envCondition: { key: 'trend-strong-up', label: '多头强排列' } },
    ];
    const results = strategies.map(s => runBacktest(ks, {
      rules: [{ ...base, envCondition: s.envCondition }],
      initialCapital: 100000,
    } as BacktestStrategy));
    expect(results[0].trades.length).toBeGreaterThan(0); // 无前提 → 触发
    expect(results[1].trades.length).toBe(0);            // 不成立前提 → 全程不触发
    expect(results[2].trades.length).toBeGreaterThan(0); // 成立前提 → 触发
  });
});