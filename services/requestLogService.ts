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
}

export interface RequestLogStats {
  total: number;
  success: number;
  failed: number;
  cached: number;
  pending: number;
}

type RequestLogListener = (logs: RequestLogEntry[], stats: RequestLogStats) => void;

class RequestLogService {
  private logs: RequestLogEntry[] = [];
  private listeners: Set<RequestLogListener> = new Set();
  private pendingRequests: Map<string, number> = new Map(); // id -> startTime
  private batchReason: string | null = null; // 当前批量请求的触发原因

  // 设置/清除批量触发原因：一次批量请求共用同一个原因，
  // 直到下一次 setBatchReason 或 reset 才会改变
  setBatchReason(reason: string | null): void {
    this.batchReason = reason;
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
  startRequest(url: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET'): string {
    const id = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const entry: RequestLogEntry = {
      id,
      timestamp: Date.now(),
      url,
      method,
      status: 'pending',
      reason: this.batchReason || undefined,
    };
    
    this.logs.push(entry);
    this.pendingRequests.set(id, Date.now());
    this.notifyListeners();
    
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
    }
  }

  // 缓存命中（不发网络请求）
  cacheHit(url: string): void {
    const id = `cache_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const entry: RequestLogEntry = {
      id,
      timestamp: Date.now(),
      url,
      method: 'GET',
      status: 'cached',
      cached: true,
      reason: this.batchReason || undefined,
    };
    
    this.logs.push(entry);
    this.notifyListeners();
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
