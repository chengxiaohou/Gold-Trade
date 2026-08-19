// 网络请求日志服务

export interface RequestLogEntry {
  id: string;
  timestamp: number;
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  status: 'pending' | 'success' | 'failed' | 'cached';
  duration?: number; // 毫秒
  error?: string;
  cached?: boolean;
  reason?: string; // 触发原因（一次批量请求共用同一个原因）
  batchKey?: string; // 批次标识（原因+触发时间），用于区分多次相同原因的触发
}

export interface RequestLogStats {
  total: number;
  success: number;
  failed: number;
  cached: number;
  pending: number;
}

// 批次上下文：一次触发（批量请求）的原因与批次标识，
// 由调用方在批次开始时通过 beginBatch 获取，并显式传给该批次内的每个请求，
// 避免并发批次之间互相劫持原因
export interface LogBatchContext {
  reason: string;
  batchKey: string;
}

type RequestLogListener = (logs: RequestLogEntry[], stats: RequestLogStats) => void;

const STORAGE_KEY = 'gold_request_logs';
const MAX_LOGS = 500;

class RequestLogService {
  private logs: RequestLogEntry[] = [];
  private listeners: Set<RequestLogListener> = new Set();
  private pendingRequests: Map<string, number> = new Map(); // id -> startTime
  private batchReason: string | null = null; // 当前批量请求的触发原因
  private batchStartedAt: number | null = null; // 当前批次的触发时间

  constructor() {
    // 从 localStorage 恢复日志（刷新页面后仍然保留，只有点「重置」才清空）
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          this.logs = parsed
            .filter((l): l is RequestLogEntry => l && typeof l.id === 'string' && typeof l.url === 'string')
            .map(l => l.status === 'pending'
              ? { ...l, status: 'failed' as const, error: '页面刷新，请求中断' }
              : l);
          console.log(`[RequestLogService] 从 localStorage 恢复 ${this.logs.length} 条日志`);
        }
      }
    } catch (e) {
      console.warn('[RequestLogService] 读取 localStorage 日志失败:', e);
    }
    if (this.logs.length > 0) {
      this.notifyListeners();
    }
  }

  // 持久化日志到 localStorage（最多保留最近 MAX_LOGS 条）
  private persist(): void {
    try {
      const trimmed = this.logs.slice(-MAX_LOGS);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (e) {
      console.warn('[RequestLogService] 日志持久化失败:', e);
    }
  }

  // 设置/清除批量触发原因：一次批量请求共用同一个原因，
  // 直到下一次 setBatchReason 或 reset 才会改变
  setBatchReason(reason: string | null): void {
    this.batchReason = reason;
    this.batchStartedAt = reason ? Date.now() : null;
  }

  // 开始一个批次，返回稳定的批次上下文（原因 + 批次标识）
  beginBatch(reason: string): LogBatchContext {
    this.batchReason = reason;
    this.batchStartedAt = Date.now();
    return {
      reason,
      batchKey: `${this.batchStartedAt}_${reason}`,
    };
  }

  // 添加监听器
  subscribe(listener: RequestLogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // 通知所有监听器
  private notifyListeners(): void {
    const stats = this.getStats();
    this.listeners.forEach(listener => listener([...this.logs], stats));
  }

  // 开始请求
  startRequest(
    url: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    ctx?: LogBatchContext
  ): string {
    const id = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const entry: RequestLogEntry = {
      id,
      timestamp: Date.now(),
      url,
      method,
      status: 'pending',
      reason: ctx?.reason ?? this.batchReason ?? undefined,
      batchKey: ctx?.batchKey ?? (this.batchReason && this.batchStartedAt ? `${this.batchStartedAt}_${this.batchReason}` : undefined),
    };
    
    this.logs.push(entry);
    this.pendingRequests.set(id, Date.now());
    this.notifyListeners();
    this.persist();
    
    return id;
  }

  // 请求成功
  success(id: string, cached: boolean = false): void {
    const entry = this.logs.find(log => log.id === id);
    if (entry) {
      const startTime = this.pendingRequests.get(id);
      entry.status = cached ? 'cached' : 'success';
      entry.duration = startTime ? Date.now() - startTime : undefined;
      entry.cached = cached;
      this.pendingRequests.delete(id);
      this.notifyListeners();
      this.persist();
    }
  }

  // 请求失败
  failed(id: string, error: string): void {
    const entry = this.logs.find(log => log.id === id);
    if (entry) {
      const startTime = this.pendingRequests.get(id);
      entry.status = 'failed';
      entry.duration = startTime ? Date.now() - startTime : undefined;
      entry.error = error;
      this.pendingRequests.delete(id);
      this.notifyListeners();
      this.persist();
    }
  }

  // 缓存命中（不发网络请求）
  cacheHit(url: string, ctx?: LogBatchContext): void {
    const id = `cache_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const entry: RequestLogEntry = {
      id,
      timestamp: Date.now(),
      url,
      method: 'GET',
      status: 'cached',
      cached: true,
      reason: ctx?.reason ?? this.batchReason ?? undefined,
      batchKey: ctx?.batchKey ?? (this.batchReason && this.batchStartedAt ? `${this.batchStartedAt}_${this.batchReason}` : undefined),
    };
    
    this.logs.push(entry);
    this.notifyListeners();
    this.persist();
  }

  // 获取统计信息
  getStats(): RequestLogStats {
    return {
      total: this.logs.length,
      success: this.logs.filter(log => log.status === 'success').length,
      failed: this.logs.filter(log => log.status === 'failed').length,
      cached: this.logs.filter(log => log.status === 'cached').length,
      pending: this.logs.filter(log => log.status === 'pending').length,
    };
  }

  // 获取所有日志
  getLogs(): RequestLogEntry[] {
    return [...this.logs];
  }

  // 重置日志
  reset(): void {
    this.logs = [];
    this.pendingRequests.clear();
    this.batchReason = null;
    this.notifyListeners();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // 忽略
    }
  }

  // 导出日志为文本
  exportLogs(): string {
    const lines = [
      '时间,触发原因,URL,方法,状态,耗时(ms),错误信息',
      ...this.logs.map(log => {
        const time = new Date(log.timestamp).toLocaleString('zh-CN', { hour12: false });
        const status = log.status === 'success' ? '成功' : 
                       log.status === 'failed' ? '失败' : 
                       log.status === 'cached' ? '缓存' : '进行中';
        return `${time},"${log.reason || ''}","${log.url}",${log.method},${status},${log.duration || ''},${log.error || ''}`;
      })
    ];
    return lines.join('\n');
  }
}

// 单例模式
export const requestLogService = new RequestLogService();
