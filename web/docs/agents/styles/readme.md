# 样式层（`web/src/styles/`）

## 使用说明

### 这份文档是什么

样式层的规则与索引：7 个文件的职责与引入顺序、三条令牌体系、按作用对象分文件的约定与改动步骤。

**不覆盖**：具体组件的视觉规格（见四个子文档与 `docs/bgm-design/ui-style.md`）。上层入口：[AGENTS.md](../../../AGENTS.md)。

### 怎么读（文件 → 场景）

| 文件 | 什么时候读 |
|---|---|
| 本文件 | 判断新样式该写进哪个文件、核对引入顺序时 |
| [tokens.md](tokens.md) | 改设计令牌、外观层令牌（`--app-*`）、字体、圆角刻度、焦点环时 |
| [frame.md](frame.md) | 改外壳网格、会话区布局、滚动与首屏行为，或改共享渲染器（消息行、过程折叠、思考块、Markdown）时 |
| [components.md](components.md) | 改确认卡、输入区与浮层、弹窗样式时 |
| [content-and-brand.md](content-and-brand.md) | 改内容条目样式，或改 Bangumi 令牌与语义别名重定向时 |

### 必须遵守的规则

1. **引入顺序固定**：`tokens → frame → composer → cards → modal → bgm → content`，`bgm.css` 必须在它重定向的那些文件之后。违反后果：品牌令牌不生效，部分颜色与圆角回到 DSH 默认。见 §引入顺序是契约。
2. **同一元素同一属性只有一个来源**：样式按作用对象分文件，形态规则就近写进它所属的那个文件。违反后果：同一属性出现两处声明，改一处不生效，出问题无法定位来源。见 §按作用对象分文件。
3. **不写死颜色，一律走令牌**：违反后果：换令牌时局部不跟随，视觉不一致。见 §三条令牌体系。
4. **动效令牌两处必须同步**：CSS 侧是 `tokens.css` 的 `--app-*`，JS 侧是 `components/motion/motionTokens.ts`。违反后果：同一个界面出现两条缓动曲线。
5. **只有浅色一套，不写主题分支**：违反后果：死代码与不可维护的分支。见 §唯一浅色外观。
6. **保留焦点环、关键信息不依赖 hover**：违反后果：键盘用户不可用（这两条是刻意规避站点自身的可用性问题）。见 §新增样式的步骤。

## 按作用对象分文件

这是这一层的**唯一组织方式**，取代了任何形式的"覆盖层"：

1. **一个文件 = 一类元素的唯一形态来源**。外壳 → `frame.css`；输入区与浮层 → `composer.css`；卡片与按钮 → `cards.css`；弹窗 → `modal.css`；内容条目 → `content.css`。
2. **令牌集中在两处**：`tokens.css` 定义 DSH 语义令牌（`--dsw-*` / `--dsh-*`）与外观层令牌（`--app-*`）；`bgm.css` 定义 Bangumi 令牌（`--bgm-*`）并把组件实际用到的 `--dsw-*` 别名重定向过去。
3. **共享渲染器的类名只有一个来源**：`.userRow`、`.bubble`、`.assistantRow`、`.processTitle`、`.thinkingBlock`、`.planCard`、`.markdown`… 的形态规则全部写在 `frame.css`（卡片类在 `cards.css`）。组件与样式两边改一处即可。
4. **不要在别处再覆写一遍**：这层没有"覆盖层"概念，不允许同一个属性、同一个元素出现第二处声明（带任何额外前缀都不行）——重复声明一律当成 bug。需要改观感时，改那条规则本身。

历史上调试面板的样式曾单独成文件（`.preview*`），后被移除——**"先归入已有文件、确属新领域才新建文件"这条约定保留**：新建文件要同时改 `main.tsx` 的 import 顺序，并登记进本文件的表格。

## 这一层是什么

手写 CSS，**无框架、无 CSS-in-JS、无 CSS Modules**。共 7 个文件，按"作用对象"分层，靠**令牌**统一视觉、靠**类名前缀**互相隔离。

| 文件 | 行数 | 作用对象 | 令牌体系 | 子文档 |
|---|---|---|---|---|
| `tokens.css` | 447 | 设计令牌本体：色板、语义 alias、字体、圆角、焦点环、滚动条，以及末尾的外观层令牌（时长、缓动、位移、阴影、表面、圆角） | 定义 `--dsw-*` / `--dsh-*` / `--app-*` | [tokens.md](tokens.md) |
| `frame.css` | 1053 | 页面框架、会话区与**共享会话渲染器**：外壳网格、侧栏、会话头、滚动体、轮次、首屏、轮次导航，以及消息行、过程折叠、思考块、流式区、Markdown | 消费 `--bgm-*` / `--app-*` | [frame.md](frame.md) |
| `composer.css` | 659 | 输入区与浮层：输入卡、发送键、命令候选、思考强度菜单、统计底栏与其浮层 | 消费 `--bgm-*` / `--app-*` | [components.md](components.md) |
| `cards.css` | 158 | 写入确认卡与按钮基元 | 消费 `--bgm-*` / `--app-*` | [components.md](components.md) |
| `modal.css` | 468 | 弹窗：遮罩、表面、标题栏、字段、选项行、状态条、设置行、会话选择列表 | 消费 `--bgm-*` / `--app-*` | [components.md](components.md) |
| `bgm.css` | 160 | **只有令牌**：定义 `--bgm-*`，并把组件实际用到的 `--dsw-*` 别名重定向过去；**不含任何形态规则** | 定义 `--bgm-*`，重定向 `--dsw-*` | [content-and-brand.md](content-and-brand.md) |
| `content.css` | 1010 | 内容组件库（12 种内容条目的皮肤），末尾一节是 `@media (hover: hover)` 包裹的 hover/active 补充规则 | 消费 `--bgm-*` / `--app-*` | [content-and-brand.md](content-and-brand.md) |
| `fonts/` | — | Montserrat（OFL，三个字重 woff2 + 许可文件） | — | [tokens.md](tokens.md) |

## 引入顺序是契约（`main.tsx`）

```ts
tokens → frame → composer → cards → modal → bgm → content
```

两条硬约束：

1. **`bgm.css` 必须排在 `tokens/frame/composer/cards/modal` 之后**：它把组件实际引用到的 `--dsw-*` 语义别名**重定向**到 `--bgm-*` 品牌令牌，靠"同名变量后定义覆盖先定义"生效。位置错了会出现"部分颜色或圆角不生效"。
2. **`content.css` 最后**：它只服务内容组件库，且颜色只消费 `--bgm-*`，放最后可确保品牌令牌已就位。

`frame/composer/cards/modal` 消费的是 `--bgm-*` 与 `--app-*` 这类**变量引用**，它们的取值在计算时才解析，因此不受 `bgm.css` 位置影响；真正依赖顺序的只有上面第 1 条那种同名重定义。

新增样式文件时，同样要放进这条链的正确位置，并在 `main.tsx` 里加 import。

## 三条令牌体系

| 体系 | 定义处 | 用途 |
|---|---|---|
| `--dsw-*` / `--dsh-*` | `tokens.css`（移植自 deepseek-harness） | 语义令牌（背景/描边/文本/状态色）、字体与尺寸刻度、布局轴 |
| `--app-*` | `tokens.css` 末尾 | **外观层**：时长阶梯、缓动、入场位移、三级阴影、表面与描边、两档圆角；与 `components/motion/motionTokens.ts` 一一对应 |
| `--bgm-*` | `bgm.css` | Bangumi 品牌色与形态基准；`content.css` 的颜色只认这一套，`--app-*` 里的表面与描边也全部由它派生 |

规则：**不写死十六进制**。需要新颜色时优先用已有令牌，或像 `content.css` 那样用 `color-mix()` 从令牌就地派生。

## 类名与选择器约定

外壳与容器用 `app*` 前缀（由既有的容器类名统一改名而来）；共享渲染器沿用既有类名，落在 `frame.css`。

| 文件 | 允许的选择器 |
|---|---|
| `frame.css` | `.app*`（外壳与容器：`.appFrame`、`.appSidebar`、`.appLogoRow`、`.appBrand`、`.appIconButton`、`.appNewSession*`、`.appRegion*`、`.appSession*`、`.appConversation`、`.appHeader`、`.appTitle*`、`.appTab`、`.appHeaderMeta`、`.appChip*`、`.appToast`、`.appStage*`、`.appTurn*`、`.appStreaming*`、`.appHero*`、`.appRail*`），以及共享渲染器类名（`.userRow`、`.userStack`、`.bubble`、`.assistantRow`、`.assistantBody`、`.noticeRow`、`.errorRow`、`.stateDot`、`.errorText`、`.sessionBanner`、`.running`、`.processGroup`、`.processTitle`、`.processBody`、`.activityRow`、`.mark`、`.chevron`、`.count`、`.thinkingBlock`、`.thinkingTitle`、`.thinkingBody`、`.markdown*`） |
| `composer.css` | `.appSeat`、`.appCardSeat`（接管时的座位容器）、`.appComposerStack`、`.appGlow`、`.appComposerCard`、`.appComposerScroll`、`.appComposerInput`、`.appComposerRow`、`.appComposerTools`、`.appComposerHint`、`.appComposerProblem`、`.appComposerTrailing`、`.appSendButton`、`.appComposerPopup`、`.appPopupSection`、`.appPopupItem`、`.thinkingAnchor`、`.thinkingTrigger`、`.thinkingMenu`、`.menuMaterial`、`.menuViewport`、`.menuLabel`、`.menuSeparator`、`.menuItem`、`.statsDock`、`.stats*`、`.context*` |
| `cards.css` | `.planCard`、`.planStrip`、`.planBody`、`.planNote`、`.planActions`、`.previewText`、`.button`（含 `primary` / `outline` / `ghost` / `reject`） |
| `modal.css` | `.modalOverlay`、`.modalSurface`、`.modalHeader`、`.modalEyebrow`、`.modalClose`、`.modalBody`、`.modalFooter`、`.modalField`、`.modalInput`、`.modalCheck`、`.modalError`、`.modalHint`、`.modalSteps`、`.modalChoiceRow`、`.modalStatus`、`.settingsRow`、`.pickerList`、`.pickerRow` |
| `content.css` | `.content*`（与 `components/content/` 的组件一一对应） |
| `bgm.css` | 只有 `:root` 上的自定义属性声明，**没有任何形态规则** |

`.appRow` 是 `Turn` 里每一行的结构钩子（本身无规则）；`.label` / `.value` / `.actions` / `.selected` / `.hint` / `.title` / `.meta` / `.note` / `.dot` / `.spacer` 是各自容器内部的局部类名，规则写在它们所属的文件里。

## 唯一浅色外观

没有深色主题、没有主题切换、不跟随系统偏好。因此：

- 不写 `@media (prefers-color-scheme: dark)`；
- 不写主题属性分支（如 `body[data-ds-dark-theme]`）；
- `tokens.css` 只保留上游的浅色语义 alias。

## 新增样式的步骤

1. 先找它属于哪个作用对象：外壳与共享渲染器 → `frame.css`；输入区与浮层 → `composer.css`；卡片与按钮 → `cards.css`；弹窗 → `modal.css`；内容条目 → `content.css`；确属新领域才新建文件；
2. 若目标是一个**共享渲染器的既有类名**，改 `frame.css` 里那条规则本身——不要新增一条覆写，也不要带任何额外前缀；
3. 类名用该文件的既有语汇与前缀（BEM 风格的点线分层：`.planCard` → `.planStrip` → `.planBody`），不要引入新命名体系；
4. 颜色走令牌，表面/描边/圆角优先用 `--app-*`（它们已经由 `--bgm-*` 派生），尺寸用既有刻度（`--dsw-radius-*`、`--dsh-*` 布局轴、`--app-radius-*`）；
5. 动效只引用 `--app-dur-*` / `--app-ease-*` / `--app-shift-*`；改动数值必须同步 `components/motion/motionTokens.ts`；
6. 保留可见焦点环（`:focus-visible`），关键信息不依赖 hover 才能看到——这两条是刻意规避站点自身的可用性问题；
7. 更新本文件或对应子文档的表格。
