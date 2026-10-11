import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { AppRouter } from './router';
import { store } from './store';
// 样式令牌层：按族分（颜色 → 排版 → 动效 → 间距 → 层次 → 形状 → 交互机制）。
// 全部只写 :root 变量与全局伪元素规则，顺序不影响取值（CSS 变量是运行期解析）。
import './styles/base/color/bgm.css';
import './styles/base/color/app.css';
import './styles/base/typography/typography.css';
import './styles/base/motion/motion.css';
import './styles/base/space/space.css';
import './styles/base/elevation/elevation.css';
import './styles/base/shape/shape.css';
import './styles/base/interaction/interaction.css';
// 跨页面共享的表面原语（顶栏骨架、玻璃浮起层、可选中行、空态、微标签、错峰入场）。
import './styles/common.css';
// 主界面四件：外壳、输入区、内容卡与弹窗。
import './page/mainPage/styles/frame.css';
import './page/mainPage/styles/composer.css';
import './page/mainPage/styles/cards.css';
import './page/mainPage/styles/modal.css';
// 内容组件库样式（条目、统计、进度、表格等），只消费 --bgm-* / --app-* 令牌。
import './styles/content.css';
// 调试页皮肤：只新增 debug 前缀的类，不覆写任何既有组件的类。
import './page/debug/styles/debug.css';
// 组件库文档页皮肤：只新增 lib 前缀的类，不覆写任何既有组件的类。排最后是因为它只消费令牌，
// 且文档页要展示内容条目（`content.css` 必须已经在）。
import './page/library/styles/library.css';

/**
 * 应用装配入口（`web/index.html` 唯一引用它，也是**唯一**的 HTML 入口）。
 *
 * 这里**不写任何路由逻辑**：路由表、分支、路径常量都在 `src/router/`，本文件只引用
 * `<AppRouter />`。改造前本文件里的「按 hash 在 `MainPage` 与 `DebugPage` 之间互斥挂载」
 * 与 `data-debug` 标记都已删除——前者进了路由表（`/` 与 `/debug`），后者早就没有消费方
 * （调试页样式作用域改用 `.appFrame[data-mode='debug']`，见 `styles/debug.css`）。
 *
 * 样式引入链的顺序是契约（见 `web/README.md` §样式）：
 * base 七族令牌 → common → 主界面四件（frame / composer / cards / modal）→ content → debug → library。
 * 改造前这条链在 `main.tsx` 与已删除的 `library.tsx` 各写一次，现在只有这一处；
 * `bgm.css` 原先夹在主界面四件之后（让「谁定义颜色」在链里一眼可见），现在随令牌层进
 * `base/color/`——令牌层两边都只写 `:root` 变量，运行期解析，取值不受位置影响。
 *
 * redux 的 `<Provider>` 留在这里而不是搬进 `src/router/`：store 装配不是路由逻辑，
 * 路由目录只负责「哪个地址渲染哪个页面」。
 */
const container = document.getElementById('root');
if (!container) throw new Error('缺少 #root 容器。');

createRoot(container).render(
  <StrictMode>
    <Provider store={store}>
      <AppRouter />
    </Provider>
  </StrictMode>,
);
