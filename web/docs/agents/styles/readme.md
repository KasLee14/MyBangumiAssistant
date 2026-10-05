# 样式层（`web/src/styles/`）

## 简介

样式层的规则与索引：7 个文件的职责与引入顺序、三套令牌体系、「同一元素同一属性只有一个来源」的约定与改动步骤。

**不覆盖**：具体组件的视觉规格（见四个子文档与 `docs/bgm-design/ui-style.md`）。

上层：[AGENTS.md](../../../AGENTS.md)，跨层的外观约定在其 §规则「外观层硬约定」。相关：[tokens.md](tokens.md)、[frame.md](frame.md)、[components.md](components.md)、[content-and-brand.md](content-and-brand.md)。

## 使用说明

- **改任何样式之前先读 §规则**：六条硬规则与四个约束性子节（同一属性只有一个来源、引入顺序、隔离、唯一浅色外观）都在那里。漏读的典型后果是"改一处不生效"——这一层没有"覆盖层"概念，重复声明会被当成 bug。
- **只想查某个文件负责什么、某个令牌体系在哪、新样式该写进哪个文件**：直接查 §索引 的三张表（这一层是什么、怎么读、三套令牌体系），不必通读 §规则。
- **新增样式**：照 §规则 末条「新增样式的步骤」逐步做。
- 本层只讲样式怎么写；跨层的外观语言（配色、动效、层次）在 [AGENTS.md](../../../AGENTS.md) §规则「外观层硬约定」。

## 规则

### 六条硬规则

1. **引入顺序固定**：`tokens → frame → composer → cards → modal → bgm → content`，`bgm.css` 必须在它重定向的那些文件之后。违反后果：品牌令牌不生效，部分颜色回到 DSH 默认。见 §规则「引入顺序是契约」。
2. **同一元素同一属性只有一个来源**：样式按作用对象分文件，改既有类就改它那一条规则，不要再叠一条覆写。违反后果：改一处不生效，出问题无法定位来源。见 §规则「同一元素同一属性只有一个来源」。
3. **不写死颜色，一律走令牌**：违反后果：换令牌时局部不跟随，视觉不一致。见 §规则「不写死颜色，一律走令牌」。
4. **每个文件只用自己的命名前缀与作用对象**：违反后果：样式互相污染，出问题难以定位来源。见 §规则「隔离规则」。
5. **只有浅色一套，不写主题分支**：违反后果：死代码与不可维护的分支。见 §规则「唯一浅色外观」。
6. **保留焦点环、关键信息不依赖 hover**：违反后果：键盘用户不可用（这两条是刻意规避站点自身的可用性问题）。见 §规则「新增样式的步骤」。

### 同一元素同一属性只有一个来源

这一层经历过一次合并：此前同一属性有三处可以声明（基础样式、品牌形态、以及后引入的一套外观覆写），并且靠挂在 `<html>` 上的作用域属性把最后那套圈起来。现在：

- **只有按作用对象分的 5 个形态文件**（`frame` / `composer` / `cards` / `modal` / `content`），品牌形态与外观覆写的内容已**就地并入**这 5 个文件里对应的那条规则；
- `bgm.css` 只剩令牌（`--bgm-*` 定义 + `--dsw-*` 别名重定向），文件里没有任何形态规则；
- **不存在任何作用域属性、版本前缀或独立的样式子目录**。

于是硬约定只有一条：**同一元素同一属性，整个 `styles/` 里只有一个来源。**

- 改共享渲染器的既有类（`.bubble`、`.assistantRow`、`.modalSurface`…）时，**直接改它在 `frame.css`（或对应文件）里的那一条规则**；
- 新增规则前先搜一遍这个类名：已经存在就说明你该改的是那条，而不是再加一条"更具体 / 更靠后"的规则去盖它；
- 不要再引入作用域属性或第二套选择器前缀来"分层"——这一层没有"覆盖层"这个概念，重复声明会被当成 bug。

**为什么**：覆写层的代价是"改一处不生效"。同属性在多处声明时，最终值由引入顺序与特异性决定，而不由语义决定；定位一个问题要通读全部样式文件。只有一份来源时，"这个属性最终长什么样"可以直接在唯一那条规则上读到。

**违反后果**：改一处不生效，出问题无法定位来源。

**唯一留存的跨文件例外**：由容器状态驱动的规则，留在持有该状态的类所在文件。目前只有两条，都锚在 `.appStage` 上：

```css
.appStage[data-phase='hero'] .appSeat { padding-bottom: 26px; }
.appStage[data-phase='hero'] .appComposerInput { min-height: 32px; }
```

它们写在 `frame.css`，因为 `data-phase` 是外壳状态；改输入区内部规则时不要在这两处之外再补一份同样的声明。

### 引入顺序是契约（`main.tsx`）

```ts
tokens → frame → composer → cards → modal → bgm → content
```

两条硬约束：

1. **`bgm.css` 必须排在 `tokens/frame/composer/cards/modal` 之后**：它靠"后定义覆盖先定义"把 60 条 `--dsw-*` / `--dsh-*` 语义别名重定向到 `--bgm-*` 品牌令牌。位置错了会出现"部分颜色不生效"。
2. **`content.css` 最后**：它只服务内容组件库，且只消费 `--bgm-*` / `--app-*`，放最后可确保品牌令牌已就位。

新增样式文件时，同样要放进这条链的正确位置，并在 `main.tsx` 里加 import。

**违反后果**：品牌令牌不生效，部分颜色回到 DSH 默认。

### 隔离规则

每个文件只操作自己的类名前缀与作用对象，**不得**出现会命中别人 DOM 的选择器：

| 文件 | 允许的选择器 |
|---|---|
| `frame.css` | 外壳：`.appFrame`、`.appSidebar`、`.appLogoRow`、`.appBrand`、`.appIconButton`、`.appNewSession*`、`.appRegion*`、`.appSession*`、`.appConversation`、`.appHeader`、`.appTitleRow`、`.appTitle`、`.appTab`、`.appHeaderMeta`、`.appChip*`、`.appToast`、`.appStage*`、`.appTurn*`、`.appHero*`、`.appRail*`、`.appStreaming*`；共享渲染器：`.userRow`、`.bubble`、`.assistantRow`、`.assistantBody`、`.noticeRow`、`.errorRow`、`.stateDot`、`.errorText`、`.sessionBanner`、`.running`、`.processGroup`、`.processTitle`、`.processBody`、`.activityRow`、`.mark`、`.chevron`、`.count`、`.markdown*`（含 `.markdownTableWrap` / `.markdownTableWide`）；外加 §规则「同一元素同一属性只有一个来源」里那两条 hero 阶段规则 |
| `composer.css` | `.appSeat`、`.appCardSeat`、`.appComposerStack`、`.appGlow`、`.appComposerCard`、`.appComposerScroll`、`.appComposerInput`、`.appComposerRow`、`.appComposerTools`、`.appComposerHint`、`.appComposerProblem`、`.appComposerTrailing`、`.appSendButton`、`.appComposerPopup`、`.appPopupSection`、`.appPopupItem`、`.thinkingAnchor`、`.thinkingTrigger`、`.thinkingMenu`、`.menuMaterial`、`.menuViewport`、`.menuLabel`、`.menuSeparator`、`.menuItem`、`.statsDock`、`.statsAnchor`、`.statsPill`、`.statsLabel`、`.statsSep`、`.statsPanelMaterial`、`.statsPanelBody`、`.statsTitle*`、`.statsRows`、`.statsRow`、`.context*` |
| `cards.css` | `.planCard`、`.planStrip`、`.planTitle`、`.planBody`、`.planPreview`、`.planNote`、`.planActions`、`.button`（含 `.primary` / `.outline` / `.ghost` / `.reject` / `.sm`）、`.thinkingBlock`、`.thinkingTitle`、`.thinkingBody`、`.activityRow[data-state]` 的状态色 |
| `modal.css` | `.modalOverlay`、`.modalSurface`、`.modalHeader`、`.modalEyebrow`、`.modalClose`、`.modalBody`、`.modalFooter`、`.modalField`、`.modalInput`、`.modalCheck`、`.modalHint`、`.modalError`、`.modalStatus`、`.modalSteps`、`.modalChoiceRow`、`.pickerList`、`.pickerRow`、`.settingsRow`、`.label`、`.value`、`.actions`、`.note`、`.dot`，以及 `.modalSurface .menuMaterial` |
| `content.css` | `.content*`（与 `components/content/` 的组件一一对应） |
| `bgm.css` | **没有任何形态规则**：只有 `:root` 上的 `--bgm-*` 定义与 `--dsw-*` / `--dsh-*` 重定向 |

历史上调试面板的样式曾单独成文件（`.preview*`）并遵守同一规则，后被移除——**这条"前缀隔离"约定保留**：任何新样式文件都要有自己的前缀。

**违反后果**：样式互相污染，出问题难以定位来源。

### 唯一浅色外观

没有深色主题、没有主题切换、不跟随系统偏好。因此：

- 不写 `@media (prefers-color-scheme: dark)`；
- 不写主题属性分支（如 `body[data-ds-dark-theme]`）；
- `tokens.css` 只保留上游的浅色语义 alias。

**违反后果**：死代码与不可维护的分支。

### 不写死颜色，一律走令牌

**不写死十六进制**。需要新颜色时优先用已有令牌，或像 `content.css` 那样用 `color-mix()` 从令牌就地派生。

**为什么**：这一层靠令牌统一视觉——三套令牌体系各有唯一定义处（见 §索引「三套令牌体系」），换品牌色只改 `--bgm-*`，所有消费语义别名的组件就成片跟着变；写死一个色值就断了这条链。

**违反后果**：换令牌时局部不跟随，视觉不一致。

### 新增样式的步骤

1. **先搜类名**：`styles/` 里已经存在同名规则时，改那一条，不要新增第二条（见 §规则「同一元素同一属性只有一个来源」）；
2. 再找它属于哪个作用对象：外壳与会话区 → `frame.css`；输入区与浮层 → `composer.css`；卡片与按钮 → `cards.css`；弹窗 → `modal.css`；内容条目 → `content.css`；确属新领域才新建文件；
3. 类名用该文件的既有语汇与前缀（BEM 风格的点线分层：`.planCard` → `.planStrip` → `.planBody`），不要引入新命名体系；
4. 颜色走令牌，时长/缓动/位移走 `--app-*`（并同步 `motionTokens.ts`），尺寸用既有刻度（`--dsw-radius-*`、`--bgm-r-*`）；
5. 保留可见焦点环（`:focus-visible`），关键信息不依赖 hover 才能看到——这两条是刻意规避站点自身的可用性问题（违反后果：键盘用户不可用）；
6. 更新本文件或对应子文档的表格。

## 索引

### 这一层是什么

手写 CSS，**无框架、无 CSS-in-JS、无 CSS Modules**。共 7 个 `.css` 文件（另有 `fonts/` 目录），按"作用对象"分层，靠**令牌**统一视觉、靠**类名前缀与作用对象**互相隔离。

| 文件 | 行数级别 | 作用对象 | 令牌体系 | 子文档 |
|---|---|---|---|---|
| `tokens.css` | ~430 | 设计令牌本体：色板、语义 alias、字体、圆角、焦点环、滚动条，以及**外观层令牌** `--app-*` | 定义 `--dsw-*` / `--dsh-*` / `--app-*` | [tokens.md](tokens.md) |
| `frame.css` | ~1000 | 外壳（`.appFrame` / 侧栏 / 顶栏 / `.appToast`）与会话区（`.appStage*` / 轮次 / 首屏 / 导轨），以及共享渲染器（消息行、过程折叠、Markdown、流式区） | 消费 `--bgm-*` / `--app-*` | [frame.md](frame.md) |
| `composer.css` | ~630 | 输入区座位与卡片、命令候选、发送键、思考强度菜单、统计底栏与其浮层 | 消费 `--bgm-*` / `--app-*` | [components.md](components.md) |
| `cards.css` | ~250 | 写入确认卡、按钮基元、流式思考块、工具活动状态色 | 消费 `--bgm-*` / `--app-*` | [components.md](components.md) |
| `modal.css` | ~470 | 弹窗（遮罩、表面、字段、选项行、状态条、设置行、会话选择列表） | 消费 `--bgm-*` / `--app-*` | [components.md](components.md) |
| `bgm.css` | ~150 | **只有令牌**：定义 `--bgm-*`，并把组件实际用到的 60 条 `--dsw-*` / `--dsh-*` 别名重定向过去 | 定义 `--bgm-*`，重定向 `--dsw-*` / `--dsh-*` | [content-and-brand.md](content-and-brand.md) |
| `content.css` | ~980 | 内容组件库（12 种内容条目的皮肤）；末尾另有一节以 `@media (hover: hover)` 包裹的补充规则 | 消费 `--bgm-*` / `--app-*` | [content-and-brand.md](content-and-brand.md) |
| `fonts/` | — | Montserrat（OFL，三个字重 woff2 + 许可文件） | — | [tokens.md](tokens.md) |

### 怎么读（文件 → 场景）

| 文件 | 什么时候读 |
|---|---|
| 本文件 | 判断新样式该写进哪个文件、核对引入顺序时 |
| [tokens.md](tokens.md) | 改设计令牌、外观层令牌（`--app-*`）、字体、圆角刻度、焦点环时 |
| [frame.md](frame.md) | 改外壳网格、侧栏与顶栏、会话区布局、共享渲染器（消息行 / 过程折叠 / Markdown / 流式区）、滚动与首屏行为时 |
| [components.md](components.md) | 改确认卡、按钮基元、输入区、浮层、弹窗样式时 |
| [content-and-brand.md](content-and-brand.md) | 改内容条目样式、品牌令牌或 `--bgm-*` 重定向时 |

### 三套令牌体系

| 体系 | 定义处 | 用途 |
|---|---|---|
| `--dsw-*` / `--dsh-*` | `tokens.css`（移植自 deepseek-harness） | 语义令牌（背景/描边/文本/状态色）、布局轴、字体与圆角刻度 |
| `--app-*` | `tokens.css` 末尾 | **外观层令牌**：时长、缓动、位移、三级阴影、表面、描边、圆角；时长/缓动/位移与 `components/motion/motionTokens.ts` 一一对应 |
| `--bgm-*` | `bgm.css` | Bangumi 品牌色与圆角阶梯；`content.css` 的品牌色与 `--app-*` 的表面/描边/圆角全部由它派生（不新增色值） |

怎么用这三套令牌见 §规则「不写死颜色，一律走令牌」。
