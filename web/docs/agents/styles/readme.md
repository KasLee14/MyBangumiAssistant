# 样式层（`web/src/styles/`）

## 使用说明

### 这份文档是什么

样式层的规则与索引：8 个文件的职责与引入顺序、两套令牌体系、前缀隔离约定与改动步骤。

**不覆盖**：具体组件的视觉规格（见三个子文档与 `docs/bgm-design/ui-style.md`）。上层入口：[AGENTS.md](../../../AGENTS.md)。

### 怎么读（文件 → 场景）

| 文件 | 什么时候读 |
|---|---|
| 本文件 | 判断新样式该写进哪个文件、核对引入顺序时 |
| [tokens.md](tokens.md) | 改设计令牌、字体、圆角刻度、焦点环时 |
| [frame.md](frame.md) | 改外壳网格、会话区布局、滚动与首屏行为时 |
| [components.md](components.md) | 改确认卡、输入区、弹窗样式时 |
| [content-and-brand.md](content-and-brand.md) | 改内容条目样式、品牌色或形态覆盖时 |

### 必须遵守的规则

1. **引入顺序固定**：`tokens → frame → composer → cards → modal → bgm → content`，`bgm.css` 必须在它重定向的那些文件之后。违反后果：品牌令牌不生效，部分颜色与圆角回到 DSH 默认。见 §引入顺序是契约。
2. **不写死颜色，一律走令牌**：违反后果：换令牌时局部不跟随，视觉不一致。见 §两条令牌体系。
3. **每个文件只用自己的命名前缀**：违反后果：样式互相污染，出问题难以定位来源。见 §隔离规则。
4. **只有浅色一套，不写主题分支**：违反后果：死代码与不可维护的分支。见 §唯一浅色外观。
5. **保留焦点环、关键信息不依赖 hover**：违反后果：键盘用户不可用（这两条是刻意规避站点自身的可用性问题）。见 §新增样式的步骤。
6. **v2 的覆写必须带 `[data-ui='v2']` 前缀**：v2 自有组件用 `v2*` 类名；一旦要改共享渲染器的既有类（`.bubble`、`.modalSurface`…），选择器必须写成 `[data-ui='v2'] .bubble`。违反后果：覆写会命中 v1 的 DOM，v1 的外观被 v2 改掉。见 §v2 是怎么隔离的。

## v2 是怎么隔离的

v1 与 v2 同时活在同一份 CSS 里，靠两件事互不干扰：

1. **作用域属性在 `<html>` 上**：`main.tsx` 在首帧前按 `store.ui.variant` 预置 `document.documentElement.dataset.ui`，`ShellV2` 挂载后接管、卸载时删除。写在 `<html>` 而不是子树根节点上，是因为统计浮层与弹窗 portal 到 `body`——挂在子树里它们就落在作用域外，v2 的覆写会失效。
2. **v1 里没有任何 `[data-ui]` 选择器**：所以这个属性对 v1 完全透明；反过来 v2 的覆写也只可能命中 v2 的 DOM。

v1↔v2 切换时，v2 的整棵子树与它的作用域属性一起消失，v1 回到没有任何属性、没有任何 v2 类名的状态。

## 这一层是什么

手写 CSS，**无框架、无 CSS-in-JS、无 CSS Modules**。共 8 个文件，按"作用对象"分层，靠**令牌**统一视觉、靠**前缀**互相隔离。

| 文件 | 行数级别 | 作用对象 | 令牌体系 | 子文档 |
|---|---|---|---|---|
| `tokens.css` | ~400 | 设计令牌本体：色板、语义 alias、字体、圆角、焦点环、滚动条 | 定义 `--dsw-*` / `--dsh-*` | [tokens.md](tokens.md) |
| `frame.css` | ~880 | 页面框架与会话区：外壳网格、侧栏、会话头、滚动体、轮次、首屏 | 消费 `--dsh-*` | [frame.md](frame.md) |
| `cards.css` | ~270 | 确认卡座位与卡内提示 | 消费 `--dsh-*` | [components.md](components.md) |
| `composer.css` | ~615 | 输入区与浮层（含思考强度菜单） | 消费 `--dsh-*` | [components.md](components.md) |
| `modal.css` | ~170 | 弹窗（遮罩、表面、字段、选项行、状态条） | 消费 `--dsh-*` | [components.md](components.md) |
| `bgm.css` | ~770 | **品牌覆盖层**：定义 `--bgm-*` 并把组件实际用到的 `--dsw-*` 别名重定向过去，再覆盖形态 | 定义 `--bgm-*`，重定向 `--dsw-*` | [content-and-brand.md](content-and-brand.md) |
| `content.css` | ~855 | 内容组件库（12 种内容条目的样式） | 只用 `--bgm-*` | [content-and-brand.md](content-and-brand.md) |
| `fonts/` | — | Montserrat（OFL，三个字重 woff2 + 许可文件） | — | [tokens.md](tokens.md) |
| `v2/*.css` | 6 个文件 | **v2（动效版）的一整套**：`tokens` / `shell` / `conversation` / `composer` / `overlays` / `content` | 定义并消费 `--v2-*`，并覆写共享类 | [../../AGENTS.md](../../../AGENTS.md) §3 |

## 引入顺序是契约（`main.tsx`）

```ts
tokens → frame → composer → cards → modal → bgm → content
       → v2/tokens → v2/shell → v2/conversation → v2/composer → v2/overlays → v2/content
```

v2 的一组排在**最后**：它们要么用 `v2*` 类名（本来就唯一），要么是 `[data-ui='v2']` 作用域内的覆写——覆写要盖住 v1 的同名规则，因此必须在 v1 的 8 个文件之后引入。

两条硬约束：

1. **`bgm.css` 必须排在 `tokens/frame/composer/cards/modal` 之后**：它是覆盖层，靠"后定义覆盖先定义"把 85 个 `--dsw-*` 语义别名重定向到 `--bgm-*` 品牌令牌，并覆盖圆角/描边/胶囊等形态。位置错了会出现"部分颜色或圆角不生效"。
2. **`content.css` 最后**：它只服务内容组件库，且只消费 `--bgm-*`，放最后可确保品牌令牌已就位。

新增样式文件时，同样要放进这条链的正确位置，并在 `main.tsx` 里加 import。

## 两条令牌体系

| 体系 | 定义处 | 用途 |
|---|---|---|
| `--dsw-*` / `--dsh-*` | `tokens.css`（移植自 deepseek-harness） | 语义令牌（背景/描边/文本/状态色）与布局轴 |
| `--bgm-*` | `bgm.css` | Bangumi 品牌色与形态基准；`content.css` 只认这一套 |

规则：**不写死十六进制**。需要新颜色时优先用已有令牌，或像 `content.css` 那样用 `color-mix()` 从令牌就地派生。

## 隔离规则

每个文件只操作自己的命名前缀，**不得**出现会命中别人 DOM 的选择器：

| 文件 | 允许的选择器 |
|---|---|
| `frame.css` | `.frame`、`.sidebar`、`.conversation`、`.conversationHeader`、`.body`、`.scrollBody`、`.scroll`、`.column`、`.flowItem`、`.turnRail`、`.hero` … |
| `composer.css` | `.composerSeat`、`.composerCard`、`.composerPopup`、`.composerStack`、`.thinkingAnchor`、`.thinkingMenu` … |
| `cards.css` | `.cardSeat`、`.planCard`、`.planStrip`、`.planBody`、`.planActions` … |
| `modal.css` | `.modalOverlay`、`.modalSurface`、`.modalField`、`.modalCheck`、`.modalStatus` … |
| `content.css` | `.content*`（与 `components/content/` 的组件一一对应） |
| `v2/*.css` | `v2*`（v2 自有组件）与 `[data-ui='v2'] <既有类>`（覆写共享渲染器）——见 §v2 是怎么隔离的 |

历史上调试面板的样式曾单独成文件（`.preview*`）并遵守同一规则，后被移除——**这条"前缀隔离"约定保留**：任何新样式文件都要有自己的前缀。

## 唯一浅色外观

没有深色主题、没有主题切换、不跟随系统偏好。因此：

- 不写 `@media (prefers-color-scheme: dark)`；
- 不写主题属性分支（如 `body[data-ds-dark-theme]`）；
- `tokens.css` 只保留上游的浅色语义 alias。

## 新增样式的步骤

1. 先找它属于哪个作用对象：外壳 → `frame.css`；输入区 → `composer.css`；弹窗 → `modal.css`；内容条目 → `content.css`；确属新领域才新建文件；
2. 类名用该文件的既有语汇与前缀（BEM 风格的点线分层：`.planCard` → `.planStrip` → `.planBody`），不要引入新命名体系；
3. 颜色走令牌，尺寸用既有刻度（`--dsw-radius-*`、`--dsh-*` 布局轴）；
4. 保留可见焦点环（`:focus-visible`），关键信息不依赖 hover 才能看到——这两条是刻意规避站点自身的可用性问题；
5. 更新本文件或对应子文档的表格。
