import { ApiSource } from '../types';
import { getDynamicCacheTTL, setLastFetchTime } from './cacheService';
import { requestLogService } from './requestLogService';

// 生产环境配置
const isDev = import.meta.env.DEV;
const PROD_CONFIG = {
  // Cloudflare Worker 代理（需部署 workers/cors-proxy.js，替换下方 URL）
  cfWorker: 'https://cors-proxy.gold-trade.workers.dev',
  // 备用 CORS 代理（CF Worker 不可用时回退）
  fallbackProxies: [
    'https://corsproxy.io/?url=',
    'https://api.allorigins.win/raw?url=',
  ],
  // 超时配置
  jsonpTimeout: 12000,
  proxyTimeout: 12000,
};

// JSONP 请求：通过 <script> 标签加载，不受 CORS 限制
function jsonpRequest<T>(url: string, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const cbName = `__jsonp_cb_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const script = document.createElement('script');
    let settled = false;

    const cleanup = () => {
      settled = true;
      delete (window as unknown as Record<string, unknown>)[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    };

    const timer = setTimeout(() => {
      if (!settled) { cleanup(); reject(new Error('JSONP 超时')); }
    }, timeoutMs);

    (window as unknown as Record<string, unknown>)[cbName] = (data: T) => {
      clearTimeout(timer);
      if (!settled) { cleanup(); resolve(data); }
    };

    script.onerror = () => {
      clearTimeout(timer);
      if (!settled) { cleanup(); reject(new Error('JSONP 请求失败')); }
    };

    const sep = url.includes('?') ? '&' : '?';
    script.src = `${url}${sep}callback=${cbName}`;
    document.head.appendChild(script);
  });
}

// 代理请求（单个代理）
async function singleProxyFetch<T>(proxyUrl: string, timeoutMs: number): Promise<T> {
  const response = await fetch(proxyUrl, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`代理返回 ${response.status}`);
  return response.json() as Promise<T>;
}

// 生产环境请求：JSONP + CF Worker 并行竞争，失败后回退到备用代理
async function prodFetchJson<T>(realUrl: string): Promise<{ data: T | null; error?: string }> {
  const { cfWorker, fallbackProxies, jsonpTimeout, proxyTimeout } = PROD_CONFIG;

  // 第一组：JSONP + CF Worker 并行（两条最快路径竞争）
  const primaryTasks: Promise<{ data: T | null; error?: string }>[] = [
    jsonpRequest<T>(realUrl, jsonpTimeout).then(data => ({ data })).catch(e => ({ data: null, error: e.message })),
    singleProxyFetch<T>(`${cfWorker}/?url=${encodeURIComponent(realUrl)}`, proxyTimeout)
      .then(data => ({ data })).catch(e => ({ data: null, error: e.message })),
  ];

  const firstSuccess = await raceFirstSuccess(primaryTasks);
  if (firstSuccess.data !== null) return firstSuccess;

  // 第二组：回退到备用代理链
  for (const proxyBase of fallbackProxies) {
    try {
      const url = `${proxyBase}${encodeURIComponent(realUrl)}`;
      const data = await singleProxyFetch<T>(url, proxyTimeout);
      return { data };
    } catch (e) {
      // 继续下一个代理
    }
  }

  return firstSuccess.data !== null
    ? firstSuccess
    : { data: null, error: '所有请求均失败' };
}

// 并行竞争：第一个成功（有 data）的结果返回
function raceFirstSuccess<T>(tasks: Promise<{ data: T | null; error?: string }>[]): Promise<{ data: T | null; error?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    let lastError = '';

    const finalize = (result: { data: T | null; error?: string }) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    for (const task of tasks) {
      task.then(result => {
        if (result.data !== null) finalize(result);
        else lastError = result.error || lastError;
      });
    }

    Promise.all(tasks).then(() => {
      if (!settled) finalize({ data: null, error: lastError || '所有请求均失败' });
    });
  });
}

// 生成用于日志显示的 URL（始终用 proxy 路径格式，便于阅读）
function logTencentUrl(path: string): string {
  return `/api/tencent${path}`;
}

function logSinaUrl(path: string): string {
  return `/api/sina${path}`;
}

export type BollPeriod = 'daily' | 'weekly' | 'monthly';
export type BollAdjust = 'qfq' | 'none';

export interface BollData {
  upper: number;
  mid: number;
  lower: number;
  close: number;
  date: string;
  fetchedAt: number;
  rangeCount: number;
  rangePriceHigh: number;
  rangePriceHighDate: string;
  rangePriceLow: number;
  rangePriceLowDate: string;
}

export interface BollResult {
  data: BollData | null;
  error?: string;
  unsupported?: boolean; // 数据源不支持该周期
}

// 请求频率限制已移至 fetchAllBoll，此处仅保留缓存相关逻辑
const cache = new Map<string, { data: BollData; timestamp: number }>();

const CACHE_STORAGE_KEY = 'boll_cache_v1';
const CACHE_EXPIRY_MS = 4 * 60 * 60 * 1000; // 4小时

// 从 LocalStorage 恢复缓存
function restoreCacheFromStorage(): void {
  try {
    const stored = localStorage.getItem(CACHE_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      const now = Date.now();
      
      // 只恢复未过期的缓存
      for (const [key, value] of Object.entries(parsed)) {
        const entry = value as { data: BollData; timestamp: number };
        if (now - entry.timestamp < CACHE_EXPIRY_MS) {
          cache.set(key, entry);
        }
      }
    }
  } catch (e) {
    console.warn('Failed to restore BOLL cache from localStorage:', e);
  }
}

// 保存缓存到 LocalStorage
function saveCacheToStorage(): void {
  try {
    const obj: Record<string, { data: BollData; timestamp: number }> = {};
    cache.forEach((value, key) => {
      obj[key] = value;
    });
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(obj));
  } catch (e) {
    console.warn('Failed to save BOLL cache to localStorage:', e);
  }
}

// 初始化时恢复缓存
restoreCacheFromStorage();

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

// 检查所有股票的缓存状态，返回缓存数据或null
export function checkAllBollCache(
  stocks: Array<{ id: string; code: string }>,
  adjust: BollAdjust,
  apiSource: ApiSource,
  dynamicTTL: number
): { allCached: boolean; cachedData: Map<string, { daily: BollData | null; weekly: BollData | null; monthly: BollData | null }> } {
  const cachedData = new Map<string, { daily: BollData | null; weekly: BollData | null; monthly: BollData | null }>();
  let allCached = true;
  
  for (const stock of stocks) {
    const { market, code } = getMarketPrefix(stock.code);
    const fullCode = `${market}${code}`;
    
    const periods: BollPeriod[] = ['daily', 'weekly', 'monthly'];
    const data: { daily: BollData | null; weekly: BollData | null; monthly: BollData | null } = {
      daily: null,
      weekly: null,
      monthly: null
    };
    
    for (const period of periods) {
      const cacheKey = getCacheKey(fullCode, period, adjust, apiSource);
      const cached = cache.get(cacheKey);
      
      if (cached && Date.now() - cached.timestamp < dynamicTTL) {
        data[period] = cached.data;
        // 记录缓存命中日志（配合 fetchAllBoll 开始时的 reset，只显示本次缓存命中）
        const url = apiSource === 'tencent'
          ? logTencentUrl(`/appstock/app/fqkline/get?param=${fullCode},${period}`)
          : logSinaUrl(`/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${fullCode}&scale=${period}`);
        requestLogService.cacheHit(url);
      } else {
        allCached = false;
      }
    }
    
    cachedData.set(stock.id, data);
  }
  
  return { allCached, cachedData };
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

// 腾讯 K线接口响应类型
interface TencentKlineResponse {
  data: Record<string, unknown>;
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
    // 缓存命中，记录日志
    const url = apiSource === 'tencent'
      ? logTencentUrl(`/appstock/app/fqkline/get?param=${fullCode},${period}`)
      : logSinaUrl(`/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${fullCode}&scale=${period}`);
    requestLogService.cacheHit(url);
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

  const urlPath = `/appstock/app/fqkline/get?param=${code},${periodParam},,,${count},${adjustParam}`;
  const realUrl = `https://web.ifzq.gtimg.cn${urlPath}`;
  const devUrl = `/api/tencent${urlPath}`;
  const logUrl = logTencentUrl(urlPath);

  // 开始请求，记录日志
  const requestId = requestLogService.startRequest(logUrl);

  try {
    let result: TencentKlineResponse | null = null;

    if (isDev) {
      const response = await fetch(devUrl);
      if (!response.ok) {
        requestLogService.failed(requestId, `腾讯接口请求失败 (${response.status})`);
        return { data: null, error: `腾讯接口请求失败 (${response.status})` };
      }
      result = await response.json();
    } else {
      // 腾讯接口支持 CORS（access-control-allow-origin: *），可直接 fetch
      const response = await fetch(realUrl);
      if (!response.ok) {
        requestLogService.failed(requestId, `腾讯接口请求失败 (${response.status})`);
        return { data: null, error: `腾讯接口请求失败 (${response.status})` };
      }
      result = await response.json();
    }

    if (!result || !result.data || !result.data[code]) {
      requestLogService.failed(requestId, '腾讯接口无数据');
      return { data: null, error: '腾讯接口无数据' };
    }

    const klines = parseTencentKlineData(result.data, code, period, adjust);
    
    if (!klines || klines.length < 20) {
      requestLogService.failed(requestId, `K线数据不足 (${klines?.length || 0}/20)`);
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
      requestLogService.failed(requestId, '收盘价数据不足');
      return { data: null, error: '收盘价数据不足' };
    }

    const sum = closes.reduce((a, b) => a + b, 0);
    const mid = sum / 20;

    const variance = closes.reduce((sum, val) => sum + Math.pow(val - mid, 2), 0) / 20;
    const std = Math.sqrt(variance);

    const upper = mid + 2 * std;
    const lower = mid - 2 * std;

    // 遍历全部已拉取的K线，找出区间最高/最低（使用 high/low）
    const rangeCount = klines.length;
    let rangePriceHigh = -Infinity;
    let rangePriceHighDate = '';
    let rangePriceLow = Infinity;
    let rangePriceLowDate = '';
    for (let i = 0; i < klines.length; i++) {
      const k = klines[i];
      if (k.high > rangePriceHigh) {
        rangePriceHigh = k.high;
        rangePriceHighDate = k.date;
      }
      if (k.low < rangePriceLow) {
        rangePriceLow = k.low;
        rangePriceLowDate = k.date;
      }
    }

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
      rangeCount,
      rangePriceHigh: Math.round(rangePriceHigh * 100) / 100,
      rangePriceHighDate,
      rangePriceLow: Math.round(rangePriceLow * 100) / 100,
      rangePriceLowDate,
    };

    const cacheKey = getCacheKey(code, period, adjust, 'tencent');
    cache.set(cacheKey, { data: result_data, timestamp: fetchedAt });
    saveCacheToStorage();

    // 记录腾讯数据源的拉取时间
    setLastFetchTime('tencent', fetchedAt);

    // 请求成功
    requestLogService.success(requestId);

    return { data: result_data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    requestLogService.failed(requestId, msg);
    return { data: null, error: `腾讯接口异常: ${msg}` };
  }
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

  const urlPath = `/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${fullCode}&scale=${scale}&ma=no&datalen=80`;
  const realUrl = `https://money.finance.sina.com.cn${urlPath}`;
  const devUrl = `/api/sina${urlPath}`;
  const logUrl = logSinaUrl(urlPath);

  // 开始请求，记录日志
  const requestId = requestLogService.startRequest(logUrl);

  try {
    let klines: SinaKline[];

    if (isDev) {
      const response = await fetch(devUrl);
      if (!response.ok) {
        requestLogService.failed(requestId, `新浪接口请求失败 (${response.status})`);
        return { data: null, error: `新浪接口请求失败 (${response.status})` };
      }
      klines = await response.json();
    } else {
      const res = await prodFetchJson<SinaKline[]>(realUrl);
      if (!res.data) {
        requestLogService.failed(requestId, res.error || '新浪接口请求失败');
        return { data: null, error: res.error || '新浪接口请求失败' };
      }
      klines = res.data;
    }

    if (!klines || !Array.isArray(klines)) {
      requestLogService.failed(requestId, '新浪接口无K线数据');
      return { data: null, error: '新浪接口无K线数据' };
    }

    if (klines.length < 20) {
      requestLogService.failed(requestId, `K线数据不足 (${klines.length}/20)`);
      return { data: null, error: `K线数据不足 (${klines.length}/20)` };
    }

    // 新浪只支持前复权，不需要请求实时价格
    const closes: number[] = [];
    for (let i = klines.length - 20; i < klines.length; i++) {
      closes.push(parseFloat(klines[i].close));
    }

    if (closes.length < 20) {
      requestLogService.failed(requestId, '收盘价数据不足');
      return { data: null, error: '收盘价数据不足' };
    }

    const sum = closes.reduce((a, b) => a + b, 0);
    const mid = sum / 20;

    const variance = closes.reduce((sum, val) => sum + Math.pow(val - mid, 2), 0) / 20;
    const std = Math.sqrt(variance);

    const upper = mid + 2 * std;
    const lower = mid - 2 * std;

    // 遍历全部已拉取的K线，找出区间最高/最低（使用 high/low）
    const rangeCount = klines.length;
    let rangePriceHigh = -Infinity;
    let rangePriceHighDate = '';
    let rangePriceLow = Infinity;
    let rangePriceLowDate = '';
    for (let i = 0; i < klines.length; i++) {
      const k = klines[i];
      const high = parseFloat(k.high);
      const low = parseFloat(k.low);
      if (high > rangePriceHigh) {
        rangePriceHigh = high;
        rangePriceHighDate = k.day;
      }
      if (low < rangePriceLow) {
        rangePriceLow = low;
        rangePriceLowDate = k.day;
      }
    }

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
      rangeCount,
      rangePriceHigh: Math.round(rangePriceHigh * 100) / 100,
      rangePriceHighDate,
      rangePriceLow: Math.round(rangePriceLow * 100) / 100,
      rangePriceLowDate,
    };

    const cacheKey = getCacheKey(fullCode, period, adjust, 'sina');
    cache.set(cacheKey, { data: result_data, timestamp: fetchedAt });
    saveCacheToStorage();

    // 记录新浪数据源的拉取时间
    setLastFetchTime('sina', fetchedAt);

    // 请求成功
    requestLogService.success(requestId);

    return { data: result_data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    requestLogService.failed(requestId, msg);
    return { data: null, error: `新浪接口异常: ${msg}` };
  }
}

// 清除所有BOLL缓存数据
export function clearAllCache(): void {
  cache.clear();
  localStorage.removeItem(CACHE_STORAGE_KEY);
}
