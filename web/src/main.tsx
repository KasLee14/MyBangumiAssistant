import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { MainPage } from './page/mainPage';
import { store } from './store';
import './styles/tokens.css';
import './styles/frame.css';
import './styles/composer.css';
import './styles/cards.css';
import './styles/modal.css';
// Bangumi 风格覆盖层必须最后引入：它重定向语义令牌并覆盖组件形态。
import './styles/bgm.css';
// 内容组件库样式（条目、统计、进度、表格等），只消费 --bgm-* 令牌。
import './styles/content.css';
// v2（动效版）外观。全部规则都在 [data-ui='v2'] 作用域内或使用 v2* 类名，
// 因此必须在上面 8 个文件之后引入，且不会影响 v1。
import './styles/v2/tokens.css';
import './styles/v2/shell.css';
import './styles/v2/conversation.css';
import './styles/v2/composer.css';
import './styles/v2/overlays.css';
import './styles/v2/content.css';

const container = document.getElementById('root');
if (!container) throw new Error('缺少 #root 容器。');

/*
 * 外观作用域属性必须在**首帧渲染之前**写到 <html> 上。
 *
 * 放在 `ShellV2` 的 effect 里会晚一帧，那一帧 v2 的样式还没生效，切换时会闪一下
 * 无样式的骨架。这里按 store 里的初始版本预置一次；之后由 `ShellV2` 自己维护，
 * 切回 v1 时它会删掉这个属性。
 */
if (store.getState().ui.variant === 'v2') {
  document.documentElement.dataset['ui'] = 'v2';
}

createRoot(container).render(
  <StrictMode>
    <Provider store={store}>
      <MainPage />
    </Provider>
  </StrictMode>,
);
