# 设计令牌（`styles/tokens.css`）

## 使用说明

### 这份文档是什么

设计令牌本体：来源与命名约定、内容清单、外观层令牌（`--app-*`）的来龙去脉与三条约定，以及"什么时候该改这里"的判据。

上层：[readme.md](readme.md)。

### 怎么读（章节 → 场景）

| 章节 | 什么时候读 |
|---|---|
| §来源与命名 | 想知道某个 `--dsw-*` 从哪来、为什么保持上游命名 |
| §内容清单 | 找某类令牌（语义色、字体、圆角、焦点环、滚动条、外观层） |
| §外观层令牌（`--app-*`） | **改动效、阴影、表面或圆角档位前必读**（这一节与 `motionTokens.ts` 是一对） |
| §三条约定 | **改令牌前必读**（只有浅色、只此一处定义、改动影响面） |
| §什么时候该改这里 | 判断"该改令牌，还是改组件样式" |

### 必须遵守的规则

本层通用规则见 [readme.md](readme.md) 的「必须遵守的规则」。本篇专属：

1. **只有浅色一套，不移植深色覆盖块** —— 违反后果：死代码与不可维护的分支（见本层「只有浅色一套，不写主题分支」）。
2. **`--dsw-*` 只在这里定义**，`bgm.css` 只重定向、不新增语义名 —— 违反后果：令牌出现两个定义处。
3. **`--app-*` 与 `motionTokens.ts` 必须同步改** —— 违反后果：CSS 过渡与 motion 过渡跑两条曲线。
4. **不为局部问题新增令牌**，优先用现有令牌派生 —— 违反后果：令牌表膨胀，后续没人敢改。

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
| `gradient-shadow-text.css` | 阴影、elevation 三件套、排版阶梯（思考文本渐变未移植） |

**变量名保持上游的 `--dsw-*` / `--dsh-*` 命名**，便于与上游逐项核对；本应用自己的品牌令牌用 `--bgm-*`，定义在 `bgm.css`（见 [content-and-brand.md](content-and-brand.md)）；外观层用 `--app-*`，定义在本文件末尾。

## 内容清单

1. **`@font-face`**：Montserrat 三个字重（light/regular/medium），字体文件在同目录 `fonts/`。
2. **静态色板**：中性色与品牌色阶（`--dsw-static-*`）。
3. **语义 alias**：`--dsw-alias-*` —— 背景（`bg-*`）、描边（`border-*`）、文本（`label-*`）、状态（`state-*`）、交互（`interactive-*`）等。组件样式**只消费这一层**，不消费静态色板。
4. **布局与结构令牌**：`--dsh-composer-side-clearance`、`--dsh-composer-dock-inset`、`--dsh-composer-text-max-height`、`--dsh-content-font-size` 等（外壳网格与内容轴的刻度）。
5. **字体与尺寸刻度**：`--dsw-font-*`（组合的 `font` 简写）、`--dsw-radius-*`、缓动曲线。
6. **焦点环与滚动条**：`--dsw-focus-*`、`--dsh-scrollbar-*`。
7. **阴影与 elevation**：`--dsw-shadow-lv1` / `--dsw-shadow-lv1-blur` / `--dsw-shadow-lv2` / `--dsw-shadow-lv3`、`--dsw-elevation-*`（`stroke` / `panel` / `prominent` / `soft`，逐元素声明而非从 `body` 继承，原因见文件内注释）。
8. **外观层令牌**：`--app-*`，见下一节。

## 外观层令牌（`--app-*`）

文件末尾的 `:root` 块是**本应用自己的外观层**：它把"动效刻度、阴影、表面、圆角"收敛成一套名字，让 `frame/composer/cards/modal/content` 不必各自写裸值。这些令牌分两类来源：

### 1. 时长、缓动与位移：与 `components/motion/motionTokens.ts` 一一对应

| `tokens.css` | 值 | `motionTokens.ts` | 值 |
|---|---|---|---|
| `--app-dur-instant` | `100ms` | `DURATION.instant` | `0.1` |
| `--app-dur-fast` | `150ms` | `DURATION.fast` | `0.15` |
| `--app-dur-base` | `200ms` | `DURATION.base` | `0.2` |
| `--app-dur-slow` | `300ms` | `DURATION.slow` | `0.3` |
| `--app-dur-slower` | `450ms` | `DURATION.slower` | `0.45` |
| `--app-ease-out` | `cubic-bezier(.22, 1, .36, 1)` | `EASE_OUT` | `[0.22, 1, 0.36, 1]` |
| `--app-ease-in-out` | `cubic-bezier(.4, 0, .2, 1)` | `EASE_IN_OUT` | `[0.4, 0, 0.2, 1]` |
| `--app-shift-row` | `8px` | `SHIFT.row` | `8` |
| `--app-shift-panel` | `16px` | `SHIFT.panel` | `16` |

CSS 侧给 `transition` / `animation` 用，JS 侧给 motion 的 `transition` 用（秒）。**改一处必须同时改另一处**，否则同一个界面会出现两条缓动曲线。

用法上有一条分寸：`instant`（100ms）只给按下、聚焦这类即时反馈，`slower`（450ms）只给首屏这样一次性、面积较大的进入；不要用它做常驻动效。

### 2. 层次、表面、描边与圆角：全部由 `--bgm-*` 派生

| 令牌 | 值 | 分工 |
|---|---|---|
| `--app-shadow-raised` | `0 1px 1px rgba(60,60,60,.04), 0 4px 14px rgba(60,60,60,.07)` | 内嵌/抬起的小元素（气泡、侧栏新建会话、导轨） |
| `--app-shadow-card` | `0 1px 2px rgba(60,60,60,.05), 0 8px 24px rgba(60,60,60,.05)` | 会话里的浮起卡片（确认卡、条目卡） |
| `--app-shadow-panel` | `0 2px 8px rgba(60,60,60,.08), 0 20px 48px rgba(60,60,60,.12)` | 浮层（弹窗、命令候选、思考菜单、统计面板、toast） |
| `--app-surface` | `var(--bgm-surface)` | 主表面（对话区、侧栏、卡片、浮层底） |
| `--app-surface-sunken` | `var(--bgm-bg)` | 下沉表面（页面底色一档）；**当前没有消费者**，属保留位 |
| `--app-surface-tint` | `color-mix(in srgb, var(--bgm-surface) 86%, var(--bgm-primary-soft))` | 图标按钮 hover 的极淡主色底 |
| `--app-hairline` | `color-mix(in srgb, var(--bgm-border) 62%, transparent)` | 1px 分隔线与弱描边 |
| `--app-hairline-strong` | `color-mix(in srgb, var(--bgm-border) 88%, transparent)` | 需要更明确轮廓的描边（浮层、确认卡外框） |
| `--app-primary-veil` | `color-mix(in srgb, var(--bgm-primary) 14%, transparent)` | 主色蒙层（输入卡聚焦光晕、输入框聚焦光晕） |
| `--app-accent-veil` | `color-mix(in srgb, var(--bgm-interactive) 12%, transparent)` | 交互色蒙层；**当前没有消费者**，属保留位 |
| `--app-radius-control` | `var(--bgm-r-md)`（10px） | 控件档：按钮、输入、气泡、行、卡内块 |
| `--app-radius-panel` | `var(--bgm-r-lg)`（15px） | 容器档：输入卡、确认卡、弹窗、浮层 |

**三级阴影的判据是"离页面多远"**：同一平面内的抬升用 `raised`，会话内容里浮起的卡片用 `card`，脱离文档流的浮层用 `panel`。Bangumi 的 5/10/15/20 圆角阶梯里只取控件与容器两档，其余场合直接用 `--bgm-r-sm` / `--bgm-r-pill`。

因为 `--app-*` 只引用名字（`var(--bgm-*)`），取值在计算时才解析，所以**不关心** `bgm.css` 与 `tokens.css` 的先后；真正依赖顺序的是 `bgm.css` 对 `--dsw-*` 的同名重定义（见 [readme.md](readme.md) §引入顺序是契约）。

表里标了"当前没有消费者"的两个令牌是保留位：新样式要引它们时，先确认真的需要第二个下沉档或第二层蒙层——不要因为名字看着合适就顺手用，那会让"谁在用哪一档"重新变得说不清。

## 三条约定

1. **只有浅色一套**：上游的深色覆盖块（`body[data-ds-dark-theme]`）与主题切换机制**没有移植**。上游在两处重复声明的同名静态色板这里只声明一次，语义不变。
2. **不要在别处定义 `--dsw-*`**：语义令牌只有这一个定义处；`bgm.css` 只做**重定向**（改变量的值），不新增语义名。
3. **改令牌 = 全局改版**：`--dsw-alias-*` 被 `frame/composer/cards/modal` 大量引用，`--app-*` 表面系被所有文件引用，改一个值会成片改变外观。做局部调整时优先改对应组件的规则，而不是改令牌。

## 什么时候该改这里

| 场景 | 做法 |
|---|---|
| 整体色板/字体要变 | 改这里（或经由 `bgm.css` 重定向）——影响面最大，必须按 [../regression/shell-and-layout.md](../regression/shell-and-layout.md) 全量回归 |
| 改品牌色 | 改 `bgm.css` 的 `--bgm-*`；`--app-*` 里的表面与描边会自动跟着变 |
| 调整动效快慢、缓动或入场位移 | 改这里的 `--app-dur-*` / `--app-ease-*` / `--app-shift-*` **并同步** `components/motion/motionTokens.ts` |
| 调整某个浮层的阴影强度 | 改 `--app-shadow-*`（三档各自对应一类元素，不要在组件里写阴影裸值） |
| 单个组件要特殊颜色 | 在该组件样式文件里用现有令牌派生（`color-mix()`），不要新增令牌 |
| 要支持深色主题 | 属于产品级改动：需要引入主题属性、补一套 alias 覆盖块，并重新设计所有派生色——当前项目明确不做 |
| 新增字体 | 放 `fonts/`（附许可文件）+ 在 `tokens.css` 加 `@font-face` + 加进字体栈令牌 |
