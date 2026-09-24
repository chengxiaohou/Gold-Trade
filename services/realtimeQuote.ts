// 实时行情 (qt.gtimg.cn) 的 HTTP 封装 —— 仅供价格数据部(priceBureau)内部调用。
// 解析纯函数集中在 tencentQuote（与网络/日志解耦，便于单测），本模块只负责网络与请求日志。
// 全项目只有 priceBureau 允许依赖本模块；组件不得直连行情源。
import { toTencentCode, parseTencentQuoteText, type TencentQuote } from './tencentQuote';
import { requestLogService, type LogBatchContext } from './requestLogService';

const REALTIME_URL = 'https://qt.gtimg.cn/q=';

/**
 * 批量拉取多只股票实时行情（qt.gtimg.cn）：一次请求逗号拼接多个代码，
 * 返回按腾讯代码(如 sz000001)映射的结果。单个代码解析失败仅导致该 code 缺失，
 * 不影响其它，调用方对缺失项做单只兜底重试（同 priceBureau 既有约定）。
 */
export async function fetchTencentRealtime(codes: string[], logCtx?: LogBatchContext): Promise<Map<string, TencentQuote>> {
  const tencentCodes = codes.map(toTencentCode);
  const url = `${REALTIME_URL}${tencentCodes.join(',')}`;
  const logId = requestLogService.startRequest(url, 'GET', logCtx);
  const quotes = new Map<string, TencentQuote>();
  try {
    const response = await fetch(url);
    const decoder = new TextDecoder('gb18030');
    const text = decoder.decode(await response.arrayBuffer());
    const parsed = parseTencentQuoteText(text);
    // 仅保留本次请求的代码，避免误带响应中的其它字段
    for (const tc of tencentCodes) {
      const q = parsed.get(tc);
      if (q) quotes.set(tc, q);
    }
    requestLogService.success(logId);
  } catch (error) {
    requestLogService.failed(logId, error instanceof Error ? error.message : '批量拉取股价失败');
  }
  return quotes;
}