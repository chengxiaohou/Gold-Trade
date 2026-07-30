import { ApiSource } from '../types';
import { getDynamicCacheTTL, setLastFetchTime } from './cacheService';

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
  unsupported?: boolean; // 数据源不支持该周期
}

// 请求频率限制已移至 fetchAllBoll，此处仅保留缓存相关逻辑
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

interface TencentKlineItem {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

function parseTencentKlineData(data: any, code: string, period: BollPeriod, adjust: BollAdjust): TencentKlineItem[] | null {
  if (!data || !data[code]) return null;

  const periodMap: Record<BollPeriod, string> = {
    daily: 'day',
    weekly: 'week',
    monthly: 'month'
  };

  const adjustMap: Record<BollAdjust, string> = {
    qfq: 'qfq',
    none: ''
  };

  const periodKey = periodMap[period];
  const adjustKey = adjustMap[adjust];

  // 腾讯K线数据在 data.{code}.{adjust}{period} 字段
  // 例如: data.sh601318.qfqday 或 data.sh601318.day
  let dataKey = adjustKey ? `${adjustKey}${periodKey}` : periodKey;
  
  const rawData = data[code][dataKey];
  
  if (!rawData || !Array.isArray(rawData)) return null;

  return rawData.map((item: any[]) => ({
    date: item[0],
    open: parseFloat(item[1]),
    close: parseFloat(item[2]),
    high: parseFloat(item[3]),
    low: parseFloat(item[4]),
    volume: parseFloat(item[5])
  }));
}

function getTencentRealtimePrice(data: any, code: string): number | null {
  if (!data || !data[code] || !data[code].qt) return null;
  
  const qt = data[code].qt[code];
  if (!qt || !Array.isArray(qt)) return null;
  
  // 腾讯实时行情格式: v_sh601318=["1","中国平安","601318","54.33",...]
  // 第4个字段(index 3)是当前价格
  const price = parseFloat(qt[3]);
  return price > 0 ? price : null;
}

// 新浪支持的周期
const SINA_SUPPORTED: Record<BollPeriod, boolean> = {
  daily: true,
  weekly: true,
  monthly: true
};

// 新浪仅支持前复权
const SINA_SUPPORTED_ADJUST: Record<BollAdjust, boolean> = {
  qfq: true,
  none: false  // 新浪不支持不复权
};

export async function fetchBollData(
  stockCode: string,
  period: BollPeriod = 'daily',
  adjust: BollAdjust = 'qfq',
  apiSource: ApiSource = 'tencent'
): Promise<BollResult> {
  const { market, code } = getMarketPrefix(stockCode);
  const fullCode = `${market}${code}`;
  
  const cacheKey = getCacheKey(fullCode, period, adjust, apiSource);
  const cached = cache.get(cacheKey);
  const dynamicTTL = getDynamicCacheTTL();
  
  if (cached && Date.now() - cached.timestamp < dynamicTTL) {
    return { data: cached.data };
  }

  // 检查数据源是否支持该周期/复权模式
  if (apiSource === 'sina') {
    if (!SINA_SUPPORTED[period]) {
      return { data: null, error: '新浪不支持该周期数据', unsupported: true };
    }
    if (!SINA_SUPPORTED_ADJUST[adjust]) {
      return { data: null, error: '新浪不支持不复权数据，请切换到腾讯数据源', unsupported: true };
    }
  }

  try {
    if (apiSource === 'tencent') {
      return fetchBollFromTencent(fullCode, period, adjust);
    } else {
      return fetchBollFromSina(market, code, period, adjust, apiSource);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { data: null, error: `获取失败: ${msg}` };
  }
}

async function fetchBollFromTencent(
  code: string,
  period: BollPeriod,
  adjust: BollAdjust
): Promise<BollResult> {
  const periodMap: Record<BollPeriod, string> = {
    daily: 'day',
    weekly: 'week',
    monthly: 'month'
  };

  const adjustMap: Record<BollAdjust, string> = {
    qfq: 'qfq',
    none: 'none'
  };

  const periodParam = periodMap[period];
  const adjustParam = adjustMap[adjust];
  const count = 80;

  const url = `/api/tencent/appstock/app/fqkline/get?param=${code},${periodParam},,,${count},${adjustParam}`;

  const response = await fetch(url);
  if (!response.ok) {
    return { data: null, error: `腾讯接口请求失败 (${response.status})` };
  }

  const result = await response.json();
  
  if (!result || !result.data || !result.data[code]) {
    return { data: null, error: '腾讯接口无数据' };
  }

  const klines = parseTencentKlineData(result.data, code, period, adjust);
  
  if (!klines || klines.length < 20) {
    return { data: null, error: `K线数据不足 (${klines?.length || 0}/20)` };
  }

  // 腾讯接口内嵌实时行情，不复权模式下直接使用
  const realtimePrice = adjust === 'none' ? getTencentRealtimePrice(result.data, code) : null;

  const closes: number[] = [];
  for (let i = klines.length - 20; i < klines.length; i++) {
    let close = klines[i].close;
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
  const close = adjust === 'none' && realtimePrice ? realtimePrice : last.close;
  const date = last.date;
  const fetchedAt = Date.now();

  const result_data: BollData = {
    upper: Math.round(upper * 100) / 100,
    mid: Math.round(mid * 100) / 100,
    lower: Math.round(lower * 100) / 100,
    close: Math.round(close * 100) / 100,
    date,
    fetchedAt,
  };

  const cacheKey = getCacheKey(code, period, adjust, 'tencent');
  cache.set(cacheKey, { data: result_data, timestamp: fetchedAt });

  // 记录腾讯数据源的拉取时间
  setLastFetchTime('tencent', fetchedAt);

  return { data: result_data };
}

async function fetchBollFromSina(
  market: string,
  code: string,
  period: BollPeriod,
  adjust: BollAdjust,
  _apiSource: ApiSource
): Promise<BollResult> {
  const scale = getScaleParam(period);
  const fullCode = `${market}${code}`;

  const url = `/api/sina/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${fullCode}&scale=${scale}&ma=no&datalen=80`;

  const response = await fetch(url);
  if (!response.ok) {
    return { data: null, error: `新浪接口请求失败 (${response.status})` };
  }

  const klines: SinaKline[] = await response.json();
  
  if (!klines || !Array.isArray(klines)) {
    return { data: null, error: '新浪接口无K线数据' };
  }

  if (klines.length < 20) {
    return { data: null, error: `K线数据不足 (${klines.length}/20)` };
  }

  // 新浪只支持前复权，不需要请求实时价格
  const closes: number[] = [];
  for (let i = klines.length - 20; i < klines.length; i++) {
    closes.push(parseFloat(klines[i].close));
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
  const close = parseFloat(last.close);
  const date = last.day;
  const fetchedAt = Date.now();

  const result_data: BollData = {
    upper: Math.round(upper * 100) / 100,
    mid: Math.round(mid * 100) / 100,
    lower: Math.round(lower * 100) / 100,
    close: Math.round(close * 100) / 100,
    date,
    fetchedAt,
  };

  const cacheKey = getCacheKey(fullCode, period, adjust, 'sina');
  cache.set(cacheKey, { data: result_data, timestamp: fetchedAt });

  // 记录新浪数据源的拉取时间
  setLastFetchTime('sina', fetchedAt);

  return { data: result_data };
}

// 清除所有BOLL缓存数据
export function clearAllCache(): void {
  cache.clear();
}
