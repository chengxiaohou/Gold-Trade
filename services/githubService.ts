
import { TradeRecord, AppSettings, StockEntry, StockSettings, BacktestStrategyPreset } from "../types";
import { splitFinancialsFromStocks, joinFinancialsToStocks, type StocksFileStock, type FinancialsIndex } from "./stockSync";

const GIST_FILENAME = "gold-trades.json"; // 旧版单文件（迁移时删除）
const GIST_DESCRIPTION = "GoldCost Pro 交易记录备份";
// 拆分后的三个云端文件
export const CLOUD_GOLD_FILENAME = "gold.json";
export const CLOUD_STOCKS_FILENAME = "stocks.json";
export const CLOUD_FINANCIALS_FILENAME = "financials.json";
export const CLOUD_FILE_NAMES = [CLOUD_GOLD_FILENAME, CLOUD_STOCKS_FILENAME, CLOUD_FINANCIALS_FILENAME] as const;
export type CloudFileName = (typeof CLOUD_FILE_NAMES)[number];

// Helper to construct headers with robust token handling
const getHeaders = (token: string) => {
  const cleanToken = token.trim();
  const authHeader = cleanToken.startsWith('Bearer ') || cleanToken.startsWith('token ') 
    ? cleanToken 
    : `token ${cleanToken}`;

  return {
    Authorization: authHeader,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json",
  };
};

const handleApiError = async (response: Response, context: string) => {
  const requestId = response.headers.get('x-github-request-id') || 'N/A';
  let rawBody = "";
  
  try {
    rawBody = await response.text();
  } catch (e) {
    console.warn("Failed to read error response body", e);
    rawBody = "[无法读取响应体]";
  }

  // 详细的 Console 日志，方便开发者或用户截图调试
  console.group(`❌ GitHub API Error: ${context}`);
  console.log(`URL: ${response.url}`);
  console.log(`Status: ${response.status} ${response.statusText}`);
  console.log(`Request-ID: ${requestId}`);
  console.log(`Raw Body:`, rawBody);
  console.groupEnd();

  let friendlyDetails = "";
  
  // 1. 尝试解析 JSON 错误信息
  try {
    if (rawBody && rawBody !== "[无法读取响应体]") {
      const json = JSON.parse(rawBody);
      if (json.message) {
        friendlyDetails = json.message;
        // GitHub Validation Errors
        if (json.errors && Array.isArray(json.errors)) {
           const subErrors = json.errors.map((e: any) => {
             if (e.field && e.code) return `${e.field} (${e.code})`;
             return e.message || JSON.stringify(e);
           }).join('; ');
           friendlyDetails += ` [Errors: ${subErrors}]`;
        }
      }
    }
  } catch {
    // 2. 如果不是 JSON，尝试使用原始内容（如果是 HTML 或者是纯文本错误）
    if (rawBody && rawBody.trim()) {
      // 截断过长的 HTML 报错页面
      friendlyDetails = rawBody.slice(0, 300).replace(/\s+/g, ' ').trim(); 
      if (rawBody.length > 300) friendlyDetails += "...";
    }
  }

  // 3. 如果内容依然为空，使用状态码推断默认信息
  if (!friendlyDetails) {
      if (response.statusText) {
          friendlyDetails = response.statusText;
      } else {
        switch (response.status) {
          case 400: friendlyDetails = "请求参数错误 (Bad Request)"; break;
          case 401: friendlyDetails = "Token 无效或已过期"; break;
          case 403: friendlyDetails = "权限不足 (Forbidden) - 请检查 Token 权限"; break;
          case 404: friendlyDetails = "未找到资源 (Not Found) - 请检查 Gist ID"; break;
          case 422: friendlyDetails = "数据校验失败 (Unprocessable Entity)"; break;
          case 500: friendlyDetails = "GitHub 服务端内部错误 (Internal Server Error)"; break;
          case 502: friendlyDetails = "网关错误 (Bad Gateway)"; break;
          case 503: friendlyDetails = "服务暂时不可用 (Service Unavailable)"; break;
          default: friendlyDetails = `HTTP Error ${response.status}`;
        }
      }
  }

  // 构建最终抛出的错误对象，包含足够的信息供 Alert 显示
  throw new Error(`${context}\nCode: ${response.status}\nReqID: ${requestId}\nInfo: ${friendlyDetails}`);
};

export const validateConnection = async (token: string, gistId?: string): Promise<string> => {
  try {
    // 1. Verify Token by fetching User info
    const userRes = await fetch("https://api.github.com/user", {
      headers: getHeaders(token),
    });

    if (!userRes.ok) {
      await handleApiError(userRes, "Token 验证失败");
    }

    const userData = await userRes.json();
    const username = userData.login;

    // 2. If Gist ID provided, verify it exists and is accessible
    if (gistId) {
      const gistRes = await fetch(`https://api.github.com/gists/${gistId}`, {
        headers: getHeaders(token),
      });

      if (!gistRes.ok) {
        await handleApiError(gistRes, "Gist ID 验证失败");
      }
    }

    return username;
  } catch (error) {
    console.error("Validation failed:", error);
    if (error instanceof TypeError && error.message.includes("fetch")) {
       throw new Error(`网络连接失败: 无法连接到 GitHub API。\n请检查网络/代理/VPN设置。\n(${error.message})`);
    }
    throw error;
  }
};

export interface GistData {
  trades: TradeRecord[];
  settings?: AppSettings;
  stocks?: StockEntry[];
  stockSettings?: StockSettings;
  backtestStrategyPresets?: BacktestStrategyPreset[];
}

// 安全解析 JSON：失败返回 null（新文件缺失或损坏时不抛错，按空处理）
function safeParse(raw: string): Record<string, any> | null {
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

export const loadFromGist = async (token: string, gistId: string): Promise<GistData | null> => {
  try {
    const response = await fetch(`https://api.github.com/gists/${gistId}`, {
      headers: getHeaders(token),
      cache: 'no-cache' // Ensure we get fresh data
    });

    if (!response.ok) {
      await handleApiError(response, "下载数据失败");
    }

    const data = await response.json();
    const files: Record<string, { content?: string }> = data.files || {};

    // 新版：三文件
    const goldRaw = files[CLOUD_GOLD_FILENAME]?.content;
    const stocksRaw = files[CLOUD_STOCKS_FILENAME]?.content;
    const finRaw = files[CLOUD_FINANCIALS_FILENAME]?.content;
    if (goldRaw !== undefined || stocksRaw !== undefined || finRaw !== undefined) {
      const gold = safeParse(goldRaw || '{}') || {};
      const stocksParsed = safeParse(stocksRaw || '{}') || {};
      const finParsed = safeParse(finRaw || '{}') || {};
      const financials: FinancialsIndex = finParsed.financials || {};
      const coreStocks: StocksFileStock[] = Array.isArray(stocksParsed.stocks) ? stocksParsed.stocks : [];
      return {
        trades: Array.isArray(gold.trades) ? gold.trades : [],
        settings: gold.settings,
        stocks: joinFinancialsToStocks(coreStocks, financials),
        stockSettings: stocksParsed.stockSettings,
        backtestStrategyPresets: stocksParsed.backtestStrategyPresets,
      };
    }

    // 旧版单文件（迁移前）
    const legacy = files[GIST_FILENAME]?.content;
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (Array.isArray(parsed)) {
        return { trades: parsed };
      }
      return {
        trades: parsed.trades || [],
        settings: parsed.settings,
        stocks: parsed.stocks,
        stockSettings: parsed.stockSettings,
        backtestStrategyPresets: parsed.backtestStrategyPresets,
      };
    }

    throw new Error(`Gist 中未找到本应用的数据文件。请确认该 Gist 是由本应用创建的。`);
  } catch (error) {
    console.error("Load from Gist failed:", error);
    if (error instanceof TypeError && error.message.includes("fetch")) {
       throw new Error(`网络请求失败: 无法连接到 GitHub。\n${error.message}`);
    }
    throw error;
  }
};

// 探测 gist 中已存在的文件（用于迁移检测：云端仍是旧版单文件时，写全三文件并删除旧文件）。
export interface CloudFilePresence {
  gold: boolean;
  stocks: boolean;
  financials: boolean;
  legacy: boolean;
}
export async function getCloudFilePresence(token: string, gistId: string): Promise<CloudFilePresence> {
  const response = await fetch(`https://api.github.com/gists/${gistId}`, {
    headers: getHeaders(token),
    cache: 'no-cache',
  });
  if (!response.ok) {
    await handleApiError(response, "读取云端文件清单失败");
  }
  const data = await response.json();
  const names = Object.keys(data.files || {});
  return {
    gold: names.includes(CLOUD_GOLD_FILENAME),
    stocks: names.includes(CLOUD_STOCKS_FILENAME),
    financials: names.includes(CLOUD_FINANCIALS_FILENAME),
    legacy: names.includes(GIST_FILENAME),
  };
}

export interface SaveToGistOptions {
  /** 要写入的文件；缺省写入全部三个文件 */
  files?: CloudFileName[];
  /** 是否删除旧版单文件 gold-trades.json（首次迁移到多文件时用） */
  deleteLegacy?: boolean;
}

export const saveToGist = async (
  token: string,
  data: GistData & { trades?: TradeRecord[]; stocks?: StockEntry[] },
  gistId?: string,
  opts?: SaveToGistOptions
): Promise<string> => {
  const filesToWrite = opts?.files ?? [...CLOUD_FILE_NAMES];
  const files: Record<string, { content?: string } | null> = {};
  const coreStocks = splitFinancialsFromStocks(data.stocks || []);

  for (const name of filesToWrite) {
    if (name === CLOUD_GOLD_FILENAME) {
      files[name] = {
        content: JSON.stringify({ version: 1, trades: data.trades || [], settings: data.settings }),
      };
    } else if (name === CLOUD_STOCKS_FILENAME) {
      files[name] = {
        content: JSON.stringify({ version: 1, stocks: coreStocks.core, stockSettings: data.stockSettings, backtestStrategyPresets: data.backtestStrategyPresets }),
      };
    } else if (name === CLOUD_FINANCIALS_FILENAME) {
      files[name] = {
        content: JSON.stringify({ version: 1, financials: coreStocks.financials }),
      };
    }
  }

  if (opts?.deleteLegacy) {
    files[GIST_FILENAME] = null; // 删除旧版单文件
  }

  try {
    let url = "https://api.github.com/gists";
    let method = "POST";

    // If we have a gistId, we update (PATCH) instead of create (POST)
    if (gistId) {
      url = `${url}/${gistId}`;
      method = "PATCH";
    }

    // 单文件硬上限 1MB，这里只对即将写入的最大单文件体积做一次诊断提示
    let maxLen = 0;
    for (const name of Object.keys(files)) {
      const f = files[name];
      if (f && f.content && f.content.length > maxLen) maxLen = f.content.length;
    }
    if (maxLen > 1000000) {
      console.warn("Payload size is large:", maxLen);
    }

    const response = await fetch(url, {
      method: method,
      headers: getHeaders(token),
      body: JSON.stringify({
        description: GIST_DESCRIPTION,
        public: false, // Default to secret gist
        files: files,
      }),
    });

    if (!response.ok) {
      await handleApiError(response, "上传数据失败");
    }

    const resData = await response.json();
    return resData.id; // Return the new or existing Gist ID
  } catch (error) {
    console.error("Save to Gist failed:", error);
    if (error instanceof TypeError && error.message.includes("fetch")) {
       throw new Error(`网络请求失败: 无法连接到 GitHub。\n${error.message}`);
    }
    throw error;
  }
};
