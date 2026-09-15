// 股票交易流水账 IndexedDB 存储
// 用途：本地保留每只股票的「全量」逐笔成交/挂单记录（含软删墓碑），供盈利统计读取；
// 云端同步仍只上传最新 20 条活记录。全量不落 localStorage，避免 5MB 硬上限。
// 说明：不做 localStorage 降级、不做旧数据迁移——旧数据已被合并过，明细不可恢复，从功能上线起积累。

import type { StockTrade } from '../types';

const DB_NAME = 'gold_trade_stock_ledger';
const DB_VERSION = 1;
const STORE = 'ledger';
const ENTRY_KEY = 'ledger_v1';

// 每只股票的流水账：全量逐笔记录 + 墓碑（被软删记录的 id，仅增量）
export interface StockLedgerEntry {
  trades: StockTrade[];
  deletedIds: string[];
}
export type StockLedgerMap = Record<string, StockLedgerEntry>;

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

function readEntry(): Promise<StockLedgerMap> {
  return openDB().then(
    (db) =>
      new Promise<StockLedgerMap>((resolve) => {
        const tx = db.transaction(STORE, 'readonly');
        const r = tx.objectStore(STORE).get(ENTRY_KEY);
        r.onsuccess = () => resolve((r.result as StockLedgerMap) || {});
        r.onerror = () => resolve({});
      }),
    () => Promise.resolve({})
  );
}

function writeEntry(obj: StockLedgerMap): Promise<boolean> {
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

// 读取全部流水账（异步，页面启动时调用）
export function getLedgerFromStore(): Promise<StockLedgerMap> {
  return readEntry();
}

// 保存全部流水账（异步，fire-and-forget，不阻塞主线程）
export function saveLedgerToStore(obj: StockLedgerMap): void {
  void writeEntry(obj);
}

// 清空全部流水账（异步）
export function clearLedgerFromStore(): void {
  void writeEntry({});
}

// 统计流水账实际占用字节数（异步，供设置页 IndexedDB 占用进度条）
export function getLedgerSizeBytes(): Promise<number> {
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