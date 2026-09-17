
import { TradeRecord, AppSettings, StockEntry, StockSettings } from "../types";

const GIST_FILENAME = "gold-trades.json";
const GIST_DESCRIPTION = "GoldCost Pro 交易记录备份";

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

interface GistPayload {
  trades?: TradeRecord[];
  settings?: AppSettings;
  stocks?: StockEntry[];
  stockSettings?: StockSettings;
  version?: number;
}

export const loadFromGist = async (token: string, gistId: string): Promise<{ trades: TradeRecord[], settings?: AppSettings, stocks?: StockEntry[], stockSettings?: StockSettings } | null> => {
  try {
    const response = await fetch(`https://api.github.com/gists/${gistId}`, {
      headers: getHeaders(token),
      cache: 'no-cache' // Ensure we get fresh data
    });

    if (!response.ok) {
      await handleApiError(response, "下载数据失败");
    }

    const data = await response.json();
    const file = data.files[GIST_FILENAME];

    if (!file || !file.content) {
      throw new Error(`Gist 中未找到目标文件 '${GIST_FILENAME}'。请确认该 Gist 是由本应用创建的。`);
    }

    const parsed = JSON.parse(file.content);

    // Backward compatibility: Old format was just an array of trades
    if (Array.isArray(parsed)) {
      return { trades: parsed };
    }

    // New format: Object containing trades, settings and stocks
    return {
      trades: parsed.trades || [],
      settings: parsed.settings,
      stocks: parsed.stocks,
      stockSettings: parsed.stockSettings
    };

  } catch (error) {
    console.error("Load from Gist failed:", error);
    if (error instanceof TypeError && error.message.includes("fetch")) {
       throw new Error(`网络请求失败: 无法连接到 GitHub。\n${error.message}`);
    }
    throw error;
  }
};

export const saveToGist = async (
  token: string,
  data: { trades?: TradeRecord[], settings?: AppSettings, stocks?: StockEntry[], stockSettings?: StockSettings },
  gistId?: string
): Promise<string> => {
  
  const payload: GistPayload = {
    trades: data.trades,
    settings: data.settings,
    stocks: data.stocks,
    stockSettings: data.stockSettings,
    version: 1
  };

  const content = JSON.stringify(payload, null, 2);
  const files = {
    [GIST_FILENAME]: {
      content: content,
    },
  };

  try {
    let url = "https://api.github.com/gists";
    let method = "POST";

    // If we have a gistId, we update (PATCH) instead of create (POST)
    if (gistId) {
      url = `${url}/${gistId}`;
      method = "PATCH";
    }

    // Debug: Check payload size
    if (content.length > 1000000) {
        console.warn("Payload size is large:", content.length);
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
