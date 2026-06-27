// ⚠️ 改 admin 源码后如何生效，取决于你用哪个入口：
//   · 5173（`pnpm --filter admin dev`）→ HMR 即时生效，无需 build。
//   · 8787/admin（api 内嵌静态）→ 只读本配置产出的 dist/，
//     改了 src/** 必须先 `pnpm --filter admin build`，否则看到的还是旧产物。
//   详见 apps/api/src/index.ts 的 admin 静态托管块。
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
