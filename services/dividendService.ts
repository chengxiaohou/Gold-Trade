import { requestLogService } from './requestLogService';

// 分红数据查询服务
//
// 主数据源：同花顺 F10「分红融资」页面（basic.10jqka.com.cn/pad/{code}/equitybonus.html）
//  - 与用户手动查询的渠道一致；
//  - 每条分红都带明确的所属年度标签，如【2025年年度】【2025年中期】【2024年特别】，
//    直接按标签汇总即可，无需猜测归属年度；
//  - 包含已实施与已公告预案的现金分红（同花顺页面展示的口径）。
//
// 备用数据源：东方财富 datacenter 接口（按报告期年度汇总，可能漏特别分红，仅作降级用）。

const THS_HOST = 'basic.10jqka.com.cn';
const EASTMONEY_HOST = 'datacenter-web.eastmoney.com';

// 生产环境配置（与 bollService 相同模式）
const PROD_CONFIG = {
  // Cloudflare Worker 代理（需部署 workers/cors-proxy.js，替换下方 URL）
  cfWorker: 'https://cors-proxy.gold-trade.workers.dev',
  // 备用 CORS 代理（CF Worker 不可用时回退）
  fallbackProxies: [
    'https://corsproxy.io/?url=',
    'https://api.allorigins.win/raw?url=',
  ],
  proxyTimeout: 12000,
};

// 数据源按 IP 限流，对突发请求会临时封禁（社区实测经验：相邻请求间隔至少 0.5 秒）。
// 这里做统一节流：无论批量查询还是添加股票，相邻两次请求间隔都不小于该值。
const MIN_REQUEST_INTERVAL_MS = 500;
let lastRequestTime = 0;

async function throttleRequest(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, lastRequestTime + MIN_REQUEST_INTERVAL_MS - now);
  lastRequestTime = Math.max(now, lastRequestTime + MIN_REQUEST_INTERVAL_MS);
  if (wait > 0) {
    await new Promise(resolve => setTimeout(resolve, wait));
  }
}

export interface DividendRecord {
  reportDate: string;     // 公告日期，如 2026-04-01
  pretaxPer10: number;    // 每10股派息（税前，元）
  planProfile: string;    // 方案描述，如 10派15.83元(含税) 【2025年年度】
}

export interface YearlyDividends {
  found: boolean;         // false 表示该代码查不到分红数据（如 ETF）
  code: string;
  name?: string;
  dividend2024: number;   // 每股派息（税前），按分红所属年度汇总（含中期/特别/年度）
  dividend2025: number;
  dividendByYear: Record<number, number>; // key=年份, value=每股税前派息（全年汇总）
  records: DividendRecord[];
  source: '同花顺' | '东方财富';
  error?: string;
}

// ---------- 请求封装 ----------

async function singleProxyFetch(proxyUrl: string, timeoutMs: number): Promise<Response> {
  const response = await fetch(proxyUrl, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`代理返回 ${response.status}`);
  return response;
}

// 生产环境请求：CF Worker 优先，失败后回退到备用代理
async function prodFetch(realUrl: string): Promise<Response> {
  const { cfWorker, fallbackProxies, proxyTimeout } = PROD_CONFIG;
  let lastError = '';
  try {
    return await singleProxyFetch(`${cfWorker}/?url=${encodeURIComponent(realUrl)}`, proxyTimeout);
  } catch (e) {
    lastError = e instanceof Error ? e.message : 'CF Worker 失败';
  }
  for (const proxyBase of fallbackProxies) {
    try {
      return await singleProxyFetch(`${proxyBase}${encodeURIComponent(realUrl)}`, proxyTimeout);
    } catch {
      // 继续下一个代理
    }
  }
  throw new Error(lastError || '所有代理请求均失败');
}

async function fetchText(realUrl: string, localPath: string, gbk: boolean): Promise<string> {
  const logId = requestLogService.startRequest(realUrl);
  try {
    let response: Response;
    if (import.meta.env.DEV) {
      // 开发环境走 vite 本地代理（见 vite.config.ts /api/ths、/api/eastmoney）
      response = await fetch(localPath, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`本地代理返回 ${response.status}`);
    } else {
      response = await prodFetch(realUrl);
    }
    const buffer = await response.arrayBuffer();
    const text = new TextDecoder(gbk ? 'gbk' : 'utf-8').decode(buffer);
    requestLogService.success(logId);
    return text;
  } catch (error) {
    const message = error instanceof Error ? error.message : '请求失败';
    requestLogService.failed(logId, message);
    throw error;
  }
}

// ---------- 主数据源：同花顺 F10 分红融资 ----------

function parseTonghuashunHtml(html: string, code: string): YearlyDividends | null {
  const records: DividendRecord[] = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let trMatch: RegExpExecArray | null;
  while ((trMatch = trRegex.exec(html)) !== null) {
    const cells: string[] = [];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let tdMatch: RegExpExecArray | null;
    while ((tdMatch = tdRegex.exec(trMatch[1])) !== null) {
      cells.push(tdMatch[1]);
    }
    if (cells.length < 2) continue;

    const program = cells[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const cashMatch = program.match(/派([\d.]+)元/);
    if (!cashMatch || !/【\d{4}年/.test(program)) continue;

    const pretaxPer10 = parseFloat(cashMatch[1]);
    if (isNaN(pretaxPer10) || pretaxPer10 <= 0) continue;

    records.push({
      reportDate: cells[0].replace(/<[^>]+>/g, '').trim().slice(0, 10),
      pretaxPer10,
      planProfile: program,
    });
  }

  if (records.length === 0) return null;

  const sumPerShare = (year: number): number => {
    const totalPer10 = records
      .filter(r => {
        const y = r.planProfile.match(/【(\d{4})年/);
        return y && parseInt(y[1], 10) === year;
      })
      .reduce((acc, r) => acc + r.pretaxPer10, 0);
    return Math.round((totalPer10 / 10) * 10000) / 10000;
  };

  const buildDividendByYear = (): Record<number, number> => {
    const map: Record<number, number> = {};
    for (const r of records) {
      const y = r.planProfile.match(/【(\d{4})年/);
      if (!y) continue;
      const year = parseInt(y[1], 10);
      map[year] = (map[year] || 0) + r.pretaxPer10;
    }
    for (const y of Object.keys(map)) {
      map[+y] = Math.round((map[+y] / 10) * 10000) / 10000;
    }
    return map;
  };

  return {
    found: true,
    code,
    dividend2024: sumPerShare(2024),
    dividend2025: sumPerShare(2025),
    dividendByYear: buildDividendByYear(),
    records,
    source: '同花顺',
  };
}

async function fetchFromTonghuashun(code: string): Promise<YearlyDividends | null> {
  const secCode = code.replace(/\.(SH|SZ|BJ)$/i, '');
  // 附加时间戳避免 CF Worker / 代理层命中缓存（点击刷新必须拿最新数据）
  const realUrl = `https://${THS_HOST}/pad/${secCode}/equitybonus.html?_=${Date.now()}`;
  const localPath = `/api/ths/pad/${secCode}/equitybonus.html`;
  try {
    const html = await fetchText(realUrl, localPath, true);
    return parseTonghuashunHtml(html, code);
  } catch {
    return null;
  }
}

// ---------- 备用数据源：东方财富 datacenter ----------

function buildEastmoneyUrl(code: string): string {
  const secCode = code.replace(/\.(SH|SZ|BJ)$/i, '');
  const filter = `(SECURITY_CODE="${secCode}")(REPORT_DATE>='2024-01-01')(REPORT_DATE<='2025-12-31')`;
  const params = new URLSearchParams({
    reportName: 'RPT_SHAREBONUS_DET',
    columns: 'ALL',
    filter,
    sortColumns: 'REPORT_DATE',
    sortTypes: '-1',
    pageSize: '100',
    client: 'WEB',
    _: Date.now().toString(), // 避免代理层缓存
  });
  return `https://${EASTMONEY_HOST}/api/data/v1/get?${params.toString()}`;
}

function parseEastmoneyJson(json: unknown, code: string): YearlyDividends {
  const result = (json as { result?: { data?: Array<Record<string, unknown>> } })?.result;
  const data = result?.data;
  if (!Array.isArray(data) || data.length === 0) {
    return { found: false, code, dividend2024: 0, dividend2025: 0, dividendByYear: {}, records: [], source: '东方财富' };
  }

  const records: DividendRecord[] = data
    .filter(r => {
      const bonus = parseFloat(String(r.PRETAX_BONUS_RMB ?? '0'));
      const progress = String(r.ASSIGN_PROGRESS || '');
      return !isNaN(bonus) && bonus > 0 && progress.includes('实施');
    })
    .map(r => ({
      reportDate: String(r.REPORT_DATE || '').slice(0, 10),
      pretaxPer10: parseFloat(String(r.PRETAX_BONUS_RMB || '0')),
      planProfile: String(r.IMPL_PLAN_PROFILE || ''),
    }));

  const sumPerShare = (year: number): number => {
    const totalPer10 = records
      .filter(r => r.reportDate.startsWith(`${year}-`))
      .reduce((acc, r) => acc + r.pretaxPer10, 0);
    return Math.round((totalPer10 / 10) * 10000) / 10000;
  };

  const buildDividendByYear = (): Record<number, number> => {
    const map: Record<number, number> = {};
    for (const r of records) {
      if (!r.reportDate) continue;
      const year = parseInt(r.reportDate.slice(0, 4), 10);
      if (isNaN(year)) continue;
      map[year] = (map[year] || 0) + r.pretaxPer10;
    }
    for (const y of Object.keys(map)) {
      map[+y] = Math.round((map[+y] / 10) * 10000) / 10000;
    }
    return map;
  };

  return {
    found: true,
    code,
    name: data[0]?.SECURITY_NAME_ABBR ? String(data[0].SECURITY_NAME_ABBR) : undefined,
    dividend2024: sumPerShare(2024),
    dividend2025: sumPerShare(2025),
    dividendByYear: buildDividendByYear(),
    records,
    source: '东方财富',
  };
}

async function fetchFromEastmoney(code: string): Promise<YearlyDividends | null> {
  const realUrl = buildEastmoneyUrl(code);
  const logId = requestLogService.startRequest(realUrl);
  try {
    let json: unknown;
    if (import.meta.env.DEV) {
      const localUrl = `/api/eastmoney/api/data/v1/get?${new URL(realUrl).searchParams.toString()}`;
      const response = await fetch(localUrl, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`本地代理返回 ${response.status}`);
      json = await response.json();
    } else {
      const response = await prodFetch(realUrl);
      json = await response.json();
    }
    requestLogService.success(logId);
    return parseEastmoneyJson(json, code);
  } catch (error) {
    const message = error instanceof Error ? error.message : '请求失败';
    requestLogService.failed(logId, message);
    return null;
  }
}

// ---------- 对外入口 ----------

// 查询一只股票的 2024/2025 全年分红（每股税前派息，按分红所属年度汇总）
export async function fetchYearlyDividends(code: string): Promise<YearlyDividends> {
  await throttleRequest();

  const ths = await fetchFromTonghuashun(code);
  if (ths) {
    return ths;
  }

  const em = await fetchFromEastmoney(code);
  if (em) {
    return em;
  }

  return {
    found: false,
    code,
    dividend2024: 0,
    dividend2025: 0,
    dividendByYear: {},
    records: [],
    source: '同花顺',
    error: '同花顺与东方财富均未返回分红数据',
  };
}
