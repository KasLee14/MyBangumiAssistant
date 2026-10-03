# 样式层（`web/src/styles/`）

> 上层入口：[../../AGENTS.md](../../../AGENTS.md)。本文件是样式层的索引与硬约定。

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

## 引入顺序是契约（`main.tsx`）

```ts
tokens → frame → composer → cards → modal → bgm → content
```

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

## 子文档

- [tokens.md](tokens.md)：令牌来源、命名、内容清单与改动影响面。
- [frame.md](frame.md)：外壳网格、会话区技术细节（容器查询、屏外优化、贴底滚动）与 DOM 契约。
- [components.md](components.md)：确认卡、输入区、弹窗三组组件样式。
- [content-and-brand.md](content-and-brand.md)：内容组件库样式与 Bangumi 品牌覆盖层。
