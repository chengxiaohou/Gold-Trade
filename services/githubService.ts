import { TradeRecord } from "../types";

const GIST_FILENAME = "gold-trades.json";
const GIST_DESCRIPTION = "GoldCost Pro 交易记录备份";

export const loadFromGist = async (token: string, gistId: string): Promise<TradeRecord[] | null> => {
  try {
    const response = await fetch(`https://api.github.com/gists/${gistId}`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API Error: ${response.statusText}`);
    }

    const data = await response.json();
    const file = data.files[GIST_FILENAME];

    if (!file || !file.content) {
      throw new Error("找不到目标文件");
    }

    return JSON.parse(file.content);
  } catch (error) {
    console.error("Load from Gist failed:", error);
    throw error;
  }
};

export const saveToGist = async (
  token: string,
  trades: TradeRecord[],
  gistId?: string
): Promise<string> => {
  const content = JSON.stringify(trades, null, 2);
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
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        description: GIST_DESCRIPTION,
        public: false, // Default to secret gist
        files: files,
      }),
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.message || `GitHub API Error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.id; // Return the new or existing Gist ID
  } catch (error) {
    console.error("Save to Gist failed:", error);
    throw error;
  }
};
