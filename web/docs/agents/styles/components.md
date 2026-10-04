# 组件样式（`cards.css` / `composer.css` / `modal.css`）

## 使用说明

### 这份文档是什么

三份组件样式（确认卡与按钮、输入区与浮层、弹窗）的类名对照与共同约定。

上层：[readme.md](readme.md)。这三份都消费 `--bgm-*` 品牌令牌与 `--app-*` 外观层令牌，几何与形态规则就写在这里。

### 怎么读（章节 → 场景）

| 章节 | 什么时候读 |
|---|---|
| §`cards.css` | 改确认卡、预览文本或按钮基元时 |
| §`composer.css` | 改输入卡、命令候选、思考菜单、统计底栏与浮层时 |
| §`modal.css` | 改弹窗几何（宽度、头部、字段、选项行、设置行、会话选择列表）时 |
| §三者共同遵守 | **写这三份样式前必读**（令牌、材质、可访问性、共享类名的归属） |

### 必须遵守的规则

本层通用规则见 [readme.md](readme.md) 的「必须遵守的规则」。本篇专属：

1. **浮层材质走子层**（`.menuMaterial` / `.statsPanelMaterial` 承载底色与模糊，卡片只管几何与描边）—— 违反后果：各浮层的透出效果不一致。
2. **共享类名不在这里越权改**：`.planCard` / `.planStrip` / `.planBody` / `.planNote` / `.planActions` / `.previewText` / `.button` 的形态归 `cards.css`；消息行、过程折叠、Markdown 归 `frame.css`。同一属性不要写第二遍。
3. **`modal.css` 只写 `.modal*` 与它自己的行式类**（`.settingsRow`、`.picker*`），不要出现 `.app*` 容器类的规则。
4. **尺寸与颜色走令牌**：圆角优先用 `--app-radius-control` / `--app-radius-panel`，阴影用 `--app-shadow-*`，时长用 `--app-dur-*`。

## `cards.css`（158 行）：写入确认卡与按钮基元

来源：deepseek-harness 的 `ui-approval/ApprovalPanel.module.css`（确认/预览卡：圆角、描边、色条、动作行）与 `ui-conversation/skeleton/InputBar.module.css`（卡外内边距）；形态按 bgm.tv 的卡片语言改写（1px 淡描边 + 卡头色条 + 两级阴影）。

| 类名 | 用途 |
|---|---|
| `.planCard[data-state]` | 确认卡本体：主色描边 + `--app-shadow-card`；`data-state` 取 `pending` / `accepted` / `rejected` / `expired` |
| `.planStrip` | 卡头色条：默认主色浅底 + 主色文字，`accepted` 换成功态底，`rejected` / `expired` 换成交互底 + 次级文字 |
| `.planBody` / `.planNote` / `.planActions` | 预览区（`max-height: 336px`、可滚动）、提示文字、动作行（右上 1px hairline 分隔） |
| `.previewText` | 宿主给的完整预览：等宽、`white-space: pre-wrap`，前端不截断也不改写 |
| `.button`（`.primary` / `.outline` / `.ghost` / `.reject`） | 按钮基元：高 36px、胶囊圆角、`transition: var(--bgm-fast)`；`primary` 粉底白字、hover 落交互蓝；`reject` 直接在原类上覆色（危险动作不进 Button 变体） |

`.planStrip .spacer` 承担标题（等宽、右对齐、超长省略）。`.previewText` 只服务确认卡的 `<pre>`，它的形态只有这一处来源。

## `composer.css`（659 行）：输入区与浮层

来源：`ui-conversation/skeleton/InputBar.module.css`（卡片圆角、内边距、发送键 34×34）、`ui-input-trigger/MenuView` + `ui-commands/PopupSelectView`（命令弹窗：锚点、行高、分组标题）、`ui-primitives/Menu.module.css`（MenuSurface 材质：底色与模糊放在子层）、`ui-model-selection/ModelSelect.module.css`（触发器 24px 高）。

输入卡本体由 ReactBits 的 `BorderGlow` 提供底色、描边与边缘光（`Composer.tsx` 传 `animated={false}`，只在指针进入时驱动），因此内层卡片**不再画边框与阴影**——两层阴影叠在一起会显得脏。

| 类名 | 用途 |
|---|---|
| `.appSeat` | 输入区座位（`padding: 6px 24px 18px`）；**接管卡替换的是它内部的内容，容器不动**（否则 textarea 丢焦点与 IME 组合态）。首屏阶段的高度由 `.appStage[data-phase='hero'] .appSeat` / `.appComposerInput` 两处给出 |
| `.appCardSeat` | 接管（写入确认）时的座位容器：`display: block`，进入动效由 `ComposerSeat` 的 motion 元素给出 |
| `.appComposerStack` / `.appGlow` / `.appComposerCard` | 卡片本体与 `BorderGlow` 外层；`.appGlow .border-glow-inner` 放开 `overflow: visible`（否则向上展开的命令候选会被裁掉） |
| `.appComposerScroll` / `.appComposerInput` / `.appComposerRow` / `.appComposerTools` / `.appComposerTrailing` | 输入框与底栏；`.appComposerHint` 是一行操作提示，`.appComposerProblem` 是参数错误胶囊（`role="alert"`） |
| `.appSendButton` | 发送/停止键 34×34；hover 加深并带主色光晕，按下缩到 `.95`，禁用转灰 |
| `.appComposerPopup` / `.appPopupSection` / `.appPopupItem[data-active]` | 命令候选浮层：锚在卡片顶边向上展开（`bottom: calc(100% + 8px)`），`app-popup-in` 入场 |
| `.thinkingAnchor` / `.thinkingTrigger` / `.thinkingMenu` | 思考强度入口：24px 高描边胶囊 + 向上展开的菜单 |
| `.menuMaterial` / `.menuViewport` / `.menuLabel` / `.menuSeparator` / `.menuItem`（`.selected`、`.hint`） | 菜单结构与材质子层（`background: var(--dsw-specific-menu)` + `box-shadow: var(--dsw-elevation-stroke)`；`bgm.css` 已把模糊关掉） |
| `.statsDock` / `.statsAnchor` / `.statsPill` / `.statsLabel` / `.statsSep` | 输入卡**外**的读数条：累计 token 胶囊（读数比正文低一档，12px，`tabular-nums`） |
| `.contextAnchor` / `.contextTrigger[data-warn]` / `.contextTrack` / `.contextFill` | 上下文占用环（SVG，`stroke-dasharray` 随读数过渡） |
| `.statsPanel` / `.statsPanelMaterial` / `.statsPanelBody` / `.statsTitle*` / `.statsRows` / `.statsRow` | 用量浮层的结构与材质子层；浮层 `position: fixed`、`z-index: 1100`（portal 到 body，留在卡内的绝对定位浮层会被滚动容器裁掉） |
| `.contextPanel` / `.contextHeader` / `.contextHeadline` / `.contextPercent` / `.contextFigures` / `.contextBar` / `.contextSegment[data-warn]` | 上下文浮层（宽 `min(264px, calc(100vw - 24px))`）与占用条 |

浮层材质统一用 MenuSurface 的做法：**底色与背景模糊放在子层**（`.menuMaterial` / `.statsPanelMaterial`），卡片本身只管几何与描边。新增浮层请沿用这个结构。

## `modal.css`（468 行）：弹窗

来源：harness 的 MenuSurface 材质 + elevation 三件套里的 prominent 档；形态细节按 bgm.tv 的 `#TB_window` 实测值重做（15px 圆角、1px 细描边、40px 标题栏、15px 细线 ×）。

| 类名 | 用途 |
|---|---|
| `.modalOverlay` | 遮罩：`position: fixed` + `rgba(40, 40, 40, .32)`，`z-index: 60`，模糊走 `--dsw-mask-blur`（`bgm.css` 置 0） |
| `.modalSurface`（`[data-wide='true']`） | 弹窗表面：宽 `min(480px, 100%)` / wide `min(600px, 100%)`，最大高 `min(85vh, 640px)`，1px `--app-hairline-strong` 描边 + `--app-shadow-panel` |
| `.modalSurface .menuMaterial` | 材质子层保留占位（结构与过渡都依赖它），但表面已是纯白，因此 `opacity: 0` |
| `.modalHeader` / `.modalEyebrow` / `.modalClose` | 标题栏 40px（16px/600 标题、下压 1px hairline）；`eyebrow` 退成标题前 12px 主色小字，与标题重复时不渲染（组件侧判断）；关闭按钮是 30×30 点击区 + 15px 细线 `mask` 图标（默认 `#ccc`、hover 转黑） |
| `.modalBody` / `.modalFooter` / `.modalFooter .note` | 内容区（15px 内边距、可滚动）、底栏（右上 1px hairline）；底栏按钮取站点常规尺寸（高 32px、左右 24px） |
| `.modalField` / `.modalInput` / `textarea.modalInput` | 字段与输入框（高 34px、1px `--bgm-input-border`、聚焦粉色描边 + 3px `--app-primary-veil`） |
| `.modalCheck`（`[data-disabled='true']`） | 复选/单选行（模型配置的"保存到本机"、代理模式三选一）；原生控件 + `accent-color` |
| `.modalHint` / `.modalError` / `.modalSteps` / `.modalChoiceRow` | 说明、错误、步骤列表、横排选项行（站点 `div.collectType` 的做法） |
| `.modalStatus`（`[data-configured='true']`） / `.dot` | 进度状态条：默认浅灰块 + 待机点，配好凭据时转成功色 |
| `.settingsRow` / `.label` / `.value` / `.actions` | 设置主面板的四行布局（名称 5.5em 定宽 + 值 + 操作；行内小按钮 24px 高） |
| `.pickerList` / `.pickerRow`（`.selected`） / `.title` / `.meta` | 选择列表（历史会话弹窗）：点线分隔、hover 整行交互蓝 + 白字 |

`.modalSurface code` 与 `frame.css` 的 `.markdown code` 是两处独立的等宽皮肤，各自服务自己的容器。

## 三者共同遵守

1. **只消费令牌**（`--bgm-*` / `--app-*` / 少量 `--dsw-alias-*`），不写死颜色；品牌色改动只发生在 `bgm.css`。
2. **类名不越界**：`cards.css` 不写 `.modal*`，`modal.css` 不写 `.composer*`，`composer.css` 不写 `.plan*`。
3. **浮层材质走子层**：底色 + 模糊放 `.xxxMaterial`，卡片只管几何与描边——这样背景内容透出来的效果在所有浮层一致。
4. **可访问性**：交互控件保留 `:focus-visible` 焦点环（`--bgm-focus` 或 `outline`）；`data-state` 类的状态不能只靠颜色区分（确认卡同时有文案）。
5. **同一属性只有一个来源**：`.button` 的基础形态在 `cards.css`，弹窗与设置行只按需改尺寸/配色；出现"同一属性在两处各写一遍"时，合并到更靠基础的那一处。
