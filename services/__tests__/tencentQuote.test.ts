import { describe, it, expect } from 'vitest';
import { toTencentCode, parseTencentQuoteLine, parseTencentQuoteText } from '../tencentQuote';

/**
 * 构造一条接近腾讯真实字段位序的行情行：
 * [1]名称 [2]代码 [3]现价 [4]昨收 [5]今开 [6]成交量 .. [33]最高 [34]最低
 */
function mkLine(code: string, price: number, prevClose: number, highOverride?: number, lowOverride?: number): string {
  const f: string[] = new Array(40).fill('');
  f[0] = '1';
  f[1] = '测试股';
  f[2] = code;
  f[3] = String(price);
  f[4] = String(prevClose);
  f[5] = String(price);
  f[6] = '234500';
  f[7] = String(prevClose);
  f[33] = String(highOverride ?? price);
  f[34] = String(lowOverride ?? price);
  return `v_${code}="${f.join('~')}";`;
}

describe('toTencentCode 代码规整', () => {
  it('沪市完整代码 → sh 前缀', () => {
    expect(toTencentCode('600000.SH')).toBe('sh600000');
  });
  it('深市完整代码 → sz 前缀', () => {
    expect(toTencentCode('000001.SZ')).toBe('sz000001');
  });
  it('裸沪市代码 → sh 前缀', () => {
    expect(toTencentCode('600519')).toBe('sh600519');
  });
  it('裸沪市科创板代码 → sh 前缀', () => {
    expect(toTencentCode('688018')).toBe('sh688018');
  });
  it('裸深市代码（主板/创业板）→ sz 前缀', () => {
    expect(toTencentCode('000858')).toBe('sz000858');
    expect(toTencentCode('300750')).toBe('sz300750');
  });
  it('裸深市中小板代码 → sz 前缀', () => {
    expect(toTencentCode('002415')).toBe('sz002415');
  });
});

describe('parseTencentQuoteLine 单行动态解析', () => {
  it('解析完整行：名称、现价、涨跌幅、开/高/低/量', () => {
    const line = mkLine('sz000858', 169.5, 168.0, 171.2, 167.1);
    const q = parseTencentQuoteLine(line);
    expect(q).not.toBeNull();
    expect(q!.code).toBe('sz000858');
    expect(q!.name).toBe('测试股');
    expect(q!.price).toBe(169.5);
    expect(q!.open).toBe(169.5);
    expect(q!.high).toBeCloseTo(171.2, 2);
    expect(q!.low).toBeCloseTo(167.1, 2);
    // 昨收 168.0 → 现价 169.5 → 涨幅 0.892857...%
    expect(q!.changePercent).toBeCloseTo(0.892857, 5);
  });

  it('无法匹配（缺行情行）→ null', () => {
    expect(parseTencentQuoteLine('hello')).toBeNull();
    expect(parseTencentQuoteLine('')).toBeNull();
  });
});

describe('parseTencentQuoteText 批量响应切分', () => {
  it('多行 → 按 code 分别映射', () => {
    const text = [
      mkLine('sz000858', 169.5, 168.0),
      mkLine('sh601318', 52.3, 52.0),
      'noise',
      mkLine('sz300750', 200.1, 199.0),
    ].join('\n');
    const map = parseTencentQuoteText(text);
    expect(map.size).toBe(3);
    expect(map.get('sz000858')!.price).toBe(169.5);
    expect(map.get('sh601318')!.price).toBe(52.3);
    expect(map.get('sz300750')!.price).toBe(200.1);
    expect(map.has('noise')).toBe(false);
  });

  it('同码重复行 → 仅保留首个', () => {
    const text = [mkLine('sz000001', 10, 9), mkLine('sz000001', 11, 9)].join('\n');
    const map = parseTencentQuoteText(text);
    expect(map.size).toBe(1);
    expect(map.get('sz000001')!.price).toBe(10);
  });

  it('空响应 → 空映射', () => {
    expect(parseTencentQuoteText('').size).toBe(0);
  });
});