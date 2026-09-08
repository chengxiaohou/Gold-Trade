// 安全的 localStorage 写入工具：遇到配额超限（QuotaExceededError）时自动清理可再生缓存后重试，
// 避免「The quota has been exceeded」异常导致页面崩溃/白屏。

// 可安全删除的缓存键（均为可再生数据，删除后自动重建，不影响持仓等核心数据）
const EVICTABLE_LOCAL_KEYS = [
  'boll_cache_v2',              // BOLL K线缓存（4小时有效期）
  'gold_request_logs',          // 请求日志（刷新即重拉的辅助数据）
  'gold_trade_error_log',       // 错误日志
];
const EVICTABLE_SESSION_KEYS = [
  'gold_request_logs_session',  // 请求日志（会话级后备）
  'gold_trade_error_log',       // 错误日志（会话级）
];

// 释放不需要持久保留的缓存空间，返回是否成功删除了数据
export function freeCacheSpace(): boolean {
  let freed = false;
  try {
    for (const k of EVICTABLE_LOCAL_KEYS) {
      if (localStorage.getItem(k) != null) {
        localStorage.removeItem(k);
        freed = true;
      }
    }
  } catch { /* 忽略 */ }
  try {
    for (const k of EVICTABLE_SESSION_KEYS) {
      if (sessionStorage.getItem(k) != null) {
        sessionStorage.removeItem(k);
        freed = true;
      }
    }
  } catch { /* 忽略 */ }
  return freed;
}

// 安全写入 value（已序列化字符串或任意值）。配额不足时先清理缓存再重试一次，仍失败则静默跳过。
export function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    // 非配额问题的写入失败（如隐私模式禁用存储）直接放弃
    const quotaExceeded =
      e instanceof DOMException &&
      (e.name === 'QuotaExceededError' || e.code === 22 || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
    if (!quotaExceeded) {
      console.warn(`[storageSafe] setItem "${key}" 失败（非配额）:`, e);
      return false;
    }
    // 配额超限：清掉可再生缓存，重试一次
    console.warn(`[storageSafe] "${key}" 写入超限，清理可再生缓存后重试`);
    freeCacheSpace();
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e2) {
      console.warn(`[storageSafe] "${key}" 写入仍然失败:`, e2);
      return false;
    }
  }
}