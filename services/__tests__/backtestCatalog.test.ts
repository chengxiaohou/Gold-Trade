import { describe, it, expect } from 'vitest';
import type { BollKline } from '../bollService';
import { BACKTEST_TAG_CATALOG, runBacktest, scanTagOccurrences, getDaySignalLabels } from '../backtestEngine';
import { getDayTagSet } from '../signalTagDetail';
import { analyzeKlinePatterns, analyzeKlinePatternsAt, analyzeMarketConditions, analyzeEnvironment, envHasCondition, ENV_TAG_CATALOG, classifyVolumeAt, classifyPriceStateAt, volBucket, stabilizeComboReference, DAILY_SIGNAL_CATALOG, selectEnvDisplayTags, PATTERN_CHIP_CLS, VOLUME5_CHIP_CLS, BREAK_CHIP_CLS, CHIP_CLS_INDIGO, CHIP_CLS_RED } from '../tagAnalyzers';
import type { EnvTag } from '../tagAnalyzers';
import type { BacktestStrategy, TagParams } from '../../types';
import { DEFAULT_TAG_PARAMS } from '../../types';

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

  it('反向兜底：回测目录穷尽弹窗全部可选信号（新增弹窗每日信号但漏登记回测目录时此处必然卡住）', () => {
    // 弹窗“每日类”可选信号全集（与 StockDividendPage.tsx 弹窗 chip 来源一致）：
    // 形态 + 破位 + 量能 + 企稳。位置(高位/低位)属于环境前提（ENV_TAG_CATALOG），不进信号栏。
    const POPUP_SIGNALS = [
      '十字星', '金针探底', '放量金针', '吊颈线', '射击之星', '倒锤子线', // pattern
      '破位',                                                          // break
      '明显放量', '温和放量', '平量', '温和缩量', '明显缩量',            // volume（量能5档）
      '放量企稳', '缩量企稳', '平量企稳', '放量反弹', '缩量反弹', '放量底部确认', '缩量健康回踩', '缩量弱势回踩', // stabilize（价格态×量能组合信号，回踩按 sub 分档）
    ];
    expect(BACKTEST_TAG_CATALOG.map(d => d.label).sort()).toEqual([...POPUP_SIGNALS].sort());
    expect(DAILY_SIGNAL_CATALOG.map(d => d.label).sort()).toEqual([...POPUP_SIGNALS].sort());
    // 高位/低位绝不进入信号目录
    for (const pos of ['高位', '低位']) expect(DAILY_SIGNAL_CATALOG.some(d => d.label === pos)).toBe(false);
  });

  it('单一数据源：回测目录与分析器的信号清单是同一份引用（从此彻底杜绝“回测忘了登记”式漂移）', () => {
    // 回测不再自建清单，而是直接引用 tagAnalyzers 的 DAILY_SIGNAL_CATALOG
    expect(BACKTEST_TAG_CATALOG).toBe(DAILY_SIGNAL_CATALOG);
    // 每个条目元数据完整且同源一致（key 唯一）
    expect(new Set(BACKTEST_TAG_CATALOG.map(d => d.key)).size).toBe(BACKTEST_TAG_CATALOG.length);
  });

  it('新 signal source 都能被对应 tagAnalyzers 判定函数真实产出（不悬空、复用同一判断）', () => {
    // 量能5档：明显放量 / 明显缩量 / 平量
    expect(classifyVolumeAt(mkKlines(140, undefined, { 139: { volume: 5_000_000 } }), 139)).toBe('明显放量');
    expect(classifyVolumeAt(mkKlines(140, undefined, { 139: { volume: 100_000 } }), 139)).toBe('明显缩量');
    expect(classifyVolumeAt(mkKlines(140), 139)).toBe('平量');
    // 组合信号：放量反弹（反弹态 + 放量粗分）/ 缩量弱势回踩（回踩态+sub=weak + 缩量粗分）
    // 反弹数据构造：近3日低点不足2日抬高（38/37/36 低点连降，低点需显式给出——本文件 override 不联动 low），避免误升级为底部确认
    const up = mkKlines(40, i => 100, { 36: { close: 102, low: 101.9 }, 37: { close: 101, low: 100.9 }, 38: { close: 100.9, low: 100.8 }, 39: { close: 108, low: 107.9, volume: 2_000_000 } });
    const psUp = classifyPriceStateAt(up, 39, fmt);
    expect(psUp?.name).toBe('反弹');
    expect(`${volBucket(classifyVolumeAt(up, 39))}${psUp!.name}`).toBe('放量反弹');
    const dn = mkKlines(40, i => 100, { 39: { close: 95, volume: 500_000 } });
    const psDn = classifyPriceStateAt(dn, 39, fmt);
    expect(psDn?.name).toBe('回踩');
    expect(psDn?.sub).toBe('weak'); // 末根低点 94.9 ≤ 昨低 99.9 → 弱势
    expect(`${volBucket(classifyVolumeAt(dn, 39))}${psDn!.sub === 'weak' ? '弱势回踩' : '健康回踩'}`).toBe('缩量弱势回踩');
    // 底部确认信号：放量+收复MA10+低点连抬+MA5走平 → 放量底部确认
    const bc = mkKlines(40, i => 100, { 36: { close: 96 }, 37: { close: 94 }, 38: { close: 95.5 }, 39: { close: 101, volume: 2_000_000 } });
    const psBc = classifyPriceStateAt(bc, 39, fmt);
    expect(psBc?.name).toBe('底部确认');
    expect(`${volBucket(classifyVolumeAt(bc, 39))}${psBc!.name}`).toBe('放量底部确认');
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

  it('量能信号命中：末根明显放量 → volume-up-strong 命中；末根明显缩量 → volume-down-strong 命中', () => {
    expect(scanTagOccurrences(mkKlines(140, undefined, { 139: { volume: 5_000_000 } }), 'volume-up-strong').length).toBeGreaterThan(0);
    expect(scanTagOccurrences(mkKlines(140, undefined, { 139: { volume: 100_000 } }), 'volume-down-strong').length).toBeGreaterThan(0);
  });

  it('位置不属于信号：回测信号目录无位置条目 → scanTagOccurrences(位置key) 为空', () => {
    expect(scanTagOccurrences(mkKlines(140, i => 10 + i * 0.2), 'position-high')).toEqual([]);
    expect(scanTagOccurrences(mkKlines(140, i => 200 - i * 0.5), 'position-low')).toEqual([]);
  });

  it('回踩组合信号命中（sub 分档）：弱势回踩+缩量 → stabilize-retrace-weak-voldn 命中；健康回踩+缩量 → stabilize-retrace-health-voldn 命中', () => {
    expect(scanTagOccurrences(mkKlines(40, i => 100, { 39: { close: 95, volume: 500_000 } }), 'stabilize-retrace-weak-voldn').length).toBeGreaterThan(0);
    // 注意本文件 mkKlines 的 override 是部分覆盖：低点需显式给出（low 不会随 close 联动）
    expect(scanTagOccurrences(mkKlines(40, i => 100, { 38: { close: 95, low: 94.9 }, 39: { close: 97, low: 96.9, volume: 500_000 } }), 'stabilize-retrace-health-voldn').length).toBeGreaterThan(0);
  });

  it('底部确认信号命中：放量底部确认 → stabilize-bottom-confirm-volup 命中', () => {
    const ks = mkKlines(40, i => 100, { 36: { close: 96 }, 37: { close: 94 }, 38: { close: 95.5 }, 39: { close: 101, volume: 2_000_000 } });
    const hits = scanTagOccurrences(ks, 'stabilize-bottom-confirm-volup');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].detail.some(d => d.includes('底部确认'))).toBe(true);
  });
});

//
// 3. 环境条件（envCondition）：作为规则的可选前提做 AND 门控
// 只含趋势结构 + 布林波动（与弹窗 selectEnvDisplayTags 同维度，不含周期/量价）
//
describe('环境前提（envCondition）', () => {
  it('ENV_TAG_CATALOG 全部为趋势/波动/位置维度，不与弹窗注释的周期/量价冲突', () => {
    expect(ENV_TAG_CATALOG.length).toBeGreaterThan(0);
    for (const c of ENV_TAG_CATALOG) {
      expect(['trend', 'volatility', 'position']).toContain(c.dim);
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

  it('弹窗“环境”展示集 == 回测“环境”下拉集：趋势+波动+位置都在，仅周期/量价被过滤', () => {
    // 覆盖 analyzeEnvironment 可能输出的全部维度（趋势5 + 波动3 + 位置3 + 周期1 + 量价1）
    const ALL: EnvTag[] = [
      { key: 'trend-strong-up', label: '多头强排列', single: '多', color: 'red', score: 1, dim: 'trend', detail: [] },
      { key: 'trend-weak-up', label: '多头弱排列', single: '弱', color: 'orange', score: 0.4, dim: 'trend', detail: [] },
      { key: 'trend-squeeze', label: '均线粘合', single: '粘', color: 'slate', score: 0, dim: 'trend', detail: [] },
      { key: 'trend-weak-down', label: '空头弱排列', single: '空弱', color: 'slate', score: -0.4, dim: 'trend', detail: [] },
      { key: 'trend-strong-down', label: '空头强排列', single: '空', color: 'green', score: -1, dim: 'trend', detail: [] },
      { key: 'vol-squeeze', label: '布林收口', single: '收', color: 'slate', score: 0, dim: 'volatility', detail: [] },
      { key: 'vol-up', label: '上轨扩张', single: '扩', color: 'red', score: 1, dim: 'volatility', detail: [] },
      { key: 'vol-down', label: '下轨扩张', single: '扩', color: 'green', score: -1, dim: 'volatility', detail: [] },
      { key: 'pos-high', label: '高位', single: '高', color: 'green', score: -0.5, dim: 'position', detail: [] },
      { key: 'pos-low', label: '低位', single: '低', color: 'red', score: 0.5, dim: 'position', detail: [] },
      { key: 'pos-mid', label: '中位', single: '中', color: 'slate', score: 0, dim: 'position', detail: [] },
      { key: 'cycle', label: '强进攻周期', single: '攻', color: 'red', score: 1, dim: 'cycle', detail: [] },
      { key: 'vol-up-up', label: '量增价升', single: '增', color: 'red', score: 1, dim: 'volume', detail: [] },
    ];
    const shown = selectEnvDisplayTags(ALL);
    // 弹窗“环境”展示集 【==】 回测“环境”下拉（ENV_TAG_CATALOG）——两边完全一模一样（含低位/中位/高位）
    expect(shown.map(t => t.key).sort()).toEqual(ENV_TAG_CATALOG.map(c => c.key).sort());
    // 环境区只含 趋势/波动/位置，周期/量价被过滤
    for (const t of shown) expect(['trend', 'volatility', 'position']).toContain(t.dim);
    expect(shown.some(t => t.dim === 'position')).toBe(true);                // 位置在环境区
    expect(shown.some(t => t.dim === 'cycle')).toBe(false);
    expect(shown.some(t => t.dim === 'volume')).toBe(false);
    // 位置三档（高位/中位/低位）全量入选环境目录
    expect(ENV_TAG_CATALOG.some(c => c.key === 'pos-high')).toBe(true);
    expect(ENV_TAG_CATALOG.some(c => c.key === 'pos-mid')).toBe(true);
    expect(ENV_TAG_CATALOG.some(c => c.key === 'pos-low')).toBe(true);
  });

  it('位置环境门控：runBacktest 可用 高位/低位 作 envCondition 前提（位置不在信号栏，但确实能作环境前提）', () => {
    // 下行序列 → 末根贴近近20日低点 → 环境命中 pos-low（低位）
    const ks = mkKlines(160, i => 10 + (140 - i) * 0.2);
    const env = analyzeEnvironment(ks, fmt, true);
    expect(env).not.toBeNull();
    expect(envHasCondition(env, 'pos-low')).toBe(true);
    expect(envHasCondition(env, 'pos-high')).toBe(false);
    // 作为环境前提门控：低位成立时触发、高位前提不触发
    const base = { id: 'r1', tagKey: 'pattern-doji', label: '十字星', action: 'buy' as const, pct: 10, enabled: true };
    const low = runBacktest(ks, { rules: [{ ...base, envCondition: { key: 'pos-low', label: '低位' } }], initialCapital: 100000 } as BacktestStrategy);
    const high = runBacktest(ks, { rules: [{ ...base, envCondition: { key: 'pos-high', label: '高位' } }], initialCapital: 100000 } as BacktestStrategy);
    expect(low.trades.length).toBeGreaterThan(0);
    expect(high.trades.length).toBe(0);
  });

  it('每日信号只在“信号”栏可选：信号目录直接对应弹窗信号集，不与任何环境条目同名/同键', () => {
    // 信号键 —— 完全来自 DAILY_SIGNAL_CATALOG（单一数据源）
    const sigKeys = new Set(DAILY_SIGNAL_CATALOG.map(d => d.key));
    expect(sigKeys.size).toBe(BACKTEST_TAG_CATALOG.length);
    // 没有任何信号 getValueAsenvCondition 键
    for (const d of ENV_TAG_CATALOG) expect(sigKeys.has(d.key)).toBe(false);
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

//
// 4. 参数一致性：回测必须与弹窗用【同一份】标签判定参数（cfg）
// 若用户在设置里改了判定参数，回测不跟随 → 同一根 K 线两侧判定会漂移，此节杜绝。
//
describe('回测与弹窗采用同一套标签判定参数（参数一致性）', () => {
  // 自定义参数：把"明显放量"阈值调成 0.01，使任何正量均判为"明显放量"（默认 1.40 下平量）
  const customCfg: TagParams = JSON.parse(JSON.stringify(DEFAULT_TAG_PARAMS));
  customCfg.classic.classicVolHighStrong.value = 0.01;

  // 平量序列（每日 volume 相同 → 量比恒为 1.0）
  const flatKlines = mkKlines(140, undefined, { 50: { volume: 1_000_000 } });

  it('默认参数下扫描不命中"明显放量" → 自定义参数下同一段 K 线命中"明显放量"（回测确实遵循传入 cfg）', () => {
    const byDefault = scanTagOccurrences(flatKlines, 'volume-up-strong', undefined, DEFAULT_TAG_PARAMS);
    const byCustom = scanTagOccurrences(flatKlines, 'volume-up-strong', undefined, customCfg);
    expect(byDefault.length).toBe(0);                 // 默认 1.40：量比 1.0 平量 → 无"明显放量"
    expect(byCustom.length).toBeGreaterThan(0);        // 0.01：量比 1.0 ≥ 0.01 → 每根都"明显放量"
  });

  it('回测扫描命中的"明显放量"集合 == 弹窗 classifyVolumeAt(同一 cfg) 的判集（同函数同参数 → 同判定）', () => {
    const scanHits = scanTagOccurrences(flatKlines, 'volume-up-strong', undefined, customCfg).map(o => o.date);
    const windowStart = 30; // scanTagOccurrences 从 i=30 起扫
    const analyzerHits: string[] = [];
    for (let i = windowStart; i < flatKlines.length; i++) {
      if (classifyVolumeAt(flatKlines.slice(0, i + 1), i, customCfg) === '明显放量') analyzerHits.push(flatKlines[i].date);
    }
    expect(scanHits).toEqual(analyzerHits); // 逐日严格一致：回测复用弹窗同参判定，无任何改判
  });

  it('runBacktest 遵循传入 cfg：默认参数平量不触发"明显放量"买 → 自定义参数触发"明显放量"买', () => {
    const rule = { id: 'r', tagKey: 'volume-up-strong', label: '明显放量', action: 'buy' as const, pct: 10, enabled: true };
    const strat = (cfg: TagParams | undefined) =>
      runBacktest(flatKlines, { rules: [{ ...rule }], initialCapital: 100000 } as BacktestStrategy, { cfg });
    expect(strat(undefined).trades.length).toBe(0);   // 不传 cfg → 默认 1.40：平量 → 全程不触发
    expect(strat(customCfg).trades.length).toBeGreaterThan(0); // 0.01：明显放量 → 触发买入
  });
});

//
// 5. 回测图十字线悬浮栏的信号来源 = 回测/弹窗同一套（getDaySignalLabels 不另算）
//
describe('getDaySignalLabels（十字线悬浮栏信号来源）', () => {
  it('末根十字星日 → 当日命中含"十字星"', () => {
    const ks = mkKlines(140, undefined, { 139: { open: 100, close: 100, high: 105, low: 95 } });
    const labels = getDaySignalLabels(ks, 139);
    expect(labels).toContain('十字星');
  });

  it('与 runBacktest 同一判据：命中信号集合能驱动对应 catalog 规则触发', () => {
    // 用手工放大数 case 构造"明显放量"日
    const ks = mkKlines(140);
    const idx = 139;
    const prefix = ks.slice(0, idx + 1);
    // 自定义 cfg：量比 1.0 ≥ 0.01 → 每根都"明显放量"；悬浮栏应报出该信号
    const cfg: TagParams = JSON.parse(JSON.stringify(DEFAULT_TAG_PARAMS));
    cfg.classic.classicVolHighStrong.value = 0.01;
    const labels = getDaySignalLabels(prefix, idx, cfg);
    expect(labels).toContain('明显放量');
    // 且该信号能真实触发 catalog 里对应 key 的规则（目录与信号判定同源不悬空）
    const def = BACKTEST_TAG_CATALOG.find(d => d.signalName === '明显放量');
    expect(def).toBeTruthy();
    const { trades } = runBacktest(ks, { rules: [{ id: 'x', tagKey: def!.key, label: def!.label, action: 'buy' as const, pct: 10, enabled: true }], initialCapital: 100000 } as BacktestStrategy, { cfg });
    expect(trades.length).toBeGreaterThan(0);
  });
});

//
// 6. getDayTagSet：信号标签部唯一权威 —— 价格浮窗底栏、标签弹窗"近10交易日"当日行、回测共用同一批判定，
//    直接对构造行情断言真实 chip 集（量能5档 + 价格态原子 + 形态 + 破位观测态），非自证。
//
describe('getDayTagSet（信号标签部唯一权威，当日行 = 底栏 = 标签弹窗同一批判定）', () => {
  const findByLabel = (tags: ReturnType<typeof getDayTagSet>, label: string) =>
    tags.find(t => t.label === label);
  const findByPrefix = (tags: ReturnType<typeof getDayTagSet>, prefix: string) =>
    tags.find(t => t.label.startsWith(prefix));
  const findBreakChip = (tags: ReturnType<typeof getDayTagSet>, prefix: string, N: number) =>
    tags.find(t => t.label === `${prefix}${N}`);

  it('常态：量能 + 价格态原子为必出基础标签，且不得出现回测组合标签（价格浮窗展示原子，与标签弹窗一致）', () => {
    const cases: BollKline[][] = [
      // 十字星（中位平量）
      mkKlines(140, undefined, { 139: { open: 100, close: 100, high: 105, low: 95 } }),
      // 明显放量
      mkKlines(140, undefined, { 139: { volume: 5_000_000 } }),
      // 缩量弱势回踩（价格态原子本应展示为「回踩」，而不是组合「缩量弱势回踩」）
      mkKlines(40, i => 100, { 39: { close: 95, volume: 500_000 } }),
      // 破位（大跌跌破均线）
      mkKlines(83, i => 200 - i * 0.5, { 81: { close: 170 }, 82: { open: 165, high: 166, low: 90, close: 95 } }),
    ];
    for (const ks of cases) {
      const i = ks.length - 1;
      const got = getDayTagSet(ks, undefined, fmt).map(t => t.label);
      // 量能标签恒存在
      expect(got).toContain(classifyVolumeAt(ks, i));
      // 严禁出现回测组合标签（价格浮窗应展示原子标签，与标签弹窗一致，不重复两套）
      for (const combo of ['放量企稳', '缩量企稳', '平量企稳', '放量反弹', '缩量反弹', '放量底部确认', '缩量底部确认', '缩量健康回踩', '缩量弱势回踩']) {
        expect(got).not.toContain(combo);
      }
    }
  });

  it('十字星：detail 为形态判定依据、reference 为组合参考价值（均非空，源自 analyzeKlinePatternsAt/analyzeKlineCombo）', () => {
    const ks = mkKlines(140, undefined, { 139: { open: 100, close: 100, high: 105, low: 95 } });
    const tags = getDayTagSet(ks.slice(0, 140), undefined, fmt);
    const star = findByLabel(tags, '十字星');
    expect(star).toBeTruthy();
    expect(star!.detail.length).toBeGreaterThan(0);   // 判定依据非空
    expect(star!.reference.length).toBeGreaterThan(0); // 组合参考价值非空
    // chip 配色 = 标签弹窗 PATTERN_CHIP_CLS（语义色：此处中位平量十字星 → 蓝）
    expect(star!.cls).toBe(PATTERN_CHIP_CLS['blue'].cls);
    expect(star!.sel).toBe(PATTERN_CHIP_CLS['blue'].sel);
  });

  it('明显放量：detail 为量能判定、reference 为 volday 静态文案', () => {
    const ks = mkKlines(140, undefined, { 139: { volume: 5_000_000 } });
    const tags = getDayTagSet(ks.slice(0, 140), undefined, fmt);
    const vol = findByLabel(tags, '明显放量');
    expect(vol).toBeTruthy();
    expect(vol!.detail.some(l => l.includes('量能 明显放量'))).toBe(true);
    expect(vol!.detail.some(l => l.includes('量比'))).toBe(true);
    expect(vol!.reference).toContain('量增价升有持续性'); // 与弹窗 volday 参考价值同一静态文案
    expect(vol!.cls).toBe(VOLUME5_CHIP_CLS['明显放量'].cls); // 放量 → 红
  });

  it('缩量弱势回踩日：展示价格态原子「回踩」（非组合「缩量弱势回踩」），reference == stabilizeComboReference', () => {
    const ks = mkKlines(40, i => 100, { 39: { close: 95, volume: 500_000 } });
    const win = ks.slice(0, 40);
    const tags = getDayTagSet(win, undefined, fmt);
    const labels = tags.map(t => t.label);
    const ps = classifyPriceStateAt(win, 39, fmt);
    expect(ps).not.toBeNull();
    expect(ps!.sub).toBe('weak');
    // 与标签弹窗一致：原子「回踩」chip，而非组合
    expect(labels).toContain('回踩');
    expect(labels).not.toContain('缩量弱势回踩');
    const pull = findByLabel(tags, '回踩');
    expect(pull).toBeTruthy();
    expect(pull!.reference).toBe(stabilizeComboReference(ps!.name, classifyVolumeAt(win, 39), ps!.sub));
  });

  // —— 破位观测态：触发日 / 观测中 / 定论日 的完整 chip 映射（标签弹窗 statusChip/repairChip 的复刻） ——
  it('破位触发日（window 首日）：出「破位 xN」绿 chip，破位属性 detail 非空', () => {
    const k2 = mkKlines(83, i => 200 - i * 0.5, {
      81: { close: 170 },
      82: { open: 165, high: 166, low: 90, close: 95 },
    });
    const events = analyzeMarketConditions(k2, 10);
    const ev = events.find(e => e.date === date(82))!;
    const tags = getDayTagSet(k2.slice(0, 83), undefined, fmt, { events });
    const brk = findBreakChip(tags, '破位 x', ev.brokenCount);
    expect(brk).toBeTruthy();
    expect(brk!.detail.length).toBeGreaterThan(0);
    expect(brk!.reference).toBe('');
    expect(brk!.cls).toBe(BREAK_CHIP_CLS.cls); // 看空 → 绿
    expect(brk!.sel).toBe(BREAK_CHIP_CLS.sel);
  });

  it('破位观测中（window 中间观测日）：出「观察 xN」indigo chip；破位触发日仍为「破位 xN」且无观察', () => {
    const k3 = mkKlines(84, i => 200 - i * 0.5, {
      81: { close: 170 },
      82: { open: 165, high: 166, low: 90, close: 95 },  // 破位日 t
      83: { open: 95, high: 96, low: 90, close: 93 },    // t+1 观测中（未修复也未定论）
    });
    const events = analyzeMarketConditions(k3, 10);
    const ev = events.find(e => e.date === date(82)); // 破位发生在 day 82
    expect(ev).toBeTruthy();
    expect(ev!.status).toBe('confirming');
    const N = ev!.brokenCount;
    // 观测中当日（t+1=day83）：观察 xN，indigo
    const tags = getDayTagSet(k3.slice(0, 84), undefined, fmt, { events });
    const obs = findBreakChip(tags, '观察 x', N);
    expect(obs).toBeTruthy();
    expect(obs!.cls).toBe(CHIP_CLS_INDIGO);            // 观察 → indigo
    // 破位触发日（day82）打回：含破位 xN，不留观察
    const tagT = getDayTagSet(k3.slice(0, 83), undefined, fmt, { events });
    expect(findBreakChip(tagT, '破位 x', N)).toBeTruthy();
    expect(findByPrefix(tagT, '观察 x')).toBeUndefined();
  });

  it('定论日：真实破位出「真破位 xN」绿 chip、假破位出「假破位 xN」红 chip', () => {
    // 真破位：3 日 window 末（t+2）仍收在 break 下方，status=trueBreak
    const kTrue = mkKlines(85, i => 200 - i * 0.5, {
      81: { close: 170 },
      82: { open: 165, high: 166, low: 90, close: 95 },  // 破位日 t
      83: { open: 95, high: 96, low: 90, close: 92 },
      84: { open: 92, high: 93, low: 88, close: 90 },    // t+2 定论日：真破位
    });
    const evT = analyzeMarketConditions(kTrue, 10).find(e => e.date === date(82))!;
    expect(evT.status).toBe('trueBreak');
    const tagEnd = getDayTagSet(kTrue.slice(0, 85), undefined, fmt, { events: analyzeMarketConditions(kTrue, 10) });
    const trueChip = findBreakChip(tagEnd, '真破位 x', evT.brokenCount);
    expect(trueChip).toBeTruthy();
    expect(trueChip!.cls).toBe(BREAK_CHIP_CLS.cls);     // 真破位 → 绿
    expect(findByPrefix(tagEnd, '观察 x')).toBeUndefined(); // 定论日不再出观察

    // 假破位：3 日 window 末收回 break 上方，status=falseBreak
    const kFalse = mkKlines(85, i => 200 - i * 0.5, {
      81: { close: 170 },
      82: { open: 165, high: 166, low: 90, close: 95 },  // 破位日 t
      83: { open: 95, high: 140, low: 94, close: 138 },
      84: { open: 138, high: 205, low: 138, close: 202 }, // t+2 定论日：假破位
    });
    const evF = analyzeMarketConditions(kFalse, 10).find(e => e.date === date(82))!;
    expect(evF.status).toBe('falseBreak');
    const tagFalse = getDayTagSet(kFalse.slice(0, 85), undefined, fmt, { events: analyzeMarketConditions(kFalse, 10) });
    const falseChip = findBreakChip(tagFalse, '假破位 x', evF.brokenCount);
    expect(falseChip).toBeTruthy();
    expect(falseChip!.cls).toBe(CHIP_CLS_RED);          // 假破位 → 红
  });
});

// ────────────────── 用户自定义标签参与回测 ──────────────────
import type { UserTagRule } from '../../types';

describe('用户自定义标签可作回测买卖触发', () => {
  // 恒定收盘 100，第 40 天起收盘跳到 120 并维持 → 触发器"收盘增至110"在第 40 天起恒命中
  const k = mkKlines(60, i => (i >= 40 ? 120 : 100));
  const customTags: UserTagRule[] = [
    { id: 'tt1', name: '长期站上110', enabled: true, source: 'price', direction: 'up', targetType: 'fixed', targetValue: 110, color: 'indigo' },
  ];
  const strategy: BacktestStrategy = {
    initialCapital: 100000,
    rules: [{ id: 'r1', tagKey: 'user-tt1', label: '长期站上110', action: 'buy', pct: 50, enabled: true }],
  };

  it('命中自定义标签后产生买入成交、触发标签名与标签一致', () => {
    const r = runBacktest(k, strategy, { customTags });
    expect(r.trades.length).toBeGreaterThan(0);
    const buy = r.trades.find(t => t.action === 'buy' && t.tagName === '长期站上110');
    expect(buy).toBeTruthy();
    expect(buy!.barIndex).toBeGreaterThanOrEqual(40); // 命中日起触发
  });

  it('自定义标签仍可被 scanTagOccurrences 预览到', () => {
    const occ = scanTagOccurrences(k, 'user-tt1', undefined, DEFAULT_TAG_PARAMS, customTags);
    expect(occ.length).toBeGreaterThan(0);
    expect(occ[0].barIndex).toBeGreaterThanOrEqual(40);
  });

  it('股息率自定义标签在回测中按派息折算命中', () => {
    const tags: UserTagRule[] = [
      { id: 'tt2', name: '股息率达3%', enabled: true, source: 'dividendRate', direction: 'up', targetType: 'fixed', targetValue: 3, color: 'green' },
    ];
    // 每股派息 3.0：股息率=3/100*100=3%，恒命中；派息 0.1 → 0.1% 不命中
    const hit = runBacktest(k, { initialCapital: 100000, rules: [{ id: 'r2', tagKey: 'user-tt2', label: '股息率达3%', action: 'buy', pct: 30, enabled: true }] }, { customTags: tags, dividendByYear: { 2025: 3.0 } });
    expect(hit.trades.some(t => t.action === 'buy' && t.tagName === '股息率达3%')).toBe(true);
    const miss = runBacktest(k, { initialCapital: 100000, rules: [{ id: 'r2', tagKey: 'user-tt2', label: '股息率达3%', action: 'buy', pct: 30, enabled: true }] }, { customTags: tags, dividendByYear: { 2025: 0.1 } });
    expect(miss.trades.length).toBe(0);
  });
});