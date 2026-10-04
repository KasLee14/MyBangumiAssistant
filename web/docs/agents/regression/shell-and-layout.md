# 外壳与布局用例（`L` / `A`）

## 使用说明

### 这份文档是什么

外壳与布局（`L1`–`L10`）与外观与动效（`A1`–`A4`）的用例：首屏与退出条件、侧栏响应式、连接状态、DOM 与类名契约、列宽轴与容器查询、品牌外观、引入顺序、可访问性、浮层层级，以及会话区 DOM 契约、内容条目入场可见性、动效约束与降级。

前提与判定约定见 [readme.md](readme.md)。这一组是**样式与 DOM 契约**的回归，改类名、层级、样式文件、令牌或动效后必跑。

### 怎么读（用例段 → 场景）

| 用例段 | 什么时候跑 |
|---|---|
| `L1`–`L2`（首屏与退出条件） | 动首屏 `Hero`、`selectHeroPhase` 或输入卡阶段时 |
| `L3`（侧栏折叠与响应式） | 动 `ui.collapsed`、`useResponsiveCollapse` 或侧栏样式时 |
| `L4`（连接状态） | 动 SSE 订阅或连接状态映射时 |
| `L5`（DOM 与类名契约） | **改组件结构、类名或层级后必读**（逐项核对骨架） |
| `L6`（列宽轴与容器查询） | 动 `.appStage` / `.appStageColumn` 的宽度规则时 |
| `L7`–`L8`（品牌形态与引入顺序） | 动样式文件、令牌或 `main.tsx` 的 import 顺序时 |
| `L9`（焦点环与键盘可达） | 动交互控件、禁用态或浮层时 |
| `L10`（浮层遮挡与层级） | 动弹窗 / toast / 统计面板的 `z-index` 时 |
| `A1`（会话区 DOM 契约与滚动容器 id） | 动 `Stage` / `Turn` 的结构或 `#app-stage-scroll` 时 |
| `A2`（内容条目入场可见性） | 动 `Turn` 的 `AnimatedContent` 用法或滚动容器 id 时（**最容易静默失败的一条**） |
| `A3`–`A4`（动效约束与降级） | 加动效、改 `--app-*` / `motionTokens.ts`、改 `BorderGlow` / `TextType` 参数时 |

### 必须遵守的规则

本组通用规则见 [readme.md](readme.md) 的「必须遵守的规则」。本篇专属：

1. **`L5` 必须同时核对层级关系**，只确认节点存在不算通过 —— 违反后果：容器查询与屏外优化静默失效。
2. **`L6` 要在侧栏展开与收起两态各测一次** —— 违反后果：只覆盖一种容器宽度。
3. **`L7` / `L8` 肉眼判定时以"关键形态"为准，并优先怀疑引入顺序** —— 违反后果：把顺序问题误判成样式写错。
4. **`A2` 必须在真实会话里跑**，且要滚动到内容条目所在位置 —— 违反后果：在 hero 或纯文本会话里跑等于没跑。
5. **`A3` 的"无循环动画"按计算样式判定**，不靠肉眼 —— 违反后果：常驻动画在低配机器上表现为掉帧，肉眼看不出但确实存在。

## L1 首屏渲染（不需模型）

**前置**：会话为空且空闲（刚新建或刚打开）。

**预期**（逐项存在且内容正确）
- 外壳：`.appFrame[data-sidebar='collapsed'|'expanded']` → `.appSidebar`、`main.appConversation`；
- 顶栏：`.appTitle`（「Bangumi 助手」）、`.appTab`（「会话」）、`.appChip`（连接状态）、`.appHeaderMeta` 里的设置按钮（`aria-label="设置"`）；
- 首屏：`.appHero` → `.appHeroHeadline`（`BlurText` 逐词渲染的标题）→ `.appHeroBadge`（「Web 终端」徽标）→ `.appHeroHint`；hero 阶段 `.appHero` 是 `.appStageScroll` 的**直接子级**，没有 `.appStageFlow` / `.appStageColumn`；
- 输入区：`.appSeat`（在 `.appStage` 内、`.appStageBody` 之后）→ `.appComposerStack` → `.appGlow` → `.appComposerCard` → `#composer-input`；
- 底栏读数：`.statsDock`（`.statsPill` token 胶囊 + `.contextTrigger` 上下文环）——**只有宿主上报过用量时才渲染**，两个读数都为 null 时整条不出现，因此不要把它算进"首屏必须存在"的清单。

**判定**
```js
['.appFrame', '.appSidebar', '.appConversation', '.appHeader', '.appHero', '.appHeroHeadline', '.appSeat', '#composer-input'].every(s => document.querySelector(s))
document.querySelector('.appStage').dataset.phase === 'hero'
document.querySelector('.appFrame').dataset.sidebar        // 窗口宽 ≤1024 时为 'collapsed'
!!document.querySelector('.appStageScroll > .appHero')     // 首屏直接挂在滚动体下
// 有历史会话时（宿主已上报用量）另加：
// !!document.querySelector('.statsDock')
```

## L2 首屏退出条件

**步骤**：分别制造下列任一条件，观察是否离开 hero 阶段（`.appStage[data-phase]` 与 `.appStageScroll[data-phase]` 一起变 `active`）。

| 条件 | 期望 |
|---|---|
| 出现任何条目（通知/命令回显/助手回答） | 离开 hero |
| 正在流式输出（`busy` 或 `liveText` 非空） | 离开 hero |
| 有乐观回显气泡（`pendingEcho`） | 离开 hero |
| 以上都没有 | 停在 hero |

**判定**：`document.querySelector('.appStage').dataset.phase`。

**注意**：离开 hero 后 `.appStageFlow` / `.appStageColumn` 才出现，`L1` 里那条 `.appStageScroll > .appHero` 也随之消失。

## L3 侧栏折叠与响应式

**步骤**
1. 点侧栏顶部的折叠按钮（`aria-label` 为「展开侧栏」/「收起侧栏」）；
2. 把**窗口宽度缩到 ≤1024**，再点按钮展开。

**预期**
- 点击在 `collapsed` / `expanded` 间切换，`.appFrame[data-sidebar]` 同步变化，列宽在 `264px` ↔ `60px` 之间过渡；
- 折叠态的文字是**透明度归零、宽度归零**而不是节点消失：`.appBrand`、`.appNewSessionLabel`、`.appRegionLabel`、`.appSessionTitle`、`.appSessionTime` 仍在 DOM 里（这样它们与列宽过渡同步淡出，不会有硬切）；
- 缩窄后自动收起；此时**手动展开**，再触发一次 resize（拖动窗口 1px）会**重新收起**——这是既定的强制语义，不是缺陷；
- 折叠状态下「新建会话」按钮仍可见可用。

**判定**
```js
document.querySelector('.appFrame').dataset.sidebar
document.querySelector('.appLogoRow .appIconButton').getAttribute('aria-label')
getComputedStyle(document.querySelector('.appBrand')).opacity      // 折叠时为 '0'
```

## L4 连接状态（不需模型）

**步骤**
1. 页面打开且宿主在运行 → 看顶栏 chip；
2. **停掉宿主进程**（`Ctrl+C`）→ 再观察；
3. 重新启动宿主 → 再观察（`EventSource` 自带重连）。

**预期**
- 运行中：chip 文案「已连接」、`data-state="on"`，圆点转绿并带 3px 光晕；
- 宿主停止：「连接中断」、`data-state="off"`，圆点转红；
- 宿主重启：自动恢复「已连接」，**无需刷新页面**。

**判定**
```js
const chip = document.querySelector('.appHeaderMeta .appChip');
[chip.textContent.trim(), chip.dataset.state]
```

## L5 DOM 与类名契约（样式依赖的骨架）

**步骤**：在空会话与至少一轮对话两种状态下，逐项核对下列节点**存在且层级正确**。

| 选择器 | 层级/关系 | 谁依赖 |
|---|---|---|
| `.appFrame` | 最外层 | 外壳网格（`data-sidebar`） |
| `.appSidebar` | `.appFrame` 的第一列 | 侧栏 |
| `.appConversation` | `.appFrame` 的第二列 | 会话列 |
| `.appHeader` | `.appConversation` 内 | 顶栏（68px + 1px hairline） |
| `.appStage` | `.appConversation` 内 | **容器查询参照**（`container-type: inline-size`）+ `data-phase` 的落点 |
| `.appStageBody` | `.appStage` 内 | 滚动体与轮次导轨的定位上下文 |
| `.appStageScroll` | `.appStageBody` 内 | 滚动 + 屏外优化 + 贴底 |
| `.appStageFlow > .appStageColumn` | `.appStageScroll` 内（活动阶段） | 外边距与内容宽轴（`100cqw`） |
| `.appTurn` | `.appStageColumn` 的直接子级 | 屏外优化选择器；带 `id="turn-<id>"` |
| `.appSeat` | `.appStage` 内、`.appStageBody` **之后** | 输入区座位 |
| `.appCardSeat` | 接管时替换 `.appSeat` **内部**的内容 | 确认卡座位 |

**判定**（层级关系一并校验）
```js
document.querySelector(".appStage[data-phase='active'] > .appStageBody > .appStageScroll > .appStageFlow > .appStageColumn > .appTurn") !== null
document.querySelector('.appStage > .appStageBody + .appSeat') !== null
document.querySelector('.appStageScroll[data-phase="active"] > .appStageFlow > .appStageColumn > .appTurn') !== null   // 屏外优化链
```

> 特别提醒：`Stage` 只负责 `.appStage` 以内的结构，`.appFrame` / `.appSidebar` / `.appConversation` 由 `Shell.tsx` 提供。两者的层级不能互换，也不能把 `.appStageBody` 从 `.appStage` 里搬走——那会同时让容器查询与屏外优化失效。

## L6 列宽轴与容器查询

**步骤**：同一窗口宽度下，分别在**侧栏展开**与**收起**两态读取 `.appStage` 与 `.appStageColumn` 的宽度。

**预期**
- `.appStage` 的 `container-type` 是 `inline-size`；
- `.appStageColumn` 的宽度由 `min(calc(100cqw - 48px), clamp(680px, 64cqw, 900px))` 算出：窗口够宽时**不超过 900px**，窄窗口（`@media (max-width: 720px)`）放开到容器全宽；
- 侧栏收放改变的是 `.appStage` 的可用宽度，两个状态下的读数都应符合上式。

**判定**
```js
const stage = document.querySelector('.appStage'), col = document.querySelector('.appStageColumn');
({ container: getComputedStyle(stage).containerType, stage: stage.getBoundingClientRect().width, col: col.getBoundingClientRect().width })
// container → 'inline-size'；宽窗口下 col ≤ 900
```

> 当前源码里**只有 `.appStageColumn` 一处**有宽度上限；`.appSeat` / `.appCardSeat` 不设宽度轴，跟着 `.appStage` 与自身内边距走。宽窗口下输入卡会比会话列宽，本用例只锁定 `.appStageColumn`，不要据此把输入卡判成失败——若认为那是缺陷，另开一处修复并在 [../styles/frame.md](../styles/frame.md) 里同步说明。

## L7 品牌外观关键形态

**步骤**：对照下列形态逐项看（不需设备，肉眼判定）。

| 项 | 期望 |
|---|---|
| 主色 | 选中态/强调为粉色（`#f09199` 系），浅底 `#fdf0f1`、深字 `#a8575f` |
| hover | 行/按钮 hover 落交互蓝（`#369cf8` 系）或 `--bgm-surface-alt` 淡底 |
| 表面 | 对话区与侧栏同为白面，靠 1px hairline 分开；页面底色是 `#f5f5f5` |
| 卡片 | 1px 描边 + 两级阴影（不是靠底色差浮起） |
| 圆角 | 控件 10px、容器 15px、胶囊与圆点全圆；同一元素不应出现第三个圆角值 |
| 弹窗 | 15px 圆角 + 40px 标题栏 + 15px 细线 ×；表面纯白、遮罩很淡且**不做模糊** |
| 弹窗按钮 | 主按钮粉底白字、次要按钮 `#eee` 底 `#888` 字，hover 都落交互蓝 |
| 连接 chip | 描边胶囊 + 圆点光晕（绿/红），文案同时表态 |
| 输入区 | 卡片底色 `#fafafa` + 主色系边缘光（指针附近才出现）；聚焦时补一圈淡主色光晕 |
| 浮层材质 | 命令候选 / 思考菜单 / 统计面板：底色与描边走子层，**背景模糊已关闭** |

**判定**：肉眼 + 需要时截图对比；错乱优先怀疑 [../styles/readme.md](../styles/readme.md) 里的**引入顺序**。

## L8 样式引入顺序回归

**步骤**：把窗口缩放一次（触发重排）后，抽查三处颜色/形态：侧栏选中行、输入卡描边、弹窗表面。

**预期**：三处都呈品牌值（不是 DSH 默认蓝/白）。若出现"部分生效"，检查 `main.tsx` 的 import 顺序是否为 `tokens → frame → composer → cards → modal → bgm → content`。

**判定**：肉眼；命令行核对顺序：`Select-String -Path web/src/main.tsx -Pattern "styles/"`。

## L9 焦点环与键盘可达

**步骤**：用 Tab 依次走：侧栏折叠按钮 → 新建会话 → 会话行 → 顶栏设置 → 输入框 → 思考标签 → 发送键。

**预期**
- 每个可交互控件都有**可见焦点环**（不依赖 hover 才看得出）：多数控件用 `box-shadow: var(--bgm-focus)`（`0 0 0 2px rgba(54, 156, 248, .35)`），模态关闭键用 `outline: 2px solid var(--bgm-interactive)`；
- 顺序与视觉顺序一致，不跳进隐藏元素（侧栏折叠态的文字节点仍在 DOM 里，但不能抢焦点）；
- Enter/Space 能激活按钮。

**判定**
```js
document.activeElement.tagName + ':' + (document.activeElement.getAttribute('aria-label') ?? document.activeElement.className)
```
（`:focus-visible` 的样式需要真实键盘操作才稳定命中，自动化里以 Tab 顺序与 `activeElement` 为准，焦点环本身靠肉眼确认。）

## L10 浮层遮挡与层级

**步骤**
1. 无弹窗时展开统计浮层与思考菜单，记下它们相对输入区的位置；
2. 打开设置弹窗，观察它相对会话区、输入区与轮次导轨的遮挡；
3. 在弹窗打开的状态下触发一次 toast（例如登录成功后的提示），观察它相对遮罩的位置。

**预期**
- 弹窗及其遮罩**覆盖整页**（含侧栏与输入区），遮罩 `z-index: 60`；轮次导轨（`z-index: 5`）被压住；
- 统计浮层 `z-index: 1100`、思考菜单 `z-index: 100`，都高于遮罩，但它们只在无弹窗时才可能出现；
- toast 的 `z-index` 是 **40**，**低于**弹窗遮罩：弹窗打开期间出现的提示会被遮罩压住。当前源码就是这个层级，回归时若要求"提示浮在弹窗之上"，先确认意图再改；
- toast 是固定定位的实体元素（右下角 20px），会占据那块区域的点击。

**判定**
```js
getComputedStyle(document.querySelector('.appToast')).zIndex        // '40'
getComputedStyle(document.querySelector('.modalOverlay')).zIndex    // '60'
```

## A1 会话区 DOM 契约与滚动容器 id

**前置**：打开一个有消息的会话（非 hero 阶段）。

**预期**（层级必须完整，屏外优化与内容条目入场都依赖这条链）
```
.appStage[data-phase='active'] > .appStageBody > .appStageScroll[id='app-stage-scroll'] > .appStageFlow > .appStageColumn > .appTurn
```
- `.appStage` 带 `container-type: inline-size`；
- `.appStageScroll` 上的 `content-visibility` 链命中 `.appTurn`；
- 滚动容器的 `id` 是 `app-stage-scroll`——它是 `Turn.tsx` 传给 `AnimatedContent` 的 `container`，改名会连带静默失效（见 `A2`）；
- 输入区在 `.appStage` 内、`.appStageBody` **之后**（`composer` 槽位）。

**判定**
```js
const ok = !!document.querySelector(".appStage[data-phase='active'] > .appStageBody > .appStageScroll#app-stage-scroll > .appStageFlow > .appStageColumn > .appTurn");
({ chain: ok, container: getComputedStyle(document.querySelector('.appStage')).containerType })
// containerType → 'inline-size'
```

## A2 内容条目不得被入场动画卡成不可见（关键）

**背景**：会话里的内容条目（`.contentBlock`）由 ReactBits 的 `AnimatedContent` 包装，它的初始内联样式是 `visibility: hidden`，靠 gsap `ScrollTrigger` 进入视口后才改为 `visible`。**一旦 `container` 指向错的滚动容器，元素会永远不可见**——这是这条用例存在的唯一原因。

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
```

## A3 动效存在且无常驻循环动画

**预期**
- 入场类动效只在挂载/进入视口时发生，结束后不残留 `will-change`；
- **没有** `animation-iteration-count: infinite` 的常驻动画，除**流式光标**（`.appStreamingCursor` 的 `app-cursor-breathe`，1.1s）一处例外——它只在流式期间存在，表达「还在写」；
- `BorderGlow` 的边缘光只在指针附近出现，**不做自动扫光**（`Composer.tsx` 传 `animated={false}`）；
- 时长、缓动与位移都取自 `--app-dur-*` / `--app-ease-*` / `--app-shift-*`，与 `components/motion/motionTokens.ts` 的刻度一致。

**判定**
```js
// 1) 有没有常驻无限动画
[...document.querySelectorAll('*')].filter(el => {
  const cs = getComputedStyle(el);
  return cs.animationIterationCount.split(',').some(v => v.trim() === 'infinite') && cs.animationName !== 'none';
}).map(el => el.className || el.tagName)
// 期望：空数组；流式进行中最多出现流式光标所在元素
// 2) BorderGlow 不是自动扫光模式
document.querySelector('.border-glow-card').classList.contains('sweep-active') === false
```

> 已知限制：`BorderGlow` 的 `edge-light` 显隐依赖真实 `:hover`，而 CDP 驱动下 `element.matches(':hover')` 恒为 false，自动化只能验证到「CSS 变量 → 透明度公式」这一环；边缘光本身需要真机指针确认。

## A4 `prefers-reduced-motion` 降级

**步骤**：在系统里开启「减少动态效果」（或 DevTools 的 Rendering 面板模拟 `prefers-reduced-motion: reduce`），刷新后开合侧栏、展开弹窗、切到有内容条目的会话。

**预期**
- CSS 侧：过渡与动画被全局禁用（`frame.css` 末尾的 `prefers-reduced-motion` 段，`* { transition: none !important; animation: none !important; }`），外壳的 `app-frame-in`、标签下划线的 `app-tab-underline`、流式光标的 `app-cursor-breathe` 都不再播放；
- JS 侧：由 `Shell.tsx` 的 `<MotionConfig reducedMotion="user">` 接管，位移/缩放类动画退化为仅透明度过渡；
- **内容仍然全部可见**（不能因为动画被跳过而不显示）：弹窗、toast、内容条目都照常出现。

**判定**
```js
matchMedia('(prefers-reduced-motion: reduce)').matches             // 开启后为 true
getComputedStyle(document.querySelector('.appFrame')).animationName  // 'none'
getComputedStyle(document.querySelector('.modalSurface')).opacity    // '1'
```
