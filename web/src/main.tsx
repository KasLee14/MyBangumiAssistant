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
// Bangumi 令牌层：定义 --bgm-*，并把组件样式实际用到的 DSH 语义别名重定向过去。
// 必须在 tokens/frame/composer/cards/modal 之后引入——重定向靠「后定义覆盖先定义」生效。
import './styles/bgm.css';
// 内容组件库样式（条目、统计、进度、表格等），只消费 --bgm-* / --app-* 令牌。
import './styles/content.css';

const container = document.getElementById('root');
if (!container) throw new Error('缺少 #root 容器。');

createRoot(container).render(
  <StrictMode>
    <Provider store={store}>
      <MainPage />
    </Provider>
  </StrictMode>,
);
