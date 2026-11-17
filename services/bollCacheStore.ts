// BOLL 缓存 IndexedDB 存储（替代 localStorage）
// 容量远大于 localStorage（几百MB），可完整保存多只股票×多周期的 K 线缓存。
// 说明：不做 localStorage 降级、不做旧数据迁移——版本切换后旧 localStorage 缓存直接移除，
// BOLL 数据重新拉取后统一写入 IndexedDB，便于确认新存储是否生效。

const DB_NAME = 'gold_trade_boll_cache';
const DB_VERSION = 1;
const STORE = 'cache';
const ENTRY_KEY = 'boll_v1';

export interface BollCacheEntry {
  data: any;                 // BollData
  timestamp: number;
}
export type BollCacheMap = Record<string, BollCacheEntry>;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'));
  });
  return dbPromise;
}

function readEntry(): Promise<BollCacheMap> {
  return openDB().then(
    (db) =>
      new Promise<BollCacheMap>((resolve) => {
        const tx = db.transaction(STORE, 'readonly');
        const r = tx.objectStore(STORE).get(ENTRY_KEY);
        r.onsuccess = () => resolve((r.result as BollCacheMap) || {});
        r.onerror = () => resolve({});
      }),
    () => Promise.resolve({}) // 打开失败：按空缓存处理（无降级，交由正常网络重新拉取）
  );
}

function writeEntry(obj: BollCacheMap): Promise<boolean> {
  return openDB().then(
    (db) =>
      new Promise<boolean>((resolve) => {
        try {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(obj, ENTRY_KEY);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch {
          resolve(false);
        }
      }),
    () => false
  );
}

function clearEntry(): Promise<boolean> {
  return openDB().then(
    (db) =>
      new Promise<boolean>((resolve) => {
        try {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).delete(ENTRY_KEY);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch {
          resolve(false);
        }
      }),
    () => false
  );
}

// 读取全部缓存（异步，页面启动时调用）
export function getBollCacheFromStore(): Promise<BollCacheMap> {
  return readEntry();
}

// 保存全部缓存（异步，fire-and-forget，不阻塞主线程）
export function saveBollCacheToStore(obj: BollCacheMap): void {
  void writeEntry(obj);
}

// 清空全部缓存（异步）
export function clearBollCacheFromStore(): void {
  void clearEntry();
}

// 统计 BOLL 缓存实际占用字节数（异步）
export function getBollCacheSizeBytes(): Promise<number> {
  return openDB().then(
    (db) =>
      new Promise<number>((resolve) => {
        const tx = db.transaction(STORE, 'readonly');
        const r = tx.objectStore(STORE).get(ENTRY_KEY);
        r.onsuccess = () => {
          const val = r.result;
          if (val == null) return resolve(0);
          try {
            const str = JSON.stringify(val);
            resolve(new Blob([str]).size); // UTF-8 字节数
          } catch {
            resolve(0);
          }
        };
        r.onerror = () => resolve(0);
      }),
    () => 0
  );
}

// 浏览器授予站点（含 IndexedDB）的总配额（异步）
export function getStorageQuotaBytes(): Promise<number> {
  return new Promise<number>((resolve) => {
    if (navigator.storage?.estimate) {
      navigator.storage.estimate().then((e) => resolve(e.quota || 0)).catch(() => resolve(0));
    } else {
      resolve(0);
    }
  });
}