import { requestLogService, type LogBatchContext } from './requestLogService';

// 分红数据查询服务
//
// 当前方案（在线使用）：每只股票逐条请求（N 只股票 = N 条请求）。
//  - 主数据源：同花顺 F10「分红融资」页面（basic.10jqka.com.cn/pad/{code}/equitybonus.html，
//    GBK 编码 HTML，按【YYYY年年度/中期/特别】标签汇总，含已实施与已公告预案）；
//  - 备用数据源：东方财富 datacenter 单只查询（RPT_SHAREBONUS_DET，filter=(SECURITY_CODE="...")，
//    当时只保留「实施分配」的记录）。
//
// ============ 批量方案（已实现但停用，因数据不完整） ============
// 东方财富 datacenter 批量接口（RPT_SHAREBONUS_DET，SECURITY_CODE in (...)），
// 一次 HTTP 请求即可拉取全部股票的分红明细（见 fetchBatchYearlyDividends）。
// 停用原因：该报表对个别股票会缺失中期分红（实测 000538 云南白药
// 缺 2024 中期 10派12.13、2025 中期 10派10.19），导致年度汇总偏小；
// 若未来东财补全数据，可把组件调用点切回 fetchBatchYearlyDividends 以获得 1 条请求的速度。
//
// 同花顺同样没有「一条请求拉全部」的公开批量接口（数据中心 ajax 有 chameleon 反爬，返回 401），
// 但实测允许小并发：批量刷新时由调用方用 4 路并发池请求单只 F10 页面。

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

// 数据源按 IP 限流，对长时间高频请求会临时封禁。
// 实测同花顺允许短时间并发（10 只并发全部 200，总耗时 <0.5s），
// 因此不再串行等待 0.5 秒，改为「启动间隔 120ms + 调用方限制并发数（批量刷新用 4）」。
const MIN_REQUEST_INTERVAL_MS = 120;
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
  registerDate?: string;  // 股权登记日（已实施的才有，预案阶段为空）
}

export interface YearlyDividends {
  found: boolean;         // false 表示该代码查不到分红数据（如 ETF）
  code: string;
  name?: string;
  dividend2024: number;   // 每股派息（税前），按分红所属年度汇总（含中期/特别/年度）
  dividend2025: number;
  dividendByYear: Record<number, number>; // key=年份, value=每股税前派息（全年汇总）
  totalShares?: number;   // 总股本（股），用于估算年度现金分红总额
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

async function fetchText(realUrl: string, localPath: string, gbk: boolean, logCtx?: LogBatchContext): Promise<string> {
  const logId = requestLogService.startRequest(realUrl, 'GET', logCtx);
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
      registerDate: cells[2] ? cells[2].replace(/<[^>]+>/g, '').trim().slice(0, 10) || undefined : undefined,
    });
  }

  if (records.length === 0) return null;

  // 总股本（亿股）→ 股。用于估算「年度现金分红总额 = 每股派息 × 总股本」。
  // 页面给的是当前股本，历史上发生增发/回购时按当前股本估算会有少量偏差。
  const sharesMatch = html.match(/总股本（亿股）[\s\S]{0,300}?([\d.]+)/);
  const sharesInYi = sharesMatch ? parseFloat(sharesMatch[1]) : NaN;
  const totalShares = isFinite(sharesInYi) && sharesInYi > 0 ? Math.round(sharesInYi * 1e8) : undefined;

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
    totalShares,
    records,
    source: '同花顺',
  };
}

async function fetchFromTonghuashun(code: string, logCtx?: LogBatchContext): Promise<YearlyDividends | null> {
  const secCode = code.replace(/\.(SH|SZ|BJ)$/i, '');
  // 附加时间戳避免 CF Worker / 代理层命中缓存（点击刷新必须拿最新数据）
  const realUrl = `https://${THS_HOST}/pad/${secCode}/equitybonus.html?_=${Date.now()}`;
  const localPath = `/api/ths/pad/${secCode}/equitybonus.html`;
  try {
    const html = await fetchText(realUrl, localPath, true, logCtx);
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
      registerDate: String(r.REGISTER_DATE || '').slice(0, 10) || undefined,
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

  // 总股本（股）：报表里 TOTAL_SHARES 为股数，用于估算年度现金分红总额
  const sharesRaw = parseFloat(String(data.find(r => r.TOTAL_SHARES)?.TOTAL_SHARES ?? ''));
  const totalShares = isFinite(sharesRaw) && sharesRaw > 0 ? sharesRaw : undefined;

  return {
    found: true,
    code,
    name: data[0]?.SECURITY_NAME_ABBR ? String(data[0].SECURITY_NAME_ABBR) : undefined,
    dividend2024: sumPerShare(2024),
    dividend2025: sumPerShare(2025),
    dividendByYear: buildDividendByYear(),
    totalShares,
    records,
    source: '东方财富',
  };
}

async function fetchFromEastmoney(code: string, logCtx?: LogBatchContext): Promise<YearlyDividends | null> {
  const realUrl = buildEastmoneyUrl(code);
  const logId = requestLogService.startRequest(realUrl, 'GET', logCtx);
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

// ---------- 批量数据源：东方财富 datacenter（已停用，保留备用） ----------

// 一次请求拉取多只股票的分红明细（实测支持 SECURITY_CODE in (...) 多代码批量）
function buildBatchEastmoneyUrl(codes: string[], pageNo: number): string {
  const inList = codes.map(c => `"${c.replace(/\.(SH|SZ|BJ)$/i, '')}"`).join(',');
  const filter = `(SECURITY_CODE in (${inList}))(REPORT_DATE>='2024-01-01')`;
  const params = new URLSearchParams({
    reportName: 'RPT_SHAREBONUS_DET',
    columns: 'SECURITY_CODE,SECURITY_NAME_ABBR,REPORT_DATE,PRETAX_BONUS_RMB,IMPL_PLAN_PROFILE,EQUITY_RECORD_DATE,EX_DIVIDEND_DATE,ASSIGN_PROGRESS',
    filter,
    sortColumns: 'SECURITY_CODE,REPORT_DATE',
    sortTypes: '1,-1',
    pageSize: '500',
    pageNumber: String(pageNo),
    client: 'WEB',
    _: Date.now().toString(), // 避免代理层缓存
  });
  return `https://${EASTMONEY_HOST}/api/data/v1/get?${params.toString()}`;
}

// 拉取一页分红明细 JSON（开发走 vite 本地代理，生产走 CF Worker / 备用代理）
async function fetchEastmoneyJsonPage(realUrl: string, logCtx?: LogBatchContext): Promise<{ data: Array<Record<string, unknown>>; pages: number }> {
  const logId = requestLogService.startRequest(realUrl, 'GET', logCtx);
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
    const result = (json as { result?: { data?: Array<Record<string, unknown>>; pages?: number } })?.result;
    return { data: Array.isArray(result?.data) ? result!.data! : [], pages: Number(result?.pages || 1) };
  } catch (error) {
    const message = error instanceof Error ? error.message : '请求失败';
    requestLogService.failed(logId, message);
    throw error;
  }
}

// ---------- 归母净利润（批量）：东方财富业绩报表 ----------

// 东财业绩报表 RPT_LICO_FN_CPD 支持 SECURITY_CODE in (...) + REPORTDATE in (...)，
// 因此「多只股票 × 多个年报期」只需 1 条请求，返回 PARENT_NETPROFIT（归母净利润，元）。
// 年报口径：只取 YYYY-12-31；当年年报尚未披露的年份自然没有数据（调用方留空）。
// 亏损公司为负数，原样保留。
function buildNetProfitBatchUrl(codes: string[], years: number[], pageNo: number): string {
  const codeList = codes.map(c => `"${c.replace(/\.(SH|SZ|BJ)$/i, '')}"`).join(',');
  const dateList = years.map(y => `'${y}-12-31'`).join(',');
  const params = new URLSearchParams({
    reportName: 'RPT_LICO_FN_CPD',
    columns: 'SECURITY_CODE,REPORTDATE,PARENT_NETPROFIT',
    filter: `(SECURITY_CODE in (${codeList}))(REPORTDATE in (${dateList}))`,
    sortColumns: 'SECURITY_CODE',
    sortTypes: '1',
    pageSize: '500',
    pageNumber: String(pageNo),
    client: 'WEB',
    _: Date.now().toString(), // 避免代理层缓存
  });
  return `https://${EASTMONEY_HOST}/api/data/v1/get?${params.toString()}`;
}

// 批量查询多只股票多年的归母净利润，返回 { 6位代码: { 年份: 净利润（元） } }
export async function fetchParentNetProfitBatch(
  codes: string[],
  years: number[],
  logCtx?: LogBatchContext,
): Promise<Record<string, Record<number, number>>> {
  const out: Record<string, Record<number, number>> = {};
  if (codes.length === 0 || years.length === 0) return out;

  let pageNo = 1;
  for (;;) {
    const { data, pages } = await fetchEastmoneyJsonPage(buildNetProfitBatchUrl(codes, years, pageNo), logCtx);
    for (const row of data) {
      const code = String(row.SECURITY_CODE || '').toUpperCase();
      const reportDate = String(row.REPORTDATE || '').slice(0, 10);
      const year = parseInt(reportDate.slice(0, 4), 10);
      const netProfit = parseFloat(String(row.PARENT_NETPROFIT ?? ''));
      if (!code || isNaN(year) || isNaN(netProfit)) continue;
      (out[code] ||= {})[year] = netProfit;
    }
    if (pageNo >= pages) break;
    pageNo += 1;
    await throttleRequest(); // 翻页请求同样节流
  }
  return out;
}

// ---------- 历年总股本（批量）：东方财富分红明细 ----------

// 分红总额 = 每股派息 × 当期总股本。同花顺页面只给「当前」总股本，早年送转后股本变化很大
// （实测 600285 当前 5.67 亿股、2011 年只有 2.00 亿股），用当前股本会把早年分红总额放大约 3 倍，
// 支付率虚高到 200%+。东财分红明细每条记录都带 TOTAL_SHARES（该方案对应的总股本）且支持多代码批量，
// 因此这里只取它的股本字段（不取它的派息金额——该报表个别股票漏中期分红，见文件头），
// 按报告期返回 { 6位代码: { 'YYYY-12-31': 股本, 'YYYY-06-30': 股本, ... } }。
function buildSharesBatchUrl(codes: string[], pageNo: number): string {
  const inList = codes.map(c => `"${c.replace(/\.(SH|SZ|BJ)$/i, '')}"`).join(',');
  const params = new URLSearchParams({
    reportName: 'RPT_SHAREBONUS_DET',
    columns: 'SECURITY_CODE,REPORT_DATE,TOTAL_SHARES',
    filter: `(SECURITY_CODE in (${inList}))`,
    sortColumns: 'SECURITY_CODE,REPORT_DATE',
    sortTypes: '1,-1',
    pageSize: '500',
    pageNumber: String(pageNo),
    client: 'WEB',
    _: Date.now().toString(), // 避免代理层缓存
  });
  return `https://${EASTMONEY_HOST}/api/data/v1/get?${params.toString()}`;
}

// 批量查询多只股票的「报告期 → 总股本」
export async function fetchTotalSharesByPeriod(
  codes: string[],
  logCtx?: LogBatchContext,
): Promise<Record<string, Record<string, number>>> {
  const out: Record<string, Record<string, number>> = {};
  if (codes.length === 0) return out;

  let pageNo = 1;
  for (;;) {
    const { data, pages } = await fetchEastmoneyJsonPage(buildSharesBatchUrl(codes, pageNo), logCtx);
    for (const row of data) {
      const code = String(row.SECURITY_CODE || '').toUpperCase();
      const reportDate = String(row.REPORT_DATE || '').slice(0, 10);
      const shares = parseFloat(String(row.TOTAL_SHARES ?? ''));
      if (!code || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) continue;
      if (!isFinite(shares) || shares <= 0) continue;
      (out[code] ||= {})[reportDate] = shares;
    }
    if (pageNo >= pages) break;
    pageNo += 1;
    await throttleRequest(); // 翻页请求同样节流
  }
  return out;
}

// ---------- 对外入口（批量） ----------

// 批量查询多只股票的年度分红（一次或少量 HTTP 请求），返回与输入 codes 一一对应的结果。
// 口径说明：
//  - 只保留有金额（PRETAX_BONUS_RMB > 0）的记录，自动排除「预披露」类无金额行
//    （如"分红金额上限不超过…"）；
//  - 已实施与已公告预案（董事会决议通过等）都计入，与原同花顺主源口径一致；
//  - 所属年度按报告期 REPORT_DATE 的年份汇总（如 2025-06-30 计入 2025 年）。
export async function fetchBatchYearlyDividends(codes: string[], logCtx?: LogBatchContext): Promise<YearlyDividends[]> {
  if (codes.length === 0) return [];
  await throttleRequest();

  const failAll = (message: string): YearlyDividends[] =>
    codes.map(code => ({ found: false, code, dividend2024: 0, dividend2025: 0, dividendByYear: {}, records: [], source: '东方财富' as const, error: message }));

  try {
    const allRows: Array<Record<string, unknown>> = [];
    let pageNo = 1;
    for (;;) {
      const { data, pages } = await fetchEastmoneyJsonPage(buildBatchEastmoneyUrl(codes, pageNo), logCtx);
      allRows.push(...data);
      if (pageNo >= pages) break;
      pageNo += 1;
      await throttleRequest(); // 翻页请求同样节流
    }

    // 按 6 位代码分组（输入代码可能带 .SH/.SZ/.BJ 后缀，返回里是不带后缀的）
    const byCode = new Map<string, { name?: string; records: DividendRecord[] }>();
    for (const row of allRows) {
      const pretaxPer10 = parseFloat(String(row.PRETAX_BONUS_RMB ?? ''));
      if (isNaN(pretaxPer10) || pretaxPer10 <= 0) continue;
      const stripped = String(row.SECURITY_CODE || '').toUpperCase();
      const reportDate = String(row.REPORT_DATE || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) continue;
      const bucket = byCode.get(stripped) || { name: row.SECURITY_NAME_ABBR ? String(row.SECURITY_NAME_ABBR) : undefined, records: [] };
      bucket.records.push({
        reportDate,
        pretaxPer10,
        planProfile: String(row.IMPL_PLAN_PROFILE || ''),
        registerDate: String(row.EQUITY_RECORD_DATE || '').slice(0, 10) || undefined,
      });
      byCode.set(stripped, bucket);
    }

    return codes.map(code => {
      const bucket = byCode.get(code.replace(/\.(SH|SZ|BJ)$/i, '').toUpperCase());
      if (!bucket || bucket.records.length === 0) {
        return { found: false, code, dividend2024: 0, dividend2025: 0, dividendByYear: {}, records: [], source: '东方财富' as const };
      }
      const byYear: Record<number, number> = {};
      for (const r of bucket.records) {
        const y = parseInt(r.reportDate.slice(0, 4), 10);
        byYear[y] = (byYear[y] || 0) + r.pretaxPer10;
      }
      for (const y of Object.keys(byYear)) {
        byYear[+y] = Math.round((byYear[+y] / 10) * 10000) / 10000;
      }
      return {
        found: true,
        code,
        name: bucket.name,
        dividend2024: byYear[2024] || 0,
        dividend2025: byYear[2025] || 0,
        dividendByYear: byYear,
        records: bucket.records,
        source: '东方财富' as const,
      };
    });
  } catch (e) {
    return failAll(e instanceof Error ? e.message : '请求失败');
  }
}

// ---------- 对外入口（逐只，当前在线方案） ----------

// 查询一只股票的 2024/2025 全年分红（每股税前派息，按分红所属年度汇总）。
// 主源同花顺 F10 HTML（含中期分红），失败降级东方财富单只查询。
export async function fetchYearlyDividends(code: string, logCtx?: LogBatchContext): Promise<YearlyDividends> {
  await throttleRequest();

  const ths = await fetchFromTonghuashun(code, logCtx);
  if (ths) {
    return ths;
  }

  const em = await fetchFromEastmoney(code, logCtx);
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
