import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..', 'web');
const modules = resolve(here, 'node_modules');

/**
 * 前端源码在 `../web`，构建产物落在 `dist/web`，由 `src/web/server.ts` 静态托管。
 *
 * 依赖只装在 `bangumi/node_modules`，而前端源码位于仓库根的 `web/`：Node 与
 * Vite 的解析都是从 importer 逐级向上找 `node_modules`，不会拐进兄弟目录，
 * 因此这里显式把 React 指到已安装的位置，避免依赖仓库根多出一份 `node_modules`。
 * 前缀别名同时覆盖 `react/jsx-runtime` 与 `react-dom/client`。
 */
export default defineConfig({
  root: webRoot,
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      react: resolve(modules, 'react'),
      'react-dom': resolve(modules, 'react-dom'),
    },
  },
  build: {
    outDir: resolve(here, 'dist', 'web'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});
