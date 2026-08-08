// Cloudflare Worker: CORS 代理，用于生产环境绕过新浪/腾讯/同花顺/东财 API 的跨域限制
// 部署方法：
//   1) 命令行：npx wrangler deploy workers/cors-proxy.js --name cors-proxy --compatibility-date=2026-08-08
//   2) 控制台：在 Cloudflare 创建 Worker 后，粘贴本文件内容（模块格式），保存并部署
// 部署后地址：https://cors-proxy.gold-trade.workers.dev/
// 依赖：无（Cloudflare Workers 原生支持 CORS headers）

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// 支持代理的目标域名白名单（防止被滥用）
const ALLOWED_HOSTS = [
  'money.finance.sina.com.cn',
  'web.ifzq.gtimg.cn',
  'qt.gtimg.cn',
  'hq.sinajs.cn',
  'datacenter-web.eastmoney.com', // 股息页分红数据（东方财富 datacenter 接口，备用源）
  'basic.10jqka.com.cn',          // 股息页分红数据（同花顺 F10 分红融资，主数据源）
];

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

async function handleRequest(request) {
  // 处理 CORS 预检请求
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  // 从查询参数获取目标 URL
  const targetUrl = url.searchParams.get('url') || url.pathname.replace(/^\//, '');

  if (!targetUrl || !targetUrl.startsWith('http')) {
    return jsonResponse({ error: '缺少 url 参数' }, 400);
  }

  // 安全检查：只允许代理白名单内的域名
  try {
    const target = new URL(targetUrl);
    if (!ALLOWED_HOSTS.includes(target.hostname)) {
      return jsonResponse({ error: `域名不被允许: ${target.hostname}` }, 403);
    }
  } catch {
    return jsonResponse({ error: '无效的 URL' }, 400);
  }

  // 设置请求头模拟浏览器（避免被 API 拦截）
  const referer = targetUrl.includes('sina')
    ? 'https://finance.sina.com.cn/'
    : targetUrl.includes('gtimg')
      ? 'https://gu.qq.com/'
      : targetUrl.includes('eastmoney')
        ? 'https://data.eastmoney.com/'
        : targetUrl.includes('10jqka')
          ? 'https://basic.10jqka.com.cn/'
          : '';
  const headers = new Headers({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': referer,
  });

  try {
    const response = await fetch(targetUrl, {
      headers,
      cf: {
        // Cloudflare 缓存（10 分钟），减少重复请求
        cacheEverything: true,
        cacheTtl: 600,
      },
    });

    const body = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'application/json';

    return new Response(body, {
      status: response.status,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': contentType,
      },
    });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : '请求失败' }, 502);
  }
}

export default {
  async fetch(request) {
    return handleRequest(request);
  },
};
