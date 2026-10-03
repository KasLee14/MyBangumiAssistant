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

const container = document.getElementById('root');
if (!container) throw new Error('缺少 #root 容器。');

createRoot(container).render(
  <StrictMode>
    <Provider store={store}>
      <MainPage />
    </Provider>
  </StrictMode>,
);
