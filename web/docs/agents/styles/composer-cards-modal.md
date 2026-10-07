# 输入区、确认卡与弹窗（`composer.css` / `cards.css` / `modal.css`）

## 使用说明

### 这份文档是什么

三个文件的规则与分区索引：输入区（输入卡、命令候选、锚定菜单、思考强度入口、统计底栏）、写入确认卡与按钮基元、弹窗（共享表面 + `.dlg*` 内容骨架 + 进出动画）。

**不覆盖**：会话区与外壳（见 [frame.md](frame.md)）、内容条目（见 [content.md](content-and-brand.md)）、令牌定义（见 [tokens.md](tokens.md)）、组件实现（见 [../components/main-page.md](../components/main-page.md)、[../components/dialog.md](../components/dialog.md)）。上层入口：[../readme.md](../readme.md)。

### 怎么读

| 你要改的地方 | 读哪一节 |
|---|---|
| 输入卡、发送键、思考强度标签、命令候选 | §索引「`composer.css`」 |
| 底栏读数与它的浮层 | §索引「`composer.css`」的「统计底栏」 |
| 确认卡的条带 / 预览 / 动作行 | §索引「`cards.css`」 |
| 按钮的主 / 次 / 拒绝三态 | §索引「`cards.css`」的「按钮基元」 |
| 弹窗表面、进出动画 | §规则「弹窗的四条硬约定」 |
| 弹窗里的表单骨架（`.dlg*`） | §索引「`modal.css`」 |

### 必须遵守的规则

1. **输入卡与内容列同宽，宽度轴只有一处来源**：`composer.css` 的 `.appComposerStack` 与 `frame.css` 的 `.appStageColumn` 共用同一条 `min(calc(100cqw - 48px), clamp(680px, 64cqw, 900px))`，卡片只写 `width: 100%`。**不要在卡片上另写 `max-width`**。违反后果：宽屏下卡比内容列宽。历史事故：`cards.css` 曾有一条 `max-width` 指向一个**全仓从未定义**的令牌——声明在计算值阶段作废，等于没写。
2. **弹窗不做 `opacity` 淡入**：Chromium 在 `opacity < 1` 时会跳过 `backdrop-filter`（实测同一条 `blur(20px)`，`opacity: 1` 时背后文字糊掉、`.5` 时清晰可读；`will-change` / `translateZ(0)` / 子层承载模糊 / 祖辈承载透明度四种写法都无效）。进出动画改由 `modal.css` 的 keyframes 给、**只动 `transform`**；退场由 `data-leaving` 触发。违反后果：弹窗背后不再模糊，玻璃面变成一块半透明色块。
3. **浮层的表面色与模糊放在材质子层，卡片只负责几何与描边**（上游 `MenuSurface` 做法）：`.menuMaterial` 用 `z-index: -1` 铺满父级、`border-radius: inherit`。违反后果：模糊与描边互相裁切，圆角处出现白边。
4. **悬停与键盘焦点必须分开声明**：合在一个块里会让鼠标划过也长出一圈焦点环。菜单项 hover 只给最浅一档底（`--bgm-surface-alt`）+ 主色深档字色，且必须带 `:not(.selected)`——否则悬停一个已选中项会把它退回悬停底，看起来像被取消选中。违反后果：鼠标划过像焦点、悬停已选项像取消选中。
5. **抬高的表面对滚动条只重绑几何，不重绑滑块深浅**：`.menuViewport` 只改 `--app-scrollbar-width` 与 `-track-margin`。违反后果：滑块出现两档深浅（上游那两级取值本来就相同，已合并成一枚令牌）。
6. **弹窗同一时刻只保留一个**（会话弹窗与设置弹窗不叠加），**无蒙层**。违反后果：两个弹窗抢焦点、或整屏压暗与「层次靠扩散阴影表达」的决策冲突。
7. **`.modalSurface` 不覆写 `--glass-shadow`**：弹窗阴影维持共享档（两段、最大模糊 28px），这是设计决策的定稿。违反后果：弹窗阴影比样张重一倍多。

## 索引

### `composer.css`

| 段 | 选择器 | 要点 |
|---|---|---|
| 输入卡与底栏栈 | `.appComposerStack` / `.appComposerCard` / `.appComposerInput` | 同一栈、同一宽度轴；卡片在上、读数在下。卡上缘挂 `BorderGlow` 的边缘光 |
| 输入卡内元素 | 发送键、命令候选、本地校验提示 | 校验提示（未知命令等）**只出现在输入卡内，不进会话记录** |
| 弹层锚点 | 卡片顶边的零高条带 | 弹层由此**向上**展开 |
| 命令弹窗 | `.menuMaterial` / `.menuItem` / `.menuLabel` / `.menuSeparator` | 行高 `min-height: 34px`、圆角走 `--app-radius-control` |
| 锚定菜单 | `.menuViewport` | `max-height: min(360px, calc(100vh - 96px))` + 滚动条几何重绑 |
| 思考强度入口 | `.thinkingAnchor` / 思考强度菜单 | 输入卡右侧常驻一枚「思考 · 高」式标签，点开就地选择；菜单向上展开，Esc 只关菜单，不会顺带停止本轮或拒绝确认 |
| 统计底栏 | `.statsDock` / `.statsAnchor` / `.statsPill` / `.contextTrigger` | **常态无底、无描边**（纯文字 + 环），只在 hover / 展开时浮起浅底——这一行是附注不是两个按钮（C32 定稿 D）；`.statsPill` 与 `.contextTrigger` **合并成一条选择器列表**（它们本该长同一副样子） |
| 统计浮层 | 底栏浮层的面板 | 浮层 **portal 到 body 后 fixed 定位**：输入卡在 `.appStageScroll`（`overflow-y: auto`）里，留在卡内的绝对定位浮层会被那个滚动容器裁掉 |

数值来源在文件头注明（对齐 DSH 的 `InputBar` / `MenuView` / `MenuSurface` / `ModelSelect`），配色改走 Bangumi 令牌。

### `cards.css`

| 段 | 选择器 | 要点 |
|---|---|---|
| 卡外框 | 确认卡的座位 | 卡外 frame 的内边距 |
| 通用卡面 | 抬高表面 | 会话内联卡也用这一层 |
| 写入确认卡 | `.planCard` / `.planStrip` / `.planTitle` / `.planBody` / `.planPreview` / `.planNote` / `.planActions` | 卡面：`1px solid` 主色 30% + `--app-radius-panel` + `--app-shadow-card`。条带用主色浅底 + 主色深字 |
| 状态变体 | `.planCard[data-state='accepted'|'rejected'|'expired']` | **已授权**的唯一状态信号是外框转 `--bgm-success-border`（条带底色与基础条同值，这是粉白体系里的必然结果）；拒绝与过期都是「已失效」，条带**弱化**而不是高亮——上游别名曾把失效底填成不透明的交互蓝，被拒绝的确认条会比待确认的还醒目 |
| 预览块 | `.planPreview` | 宿主生成的业务说明：**去底去边、改留白 + 左侧 2px 槽线** + 降次级字号（C39 定稿 C）。原先做成「内嵌块」（sunken 底 + 四边 1px），让预览区比确认卡本身还重 |
| 按钮基元 | `.button` 及变体（含 `.ghost` / `.reject`） | 实心主按钮的底色 / 字色 / hover 与侧栏「开启新对话」完全一致；`.ghost` 悬停填 `--bgm-interactive`、`.reject` 悬停填 `--bgm-danger`，各自保持原值（不能整体改） |

### `modal.css`

| 段 | 选择器 | 要点 |
|---|---|---|
| 共享表面 | `.modalOverlay` / `.modalSurface` | `.modalOverlay` **只负责三件事**：整屏定位、居中、接住外部点击（点外关闭靠它，所以 `pointer-events` 不能 `none`）；**没有遮罩**。`.modalSurface`：`min(480px, 100%)` 宽、`min(85vh, 640px)` 高、表面来自共享类 `.appGlass`、`transform-origin: center` |
| 进出动画 | `@keyframes modalIn` / `modalOut` | 只动 `transform`；退场由 `data-leaving` 触发、播完约 400ms 才从 DOM 移除；presence 不由 `AnimatePresence` 提供 |
| 内容骨架 | `.dlgPane` / `.dlgHead` / `.dlgField` / `.dlgInput` / `.dlgList` / `.dlgRow` / `.dlgCombo` / `.dlgChoices` / `.dlgActions` / `.dlgBtn*` | 标题栏固定 **40px**（左对齐标题 + 右侧 30×30 点击区的细线 × + 1px hairline）；字段名是控件上方的次级字；输入框是独立描边控件（`--app-radius-control` + 1px `--bgm-input-border`），聚焦走主色边框 + `--bgm-focus` 光晕；选项行是横排原生控件 + 1px 收尾线；底部动作行上方压一条 hairline |
| 自绘下拉 | `.dlgCombo` 相关 | 不用原生 `<select>`，保证圆角与超椭圆一致 |

## 规则

### 弹窗的四条硬约定

1. **无蒙层**：层次由 `.modalSurface` 自己承担——`.appGlass` 的玻璃填充 + 背后那一片 `backdrop-filter` 模糊 + 共享阴影档。若将来要恢复压暗，**唯一落点是 `.modalOverlay`**，不要在令牌层复活一枚遮罩别名。
2. **不淡入**（见 §规则第 2 条）。
3. **阴影走共享档**：`.modalSurface` 不覆写 `--glass-shadow`。历史上有过覆写成浮层档（最大模糊 72px）的版本，那是两份决策互斥的一段，已按「以样张为准」收口。
4. **标题栏与字段的几何固定**（40px / 10px 圆角 / 3px 焦点光晕）：样张与设计决策都写了具体值，`getComputedStyle` 可以直接核对。

### 三个文件的边界

- `composer.css`：输入区与它的浮层（含统计底栏浮层）——这些浮层的锚点是输入卡，跟着输入区走。
- `cards.css`：确认卡与按钮基元——确认卡可以出现在输入区（接管态）也可以出现在会话流（历史态），所以它单独成文件。
- `modal.css`：整屏浮层与表单骨架——`.dlg*` 是**骨架类**，所有弹窗共用；单个弹窗的专属形状写在它自己那段（`.dlg*` 之后的「外观层补充」）。

一个元素同一属性只在一处声明；要给既有类补属性时起**组合类**（见 [../readme.md](../readme.md) §规则第 1 条）。

## 现状：已知的例外与未做

1. **`.menuMaterial` 的 `box-shadow: 0 0 0 0.5px var(--app-hairline)` 看似多余**：上游那条 elevation 令牌本身是**阴影**（`0 0 0 0.5px <色>`）而不是颜色值，换描边色后必须把形状一起写回来，否则整条 `box-shadow` 作废。它在 `Modal` / `ThinkingPicker` 里都处于 `opacity: 0`，实际不参与渲染——不要因为「看不见」就删掉。
2. **`.dlgCombo` 是自绘下拉**：改它之前先确认键盘交互（方向键 / Esc / Home-End）与 `aria-*` 契约，不要退回原生 `<select>`。
3. **确认卡接管态仍缺少自动化验收**：它需要宿主发起一次真实写入（`pending` 确认），自动化里无法安全触发。改动这块时只能做静态核对 + 手动实测，不要声称已验证——这条在前端知识库的「未验证」清单里也有记录。
