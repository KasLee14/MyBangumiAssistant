# 组件样式（`cards.css` / `composer.css` / `modal.css`）

## 简介

三份组件样式（确认卡与按钮、输入区与浮层、弹窗）的类名对照与共同约定。

**不覆盖**：外壳、会话区与共享渲染器（见 [frame.md](frame.md)）；令牌本体与品牌令牌（见 [tokens.md](tokens.md)、[content-and-brand.md](content-and-brand.md)）。

上层：[readme.md](readme.md)。这三份都消费 `--bgm-*` 语义令牌与 `--app-*` 外观层令牌。

## 使用说明

- **写这三份样式之前先读 §规则**：本篇专属 3 条（同一属性只声明一次、前缀边界、宽度轴同源）与「三者共同遵守」5 条（令牌、前缀边界、浮层结构、可访问性、宽度轴）都在那里。
- **只想查某个类名属于哪份文件、某个场景该改哪里**：直接查 §索引（章节 → 场景 + 三份文件的类名表），不必通读 §规则。
- 外壳与会话区的类名在 [frame.md](frame.md)；本层通用规则见 [readme.md](readme.md) 的 §规则「六条硬规则」。

## 规则

### 本篇专属规则

本层通用规则见 [readme.md](readme.md) 的 §规则「六条硬规则」。本篇专属：

1. **同一属性只声明一次**：这三份里的类名大多只在这里出现（`.plan*`、`.appComposer*`、`.modal*`…），改外观就改那一条，不要再叠覆写 —— 违反后果：改一处不生效。
2. **类名不越出各自前缀**，只有下面两处刻意的交叉例外 —— 违反后果：样式互相污染，难以定位来源。
   - `frame.css` 里的两条 hero 阶段规则（`.appStage[data-phase='hero'] .appSeat` / `.appComposerInput`）：`data-phase` 是外壳状态；
   - `modal.css` 里的 `.modalSurface .button` / `.modalSurface .menuMaterial`：弹窗内的按钮与材质需要按弹窗语境微调。
3. **宽度轴与 `frame.css` 同源** —— 违反后果：输入卡与正文错位（当前实现见 [frame.md](frame.md) §规则「已知不一致」）。

### 三者共同遵守

1. **只消费令牌**（`--dsw-alias-*` / `--bgm-*` / `--app-*`），不写死颜色。
2. **类名不越出各自前缀**，例外只有两条（见 §规则「本篇专属规则」）：`frame.css` 的两条 hero 规则与 `modal.css` 的 `.modalSurface .button` / `.menuMaterial`。
3. **浮层结构**：材质子层（`.xxxMaterial`）作为结构保留，但当前 `.menuMaterial` / `.statsPanelMaterial` 都是 `opacity: 0` 的占位层——表面色由各自面板的 `background` 提供。新增浮层时直接在面板本体上给表面、描边、圆角与阴影，不要再指望子层透出。
4. **可访问性**：交互控件保留 `:focus-visible` 焦点环（统一走 `--bgm-focus`）；`data-state` 类的状态不能只靠颜色区分（确认卡同时有文案，工具活动同时有 `·` / `✓` / `×` 与中文状态）。
5. **宽度轴**：此前 `.appStageColumn`、输入区座位与确认卡座位共用一条由 `--dsh-chat-content-width` 驱动的宽度轴，该变量**已不存在**；现在列宽只由 `.appStageColumn` 的公式决定，输入区与确认卡只靠 24px 内边距对齐。改其中一处前先读 [frame.md](frame.md) §规则「已知不一致」。

## 索引

### 章节 → 场景

| 章节 | 什么时候读 |
|---|---|
| §索引 → `cards.css` | 改确认卡、按钮基元、思考块或工具活动状态色时 |
| §索引 → `composer.css` | 改输入区、命令候选、发送键、思考强度菜单、统计底栏与浮层时 |
| §索引 → `modal.css` | 改弹窗几何（宽度、头部、字段、选项行）或设置行时 |
| §规则 → 三者共同遵守 | **写这三份样式前必读**（令牌、前缀边界、浮层结构、可访问性） |

### `cards.css`（~250 行）：确认卡、按钮与思考块

来源：deepseek-harness 的 `ui-approval/ApprovalPanel.module.css`（确认/预览卡：圆角、描边、色条、动作行）与 `ui-conversation/skeleton/InputBar.module.css`（卡外内边距）。

| 类名 | 用途 |
|---|---|
| `.planCard` | 确认卡本体：`--app-surface` 底、`color-mix(bgm-primary 30%)` 描边、`--app-radius-panel` 圆角、`--app-shadow-card`，并把 `--dsw-elevation-stroke-color` 重绑为 `--dsw-alias-border-l2-darkmode-thin` |
| `.planCard[data-state]` | 状态着色：`accepted` 走成功色描边，`rejected` / `expired` 回落中性描边 |
| `.planStrip` / `.planTitle` | 状态条与授权标题；状态文案由 `data-state` 一并对齐 |
| `.planBody` / `.planPreview` / `.planNote` | 授权正文：`planPreview` 是普通文本容器（不用等宽字体），保留换行，宿主给的完整范围原样呈现、前端不截断；长范围在 `planBody` 内滚动 |
| `.planActions` | 动作行；按钮始终留在这一行里，不随正文滚动 |
| `.button`（`.primary` / `.outline` / `.ghost` / `.reject` / `.sm`） | 按钮基元：确认卡的取消用 `.outline.reject`，确认为 `.primary`；`.sm` 是紧凑尺寸 |
| `.thinkingBlock` / `.thinkingTitle` / `.thinkingBody` | 流式思考块：默认折叠，展开态由 `data-open` 驱动；`thinkingBody` 用等宽字体并在超长时内部滚动 |
| `.activityRow[data-state]` / `.mark` | 工具活动状态色：`running` 用中性/深潜色、`ok` 用成功色、`error` 用危险色；未结束的调用不染成成功色 |

注意：`.planCard` 的宽度上限来自 `max-width: var(--dsh-composer-card-max-width)`，而该变量**当前无人定义**，声明因此不生效（见 [frame.md](frame.md) §规则「已知不一致」）。确认卡的座位 `.appCardSeat` 在 `composer.css`。

### `composer.css`（~630 行）：输入区与浮层

来源：`ui-conversation/skeleton/InputBar.module.css`（卡片内边距、发送键 34×34）、`ui-input-trigger/MenuView` + `ui-commands/PopupSelectView`（命令弹窗：锚点、行高 34px、分组标题）、`ui-primitives/Menu.module.css`（MenuSurface 材质：底色与模糊放在子层）、`ui-model-selection/ModelSelect.module.css`（触发器 24px 高），以及 `ui-chat/chat/StatsPills` + `ui-conversation/skeleton/ContextMeter`（底栏读数）。

**外观层（`app*` 前缀）**：

| 类名 | 用途 |
|---|---|
| `.appSeat` | 输入区座位：**全界面唯一的输入卡挂载点**；`padding: 6px 24px 18px`。接管卡替换的是它内部的内容，容器不动（否则 textarea 丢焦点与 IME 组合态） |
| `.appCardSeat` | 接管卡（确认卡）的座位，`display: block` |
| `.appComposerStack` | 卡片 + 底栏读数的竖排栈（读数在卡外、紧贴卡片下方） |
| `.appGlow` | `BorderGlow` 的外层：宽 100%、`--app-radius-panel` 圆角，内层 `.border-glow-inner` 允许溢出 |
| `.appComposerCard` | 卡片本体；`:focus-within` 用 `--app-primary-veil` 画一圈聚焦光晕。`Composer` 会额外挂 `.appComposerHero`，但该类比**没有对应规则**（首屏差别在 `frame.css`） |
| `.appComposerScroll` / `.appComposerInput` | 输入框与它的内边距；`appComposerInput` 透明底、`min-height: 24px`、`max-height: 220px`，高度由组件按内容写内联 `style.height` |
| `.appComposerRow` / `.appComposerTools` / `.appComposerHint` / `.appComposerProblem` / `.appComposerTrailing` | 底栏：左侧提示与参数错误（`appComposerProblem` 是红字胶囊），右侧思考标签与发送键 |
| `.appSendButton` | 发送与停止共用同一按钮位（34×34、`--app-radius-control`）；`:focus-visible` 走 `--bgm-focus`，禁用态用 `--bgm-border` |
| `.appComposerPopup` / `.appPopupSection` / `.appPopupItem` | 命令候选浮层（锚在卡片顶边向上展开，`data-active` 标记当前项；`.value` / `.hint` 两栏） |

**共享浮层与读数**（沿用既有类名，与 `ThinkingPicker` / `StatsDock` 一一对应）：

| 类名 | 用途 |
|---|---|
| `.thinkingAnchor` / `.thinkingTrigger` | 思考强度入口：常驻描边胶囊；置灰表示当前不能切换 |
| `.thinkingMenu` / `.menuViewport` / `.menuLabel` / `.menuSeparator` / `.menuItem`（`.selected`） | 向上展开的强度菜单；`.menuItem:hover` 整行填充交互蓝 + 白字 |
| `.menuMaterial` | 材质子层的占位层（`opacity: 0`）——菜单的实际表面由 `.thinkingMenu` 自己的 `background` 提供 |
| `.statsDock`（`data-composer-stats`） | 卡外底栏读数容器：透明底、居中排列 token 胶囊与上下文环 |
| `.statsAnchor` / `.statsPill` / `.statsLabel` / `.statsSep` | token 用量胶囊与它的浮层锚点 |
| `.statsPanelMaterial` / `.statsPanelBody` / `.statsTitle*` / `.statsRows` / `.statsRow` | 圆形浮层的内部结构（明细行用 `dl`） |
| `.contextAnchor` / `.contextTrigger`（`data-warn`）/ `.contextTrack` / `.contextFill` | 上下文占用环；`data-warn` 在达到阈值后换成警示色 |
| `.contextPanel`（宽度 `min(264px, calc(100vw - 24px))`）/ `.contextHeader` / `.contextHeadline` / `.contextPercent` / `.contextFigures` / `.contextBar` / `.contextSegment` | 上下文明细面板 |

浮层都 portal 到 `body`（输入卡位于 `.appStageScroll` 内，留在卡内的绝对定位浮层会被那个滚动容器裁掉）。菜单与候选浮层用同一条 `app-popup-in` 入场动画。

`.statsPanel` 本体承担定位（`position: fixed`、`z-index: 1100`）、内边距、圆角（`--app-radius-panel`）、表面（`--app-surface` 底 + `--app-shadow-panel`）与 `app-popup-in` 入场动画；`.statsPanelMaterial` 只是 `opacity: 0` 的占位层，不提供可见表面。

### `modal.css`（~470 行）：弹窗

来源：harness 的 MenuSurface 材质 + elevation 三件套的 prominent 档；形态细节按 bgm.tv 实测值重做（见 [content-and-brand.md](content-and-brand.md)）。

| 类名 | 用途 |
|---|---|
| `.modalOverlay` | 遮罩：`position: fixed` + `inset: 0` + `z-index: 60`，底色 `rgba(40, 40, 40, .32)`；由 motion 渲染，进出各一段过渡 |
| `.modalSurface`（`[data-wide='true']`） | 弹窗表面：宽 `min(480px, 100%)`（wide 时 `min(600px, 100%)`）、高 `min(85vh, 640px)`、`--app-radius-panel` 圆角、`--app-surface` 底、`--app-shadow-panel` |
| `.modalHeader` / `.modalEyebrow` / `.modalClose` | 标题栏 40px；`eyebrow` 与标题重复时不渲染（组件侧判断）；关闭键是 30×30 点击区 + 15px 细线 `×` 的 mask 图标 |
| `.modalBody` / `.modalFooter` / `.modalField` / `.modalInput` | 内容区（15px 内边距、滚动条换 l2 一对变量）、底栏、字段与输入框 |
| `.modalCheck`（`[data-disabled='true']`） | 复选/单选行（模型配置的"保存到本机"、代理模式三选一） |
| `.modalHint` / `.modalError` / `.modalStatus` | 说明、错误、进度状态条 |
| `.modalSteps` / `.modalChoiceRow` | 登录进度步骤条与代理模式选择行 |
| `.pickerList` / `.pickerRow`（`.selected`） | 选择列表（历史会话弹窗） |
| `.settingsRow` / `.label` / `.value` / `.actions` | 设置主面板的四行布局 |
| `.modalSurface .menuMaterial` | 材质子层：`rgba(254,254,254,.8)` + 20px 模糊、`box-shadow: none`；但 `opacity` 仍是 `0`，所以弹窗的实际表面来自 `.modalSurface` 自己的 `--app-surface` |
| `.modalSurface .button` | 弹窗内的按钮微调（次要按钮的底色与 hover） |
