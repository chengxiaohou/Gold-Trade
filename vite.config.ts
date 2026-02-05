import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      // 在构建时可通过环境变量 VITE_BASE 设置 base（例如："/Gold-Trade/"），默认使用根路径 "/"
      base: env.VITE_BASE || '/',
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      // 注意：不要在前端打包时注入真实的 API Key（会被公开）。如果需要在服务端调用，请实现后端代理或 serverless。
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
