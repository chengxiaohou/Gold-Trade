/**
 * 伦敦金（现货黄金）行情
 * 数据源：腾讯行情 hf_XAU（美元/盎司），与项目现有汇率接口同源，且允许跨域直连。
 */
const LONDON_GOLD_URL = 'https://qt.gtimg.cn/q=hf_XAU';
const TIMEOUT_MS = 10000;

/** 拉取最新伦敦金现货价格（美元/盎司） */
export async function fetchLondonGoldUsdPerOz(): Promise<number> {
  const response = await fetch(LONDON_GOLD_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`行情接口返回 ${response.status}`);

  const buffer = await response.arrayBuffer();
  const text = new TextDecoder('gb18030').decode(buffer);
  const match = text.match(/v_hf_XAU="([^"]+)"/);
  // 字段 0 为最新价
  const price = match && match[1] ? parseFloat(match[1].split(',')[0]) : 0;

  if (!(price > 0)) throw new Error('伦敦金价解析失败');
  return price;
}
