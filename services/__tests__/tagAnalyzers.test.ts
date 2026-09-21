import { describe, it, expect } from 'vitest';
import type { BollKline } from '../bollService';
import type { EnvTag, MarketEvent, PriceStateTag } from '../tagAnalyzers';
import {
  analyzeKlinePatterns,
  analyzeKlinePatternsAt,
  analyzeKlineCombo,
  classifyPosition,
  classifyVolumeAt,
  classifyVolume,
  volBucket,
  dojiColorByDim,
  analyzeMarketConditions,
  analyzeEnvironment,
  classifyPriceState,
  classifyPriceStateAt,
  stabilizeComboReference,
  buildLatestDayTags,
  buildLatestShrinkTags,
  selectEnvDisplayTags,
  buildBreakExplainLines,
  latestBarFingerprint,
} from '../tagAnalyzers';

const fmt = (v: number) => v.toFixed(2);
const fmtDay = (d: string) => d;
const fmtShort = (d: string) => d.slice(5).replace('-', '/');
// 综合周期单字（已注释，不得出现在缩略展示里）
const CYCLE_SINGLES = ['攻', '防', '弹', '筑', '震'];

// 生成从 2026-01-01 起的第 i 天日期（历史日期，保证 isTodayVolumeEligible 走非当日收盘分支）
function date(i: number): string {
  return new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
}

// 便捷构造 K 线序列：base 为收盘均值，可用 overrides 覆盖任意索引的 OHLC
function mkKlines(
  n: number,
  opts: { close?: (i: number) => number; overrides?: Record<number, Partial<BollKline>> } = {},
): BollKline[] {
  const arr: BollKline[] = [];
  for (let i = 0; i < n; i++) {
    const c = opts.close ? opts.close(i) : 100;
    arr.push({ date: date(i), open: c, high: c + 0.1, low: c - 0.1, close: c, volume: 1_000_000 });
  }
  if (opts.overrides) {
    for (const [idx, o] of Object.entries(opts.overrides)) {
      const i = Number(idx);
      arr[i] = { ...arr[i], ...o };
    }
  }
  return arr;
}

// 平坦走势 + 最近 3 天跳水（不收回）→ 判定真破位；破位日为 n-3
const kTrueBreak = mkKlines(83, {
  overrides: {
    80: { open: 90, close: 90, high: 92, low: 88 },
    81: { open: 90, close: 90, high: 92, low: 88 },
    82: { open: 90, close: 90, high: 92, low: 88 },
  },
});
// 破位次日收回均线上方 → 假破位
const kFalseBreak = mkKlines(83, {
  overrides: {
    80: { open: 90, close: 90, high: 92, low: 88 },
    81: { open: 100, close: 100, high: 101, low: 99 },
    82: { open: 100, close: 100, high: 101, low: 99 },
  },
});
// 仅最后一根跳水（观测窗口不足 3 天）→ 修复观察
const kConfirming = mkKlines(80, {
  overrides: {
    79: { open: 90, close: 90, high: 92, low: 88 },
  },
});

describe('analyzeKlinePatterns（K线形态）', () => {
  it('末根十字星 → 单字"十"', () => {
    const k = mkKlines(140, {
      overrides: { 139: { open: 100, close: 100, high: 105, low: 95 } },
    });
    const ps = analyzeKlinePatterns(k, fmt);
    expect(ps).toHaveLength(1);
    expect(ps[0].type).toBe('doji');
    expect(ps[0].single).toBe('十');
  });

  it('判断依据 detail 含形态名与实体占比', () => {
    const k = mkKlines(140, {
      overrides: { 139: { open: 100, close: 100, high: 105, low: 95 } },
    });
    const ps = analyzeKlinePatterns(k, fmt);
    const joined = ps[0].detail.join('\n');
    expect(joined).toContain('十字星');
    expect(joined).toContain('实体占比');
  });

  it('下影长/上影短/实体小 + 贴近近20日低点 → 金针探底（单字"针"，红/看多）', () => {
    const k = mkKlines(140, { overrides: { 139: { open: 98.8, close: 99, high: 99.0, low: 96 } } });
    const ps = analyzeKlinePatterns(k, fmt);
    expect(ps).toHaveLength(1);
    expect(ps[0].type).toBe('hammer');
    expect(ps[0].single).toBe('针');
    expect(ps[0].color).toBe('red');
  });

  it('下影长/上影短/实体小 + MA20向上贴近近20日高点 → 吊颈线（单字"吊"，绿/看空）', () => {
    const k = mkKlines(140, {
      close: i => 10 + i * 0.2,
      overrides: { 139: { open: 37.8, close: 37.7, high: 37.81, low: 36.5 } },
    });
    const ps = analyzeKlinePatterns(k, fmt);
    expect(ps).toHaveLength(1);
    expect(ps[0].type).toBe('hangingMan');
    expect(ps[0].single).toBe('吊');
    expect(ps[0].color).toBe('green');
  });

  it('上影长/下影短/实体小 + MA20向上贴近高点 → 射击之星（单字"射"，绿/看空）', () => {
    const k = mkKlines(140, {
      close: i => 10 + i * 0.2,
      overrides: { 139: { open: 37.4, close: 37.5, high: 38.5, low: 37.38 } },
    });
    const ps = analyzeKlinePatterns(k, fmt);
    expect(ps).toHaveLength(1);
    expect(ps[0].type).toBe('shootingStar');
    expect(ps[0].single).toBe('射');
    expect(ps[0].color).toBe('green');
  });

  it('上影长/下影短/实体小 + 下跌末端贴近低点 → 倒锤子线（单字"倒"，红/看多）', () => {
    const k = mkKlines(140, {
      close: i => 100 - i * 0.5,
      overrides: { 139: { open: 30.5, close: 30.6, high: 31.6, low: 30.48 } },
    });
    const ps = analyzeKlinePatterns(k, fmt);
    expect(ps).toHaveLength(1);
    expect(ps[0].type).toBe('invertedHammer');
    expect(ps[0].single).toBe('倒');
    expect(ps[0].color).toBe('red');
  });
});

describe('analyzeKlinePatternsAt（按索引判定形态：弹窗逐日区与回测同源）', () => {
  it('末根索引（i=n-1）与 analyzeKlinePatterns 结果一致', () => {
    const k = mkKlines(140, {
      overrides: { 139: { open: 100, close: 100, high: 105, low: 95 } },
    });
    const at = analyzeKlinePatternsAt(k, 139, fmt);
    const full = analyzeKlinePatterns(k, fmt);
    expect(at).toEqual(full);
    expect(at[0].type).toBe('doji');
    expect(at[0].date).toBe(k[139].date);
  });

  it('历史日索引 i 能判出形态（十字星）且 date 正确：回测对历史日窗口判定同索引一致', () => {
    // 构造历史日 99 为十字星（开=收、高=+5、低=-5）；最新日 139 给强实体避免也成十字星
    const k = mkKlines(140, {
      overrides: {
        99: { open: 100, close: 100, high: 105, low: 95 },
        139: { open: 100, close: 104, high: 106, low: 96 },
      },
    });
    const ps = analyzeKlinePatternsAt(k, 99, fmt);
    expect(ps).toHaveLength(1);
    expect(ps[0].type).toBe('doji');
    expect(ps[0].date).toBe(k[99].date);
    // 最新日形态不受影响（146 强实体非十字星）
    expect(analyzeKlinePatternsAt(k, 139, fmt)).toEqual([]);
  });

  it('历史日索引 i 能判出形态（金针探底）且 date 正确', () => {
    // 把"下影长/上影短/实体小 + 贴近近20日低点"的十字星样例放到历史日 100
    const k = mkKlines(140, {
      overrides: { 100: { open: 98.8, close: 99, high: 99.0, low: 96 } },
    });
    const ps = analyzeKlinePatternsAt(k, 100, fmt);
    expect(ps).toHaveLength(1);
    expect(ps[0].type).toBe('hammer');
    expect(ps[0].date).toBe(k[100].date);
    expect(ps[0].color).toBe('red');
  });

  it('越界保护：i < 20（前20日均线窗口不完整）→ 空数组', () => {
    const k = mkKlines(40);
    expect(analyzeKlinePatternsAt(k, 19, fmt)).toEqual([]);
    expect(analyzeKlinePatternsAt(k, 0, fmt)).toEqual([]);
    expect(analyzeKlinePatternsAt(k, -1, fmt)).toEqual([]);
  });

  it('越界保护：i ≥ 序列长度 → 空数组', () => {
    const k = mkKlines(40);
    expect(analyzeKlinePatternsAt(k, 40, fmt)).toEqual([]);
    expect(analyzeKlinePatternsAt(k, k.length, fmt)).toEqual([]);
  });
});

describe('classifyPosition / classifyVolume / dojiColorByDim（K线形态原子维度）', () => {
  it('K线不足21根 → 位置 中位', () => {
    expect(classifyPosition(mkKlines(5))).toBe('中位');
  });
  it('末根贴近近20日高点 → 高位', () => {
    // 近20日含一个低点钉（79），末根收盘 130 贴近高点 130.1、但离低点远 → 高位
    const k = mkKlines(40, {
      close: i => (i < 20 ? 100 : 130),
      overrides: { 20: { open: 100, close: 99, high: 121, low: 79 } },
    });
    expect(classifyPosition(k)).toBe('高位');
  });
  it('末根贴近近20日低点 → 低位', () => {
    // 近20日含一个高点钉（121），末根收盘 70 贴近低点 69.9、但离高点远 → 低位
    const k = mkKlines(40, {
      close: i => (i < 20 ? 100 : 70),
      overrides: { 20: { open: 100, close: 99, high: 121, low: 79 } },
    });
    expect(classifyPosition(k)).toBe('低位');
  });
  it('区间中部收盘 → 中位', () => {
    // 近20日区间 79~121，末根收盘 95 处于中间 → 既不贴近高、也不贴近低
    const k = mkKlines(40, {
      close: i => (i < 20 ? 100 : 95),
      overrides: { 20: { open: 100, close: 99, high: 121, low: 79 } },
    });
    expect(classifyPosition(k)).toBe('中位');
  });

  it('K线不足6根 → 量能 平量', () => {
    expect(classifyVolume(mkKlines(3))).toBe('平量');
  });
  it('末根量比 ≥1.4 → 明显放量', () => {
    const k = mkKlines(40, { overrides: { 39: { volume: 2_000_000 } } }); // 2e6 / [(4*1e6+2e6)/5]=1.2e6 → ratio≈1.67
    expect(classifyVolume(k)).toBe('明显放量');
  });
  it('末根量与均量相当、ratio≈1.0 → 平量（普通交易日不刷量档）', () => {
    expect(classifyVolume(mkKlines(40))).toBe('平量');
  });
  it('末根量比 ≤0.55 → 明显缩量', () => {
    const k = mkKlines(40, { overrides: { 39: { volume: 100_000 } } }); // ratio≈0.12
    expect(classifyVolume(k)).toBe('明显缩量');
  });
  it('量能5档·边界：明显放量/温和放量交界 ratio=1.4（含）与恰低于', () => {
    const at_40 = mkKlines(40, { overrides: { 39: { volume: 1_555_556 } } }); // ratio≈1.40 → 明显放量
    expect(classifyVolume(at_40)).toBe('明显放量');
    const below_40 = mkKlines(40, { overrides: { 39: { volume: 1_500_000 } } }); // ratio≈1.36
    expect(classifyVolume(below_40)).toBe('温和放量');
  });
  it('量能5档·边界：温和放量/平量交界 ratio=1.15（含）与恰低于', () => {
    const k = mkKlines(40, { overrides: { 39: { volume: 1_200_000 } } }); // ratio≈1.1538 → 温和放量
    expect(classifyVolume(k)).toBe('温和放量');
    const below = mkKlines(40, { overrides: { 39: { volume: 1_100_000 } } }); // ratio≈1.048 → 平量
    expect(classifyVolume(below)).toBe('平量');
  });
  it('量能5档·边界：平量/温和缩量交界 ratio=0.8（含平量）与恰低于', () => {
    const at_80 = mkKlines(40, { overrides: { 39: { volume: 762_000 } } }); // ratio≈0.8001 → 平量
    expect(classifyVolume(at_80)).toBe('平量');
    const below_80 = mkKlines(40, { overrides: { 39: { volume: 700_000 } } }); // ratio≈0.745 → 温和缩量
    expect(classifyVolume(below_80)).toBe('温和缩量');
  });
  it('量能5档·边界：温和缩量/明显缩量交界 ratio=0.55（含明显缩量）', () => {
    const k = mkKlines(40, { overrides: { 39: { volume: 490_000 } } }); // ratio≈0.535 → 明显缩量
    expect(classifyVolume(k)).toBe('明显缩量');
    const above = mkKlines(40, { overrides: { 39: { volume: 520_000 } } }); // ratio≈0.565 → 温和缩量
    expect(classifyVolume(above)).toBe('温和缩量');
  });
  it('老缓存缺新增字段（classicVolHighStrong 等）不崩溃，回落默认阈值', () => {
    const oldCfg = {
      feng: { fengLowBuy: { enabled: true, value: 1.05 }, fengPullback: { enabled: true, value: 1.01 }, fengVolBreak: { enabled: true, value: 1.2 } },
      classic: { classicDojiBody: { enabled: true, value: 0.05 }, classicSmallBody: { enabled: true, value: 0.3 }, classicNearHigh: { enabled: true, value: 0.95 }, classicNearLow: { enabled: true, value: 1.05 }, classicMaSqueeze: { enabled: true, value: 0.04 } },
    } as any; // 模拟云端/本地旧结构：classic 缺少量能5档字段
    const k = mkKlines(40, { overrides: { 39: { volume: 100_000 } } });
    expect(classifyVolume(k, oldCfg)).toBe('明显缩量'); // 回落默认 classicVolLowStrong=0.55
    expect(classifyPosition(k, oldCfg)).toBe('高位'); // 不崩溃，正常归一后按默认阈值判定
  });
  it('volBucket：5档粗分折叠为 放量/缩量/平量', () => {
    expect(volBucket('明显放量')).toBe('放量');
    expect(volBucket('温和放量')).toBe('放量');
    expect(volBucket('平量')).toBe('平量');
    expect(volBucket('温和缩量')).toBe('缩量');
    expect(volBucket('明显缩量')).toBe('缩量');
  });

  it('dojiColorByDim：低位+缩量 → 红（底部信号）', () => {
    expect(dojiColorByDim('低位', '缩量')).toBe('red');
  });
  it('dojiColorByDim：高位+放量 → 绿（顶部风险）', () => {
    expect(dojiColorByDim('高位', '放量')).toBe('green');
  });
  it('dojiColorByDim：其余组合 → 蓝（中性/变盘前夜）', () => {
    expect(dojiColorByDim('中位', '平量')).toBe('blue');
    expect(dojiColorByDim('高位', '缩量')).toBe('blue');
    expect(dojiColorByDim('低位', '放量')).toBe('blue');
  });
});

describe('classifyVolumeAt（按日期索引的量能5档判定，供“近10交易日”每日一行量能标签）', () => {
  it('中间某日明显放量 → 该日为 明显放量，且其前 1 日不受影响仍为 平量', () => {
    const k = mkKlines(40, { overrides: { 20: { volume: 3_000_000 } } });
    expect(classifyVolumeAt(k, 20)).toBe('明显放量');
    expect(classifyVolumeAt(k, 19)).toBe('平量'); // 19 日的前5日均量取 14~18，未含放量日，仍是平量
  });
  it('中间某日明显缩量 → 该日为 明显缩量', () => {
    const k = mkKlines(40, { overrides: { 15: { volume: 100_000 } } });
    expect(classifyVolumeAt(k, 15)).toBe('明显缩量');
  });
  it('索引 <5 时无 5 日均量 → 平量（不越界崩溃）', () => {
    const k = mkKlines(40);
    expect(classifyVolumeAt(k, 3)).toBe('平量');
  });
  it('最新索引与 classifyVolume 结果一致', () => {
    const k = mkKlines(40, { overrides: { 39: { volume: 2_000_000 } } });
    expect(classifyVolume(k)).toBe('明显放量');
    expect(classifyVolumeAt(k, 39)).toBe('明显放量');
  });
});

describe('位置维度 → 环境标签（高位/低位/中位，归入环境区展示）', () => {
  it('末根贴近近20日高点 → 环境含 高位 标签（绿/偏空），且 selectEnvDisplayTags 保留 position（作环境前提）', () => {
    const k = mkKlines(140, {
      close: i => (i < 120 ? 100 : 130),
      overrides: { 120: { open: 100, close: 99, high: 121, low: 79 } }, // 近20日低点钉，抬高区间，末根 130 贴近高点
    });
    const env = analyzeEnvironment(k, fmt);
    expect(env).not.toBeNull();
    const pos = env!.tags.find(t => t.dim === 'position');
    expect(pos).toBeDefined();
    expect(pos!.label).toBe('高位');
    expect(pos!.color).toBe('green');
    // 位置属于环境前提，进入“环境”展示区
    expect(selectEnvDisplayTags(env!.tags).some(t => t.key === 'pos-high')).toBe(true);
  });

  it('K线不足130根 analyzeEnvironment 为 null（位置标签随 env 一起缺席，不单独判）', () => {
    expect(analyzeEnvironment(mkKlines(50), fmt)).toBeNull();
  });
});

describe('十字星参考价值：直接给出具体位置×量能的组合判断（不再回落通用文案）', () => {
  it('中位-放量 十字星 → 具体“变盘启动点”参考，非通用“必须结合位置量能”文案', () => {
    const k = mkKlines(40, {
      close: i => (i < 20 ? 100 : 95),
      overrides: {
        20: { open: 100, close: 99, high: 121, low: 79 }, // 高点钉：区间 79~121，末根 95 居中 → 中位
        39: { open: 95, close: 95, high: 96, low: 94, volume: 2_000_000 }, // 放量
      },
    });
    const pats = analyzeKlinePatterns(k, fmt);
    expect(pats.some(p => p.type === 'doji')).toBe(true);
    const combo = analyzeKlineCombo(k, pats).find(c => c.type === 'doji');
    expect(combo).toBeDefined();
    expect(combo!.reference).toContain('变盘启动点');        // 具体组合文案
    expect(combo!.reference).not.toContain('必须结合位置');   // 不再用通用兜底
    expect(combo!.tokens.map(t => t.text)).toEqual(['中位', '放量', '十字星']);
  });

  it('高位-放量 十字星 → 顶部预警参考，形态 token 偏空(绿)', () => {
    const k = mkKlines(40, {
      close: i => (i < 20 ? 100 : 130),
      overrides: { 39: { open: 130, close: 130, high: 131, low: 129, volume: 2_000_000 } },
    });
    const pats = analyzeKlinePatterns(k, fmt);
    const combo = analyzeKlineCombo(k, pats).find(c => c.type === 'doji');
    expect(combo).toBeDefined();
    expect(combo!.reference).toContain('顶部预警');
    expect(combo!.tokens[2].cls).toBe('text-brand-green');
  });

  it('低位-缩量 十字星 → 底部信号参考，形态 token 偏多(红)', () => {
    const k = mkKlines(40, {
      close: i => (i < 20 ? 100 : 70),
      overrides: {
        20: { open: 100, close: 99, high: 121, low: 79 },
        39: { open: 70, close: 70, high: 71, low: 69, volume: 100_000 },
      },
    });
    const pats = analyzeKlinePatterns(k, fmt);
    const combo = analyzeKlineCombo(k, pats).find(c => c.type === 'doji');
    expect(combo).toBeDefined();
    expect(combo!.reference).toContain('抛压衰竭');
    expect(combo!.tokens[2].cls).toBe('text-red-500');
  });
});

describe('analyzeKlineCombo（组合词条 位置·量能·形态 + 参考价值）', () => {
  it('无命中形态 → 空数组', () => {
    expect(analyzeKlineCombo([], [])).toEqual([]);
  });

  it('低位+缩量+十字星 → 组合词条：低位/缩量/十字星 三 token，颜色按多空', () => {
    // 末根十字星、贴近近20日低点、量大幅萎缩 → 低位·缩量·十字星（偏多/红）
    const k = mkKlines(40, {
      close: i => (i < 20 ? 100 : 70),
      overrides: {
        20: { open: 100, close: 99, high: 121, low: 79 }, // 高点钉：拉高 high20，让末根 70 贴近低点
        39: { open: 70, close: 70, high: 71, low: 69, volume: 100_000 },
      },
    });
    const pats = analyzeKlinePatterns(k, fmt);
    expect(pats).toHaveLength(1);
    expect(pats[0].color).toBe('red'); // 十字星 color 由位置×量能动态决定
    const combos = analyzeKlineCombo(k, pats);
    expect(combos).toHaveLength(1);
    const c = combos[0];
    expect(c.tokens.map(t => t.text)).toEqual(['低位', '缩量', '十字星']);
    expect(c.tokens[0].cls).toBe('text-red-500');   // 低位（看多）
    expect(c.tokens[1].cls).toBe('text-brand-green'); // 缩量（看空）
    expect(c.tokens[2].cls).toBe('text-red-500');   // 形态偏多
    expect(c.reference.length).toBeGreaterThan(0);
  });

  it('高位+放量+十字星 → 组合词条颜色偏空（绿色形态）', () => {
    const k = mkKlines(40, {
      close: i => (i < 20 ? 100 : 130),
      overrides: { 39: { open: 130, close: 130, high: 131, low: 129, volume: 2_000_000 } },
    });
    const pats = analyzeKlinePatterns(k, fmt);
    expect(pats).toHaveLength(1);
    expect(pats[0].color).toBe('green');
    const combos = analyzeKlineCombo(k, pats);
    expect(combos[0].tokens.map(t => t.text)).toEqual(['高位', '放量', '十字星']);
    expect(combos[0].tokens[2].cls).toBe('text-brand-green');
  });

  it('未预定义的组合 → 回落形态基础参考价值兜底', () => {
    // 中位+平量+金针探底组合没有预定义映射，应回落 PATTERN_BASE_REFERENCE（金针偏看多）
    const k = mkKlines(150, { overrides: { 149: { open: 98.8, close: 99, high: 99, low: 96 } } });
    const pats = analyzeKlinePatterns(k, fmt);
    const hammer = pats.find(p => p.type === 'hammer');
    expect(hammer).toBeTruthy();
    const combo = analyzeKlineCombo(k, pats).map(c => c.reference).join(' ');
    expect(combo).toContain('金针探底');
  });
});

describe('analyzeMarketConditions（破位与观察）', () => {
  it('3天不回 → 真破位，窗口含破位日/次日/再日', () => {
    const evs = analyzeMarketConditions(kTrueBreak);
    expect(evs).toHaveLength(1);
    const ev = evs[0];
    expect(ev.status).toBe('trueBreak');
    expect(ev.date).toBe(date(80));
    expect(ev.brokenCount).toBeGreaterThan(0);
    expect(ev.ref.period).toBeGreaterThan(0);
    expect(ev.window.map(w => w.date)).toEqual([date(80), date(81), date(82)]);
  });

  it('次日收回 → 假破位并记录 returnDay', () => {
    const evs = analyzeMarketConditions(kFalseBreak);
    expect(evs).toHaveLength(1);
    const ev = evs[0];
    expect(ev.status).toBe('falseBreak');
    expect(ev.returnDay?.date).toBe(date(81));
  });

  it('窗口不足3天 → 修复观察（confirming）', () => {
    const evs = analyzeMarketConditions(kConfirming);
    expect(evs).toHaveLength(1);
    expect(evs[0].status).toBe('confirming');
    expect(evs[0].window).toHaveLength(1);
  });
});

describe('analyzeEnvironment（趋势结构 / 布林波动）', () => {
  it('单边上行 → 趋势"多头强排列"（单字"多"）', () => {
    const k = mkKlines(140, { close: i => 10 + i * 0.2 });
    const env = analyzeEnvironment(k, fmt);
    expect(env).not.toBeNull();
    const trend = env!.tags.find(t => t.dim === 'trend');
    expect(trend).toBeDefined();
    expect(trend!.single).toBe('多');
    expect(trend!.label).toBe('多头强排列');
  });

  it('详情展开（selectEnvDisplayTags）保留 trend + volatility + position（周期/量价排除在环境区外）', () => {
    // 单边上行：cycle 必然生成，volume 受量能驱动、position 也生成；周期/量价被过滤，位置保留
    const k = mkKlines(140, { close: i => 10 + i * 0.2 });
    const env = analyzeEnvironment(k, fmt);
    expect(env).not.toBeNull();
    expect(env!.tags.some(t => t.dim === 'cycle')).toBe(true);
    expect(env!.tags.some(t => t.dim === 'position')).toBe(true);
    const sel = selectEnvDisplayTags(env!.tags);
    expect(sel.length).toBeGreaterThan(0);
    for (const t of sel) {
      expect(['trend', 'volatility', 'position']).toContain(t.dim);
    }
    // 位置作为环境前提，进入环境区展示；周期/量价不进入
    expect(sel.some(t => t.dim === 'position')).toBe(true);
    expect(sel.some(t => t.dim === 'cycle')).toBe(false);
    expect(sel.some(t => t.dim === 'volume')).toBe(false);
    // 弹窗"环境"区展示 label（详细展示依据）
    const trend = sel.find(t => t.dim === 'trend');
    expect(trend).toBeDefined();
    expect(trend!.detail.length).toBeGreaterThan(0);
  });

  it('横盘后连续跳水贴下轨 → 布林"下轨扩张"（单字"扩"，绿/看空，dim=volatility）', () => {
    // 前段横盘(flat100)压低布林带宽，末尾 25 根跳水加大波动并使收盘贴上轨下方的下轨
    const k = mkKlines(140, { close: i => (i <= 114 ? 100 : 100 - (i - 114) * 2.9) });
    const env = analyzeEnvironment(k, fmt);
    expect(env).not.toBeNull();
    const vol = env!.tags.find(t => t.dim === 'volatility');
    expect(vol).toBeDefined();
    expect(vol!.key).toBe('vol-down');
    expect(vol!.single).toBe('扩');
    expect(vol!.color).toBe('green');
    // 展示维度必须保留它（selectEnvDisplayTags 不过滤 volatility）
    const sel = selectEnvDisplayTags(env!.tags);
    expect(sel.some(t => t.dim === 'volatility' && t.key === 'vol-down')).toBe(true);
  });
});

describe('selectEnvDisplayTags（环境维度过滤）', () => {
  it('输入含 cycle/volume/trend/volatility → 仅返回 trend+volatility', () => {
    const tags: EnvTag[] = [
      { key: 'cycle', label: '震荡变盘期', single: '震', color: 'slate', score: 0, dim: 'cycle', detail: [] },
      { key: 'vol-up-up', label: '量增价升', single: '增', color: 'red', score: 1, dim: 'volume', detail: [] },
      { key: 'trend-strong-up', label: '多头强排列', single: '多', color: 'red', score: 1, dim: 'trend', detail: [] },
      { key: 'vol-up', label: '上轨扩张', single: '扩', color: 'red', score: 1, dim: 'volatility', detail: [] },
    ];
    const sel = selectEnvDisplayTags(tags);
    expect(sel.map(t => t.key)).toEqual(['trend-strong-up', 'vol-up']);
  });
});

describe('buildLatestDayTags（列表页缩略展示）', () => {
  it('K线形态单字进入缩略展示（十字星"十"）', () => {
    const k = mkKlines(140, {
      overrides: { 139: { open: 100, close: 100, high: 105, low: 95 } },
    });
    const tags = buildLatestDayTags(k, fmt);
    const texts = tags.map(t => t.text);
    expect(texts).toContain('十');
  });

  it('综合周期单字（攻/防/弹/筑/震）绝不进入缩略展示', () => {
    // 任意 ≥130 根序列：analyzeEnvironment 必要会产出 cycle，读依赖 selectEnvDisplayTags 剔除
    const k = mkKlines(140, { close: i => 10 + i * 0.2 });
    const tags = buildLatestDayTags(k, fmt);
    const texts = tags.map(t => t.text);
    for (const s of CYCLE_SINGLES) expect(texts).not.toContain(s);
  });

  it('真破位事件 → 缩略单字"真"', () => {
    const tags = buildLatestDayTags(kTrueBreak, fmt);
    expect(tags.map(t => t.text)).toContain('真');
  });

  it('破位/形态标签带底色 CLS', () => {
    const tags = buildLatestDayTags(kTrueBreak, fmt);
    const want = tags.find(t => t.text === '真');
    expect(want).toBeDefined();
    expect(want!.cls).toContain('bg-');
    expect(want!.cls).toContain('text-');
  });
});

describe('buildLatestShrinkTags（判定结果 → 缩略单字，纯映射不再重复判定）', () => {
  // 与弹窗共用的判定结果：对同一组 K 线只算一次 events/patterns/env，再喂给本函数生成缩略。
  const k = mkKlines(140, {
    overrides: { 139: { open: 100, close: 100, high: 105, low: 95 } },
  });
  const events = analyzeMarketConditions(k, 10);
  const patterns = analyzeKlinePatterns(k, fmt);
  const env = analyzeEnvironment(k, fmt);
  const lastDate = k[k.length - 1].date;

  it('喂入的判定结果直接决定缩略单字（十字星"十" + 环境单字）', () => {
    const texts = buildLatestShrinkTags(events, patterns, env, lastDate, null, null).map(t => t.text);
    expect(texts).toContain('十');
  });

  it('不会在内部重新判定：篡改传入的 events 即反映为对应单字', () => {
    // 传 null → 破位/形态/环境单字全部消失，绝不可能因"内部重新判定"又变出来
    const texts = buildLatestShrinkTags(null, null, null, lastDate, null, null).map(t => t.text);
    expect(texts).toHaveLength(0);
  });

  it('综合周期单字绝不进入缩略（依赖 selectEnvDisplayTags 已在其套餐过滤）', () => {
    const texts = buildLatestShrinkTags(events, patterns, env, lastDate, null, null).map(t => t.text);
    for (const s of CYCLE_SINGLES) expect(texts).not.toContain(s);
  });

  it('传入价格态 → 缩略单字含对应态单字（企稳="稳"）', () => {
    const ps: PriceStateTag = { date: lastDate, kind: 'stable', name: '企稳', single: '稳', color: 'red', detail: ['x'], reference: 'r' };
    const texts = buildLatestShrinkTags(events, patterns, env, lastDate, ps, null).map(t => t.text);
    expect(texts).toContain('稳');
  });

  it('传入底部确认（single="底"）→ 缩略单字"底"，颜色红（偏多强化态）', () => {
    const ps: PriceStateTag = { date: lastDate, kind: 'bottom-confirm', name: '底部确认', single: '底', color: 'red', detail: ['x'], reference: 'r' };
    const tags = buildLatestShrinkTags(events, patterns, env, lastDate, ps, null);
    const t = tags.find(x => x.key === 'ps-bottom-confirm');
    expect(t?.text).toBe('底');
    expect(t?.cls).toBe('bg-red-500/10 text-red-500 border-red-500/20'); // 红=偏多强化态
  });
});

describe('latestBarFingerprint / 列表缩略缓存时效性（回归：今日live bar 原地更新致缓存过期）', () => {
  it('指纹随末根 bar 内容变化而变（同数组原地修改 close）', () => {
    const k = mkKlines(140, {
      overrides: { 139: { open: 100, close: 100, high: 105, low: 95 } },
    });
    expect(latestBarFingerprint(k)).not.toBe('');
    const fp1 = latestBarFingerprint(k);
    // 盘中实时报价原地改 close（数组引用未变）
    k[139].close = 101;
    expect(latestBarFingerprint(k)).not.toBe(fp1);
  });

  it('盘中价格刷新前是十字星、刷新后不再是——缩略标签必须随之刷新（否则与弹窗不一致）', () => {
    const k = mkKlines(140, {
      overrides: { 139: { open: 100, close: 100, high: 105, low: 95 } },
    });
    // 第一次算：末根为十字星 → 缩略含"十"
    const before = buildLatestDayTags(k, fmt);
    expect(before.map(t => t.text)).toContain('十');
    // 原地更新末根 close（断言是十字星的形态已消失）→ 指纹变化，重新计算后缩略不得再含"十"
    k[139].close = 101;
    const after = buildLatestDayTags(k, fmt);
    expect(after.map(t => t.text)).not.toContain('十');
  });
});

describe('buildBreakExplainLines（破位判断依据）', () => {
  it('事件点击 → "当日下穿 N 条均线"详情', () => {
    const ev = analyzeMarketConditions(kTrueBreak)[0];
    const lines = buildBreakExplainLines(ev, 'event', fmt, fmtDay, fmtShort);
    expect(lines[0]).toContain('收盘');
    expect(lines[1]).toContain('当日下穿');
    expect(lines[1]).toContain('均线');
  });

  it('真破位 → "→ 真破位"', () => {
    const ev = analyzeMarketConditions(kTrueBreak)[0];
    const lines = buildBreakExplainLines(ev, 'status', fmt, fmtDay, fmtShort);
    expect(lines.join('\n')).toContain('→ 真破位');
    expect(lines[0]).toContain('收盘');
  });

  it('假破位 → "→ 假破位"', () => {
    const ev = analyzeMarketConditions(kFalseBreak)[0];
    const lines = buildBreakExplainLines(ev, 'status', fmt, fmtDay, fmtShort);
    expect(lines.join('\n')).toContain('→ 假破位');
  });

  it('修复观察 → 含"修复观察"', () => {
    const ev = analyzeMarketConditions(kConfirming)[0];
    const lines = buildBreakExplainLines(ev, 'repair', fmt, fmtDay, fmtShort);
    expect(lines.join('\n')).toContain('修复观察');
  });
});

describe('classifyPriceState（价格态原子：反弹/企稳/回踩，3互斥+无态，按强度优先）', () => {
  // 价格态只读 close/MA 结构，量能是独立原子；此处仅用 close 数组驱动
  const byCloses = (closes: number[], volAt?: [number, number]) => {
    const n = closes.length;
    const k = mkKlines(n, { close: i => closes[i] });
    if (volAt) k[volAt[0]] = { ...k[volAt[0]], volume: volAt[1] };
    return k;
  };
  const UP100 = Array.from({ length: 40 }, () => 100);

  it('反弹：收>MA10 且 ≥昨收 → 单字"反"、红（偏多）', () => {
    const closes = [...UP100]; closes[39] = 108;
    const tag = classifyPriceState(byCloses(closes), fmt);
    expect(tag?.kind).toBe('bounce');
    expect(tag?.name).toBe('反弹');
    expect(tag?.single).toBe('反');
    expect(tag?.color).toBe('red');
    expect(tag!.detail.length).toBeGreaterThan(0);
    expect(tag!.reference.length).toBeGreaterThan(0);
  });

  it('企稳：低点不创新低+收≥昨收+收≥MA5，且前段有下跌背景 → 单字"稳"、红', () => {
    // 冲高(110)后回落(96)再企稳横盘，C=98 介于 MA5(97) 与 MA10(101.9) 之间
    const closes = [
      100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,
      102,104,106,108,110,108,105,102,99,96,96.5,97,97.5,98,
    ];
    const tag = classifyPriceState(byCloses(closes), fmt);
    expect(tag?.kind).toBe('stable');
    expect(tag?.name).toBe('企稳');
    expect(tag?.single).toBe('稳');
    expect(tag?.color).toBe('red');
    expect(tag!.detail.some(d => d.includes('下跌背景'))).toBe(true);
  });

  it('回踩：收<MA5 → 单字"回"、绿（偏空）；低点未抬高 → 弱势回踩 sub="weak"', () => {
    const closes = [...UP100]; closes[39] = 95;
    const tag = classifyPriceState(byCloses(closes), fmt);
    expect(tag?.kind).toBe('pullback');
    expect(tag?.name).toBe('回踩');
    expect(tag?.single).toBe('回');
    expect(tag?.color).toBe('green');
    expect(tag?.sub).toBe('weak'); // 末根低点 94.9 ≤ 昨低 99.9 → 弱势
    expect(tag!.detail.some(d => d.includes('弱势回踩'))).toBe(true);
  });

  it('回踩健康分档：收<MA5 但低点抬高（L>昨低）→ sub="health"，detail 强调低点抬高/正常回踩', () => {
    // 前日先跌到 95（低点 94.9），当日 97（低点 96.9 > 94.9）；MA5≈98.4 > C=97 → 回踩健康档
    const closes = [...UP100]; closes[38] = 95; closes[39] = 97;
    const tag = classifyPriceState(byCloses(closes), fmt);
    expect(tag?.kind).toBe('pullback');
    expect(tag?.sub).toBe('health');
    expect(tag?.color).toBe('green');
    expect(tag!.detail.some(d => d.includes('健康回踩'))).toBe(true);
    expect(tag!.detail.some(d => d.includes('正常回踩'))).toBe(true);
  });

  it('企稳在站上MA10时不再触发（互斥）：同下跌背景但 C>MA10 → 反弹而非企稳', () => {
    // 与企稳用例同款冲高回落走势，仅末根收 103 > MA10(≈102.4) → 归反弹
    const closes = [
      100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,
      102,104,106,108,110,108,105,102,99,96,96.5,97,97.5,103,
    ];
    const tag = classifyPriceState(byCloses(closes), fmt);
    expect(tag?.kind).toBe('bounce');
    expect(tag?.name).toBe('反弹');
  });

  it('反弹/企稳互斥边界：C 介于 MA5 与 MA10 之间 → 企稳；同一走势 C 上破 MA10 → 反弹', () => {
    const base = [
      100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,
      102,104,106,108,110,108,105,102,99,96,96.5,97,97.5,
    ];
    expect(classifyPriceState(byCloses([...base, 98]), fmt)?.name).toBe('企稳');  // C=98 < MA10
    expect(classifyPriceState(byCloses([...base, 104]), fmt)?.name).toBe('反弹'); // C=104 > MA10
  });

  it('底部确认：放量+收复MA10+近3日低点至少2日抬高+MA5走平 → name"底部确认"、single"底"、红', () => {
    const closes = [...UP100];
    closes[36] = 96; closes[37] = 94; closes[38] = 95.5; closes[39] = 101; // 低点 95.9→93.9→95.4→100.9 连抬
    const k = byCloses(closes, [39, 2_000_000]); // ratio≈1.67 → 明显放量 → 放量
    const tag = classifyPriceState(k, fmt);
    expect(tag?.kind).toBe('bottom-confirm');
    expect(tag?.name).toBe('底部确认');
    expect(tag?.single).toBe('底');
    expect(tag?.color).toBe('red');
    expect(tag!.detail.some(d => d.includes('MA10'))).toBe(true);
    expect(tag!.detail.some(d => d.includes('低点连抬'))).toBe(true);
    expect(tag!.detail.some(d => d.includes('MA5'))).toBe(true);
    // 与回测/弹窗注册的组合信号同构
    const vol = classifyVolume(k);
    expect(volBucket(vol)).toBe('放量');
    expect(`${volBucket(vol)}${tag!.name}`).toBe('放量底部确认');
    expect(stabilizeComboReference(tag!.name!, vol)).toContain('可交易');
  });

  it('底部确认未命中：近3日低点不足2日抬高 → 回落为 反弹', () => {
    const closes = [...UP100];
    closes[36] = 97; closes[37] = 94; closes[38] = 93; closes[39] = 103; // L-2(93.9)≥L-3(96.9)? 否 → 低点未连抬
    const k = byCloses(closes, [39, 2_000_000]);
    const tag = classifyPriceState(k, fmt);
    expect(tag?.kind).toBe('bounce'); // C=103 > MA10(≈98.7)，但低点连抬不满足
    expect(tag?.name).toBe('反弹');
  });

  it('底部确认未命中：未放量（平量）→ 回落为 反弹', () => {
    const closes = [...UP100];
    closes[36] = 96; closes[37] = 94; closes[38] = 95.5; closes[39] = 101;
    const k = byCloses(closes); // 默认平量
    const tag = classifyPriceState(k, fmt);
    expect(tag?.kind).toBe('bounce');
    expect(tag?.name).toBe('反弹');
  });

  it('底部确认未命中：MA5 下行 → 回落为 反弹', () => {
    const closes = [...UP100];
    closes[36] = 96; closes[37] = 94; closes[38] = 97; closes[39] = 99; // MA5_39≈97.2 < MA5_38≈97.4
    const k = byCloses(closes, [39, 2_000_000]);
    const tag = classifyPriceState(k, fmt);
    expect(tag?.kind).toBe('bounce'); // 低点连抬与放量均满足，但 MA5 走低 → 不升级
    expect(tag?.name).toBe('反弹');
  });

  it('无态：平走且无下跌背景、价在均线附近 → null（普通日子不刷价态 chip）', () => {
    expect(classifyPriceState(byCloses(UP100), fmt)).toBeNull();
  });

  it('上涨趋势中不给企稳（前段下跌背景失效，不刷屏）：单调上行态为 反弹而非 企稳', () => {
    const k = byCloses(Array.from({ length: 40 }, (_, i) => i * 0.5));
    const tag = classifyPriceState(k, fmt);
    expect(tag?.kind).toEqual('bounce'); // hasDown=false，企稳永不触发，强度优先命中 反弹
    expect(tag?.kind).not.toBe('stable');
  });

  it('五粮液式放量企稳：企稳态 + 明显放量 → 产出组合信号"放量企稳"，参考价值为 中高', () => {
    const closes = [
      100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,
      102,104,106,108,110,108,105,102,99,96,96.5,97,97.5,98,
    ];
    const k = byCloses(closes, [39, 2_000_000]); // ratio≈1.67 → 明显放量 → 粗分 放量
    const ps = classifyPriceState(k, fmt);
    const vol = classifyVolume(k);
    expect(ps?.name).toBe('企稳');
    expect(vol).toBe('明显放量');
    expect(volBucket(vol)).toBe('放量');
    expect(`${volBucket(vol)}${ps!.name}`).toBe('放量企稳'); // 与回测/弹窗注册的组合信号同构
    expect(stabilizeComboReference(ps!.name!, vol)).toContain('资金进场');
  });

  it('按日期索引判定与最新日一致：classifyPriceState == classifyPriceStateAt(len-1)', () => {
    const closes = [...UP100]; closes[39] = 108;
    const k = byCloses(closes);
    expect(classifyPriceStateAt(k, k.length - 1, fmt)?.kind).toBe(classifyPriceState(k, fmt)?.kind);
  });
});

describe('STABILIZE_COMBO_REFERENCE（价格态×量能组合参考价值映射）', () => {
  it('企稳-缩量（温和/明显）→ 中·止跌观察非买点', () => {
    const ref = stabilizeComboReference('企稳', '温和缩量');
    expect(ref).toContain('止跌观察');
    expect(stabilizeComboReference('企稳', '明显缩量')).toBe(ref); // 粗分折叠，同一文案
  });
  it('反弹-放量 → 高·追势；弱势回踩-缩量 → 低·下跌中继', () => {
    expect(stabilizeComboReference('反弹', '明显放量')).toContain('追势信号');
    expect(stabilizeComboReference('回踩', '明显缩量', 'weak')).toContain('下跌中继');
  });
  it('回踩 sub 分档：健康/弱势 参考价值不同（同量能下健康更高、强调等企稳）', () => {
    const health = stabilizeComboReference('回踩', '明显缩量', 'health');
    const weak = stabilizeComboReference('回踩', '明显缩量', 'weak');
    expect(health).toContain('正常回踩');
    expect(weak).toContain('下跌中继');
    expect(health).not.toBe(weak);
  });
  it('底部确认-放量 → 高·可交易确认信号（最高价值组合）', () => {
    const ref = stabilizeComboReference('底部确认', '明显放量');
    expect(ref).toContain('可交易');
    expect(ref).toContain('底部结构确认');
  });
});