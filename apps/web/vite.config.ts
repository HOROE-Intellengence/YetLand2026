import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@yelan/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@yelan/design-tokens': path.resolve(__dirname, '../../packages/design-tokens/src/tokens.ts'),
    },
  },
  server: {
    port: 5173,
    // 开发期默认走 apps/api；通过 VITE_USE_MOCK=false 切到真实 server
    proxy: {
      '/api': {
        target: process.env.VITE_API_BASE ?? 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  worker: {
    format: 'es',
  },
});
