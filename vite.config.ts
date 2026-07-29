import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Define __dirname in ESM environment to fix the reference error
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      // For GitHub Pages (project site), ensure assets are served from /Gold-Trade/
      base: '/Gold-Trade/',
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/api/tencent-realtime': {
            target: 'https://qt.gtimg.cn',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api\/tencent-realtime/, ''),
            headers: {
              'Referer': 'https://gu.qq.com/',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
          },
          '/api/tencent': {
            target: 'https://web.ifzq.gtimg.cn',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api\/tencent/, ''),
            headers: {
              'Referer': 'https://gu.qq.com/',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
          },
          '/api/sina-realtime': {
            target: 'https://hq.sinajs.cn',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api\/sina-realtime/, ''),
            headers: {
              'Referer': 'https://finance.sina.com.cn/',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
          },
          '/api/sina': {
            target: 'https://money.finance.sina.com.cn',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api\/sina/, ''),
            headers: {
              'Referer': 'https://finance.sina.com.cn/',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
          }
        }
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          // Use the polyfilled __dirname for path resolution
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});