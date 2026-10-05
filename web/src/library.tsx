import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LibraryPage } from './page/library';
// antd 的 reset 只服务这一个入口（组件库文档页），因此放在所有样式之前：它做的是全局重置。
import 'antd/dist/reset.css';
import './styles/tokens.css';
import './styles/frame.css';
import './styles/composer.css';
import './styles/cards.css';
import './styles/modal.css';
// 与 main.tsx 相同的顺序契约：bgm.css 必须在五个基础样式之后（重定向靠后定义覆盖），
// content.css 只消费令牌、位置不敏感。
import './styles/bgm.css';
import './styles/content.css';
// 组件库文档页皮肤：只新增 lib 前缀的类，不覆写任何既有组件的类。
import './styles/library.css';

/**
 * 组件库文档页的入口。
 *
 * 与主界面共用一个 Vite 工程、一份令牌与一份 `content.css`，但**不连宿主**：页面只渲染
 * 静态示例、不发任何请求。骨架用 antd（只在本入口引入，主界面 bundle 不含它）。
 */
const container = document.getElementById('root');
if (!container) throw new Error('缺少 #root 容器。');

createRoot(container).render(
  <StrictMode>
    <LibraryPage />
  </StrictMode>,
);
