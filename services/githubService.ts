
import { TradeRecord, AppSettings } from "../types";

const GIST_FILENAME = "gold-trades.json";
const GIST_DESCRIPTION = "GoldCost Pro 交易记录备份";

// Helper to construct headers with robust token handling
const getHeaders = (token: string) => {
  const authHeader = token.startsWith('Bearer ') || token.startsWith('token ') 
    ? token 
    : `token ${token}`;

  return {
    Authorization: authHeader,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json",
  };
};

const handleApiError = async (response: Response, context: string) => {
  let detail = "";
  
  // 1. Try to read response body (JSON or Text)
  try {
    const text = await response.text();
    if (text) {
      try {
        const json = JSON.parse(text);
        if (json.message) {
          detail = json.message;
          // Handle GitHub validation errors array
          if (json.errors && Array.isArray(json.errors)) {
             const subErrors = json.errors.map((e: any) => e.field ? `${e.field}: ${e.code}` : e.message).join('; ');
             detail += ` [${subErrors}]`;
          }
        } else {
          detail = text.slice(0, 300); // Fallback to raw text if no message field
        }
      } catch {
        detail = text.slice(0, 300); // Fallback to raw text if not JSON
      }
    }
  } catch (e) {
    console.error("Error reading response body:", e);
  }

  // 2. Fallback if body provided no info
  if (!detail || detail.trim() === "") {
    if (response.statusText) {
      detail = response.statusText;
    } else {
      // 3. Status Code specific defaults
      switch (response.status) {
        case 401: detail = "Token 无效或已过期，请检查设置。"; break;
        case 403: detail = "权限不足 (可能缺少 gist 权限)。"; break;
        case 404: detail = "资源未找到 (Gist ID 错误)。"; break;
        case 422: detail = "数据验证失败 (格式错误)。"; break;
        case 500: detail = "GitHub 服务器内部错误。"; break;
        default: detail = "未知错误 (无响应内容)。";
      }
    }
  }
  
  throw new Error(`${context} [Status: ${response.status}] - ${detail}`);
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
    // Ensure network errors are also clear
    if (error instanceof TypeError && error.message.includes("fetch")) {
       throw new Error(`网络连接失败: 请检查您的网络设置 (如代理/VPN)。\n详细: ${error.message}`);
    }
    throw error;
  }
};

interface GistPayload {
  trades: TradeRecord[];
  settings?: AppSettings;
  version?: number;
}

export const loadFromGist = async (token: string, gistId: string): Promise<{ trades: TradeRecord[], settings?: AppSettings } | null> => {
  try {
    const response = await fetch(`https://api.github.com/gists/${gistId}`, {
      headers: getHeaders(token),
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

    // New format: Object containing trades and settings
    return {
      trades: parsed.trades || [],
      settings: parsed.settings
    };

  } catch (error) {
    console.error("Load from Gist failed:", error);
    if (error instanceof TypeError && error.message.includes("fetch")) {
       throw new Error(`网络请求失败: 请检查网络连接。\nDetails: ${error.message}`);
    }
    throw error;
  }
};

export const saveToGist = async (
  token: string,
  data: { trades: TradeRecord[], settings: AppSettings },
  gistId?: string
): Promise<string> => {
  
  const payload: GistPayload = {
    trades: data.trades,
    settings: data.settings,
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
       throw new Error(`网络请求失败: 请检查网络连接。\nDetails: ${error.message}`);
    }
    throw error;
  }
};
