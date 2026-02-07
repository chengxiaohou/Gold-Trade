import { TradeRecord, AppSettings } from "../types";

const GIST_FILENAME = "gold-trades.json";
const GIST_DESCRIPTION = "GoldCost Pro 交易记录备份";

// Helper to construct headers with robust token handling
const getHeaders = (token: string) => {
  // Check if token already has a prefix, if not, assume classic token and add 'token' prefix
  // or simple Bearer if it's fine-grained, but 'token' works for classic which is most common for Gists.
  // Actually, for Gists API, 'token GITHUB_TOKEN' or 'Bearer GITHUB_TOKEN' works.
  // We'll stick to 'token' for Classic PATs which are most common for this use case.
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
  let errorMessage = `GitHub API Error: ${response.statusText}`;
  
  if (response.status === 401) {
    errorMessage = "鉴权失败 (401)：Token 无效或已过期。请检查 Token 是否包含多余空格。";
  } else if (response.status === 403) {
    errorMessage = "权限不足 (403)：Token 可能缺少 'gist' 权限。";
  } else if (response.status === 404) {
    errorMessage = "找不到资源 (404)：Gist ID 错误或该 Gist 不属于当前 Token。";
  } else {
    try {
      const errData = await response.json();
      if (errData.message) errorMessage = `GitHub Error: ${errData.message}`;
    } catch (e) {
      // ignore json parse error
    }
  }
  
  throw new Error(`${context} - ${errorMessage}`);
};

export const validateConnection = async (token: string, gistId?: string): Promise<string> => {
  // 1. Verify Token by fetching User info
  try {
    const userRes = await fetch("https://api.github.com/user", {
      headers: getHeaders(token),
    });

    if (!userRes.ok) {
      await handleApiError(userRes, "Token 验证");
    }

    const userData = await userRes.json();
    const username = userData.login;

    // 2. If Gist ID provided, verify it exists and is accessible
    if (gistId) {
      const gistRes = await fetch(`https://api.github.com/gists/${gistId}`, {
        headers: getHeaders(token),
      });

      if (!gistRes.ok) {
        await handleApiError(gistRes, "Gist ID 验证");
      }
    }

    return username;
  } catch (error) {
    console.error("Validation failed:", error);
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
      await handleApiError(response, "下载失败");
    }

    const data = await response.json();
    const file = data.files[GIST_FILENAME];

    if (!file || !file.content) {
      throw new Error("Gist 中找不到 'gold-trades.json' 文件");
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
      await handleApiError(response, "上传失败");
    }

    const resData = await response.json();
    return resData.id; // Return the new or existing Gist ID
  } catch (error) {
    console.error("Save to Gist failed:", error);
    throw error;
  }
};