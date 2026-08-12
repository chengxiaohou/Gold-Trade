import { MarketStatus, ApiSource, CacheInfo } from '../types';

// A股交易时段
const MORNING_OPEN = 9.5; // 9:30
const MORNING_CLOSE = 11.5; // 11:30
const AFTERNOON_OPEN = 13.0; // 13:00
const AFTERNOON_CLOSE = 15.0; // 15:00
const PRE_OPEN_START = 9.0; // 9:00开始等待开盘

// 计算当前是星期几 (0=周日, 6=周六)
function getDayOfWeek(date: Date): number {
  return date.getDay();
}

// 判断是否为交易日 (简单判断，不考虑节假日)
// 注：实际节假日需要从接口获取，这里做简化处理
export function isTradingDay(date: Date = new Date()): boolean {
  const day = getDayOfWeek(date);
  return day >= 1 && day <= 5; // 周一到周五
}

// 获取市场状态
export function getMarketStatus(date: Date = new Date()): MarketStatus {
  if (!isTradingDay(date)) {
    return 'full_day_closed';
  }

  const hours = date.getHours();
  const minutes = date.getMinutes();
  const currentTime = hours + minutes / 60;

  if (currentTime < PRE_OPEN_START) {
    return 'full_day_closed'; // 9:00前
  }

  if (currentTime >= PRE_OPEN_START && currentTime < MORNING_OPEN) {
    return 'pre_open'; // 9:00 - 9:30
  }

  if (currentTime >= MORNING_OPEN && currentTime < MORNING_CLOSE) {
    return 'morning_session'; // 9:30 - 11:30
  }

  if (currentTime >= MORNING_CLOSE && currentTime < AFTERNOON_OPEN) {
    return 'midday_break'; // 11:30 - 13:00
  }

  if (currentTime >= AFTERNOON_OPEN && currentTime < AFTERNOON_CLOSE) {
    return 'afternoon_session'; // 13:00 - 15:00
  }

  return 'closed'; // 15:00后
}

// 是否在交易时段
export function isTradingHours(date: Date = new Date()): boolean {
  const status = getMarketStatus(date);
  return status === 'morning_session' || status === 'afternoon_session';
}

// 市场状态中文名
export function getMarketStatusText(status: MarketStatus): string {
  const map: Record<MarketStatus, string> = {
    pre_open: '待开盘',
    morning_session: '上午交易中',
    midday_break: '午间休市',
    afternoon_session: '下午交易中',
    closed: '已收盘',
    full_day_closed: '全天休市'
  };
  return map[status];
}

// 获取下一个交易时段开始时间
export function getNextTradingOpen(date: Date = new Date()): Date {
  const status = getMarketStatus(date);
  const nextDay = new Date(date);

  switch (status) {
    case 'pre_open':
      // 今天9:30开盘
      nextDay.setHours(9, 30, 0, 0);
      return nextDay;
    case 'morning_session':
    case 'midday_break':
      // 今天13:00开盘
      nextDay.setHours(13, 0, 0, 0);
      return nextDay;
    case 'afternoon_session':
    case 'closed':
    case 'full_day_closed':
      // 下个交易日9:30
      let daysToAdd = 1;
      while (!isTradingDay(new Date(nextDay.getTime() + daysToAdd * 24 * 60 * 60 * 1000))) {
        daysToAdd++;
      }
      nextDay.setDate(nextDay.getDate() + daysToAdd);
      nextDay.setHours(9, 30, 0, 0);
      return nextDay;
    default:
      return nextDay;
  }
}

// 缓存管理
const sourceLastFetch: Map<ApiSource, number> = new Map();
const sourceCacheExpiry: Map<ApiSource, number> = new Map();

// 设置上次拉取时间
export function setLastFetchTime(source: ApiSource, timestamp: number = Date.now()): void {
  sourceLastFetch.set(source, timestamp);
  updateCacheExpiry(source, timestamp);
}

// 获取上次拉取时间
export function getLastFetchTime(source: ApiSource): number | null {
  return sourceLastFetch.get(source) || null;
}

// 更新缓存过期时间（用于BOLL数据缓存管理）
function updateCacheExpiry(source: ApiSource, fromTime: number): void {
  const ttlMinutes = getBollCacheTTLMinutes();
  const expiry = calculateCacheExpiry(fromTime, ttlMinutes);
  sourceCacheExpiry.set(source, expiry);
}

// 计算缓存过期时间
function calculateCacheExpiry(fromTime: number, ttlMinutes: number): number {
  const now = new Date(fromTime);
  const isTrading = isTradingHours(now);

  if (isTrading) {
    // 交易时段：按设定的分钟数有效
    return fromTime + ttlMinutes * 60 * 1000;
  } else {
    // 非交易时段：到下次开盘前一直有效
    const nextOpen = getNextTradingOpen(now);
    return nextOpen.getTime();
  }
}

// 获取价格缓存TTL设置
function getCacheTTLMinutes(): number {
  const settings = localStorage.getItem('gold_app_settings');
  if (settings) {
    try {
      const parsed = JSON.parse(settings);
      return parsed.cacheTTLMinutes || 10;
    } catch {
      return 10;
    }
  }
  return 10;
}

// 获取BOLL缓存TTL设置
function getBollCacheTTLMinutes(): number {
  const settings = localStorage.getItem('gold_app_settings');
  if (settings) {
    try {
      const parsed = JSON.parse(settings);
      return parsed.bollCacheTTLMinutes || 120;
    } catch {
      return 120;
    }
  }
  return 120;
}

// 获取缓存过期时间（用于BOLL数据缓存管理）
export function getCacheExpiry(source: ApiSource): number | null {
  const lastFetch = sourceLastFetch.get(source);
  if (lastFetch) {
    const ttlMinutes = getBollCacheTTLMinutes();
    return calculateCacheExpiry(lastFetch, ttlMinutes);
  }
  return null;
}

// 检查缓存是否有效
export function isCacheValid(source: ApiSource): boolean {
  const lastFetch = sourceLastFetch.get(source);
  if (!lastFetch) return false;

  const expiry = getCacheExpiry(source);
  if (!expiry) return false;

  return Date.now() < expiry;
}

// 获取缓存信息
export function getCacheInfo(source: ApiSource): CacheInfo {
  const marketStatus = getMarketStatus();
  const lastFetchAt = getLastFetchTime(source);
  const expiresAt = getCacheExpiry(source);

  return {
    lastFetchAt,
    expiresAt,
    marketStatus,
    isTradingHours: isTradingHours()
  };
}

// 格式化日期时间
export function formatDateTime(timestamp: number | null): string {
  if (!timestamp) return '从未拉取';
  
  const date = new Date(timestamp);
  const pad = (n: number) => n.toString().padStart(2, '0');
  
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// 格式化日期部分
export function formatDatePart(timestamp: number | null): string {
  if (!timestamp) return '从未';
  
  const date = new Date(timestamp);
  const pad = (n: number) => n.toString().padStart(2, '0');
  
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// 格式化时间部分
export function formatTimePart(timestamp: number | null): string {
  if (!timestamp) return '';
  
  const date = new Date(timestamp);
  const pad = (n: number) => n.toString().padStart(2, '0');
  
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// 格式化相对时间（如：5分钟前、2小时前）
export function formatRelativeTime(timestamp: number | null): string {
  if (!timestamp) return '';
  
  const now = Date.now();
  const diff = now - timestamp;
  
  if (diff < 0) return '即将';
  
  const seconds = Math.floor(diff / 1000);
  
  if (seconds < 60) {
    return `${seconds}秒前`;
  }
  
  const minutes = Math.floor(seconds / 60);
  
  if (minutes < 60) {
    return `${minutes}分钟前`;
  }
  
  const hours = Math.floor(minutes / 60);
  
  if (hours < 24) {
    return `${hours}小时前`;
  }
  
  const days = Math.floor(hours / 24);
  return `${days}天前`;
}

// 清除所有缓存记录（用户手动刷新时调用）
export function clearCacheRecord(source: ApiSource): void {
  sourceLastFetch.delete(source);
  sourceCacheExpiry.delete(source);
}

// 根据当前市场状态获取价格缓存TTL（毫秒）
export function getDynamicCacheTTL(): number {
  const ttlMinutes = getCacheTTLMinutes();
  const marketStatus = getMarketStatus();

  if (marketStatus === 'morning_session' || marketStatus === 'afternoon_session') {
    return ttlMinutes * 60 * 1000;
  } else {
    const nextOpen = getNextTradingOpen();
    return nextOpen.getTime() - Date.now();
  }
}

// 根据当前市场状态获取BOLL缓存TTL（毫秒）
export function getDynamicBollCacheTTL(): number {
  const ttlMinutes = getBollCacheTTLMinutes();
  const marketStatus = getMarketStatus();

  if (marketStatus === 'morning_session' || marketStatus === 'afternoon_session') {
    return ttlMinutes * 60 * 1000;
  } else {
    const nextOpen = getNextTradingOpen();
    return nextOpen.getTime() - Date.now();
  }
}

// 判断某只股票的股价是否仍然新鲜（无需重新拉取）
// 交易时段：按设置的缓存 TTL 判断
// 午间休市：拿到早盘收盘(11:30)后的价格即视为最新
// 已收盘：拿到当日收盘(15:00)后的价格即视为最新
// 盘前/全天休市：拿到最近一个交易日收盘(15:00)后的价格即视为最新
export function isStockPriceFresh(priceUpdatedAt: number | null): boolean {
  if (!priceUpdatedAt) return false;

  const status = getMarketStatus();
  const now = Date.now();

  if (status === 'morning_session' || status === 'afternoon_session') {
    // 交易时段：在缓存 TTL 内视为新鲜
    return now - priceUpdatedAt < getDynamicCacheTTL();
  }

  let latestCloseTime: number;
  if (status === 'midday_break') {
    const t = new Date(now);
    t.setHours(11, 30, 0, 0);
    latestCloseTime = t.getTime();
  } else if (status === 'closed') {
    const t = new Date(now);
    t.setHours(15, 0, 0, 0);
    latestCloseTime = t.getTime();
  } else {
    // pre_open 或 full_day_closed：向前找最近一个交易日（简化为最近工作日，与 isTradingDay 一致）的 15:00
    const d = new Date(now);
    d.setHours(15, 0, 0, 0);
    do {
      d.setDate(d.getDate() - 1);
    } while (!isTradingDay(d));
    latestCloseTime = d.getTime();
  }

  return priceUpdatedAt >= latestCloseTime;
}
