// 腾讯实时行情 (qt.gtimg.cn) 的批量解析纯函数。
// 与网络/请求日志解耦，便于单元测试：输入原始响应文本，输出结构化行情。

export interface TencentQuote {
  code: string; // 形如 sz000001 / sh600000
  name: string;
  price: number;
  changePercent: number;
  high: number;
  low: number;
  open: number;
  volume: number;
}

/**
 * 把单个代码（完整形式，如 "600000.SH" / "000001.SZ"，
 * 或裸数字 "600000"）规整为腾讯接口使用的代码前缀 + 数字。
 * 规则与原逐只请求实现保持一致。
 */
export function toTencentCode(stockCode: string): string {
  let market = 'sh';
  let code = stockCode.trim();
  if (code.endsWith('.SZ')) {
    market = 'sz';
    code = code.replace('.SZ', '');
  } else if (code.endsWith('.SH')) {
    code = code.replace('.SH', '');
  } else {
    const n = parseInt(code, 10);
    if (isNaN(n)) {
      market = 'sh';
    } else if (n >= 600000 && n <= 699999) {
      market = 'sh'; // 沪主板 / 科创板（688/689）
    } else {
      market = 'sz'; // 深主板 / 中小板 / 创业板 / 北交所
    }
  }
  return `${market}${code}`;
}

/**
 * 解析腾讯行情响应中的一行：v_sz000001="...".
 * 失败（无法匹配或字段不足）返回 null。
 */
export function parseTencentQuoteLine(line: string): TencentQuote | null {
  const match = line.match(/v_(s[hz]\d+)="([^"]*)"/);
  if (!match || !match[2]) return null;
  const data = match[2].split('~');
  if (data.length < 11) return null;
  const price = parseFloat(data[3]);
  const prevClose = parseFloat(data[4]);
  const open = parseFloat(data[5]);
  const volume = parseFloat(data[6]);
  const high = parseFloat(data[33]);
  const low = parseFloat(data[34]);
  let changePercent = 0;
  if (prevClose > 0) {
    changePercent = ((price - prevClose) / prevClose) * 100;
  }
  return {
    code: match[1],
    name: data[1].replace(/\s/g, ''),
    price,
    changePercent,
    high: high || price,
    low: low || price,
    open: open || price,
    volume: volume || 0,
  };
}

/**
 * 解析整段批量响应，按 code 建立映射。无法解析的行被忽略。
 */
export function parseTencentQuoteText(text: string): Map<string, TencentQuote> {
  const map = new Map<string, TencentQuote>();
  for (const line of text.split('\n')) {
    const quote = parseTencentQuoteLine(line);
    if (quote && !map.has(quote.code)) map.set(quote.code, quote);
  }
  return map;
}