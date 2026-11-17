// BOLL 缓存 IndexedDB 存储（替代 localStorage）
// 容量远大于 localStorage（几百MB），可完整保存多只股票×多周期的 K 线缓存。
// 说明：不做 localStorage 降级、不做旧数据迁移——版本切换后旧缓存直接移除，
// BOLL 数据重新拉取后统一写入 IndexedDB，便于确认新存储是否生效。
//
// v2 起按"摘要 / K 线"两个 store 拆分存储：
// - summary：每只股票每周期一条，只含 BOLL 三轨、均线、区间极值等展示字段（几百字节）
// - klines：每只股票每周期一条，只含完整 K 线数组（几十 KB）
// 这样页面启动时只需反序列化全部摘要（一两百 KB）即可先画出 BOLL 数字，
// K 线数组随后在后台分批读取，不再"一次性解析几十 MB 阻塞主线程约 1 秒"。
// 写入也从"每拉一只重写整包"变为"只写变动的两个小键"。

const DB_NAME = 'gold_trade_boll_cache';
const DB_VERSION = 2;
const SUMMARY_STORE = 'summary';
const KLINES_STORE = 'klines';
const LEGACY_STORE = 'cache'; // v1：单键存放整包缓存，升级时直接删除

export interface BollCacheSummaryEntry {
  timestamp: number;
  data: any; // BollData（不含 klines）
}
export type BollCacheSummaryMap = Record<string, BollCacheSummaryEntry>;

export interface BollKlinesEntry {
  key: string;
  klines: any[]; // BollKline[]
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SUMMARY_STORE)) db.createObjectStore(SUMMARY_STORE);
      if (!db.objectStoreNames.contains(KLINES_STORE)) db.createObjectStore(KLINES_STORE);
      // 旧版整包缓存：不做迁移，直接移除（数据会在下一次拉取时重建）
      if (db.objectStoreNames.contains(LEGACY_STORE)) db.deleteObjectStore(LEGACY_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'));
  });
  return dbPromise;
}

// 读取全部摘要（体积很小，页面启动时调用）
export function getBollSummariesFromStore(): Promise<BollCacheSummaryMap> {
  return openDB().then(
    (db) =>
      new Promise<BollCacheSummaryMap>((resolve) => {
        const tx = db.transaction(SUMMARY_STORE, 'readonly');
        const os = tx.objectStore(SUMMARY_STORE);
        const keysReq = os.getAllKeys();
        const valsReq = os.getAll();
        tx.oncomplete = () => {
          const keys = (keysReq.result || []) as string[];
          const vals = (valsReq.result || []) as BollCacheSummaryEntry[];
          const map: BollCacheSummaryMap = {};
          for (let i = 0; i < keys.length; i++) {
            if (vals[i]) map[keyToStr(keys[i])] = vals[i];
          }
          resolve(map);
        };
        tx.onerror = () => resolve({});
      }),
    () => Promise.resolve({}) // 打开失败：按空缓存处理（无降级，交由正常网络重新拉取）
  );
}

function keyToStr(key: IDBValidKey): string {
  return String(key);
}

function putToStore(storeName: string, key: string, value: unknown): void {
  void openDB().then(
    (db) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(value, key);
      } catch { /* 忽略：写入失败时下次拉取会重建 */ }
    },
    () => { /* 打开失败：忽略 */ }
  );
}

// 写入单条摘要（不含 klines）
export function saveBollSummaryToStore(key: string, entry: BollCacheSummaryEntry): void {
  putToStore(SUMMARY_STORE, key, entry);
}

// 写入单条 K 线
export function saveBollKlinesToStore(key: string, klines: any[]): void {
  putToStore(KLINES_STORE, key, klines);
}

// 删除单条 K 线（缓存条目被替换且不再有 K 线时使用）
export function deleteBollKlinesFromStore(key: string): void {
  void openDB().then(
    (db) => {
      try {
        db.transaction(KLINES_STORE, 'readwrite').objectStore(KLINES_STORE).delete(key);
      } catch { /* 忽略 */ }
    },
    () => { /* 忽略 */ }
  );
}

// 分批遍历全部 K 线（游标 + 批回调）：每批之间让出主线程，避免一次性反序列化阻塞
export function hydrateBollKlinesFromStore(
  batchSize: number,
  onBatch: (items: BollKlinesEntry[]) => void
): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise<void>((resolve) => {
        let batch: BollKlinesEntry[] = [];
        const flush = () => {
          if (batch.length === 0) return;
          const ready = batch;
          batch = [];
          try { onBatch(ready); } catch { /* 忽略单批异常 */ }
        };
        const tx = db.transaction(KLINES_STORE, 'readonly');
        const req = tx.objectStore(KLINES_STORE).openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) { flush(); resolve(); return; }
          batch.push({ key: keyToStr(cursor.key), klines: (cursor.value as any[]) || [] });
          if (batch.length >= batchSize) flush();
          cursor.continue();
        };
        req.onerror = () => { flush(); resolve(); };
      }),
    () => Promise.resolve()
  );
}

// 清空全部缓存（摘要 + K 线）
export function clearBollCacheFromStore(): void {
  void openDB().then(
    (db) => {
      try {
        const tx = db.transaction([SUMMARY_STORE, KLINES_STORE], 'readwrite');
        tx.objectStore(SUMMARY_STORE).clear();
        tx.objectStore(KLINES_STORE).clear();
      } catch { /* 忽略 */ }
    },
    () => { /* 忽略 */ }
  );
}

// 统计 BOLL 缓存实际占用字节数（异步，游标累计，避免拼出巨型字符串）
export function getBollCacheSizeBytes(): Promise<number> {
  return openDB().then(
    (db) =>
      new Promise<number>((resolve) => {
        let bytes = 0;
        let pending = 2;
        const done = () => { if (--pending === 0) resolve(bytes); };
        for (const storeName of [SUMMARY_STORE, KLINES_STORE]) {
          try {
            const req = db.transaction(storeName, 'readonly').objectStore(storeName).openCursor();
            req.onsuccess = () => {
              const c = req.result;
              if (!c) { done(); return; }
              try { bytes += JSON.stringify(c.value).length * 2; } catch { /* 忽略单条 */ }
              c.continue();
            };
            req.onerror = () => done();
          } catch {
            done();
          }
        }
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
