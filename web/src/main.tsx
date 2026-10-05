import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { DebugPage } from './page/debug';
import { MainPage } from './page/mainPage';
import { store } from './store';
import { isDebugHash } from './utils/debugMode';
import './styles/tokens.css';
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
    // 样式作用域：调试页要更宽的侧栏，靠 html 上的属性选择器生效（见 styles/debug.css）。
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
