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
 * 因此这里显式把前端依赖（React、Redux）指到已安装的位置，避免依赖仓库根多出一份
 * `node_modules`。前缀别名同时覆盖 `react/jsx-runtime` 与 `react-dom/client`。
 */
/** 宿主 Web 终端地址；dev server 把 /api 反代到这里，可用环境变量改端口。 */
const hostPort = Number(process.env.BGM_WEB_PORT ?? 8787);
const hostOrigin = `http://127.0.0.1:${Number.isSafeInteger(hostPort) && hostPort > 0 ? hostPort : 8787}`;
/** 宿主每次启动都换一次性令牌；这里允许直接注入，省掉浏览器换 Cookie 的一步。 */
const hostToken = process.env.BGM_WEB_TOKEN;
/** dev server 自己的端口；`npm run dev:web` 会按可用性选好后经环境变量传进来。 */
const webPort = Number(process.env.BGM_DEV_PORT ?? 5173);

export default defineConfig({
  root: webRoot,
  base: './',
  plugins: [react()],
  /**
   * 开发服务器：前端由 Vite 直接提供（HMR），`/api` 反代给同时运行的宿主进程。
   *
   * 这样宿主不必改动——它继续只监听回环地址并校验令牌，而浏览器一侧的
   * fetch/EventSource 仍是同源相对路径 `./api/...`，无需 CORS。两条鉴权路径都可用：
   * 先在宿主打印的 `/?token=...` 地址打开一次（Cookie 会随代理落在本端口），
   * 或者用 `BGM_WEB_TOKEN` 注入 `x-bgm-token`，不必经过 Cookie。
   */
  server: {
    host: '127.0.0.1',
    port: Number.isSafeInteger(webPort) && webPort > 0 && webPort <= 65535 ? webPort : 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: hostOrigin,
        changeOrigin: true,
        ...(hostToken ? { headers: { 'x-bgm-token': hostToken } } : {}),
      },
    },
  },
  resolve: {
    alias: {
      react: resolve(modules, 'react'),
      'react-dom': resolve(modules, 'react-dom'),
      redux: resolve(modules, 'redux'),
      'react-redux': resolve(modules, 'react-redux'),
      // 动效库：只有 v2 界面用它。子路径别名必须排在裸包名之前，否则 `motion/react`
      // 会先命中 `motion` 规则、被截成一个没有 `react` 子路径的目录。
      'motion/react': resolve(modules, 'motion/dist/es/react.mjs'),
      motion: resolve(modules, 'motion/dist/es/index.mjs'),
      // 滚动触发与时间线：ReactBits 的 AnimatedContent / TextType 用它。子路径同样在前。
      'gsap/ScrollTrigger': resolve(modules, 'gsap/ScrollTrigger.js'),
      gsap: resolve(modules, 'gsap/index.js'),
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
