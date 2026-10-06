import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { DebugPage } from './page/debug';
import { MainPage } from './page/mainPage';
import { store } from './store';
import { isDebugHash } from './utils/debugMode';
import './styles/tokens.css';
// 跨页面共享的表面原语（顶栏骨架、玻璃浮起层、可选中行、空态、微标签、错峰入场）。
import './styles/common.css';
import './styles/frame.css';
import './styles/composer.css';
import './styles/cards.css';
import './styles/modal.css';
// Bangumi 令牌层：定义 --bgm-*，并把组件样式实际用到的 DSH 语义别名重定向过去。
// 必须在 tokens/frame/composer/cards/modal 之后引入——重定向靠「后定义覆盖先定义」生效。
import './styles/bgm.css';
// 内容组件库样式（条目、统计、进度、表格等），只消费 --bgm-* / --app-* 令牌。
import './styles/content.css';
// 调试页皮肤：只新增 debug 前缀的类，不覆写任何既有组件的类。
import './styles/debug.css';

const container = document.getElementById('root');
if (!container) throw new Error('缺少 #root 容器。');

/**
 * 顶层分流：调试页与主界面互斥挂载。
 *
 * 互斥的原因不只是「显示哪一屏」：主界面挂载时会建立 SSE 连接、拉取目录，
 * 而调试页全程不需要宿主。分开挂载后，调试期间不会有任何到宿主的请求。
 * 主 store 不受影响——切回主界面时重新建连，首帧本来就是全量快照。
 */
function Root(): ReactNode {
  const [debug, setDebug] = useState<boolean>(() => isDebugHash());

  useEffect(() => {
    const sync = (): void => { setDebug(isDebugHash()); };
    window.addEventListener('hashchange', sync);
    sync();
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  useEffect(() => {
    // `data-debug` 现在只是一个状态标记：调试页的样式作用域改为它自己在 `.appFrame` 上声明的
    // `data-mode="debug"`（见 styles/debug.css），不再需要靠 html 属性选择器提升特异性。
    document.documentElement.dataset['debug'] = debug ? 'on' : 'off';
  }, [debug]);

  return debug ? <DebugPage /> : <MainPage />;
}

createRoot(container).render(
  <StrictMode>
    <Provider store={store}>
      <Root />
    </Provider>
  </StrictMode>,
);
