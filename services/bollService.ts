import { ApiSource } from '../types';

export type BollPeriod = 'daily' | 'weekly' | 'monthly';
export type BollAdjust = 'qfq' | 'none';

export interface BollData {
  upper: number;
  mid: number;
  lower: number;
  close: number;
  date: string;
  fetchedAt: number;
}

export interface BollResult {
  data: BollData | null;
  error?: string;
}

const CACHE_TTL = 4 * 60 * 60 * 1000;

const cache = new Map<string, { data: BollData; timestamp: number }>();

function getCacheKey(stockCode: string, period: BollPeriod, adjust: BollAdjust, apiSource: ApiSource): string {
  return `${stockCode}_${period}_${adjust}_${apiSource}`;
}

function getMarketPrefix(stockCode: string): { market: string; code: string } {
  let market = 'sz';
  let code = stockCode;

  if (code.endsWith('.SZ')) {
    code = code.replace('.SZ', '');
  } else if (code.endsWith('.SH')) {
    market = 'sh';
    code = code.replace('.SH', '');
  } else {
    const num = parseInt(code);
    if (num >= 600000 || num >= 688000) {
      market = 'sh';
    }
  }

  return { market, code };
}

function getScaleParam(period: BollPeriod): number {
  switch (period) {
    case 'daily': return 240;
    case 'weekly': return 1200;
    case 'monthly': return 7200;
  }
}

interface SinaKline {
  day: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

async function fetchSinaRealtimePrice(market: string, code: string): Promise<number | null> {
  try {
    const url = `/api/sina-realtime/list=${market}${code}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    
    const text = await response.text();
    const match = text.match(/var hq_str_\w+="(.+)"/);
    if (!match) return null;
    
    const parts = match[1].split(',');
    if (parts.length < 4) return null;
    
    // 第4个字段是当前价格
    const price = parseFloat(parts[3]);
    return price > 0 ? price : null;
  } catch {
    return null;
  }
}

async function fetchTencentRealtimePrice(market: string, code: string): Promise<number | null> {
  try {
    const url = `/api/tencent-realtime/q=${market}${code}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    
    const text = await response.text();
    // 腾讯返回格式: v_sh601318="1~中国平安~601318~53.60~53.41~..."
    const match = text.match(/v_\w+="(.+)"/);
    if (!match) return null;
    
    const parts = match[1].split('~');
    if (parts.length < 4) return null;
    
    // 第4个字段(index 3)是当前价格
    const price = parseFloat(parts[3]);
    return price > 0 ? price : null;
  } catch {
    return null;
  }
}

async function fetchRealtimePrice(market: string, code: string, apiSource: ApiSource): Promise<number | null> {
  if (apiSource === 'tencent') {
    return fetchTencentRealtimePrice(market, code);
  }
  return fetchSinaRealtimePrice(market, code);
}

export async function fetchBollData(
  stockCode: string,
  period: BollPeriod = 'daily',
  adjust: BollAdjust = 'qfq',
  apiSource: ApiSource = 'sina'
): Promise<BollResult> {
  const cacheKey = getCacheKey(stockCode, period, adjust, apiSource);
  const cached = cache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return { data: cached.data };
  }

  try {
    const { market, code } = getMarketPrefix(stockCode);
    const scale = getScaleParam(period);

    const url = `/api/sina/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${market}${code}&scale=${scale}&ma=no&datalen=80`;

    const response = await fetch(url);
    if (!response.ok) {
      return { data: null, error: `网络请求失败 (${response.status})` };
    }

    const klines: SinaKline[] = await response.json();
    
    if (!klines || !Array.isArray(klines)) {
      return { data: null, error: '无K线数据' };
    }

    if (klines.length < 20) {
      return { data: null, error: `K线数据不足 (${klines.length}/20)` };
    }

    // 获取不复权的实时价格
    let realtimePrice: number | null = null;
    if (adjust === 'none' && period === 'daily') {
      realtimePrice = await fetchRealtimePrice(market, code, apiSource);
    }

    const closes: number[] = [];
    for (let i = klines.length - 20; i < klines.length; i++) {
      let close = parseFloat(klines[i].close);
      // 不复权模式下，用实时价格替换最后一天的收盘价
      if (adjust === 'none' && i === klines.length - 1 && realtimePrice) {
        close = realtimePrice;
      }
      closes.push(close);
    }

    if (closes.length < 20) {
      return { data: null, error: '收盘价数据不足' };
    }

    const sum = closes.reduce((a, b) => a + b, 0);
    const mid = sum / 20;

    const variance = closes.reduce((sum, val) => sum + Math.pow(val - mid, 2), 0) / 20;
    const std = Math.sqrt(variance);

    const upper = mid + 2 * std;
    const lower = mid - 2 * std;

    const last = klines[klines.length - 1];
    const close = adjust === 'none' && realtimePrice ? realtimePrice : parseFloat(last.close);
    const date = last.day;
    const fetchedAt = Date.now();

    const result: BollData = {
      upper: Math.round(upper * 100) / 100,
      mid: Math.round(mid * 100) / 100,
      lower: Math.round(lower * 100) / 100,
      close: Math.round(close * 100) / 100,
      date,
      fetchedAt,
    };

    cache.set(cacheKey, { data: result, timestamp: fetchedAt });

    return { data: result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { data: null, error: `获取失败: ${msg}` };
  }
}
