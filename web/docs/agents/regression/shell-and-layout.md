# 外壳与布局用例（`L` / `A`）

## 使用说明

### 这份文档是什么

外壳与布局的用例：`L1`–`L10` 覆盖首屏与退出条件、侧栏响应式、连接状态、DOM 与类名契约、宽度轴、品牌外观、引入顺序、可访问性、浮层层级；`A1`–`A7` 覆盖外观与动效契约（容器查询与屏外优化、内容条目可见性、非常驻循环动画、减少动态效果降级、弹窗过渡与浮层挂载点、接管卡去重、会话草稿隔离）。

前提与判定约定见 [readme.md](readme.md)。这一组是**样式与 DOM 契约**的回归，改类名、层级、样式文件、令牌或动效参数后必跑。

### 怎么读（用例段 → 场景）

| 用例段 | 什么时候跑 |
|---|---|
| `L1`–`L2`（首屏与退出条件） | 动首屏 hero、`selectHeroPhase` 或输入卡阶段时 |
| `L3`（侧栏折叠与响应式） | 动 `ui.collapsed`、`useResponsiveCollapse` 或侧栏样式时 |
| `L4`（连接状态） | 动 SSE 订阅或连接状态映射时 |
| `L5`–`L6`（DOM 契约与宽度轴） | **改组件结构、类名或层级后必读**（逐项核对骨架与列宽轴） |
| `L7`–`L8`（品牌形态与引入顺序） | 动样式文件、令牌或 `main.tsx` 的 import 顺序时 |
| `L9`（焦点环与键盘可达） | 动交互控件、禁用态或浮层时 |
| `L10`（浮层遮挡关系） | 动弹窗 / toast 的层级或 `z-index` 时 |
| `A1`（容器查询与屏外优化） | 动 `.appStage*` 的层级或 `container-type` 时 |
| `A2`（内容条目可见性） | 动 `AnimatedContent` 的用法或滚动容器 id 时（**最容易静默失败的一条**） |
| `A3`–`A4`（动效约束与降级） | 加动效、改动效令牌、改 `BorderGlow` / `TextType` 参数时 |
| `A5`（弹窗过渡与浮层挂载点） | 动 `Modal` / `DialogStage` / `Toast` / `StatsDock` 的浮层结构时 |
| `A6`–`A7`（接管卡与草稿） | 动输入区座位、共享确认卡、会话草稿或后台会话状态时 |

### 必须遵守的规则

本组通用规则见 [readme.md](readme.md) 的「必须遵守的规则」。本篇专属：

1. **`L5` 必须同时核对层级关系**，只确认节点存在不算通过 —— 违反后果：容器查询与屏外优化静默失效。
2. **`L6` 要在侧栏展开与收起两态各测一次** —— 违反后果：只覆盖一种宽度。
3. **`L7` / `L8` 肉眼判定时以"关键形态"为准，并优先怀疑引入顺序** —— 违反后果：把顺序问题误判成样式写错。
4. **`A2` 必须在真实会话里跑**，且要滚动到内容条目所在位置；只在 hero 或纯文本会话里跑等于没跑。
5. **`A3` 的"无循环动画"按计算样式判定**，不靠肉眼：常驻动画会让界面持续合成，在低配机器上表现为掉帧，肉眼看不出但确实存在。

## L1 首屏渲染（不需模型）

**前置**：会话为空且空闲（刚新建或刚打开）。

**预期**（逐项存在且内容正确）
- 外壳：`.appFrame[data-sidebar='collapsed'|'expanded']`、`.appSidebar`、`main.appConversation`；
- 顶栏：`.appTitle` 文案「Bangumi 助手」、`.appTab` 文案「会话」、`.appChip` 连接状态、`.appIconButton`（`aria-label="设置"`）；
- 首屏：`.appHero` → `.appHeroHeadline`（含「Bangumi 助手」）→ `.appHeroBadge`（「Web 终端」）→ `.appHeroHint`；
- 输入区：`.appSeat` → `.appComposerStack` → `.appGlow` → `.appComposerCard` → `#composer-input`；首屏态的区别是 `.appStage[data-phase='hero']` 下输入框最小高度变为 32px、`.appSeat` 底部留白加到 26px；
- 底栏读数：`.statsDock`（`.statsPill` token 胶囊 + `.contextTrigger` 上下文环）。

**判定**
```js
['.appFrame', '.appSidebar', '.appConversation', '.appHeader', '.appHero', '.appHeroHeadline', '.appSeat', '#composer-input'].every(s => document.querySelector(s))
document.querySelector('.appStage').dataset.phase === 'hero'
document.querySelector('.appFrame').dataset.sidebar        // 窗口宽 ≤1024 时为 'collapsed'
```

## L2 首屏退出条件

**步骤**：分别制造下列任一条件，观察是否离开 hero 阶段（`.appStage[data-phase]` 变 `active`）。

| 条件 | 期望 |
|---|---|
| 出现任何条目（通知/命令回显/助手回答） | 离开 hero |
| 正在流式输出（`busy` 或 `liveText` 非空） | 离开 hero |
| 有乐观回显气泡（`pendingEcho`） | 离开 hero |
| 以上都没有 | 停在 hero |

**判定**：`document.querySelector('.appStage').dataset.phase`（`.appStageScroll` 上也带同一个 `data-phase`，样式两处都用得到）。

## L3 侧栏折叠与响应式

**步骤**
1. 点侧栏顶部的折叠按钮（`aria-label` 为「展开侧栏」/「收起侧栏」）；
2. 把**窗口宽度缩到 ≤1024**，再点按钮展开。

**预期**
- 点击在 `collapsed` / `expanded` 间切换，`.appFrame[data-sidebar]` 同步变化（列宽 `--app-sidebar-width` 264px ↔ 60px），侧栏文字与品牌行淡出/淡入；
- 缩窄后自动收起；此时**手动展开**，再触发一次 resize（拖动窗口 1px）会**重新收起**——这是既定的强制语义，不是缺陷；
- 折叠状态下「新建会话」按钮（`.appNewSession`）仍可见可用（标签隐藏、只剩图标）。

**判定**
```js
document.querySelector('.appFrame').dataset.sidebar
document.querySelector('.appLogoRow .appIconButton').getAttribute('aria-label')
```

## L4 连接状态（不需模型）

**步骤**
1. 页面打开且宿主在运行 → 看顶栏 chip；
2. **停掉宿主进程**（`Ctrl+C`）→ 再观察；
3. 重新启动宿主 → 再观察（`EventSource` 自带重连）。

**预期**
- 运行中：chip 文案「已连接」、`data-state="on"`、圆点转绿；
- 宿主停止：「连接中断」、`data-state="off"`、圆点转红；
- 宿主重启：自动恢复「已连接」，**无需刷新页面**。

**判定**
```js
const chip = document.querySelector('.appHeader .appChip');
[chip.textContent.trim(), chip.dataset.state]
```

## L5 DOM 与类名契约（样式依赖的骨架）

**步骤**：在空会话与至少一轮对话两种状态下，逐项核对下列节点**存在且层级正确**。

首屏阶段 `.appStageScroll` 直接承载 `.appHero`；下表的 `.appStageFlow > .appStageColumn > .appTurn` 只在活动阶段出现，不能据此判定空会话首屏失败。

| 选择器 | 层级/关系 | 谁依赖 |
|---|---|---|
| `.appFrame` | 最外层 | 外壳网格 |
| `.appConversation` | `.appFrame` 的第二列 | 会话列 |
| `.appStage` | `.appConversation` 内 | **尺寸容器**（`container-type: inline-size`） |
| `.appStageBody` | `.appStage` 内 | 滚动体与导轨的定位上下文 |
| `.appStageScroll` | `.appStageBody` 内（`id="app-stage-scroll"`） | 滚动 + 屏外优化 + `AnimatedContent` 的 `container` |
| `.appStageFlow > .appStageColumn` | `.appStageScroll` 内 | 列宽轴（`100cqw`） |
| `.appTurn` | `.appStageColumn` 的直接子级 | 屏外优化选择器 |
| `.appSeat` | `.appStage` 内、`.appStageBody` **之后** | 输入卡座位（`composer` 槽位） |
| `.appCardSeat` | 接管时替换 `.appSeat` **内部** | 确认卡座位 |

**判定**（层级关系一并校验）
```js
document.querySelector('.appStageBody > .appStageScroll#app-stage-scroll > .appStageFlow > .appStageColumn > .appTurn') !== null
document.querySelector('.appStage > .appStageBody + .appSeat') !== null
document.querySelector('.appSeat #composer-input') !== null
```

> 特别提醒：`Stage` 必须包含 `.appStage`、`.appStageBody` 与 `.appStageScroll`，但**不含** `.appFrame` / `.appConversation`（由外壳提供）。这条边界改动会导致屏外优化与列宽同时失效。

## L6 列宽轴

**步骤**：同一窗口宽度下，分别在**侧栏展开**与**收起**两态读取会话列的实际宽度与其 `max-width`。

**预期**：列宽只有一个来源——`.appStageColumn` 的 `max-width: min(calc(100cqw - 48px), clamp(680px, 64cqw, 900px))`，因此展开/收起侧栏后列宽都在 680–900px 区间内变化；`.appStageFlow` 与 `.appSeat` 各给 24px 左右内缩（与公式里的 `- 48px` 同源）。

**判定**
```js
const col = document.querySelector('.appStageColumn');
const cs = getComputedStyle(col);
({ maxWidth: cs.maxWidth, width: col.getBoundingClientRect().width })
// width 应落在 680–900 之间（窄窗口下可小于 680，此时受 100cqw - 48px 约束）
getComputedStyle(document.querySelector('.appStageFlow')).paddingLeft    // '24px'
getComputedStyle(document.querySelector('.appSeat')).paddingLeft         // 同为 24px
```

> **已知不一致（待确认）**：此前输入卡与确认卡与正文列共用同一条由 `--dsh-chat-content-width` 驱动的轴；该变量已不存在，`.planCard` 的 `max-width` 又指向无人定义的 `--dsh-composer-card-max-width`（声明不生效），因此宽屏下输入卡与确认卡比正文列更宽。详见 [../styles/frame.md](../styles/frame.md) 的"已知不一致"。

## L7 品牌外观关键形态

**步骤**：对照下列形态逐项看（不需设备，肉眼判定）。

| 项 | 期望 |
|---|---|
| 主色 | 选中态/强调为粉色（`#f09199` 系），文字态用 `#a8575f` |
| hover | 列表行/菜单行 hover 落交互蓝（`#369cf8` 系）；内容条目的位移类 hover 只在 `@media (hover: hover)` 下生效 |
| 卡片 | 1px 描边 + 10px 圆角；浮起靠两级阴影（内嵌卡片 `--app-shadow-raised`、hover 升到 `--app-shadow-card` 并上移 2px） |
| 弹窗 | 15px 圆角 + `--app-shadow-panel`（两级投影）；表面不透明；遮罩 `rgba(40,40,40,.32)` |
| 弹窗标题栏 | 约 40px 高；细线关闭按钮；下方 1px 分隔线 |
| 弹窗按钮与底栏 | 主按钮粉色实心白字；次要按钮浅灰底 `#888` 字；hover 都变蓝；底栏上方有 1px 分隔线 |
| 连接 chip | 描边胶囊 + 6px 圆点（绿/红），文案同时表态 |
| 输入区 | 卡片圆角 15px（`--app-radius-panel`），与内容卡片的 10px 区分开 |
| 区域底色 | 侧栏（含 `.appFrame`）是站点灰 `#f5f5f5`（`--app-surface-sunken`）；对话区与顶栏是白面 `#fff`（`--app-surface`）；侧栏里的新建会话与会话行 hover 用白底浮起 |
| 浮层材质 | 命令候选、思考菜单、统计浮层都是不透明卡片表面；`.menuMaterial` / `.statsPanelMaterial` 是 `opacity: 0` 的占位层，看不到玻璃模糊 |

**判定**：肉眼 + 需要时截图对比；错乱优先怀疑 [../styles/readme.md](../styles/readme.md) 里的**引入顺序**。

## L8 样式引入顺序回归

**步骤**：把窗口缩放一次（触发重排）后，抽查三处颜色/形态：侧栏选中行、输入卡边框、弹窗表面。

**预期**：三处都呈品牌值（不是 DSH 默认蓝/白）。若出现"部分生效"，检查 `main.tsx` 的 import 顺序是否为 `tokens → frame → composer → cards → modal → bgm → content → debug`（`debug.css` 只消费令牌，排在最后不影响 `bgm.css` 的重定向）。

**判定**：肉眼；命令行核对顺序：`Select-String -Path web/src/main.tsx -Pattern "styles/"`。

## L9 焦点环与键盘可达

**步骤**：用 Tab 依次走：侧栏折叠按钮 → 新建会话 → 会话行 → 顶栏设置 → 输入框 → 思考标签 → 发送键。

**预期**
- 每个可交互控件都有**可见焦点环**（统一是 `--bgm-focus` 的一圈粉色光晕；不依赖 hover 才看得出）；
- 顺序与视觉顺序一致，不跳进隐藏元素；
- Enter/Space 能激活按钮。

**判定**
```js
document.activeElement.tagName + ':' + (document.activeElement.getAttribute('aria-label') ?? document.activeElement.className)
```

## L10 浮层遮挡关系

**步骤**
1. 打开设置弹窗，观察它相对会话区与输入卡的遮挡；
2. 触发一次 toast（如 `/help`），观察它与弹窗的叠放。

**预期**
- 弹窗及其遮罩覆盖整页（含侧栏与输入区），遮罩很淡；
- 层级从低到高：`.appRail`（5）< `.appComposerPopup`（20）< `.appToast`（40）< `.modalOverlay`（60）< `.thinkingMenu`（100）；
- 因此**弹窗打开时 toast 会被遮罩压住**（可见但变暗），这是当前实现，不要按"toast 永远在最上层"判定；
- toast 不阻塞点击（它没有铺满屏幕）。

**判定**：肉眼 + 需要时读层级：
```js
['.appToast', '.modalOverlay', '.thinkingMenu'].map(s => [s, getComputedStyle(document.querySelector(s)).zIndex])
```

> **修复记录**：统计浮层的根节点 `.statsPanel` 曾在外观层合并中丢掉定位与表面规则（浮层会落到页面流末尾且没有可见表面），现已补回：`position: fixed`、`z-index: 1100`、`--app-surface` 底 + `--app-shadow-panel`、`app-popup-in` 入场。详见 [../styles/components.md](../styles/components.md)。

## A1 容器查询与屏外优化

**前置**：打开一个有消息的会话（非 hero 阶段）。

**预期**（层级必须完整，屏外优化依赖这条链）
```
.appStage[data-phase='active'] > .appStageBody > .appStageScroll#app-stage-scroll > .appStageFlow > .appStageColumn > .appTurn
```
- `.appStage` 带 `container-type: inline-size`（列宽与输入卡宽度轴靠它）；
- `.appTurn` 命中 `content-visibility: auto` 的屏外优化链；
- 输入区在 `.appStage` 内、`.appStageBody` **之后**（`composer` 槽位）。

**判定**
```js
const ok = !!document.querySelector(".appStage[data-phase='active'] > .appStageBody > .appStageScroll#app-stage-scroll > .appStageFlow > .appStageColumn > .appTurn");
({ chain: ok, container: getComputedStyle(document.querySelector('.appStage')).containerType })
// containerType → 'inline-size'
getComputedStyle(document.querySelector('.appTurn')).contentVisibility   // 'auto'
```

## A2 内容条目不得被入场动画卡成不可见（关键）

**背景**：内容条目（`.contentBlock`）由 ReactBits 的 `AnimatedContent` 包装，它的初始内联样式是 `visibility: hidden`，靠 gsap `ScrollTrigger` 进入视口后才改为 `visible`。**一旦 `container` 指向错的滚动容器，元素会永远不可见**——这是这条用例存在的唯一原因：`AnimatedContent` 不传 `container` 时会先找 `#snap-main-container`、再退到 `window`，而这里的滚动发生在 `.appStageScroll`（`id="app-stage-scroll"`）内。

**前置**：会话里至少有一条内容条目（条目卡 / 统计 / 进度 / 表格 / 时间线 / 标签云 / 封面墙 / 对比表 / 引用 / 提示条 / 链接列表之一）。

**步骤**
1. 滚动到该条目所在位置；
2. 检查它的**包装元素**（`.contentBlock` 的父元素）的计算样式。

**预期**：进入视口的条目 `visibility: visible`、`opacity` 已到 1、`transform` 无残余位移；未进入视口的条目可以仍是 `visibility: hidden`（这是正常等待状态）。

**判定**
```js
[...document.querySelectorAll('.contentBlock')].map(b => {
  const w = b.parentElement, cs = getComputedStyle(w), r = w.getBoundingClientRect();
  return {
    inViewport: r.top < innerHeight && r.bottom > 0,
    visibility: cs.visibility,
    opacity: Number(cs.opacity).toFixed(2),
    translateY: cs.transform,
  };
})
// 约束：inViewport === true 的项，visibility 必须是 'visible'
// 另需核对滚动容器 id：document.querySelector('.appStageScroll')?.id === 'app-stage-scroll'
```

## A3 动效存在且无常驻循环动画

**预期**
- 入场类动效只在挂载/进入视口时发生，结束后不残留 `will-change`；
- **没有** `animation-iteration-count: infinite` 的常驻动画，除**流式光标**一处例外（它只在流式期间存在，表达「还在写」）；
- `BorderGlow`（输入卡外层 `.appGlow` / `.border-glow-card`）的边缘光只在指针附近出现，**不做自动扫光**。

**判定**
```js
// 1) 有没有常驻无限动画
[...document.querySelectorAll('*')].filter(el => {
  const cs = getComputedStyle(el);
  return cs.animationIterationCount.split(',').some(v => v.trim() === 'infinite') && cs.animationName !== 'none';
}).map(el => el.className || el.tagName)
// 期望：空数组；流式进行中最多出现流式光标所在元素
// 2) BorderGlow 不是自动扫光模式（animated={false}，因此不会挂上 sweep-active）
document.querySelector('.border-glow-card').classList.contains('sweep-active') === false
```

**说明**：流式光标由 `TextType` 用 gsap 循环改 `opacity`（不是 CSS 动画），因此它不会出现在上面这个 CSS 探针的结果里——探针在流式期间同样应当是空数组。另外 `edge-light` 的显隐还依赖真实 `:hover`，CDP 驱动下 `element.matches(':hover')` 恒为 false，自动化只能验证到「CSS 变量 → 透明度公式」这一环（`--edge-proximity` 与 `--cursor-angle` 随指针变化）。

## A4 `prefers-reduced-motion` 降级

**步骤**：在系统里开启「减少动态效果」（或 DevTools 的 Rendering 面板模拟 `prefers-reduced-motion: reduce`），刷新后打开弹窗、展开统计浮层、切换会话。

**预期**
- CSS 侧：过渡与动画被全局禁用（`frame.css` 里的 `prefers-reduced-motion` 段把 `transition` / `animation` 置为 `none !important`）；
- JS 侧：由 `Shell` 的 `<MotionConfig reducedMotion="user">` 接管，位移/缩放类动画退化为仅透明度过渡，**内容仍然全部可见**（不能因为动画被跳过而不显示）。

**判定**
```js
matchMedia('(prefers-reduced-motion: reduce)').matches   // 开启后为 true
// 弹窗仍能正常打开，且表面可见：
getComputedStyle(document.querySelector('.modalSurface')).opacity   // '1'
```

## A5 弹窗进出过渡与浮层挂载点

**背景**：`Modal` 用 motion 渲染遮罩与表面并声明 `exit`，presence 由 `DialogStage` 的 `AnimatePresence` 提供，因此关闭时也会先播完过渡再卸载。统计浮层由 `StatsDock` **portal 到 `body`**（输入卡在滚动容器里，留在卡内的绝对定位浮层会被裁掉）；弹窗**不** portal，它渲染在 `.appFrame` 内靠 `position: fixed` 覆盖全屏。

**步骤**
1. 打开设置弹窗，核对遮罩与表面的标签与角色；
2. 点关闭（或按 Esc），**同一帧**观察遮罩是否还在，约 0.5 秒后再看一次；
3. 展开统计浮层，核对它的父节点。

**预期**
- `.modalOverlay` 是 `DIV`、`.modalSurface` 是 `SECTION` 且 `role="dialog"`；两者都带 motion 写入的内联 `style`（`opacity`，表面还有 `transform`）；
- 关闭后遮罩**不是立刻消失**：它先播退出过渡（遮罩 200ms、表面 300ms），随后被卸载；
- `.statsPanel` 的 `parentElement` 是 `document.body`。

**判定**
```js
const o = document.querySelector('.modalOverlay'), s = document.querySelector('.modalSurface');
({ overlayTag: o.tagName, surfaceTag: s.tagName, role: s.getAttribute('role') })
// → DIV / SECTION / 'dialog'
// 点关闭后立刻（同一帧内）：
document.querySelectorAll('.modalOverlay').length       // 仍为 1（正在播退出过渡）
// 约 0.5 秒后：
document.querySelectorAll('.modalOverlay').length       // 0
// 统计浮层（点开 .contextTrigger 或 .statsPill 之后）：
document.querySelector('.statsPanel')?.parentElement === document.body
```

**注意**：本用例核对统计浮层的**挂载点**（portal 到 `body`）；它的表面与定位由 `L7`、`L10` 覆盖。

## A6 待授权只显示一张卡

**前置**：让宿主发起一次写入确认（普通单项修改与章节状态操作免确认，不能用来触发本用例）。

**预期**
- 输入区被**接管**：`.appSeat` 内出现 `.appCardSeat > .planCard[data-state='pending']`，同一时刻全页**只有一张** `pending` 卡，且 `#composer-input` 不在；
- 会话正文**不**重复呈现同一条待授权记录（`ConfirmationCard` 在"待授权但只呈现结果"的模式下不渲染）；确认或取消后，该记录才在正文出现，输入区撤下操作卡；
- 完整授权正文与宿主按钮文案保留，`answering` 为假（未点下）时确认与取消都可点；
- 点下后到宿主返回结论之前，两个按钮短暂禁用（防重复提交）；
- 授权完成后输入区恢复，历史列表只留一条已授权结果。

**判定**
```js
document.querySelectorAll('.planCard[data-state="pending"]').length        // 1
document.querySelector('.appSeat .appCardSeat .planCard')?.dataset.state   // 'pending'
!document.querySelector('#composer-input')
// 待确认时按钮可点：
[...document.querySelectorAll('.appSeat .planActions button')].every(b => !b.disabled)   // true
// 点下后、结论到达前（窗口很短，需要立即求值）：
[...document.querySelectorAll('.appSeat .planActions button')].every(b => b.disabled)    // true
// 历史条目里的确认卡没有动作按钮：
document.querySelectorAll('.appRow .planActions').length === 0
```

## A7 会话切换保留各自草稿

**前置**：侧栏至少两条历史会话（A、B）。

**预期**
- A ↔ B 切换分别恢复各自的草稿（草稿按会话存在 `ui.drafts[sessionId]`，切换会话会重建输入卡但草稿不丢）；
- 输入区在**切换中、未就绪或断线**时不可提交（输入与发送一并禁用）；应答在途时发送按钮禁用；
- A 的发送失败迟到时，只恢复 A 的原文，不覆盖 B 的草稿或用户的新输入（`draftRestored` 只在草稿仍为空时生效）；
- 侧栏每行右侧展示状态：`待确认` / `待登录` / `运行中` 优先于 `当前`，其余显示相对时间。

**判定**
```js
// 在 A 输入 'A 草稿' → 切到 B → 输入 'B 草稿' → 再切回 A：
document.querySelector('#composer-input').value            // 'A 草稿'
// 侧栏状态：
[...document.querySelectorAll('.appSessionRow')].map(r => [
  r.querySelector('.appSessionTitle').textContent,
  r.querySelector('.appSessionTime').textContent,
  r.dataset.current,
])
```
