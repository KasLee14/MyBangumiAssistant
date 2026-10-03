# 设计令牌（`styles/tokens.css`）

> 上层：[readme.md](readme.md)。

## 来源与命名

移植自 deepseek-harness 客户端主题包（MIT），逐项对应上游文件：

| 上游文件 | 本文件承载 |
|---|---|
| `design-platform.css` | 色板与语义 alias |
| `base.css` | 字体栈、缓动、圆角刻度 |
| `focus.css` | 焦点环 |
| `scrollbar.css` | 滚动条皮肤 |
| `corner-shape.css` | 超椭圆圆角 |
| `brand-font.css` | Montserrat（OFL，`fonts/` 下三个字重 + 许可文件） |

**变量名保持上游的 `--dsw-*` / `--dsh-*` 命名**，便于与上游逐项核对；本应用自己的品牌令牌用 `--bgm-*`，定义在 `bgm.css`（见 [content-and-brand.md](content-and-brand.md)）。

## 内容清单

1. **`@font-face`**：Montserrat 三个字重（light/regular/medium），字体文件在同目录 `fonts/`。
2. **静态色板**：中性色与品牌色阶（`--dsw-static-*`）。
3. **语义 alias**：`--dsw-alias-*` —— 背景（`bg-*`）、描边（`border-*`）、文本（`label-*`）、状态（`state-*`）、交互（`interactive-*`）等。组件样式**只消费这一层**，不消费静态色板。
4. **布局与结构令牌**：`--dsh-sidebar-width`、`--dsh-chat-content-width` 等（外壳网格与列宽的轴）。
5. **字体与尺寸刻度**：`--dsw-font-*`（组合的 `font` 简写）、`--dsw-radius-*`、缓动曲线。
6. **焦点环与滚动条**：`--dsw-focus-*`、`--dsh-scrollbar-*`。

## 三条约定

1. **只有浅色一套**：上游的深色覆盖块（`body[data-ds-dark-theme]`）与主题切换机制**没有移植**。上游在两处重复声明的同名静态色板这里只声明一次，语义不变。
2. **不要在别处定义 `--dsw-*`**：语义令牌只有这一个定义处；`bgm.css` 只做**重定向**（改变量的值），不新增语义名。
3. **改令牌 = 全局改版**：`--dsw-alias-*` 被 `frame/composer/cards/modal` 大量引用，改一个值会成片改变外观。做局部调整时优先在对应组件的样式文件里覆盖，而不是改令牌。

## 什么时候该改这里

| 场景 | 做法 |
|---|---|
| 整体色板/圆角/字体要变 | 改这里（或经由 `bgm.css` 重定向）——影响面最大，必须按 [../regression/shell-and-layout.md](../regression/shell-and-layout.md) 全量回归 |
| 单个组件要特殊颜色 | 在该组件样式文件里用现有令牌派生（`color-mix()`），不要新增令牌 |
| 要支持深色主题 | 属于产品级改动：需要引入主题属性、补一套 alias 覆盖块，并重新设计所有派生色——当前项目明确不做 |
| 新增字体 | 放 `fonts/`（附许可文件）+ 在 `tokens.css` 加 `@font-face` + 加进字体栈令牌 |
