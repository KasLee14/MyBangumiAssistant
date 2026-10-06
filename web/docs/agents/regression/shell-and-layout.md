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
| `L5`–`L6`（DOM 契约与宽度轴） | **改组件结构、类名或层级后必读**（逐项核对两列网格 `'side main'`、抽屉式收起与列宽轴） |
| `L7`–`L8`（品牌外观与引入顺序） | 动样式文件、令牌、表面材质或 `main.tsx` 的 import 顺序时 |
| `L9`（焦点环与键盘可达） | 动交互控件、禁用态或浮层时 |
| `L10`（浮层遮挡关系） | 动弹窗 / toast 的层级或 `z-index` 时 |
| `A1`（容器查询与屏外优化） | 动 `.appStage*` 的层级或 `container-type` 时 |
| `A2`（内容条目可见性） | 动 `AnimatedContent` 的用法或滚动容器 id 时（**最容易静默失败的一条**） |
| `A3`–`A4`（动效约束与降级） | 加动效、改动效令牌、改 `BorderGlow` / `TextType` 参数时 |
| `A5`（弹窗过渡与浮层挂载点） | 动 `Modal` / `DialogStage` / `Toast` / `StatsDock` 的浮层结构时 |
| `A6`–`A7`（接管卡与草稿） | 动输入区座位、共享确认卡、会话草稿或后台会话状态时 |

### 必须遵守的规则

本组通用规则见 [readme.md](readme.md) 的「必须遵守的规则」。本篇专属：

1. **`L5` 必须同时核对层级与网格归属**：`.appSidebar` / `.appConversation` 都是 `.appFrame` 的**直接子元素**，并各自命中 `grid-area`（`side` / `main`）；`.appCollapseBubbles` 也是直接子元素，但**绝对定位、不参与 grid**。主界面**没有** `top` 行与 `.appTopBar`（C01 删除顶栏）——只确认节点存在不算通过。违反后果：抽屉式收起的定位基准失效，容器查询与屏外优化静默失效。
2. **`L6` 要在侧栏展开与收起两态各测一次** —— 违反后果：只覆盖一种宽度。
3. **`L7` / `L8` 肉眼判定时以"关键形态"为准，并优先怀疑引入顺序** —— 违反后果：把顺序问题误判成样式写错。
4. **`A2` 必须在真实会话里跑**，且要滚动到内容条目所在位置；只在 hero 或纯文本会话里跑等于没跑。
5. **`A3` 的"无循环动画"按计算样式判定**，不靠肉眼：常驻动画会让界面持续合成，在低配机器上表现为掉帧，肉眼看不出但确实存在。

## L1 首屏渲染（不需模型）

**前置**：会话为空且空闲（刚新建或刚打开）。

**预期**（逐项存在且内容正确）
- 外壳：`.appFrame[data-sidebar='collapsed'|'expanded']`（两列网格 `grid-template-areas: 'side main'`）、`aside.appSidebar`、`main.appConversation`；**不应存在** `.appFrame > .appTopBar`（主界面顶栏已按 [C01](../../design/decisions/C01-app-top-bar.md) 删除，功能全部迁进侧栏）；
- 侧栏（**唯一外壳**，自上而下）：`.appSidebarTop`（品牌落点 `.appBrandAction.appSidebarBrand`，文案「Bangumi 助手」+ `.appSidebarStatus`（8px 连接状态点，`data-state="on"|"off"`）+ `.appIconButton`（`aria-label` 为「展开侧栏」/「收起侧栏」））、`.appSidebarNew`（实心主色整行「开启新对话」——**侧栏**唯一的主色实心操作，全界面同色的另一处是首屏设置入口 `.appHeroSettings`）、`.appSidebarScroll`（分组标题 `.appSidebarGroup` + 会话行 `.appNavItem > .appNavRow`）、`.appSidebarUser`（`.appSidebarAvatar` + `.appSidebarUserName` + `.appIconButton`（`aria-label`／`title` 为「设置」的**齿轮**按钮，单击直达设置弹窗；[C45](../../design/decisions/C45-settings-entry.md) 之后这里**没有**「···」也没有浮层菜单））；
- 收起态另有 `.appCollapseBubbles`（两枚带文字胶囊「展开」/「新对话」，绝对定位在 `.appFrame` 左上角，不参与 grid）；
- 首屏：`.appHero` → `.appHeroHeadline`（含「Bangumi 助手」）→ `.appHeroHint` → `.appHeroSettings`（**实心主色深档**按钮「设置 · 模型 / 代理 / 登录」，与侧栏「开启新对话」同色同 hover，单击开设置弹窗；[C45](../../design/decisions/C45-settings-entry.md) 的 **2026-10-10 修订**把它从「示例下方的玻璃胶囊」移到**说明与示例之间**）→ `.appHeroSamples`（三枚 `.appGlass.appHeroSample` 示例胶囊，点一下把文案填进输入框；`.appHeroBadge`「Web 终端」已在本次重构中删除）；
- 输入区：`.appSeat` → `.appComposerStack` → `.appGlow` → `.appComposerCard` → `#composer-input`；首屏态的区别是 `.appStage[data-phase='hero']` 下输入框最小高度变为 32px、`.appSeat` 底部留白加到 26px；
- 卡外一行：`.appComposerDock` 里左边是思考强度（`.thinkingAnchor > .thinkingTrigger`）、右边是读数（`.statsAnchor > .statsPill` token 胶囊 + `.statsAnchor.contextAnchor > .contextTrigger` 上下文环）——输入卡里只剩「输入 + 发送」。

**判定**
```js
['.appFrame', '.appSidebar', '.appConversation', '.appHero', '.appHeroHeadline', '.appSeat', '#composer-input'].every(s => document.querySelector(s))
document.querySelector('.appFrame > .appTopBar') === null                       // 主界面没有顶栏（C01）
document.querySelector('.appSidebarStatus').dataset.state                       // 'on' / 'off'
document.querySelector('.appSidebarNew').textContent.trim()                     // '开启新对话'
document.querySelector('.appStage').dataset.phase === 'hero'
document.querySelector('.appFrame').dataset.sidebar        // 窗口宽 ≤1024 时为 'collapsed'
document.querySelector('.appComposerCard #composer-input') !== null            // 输入框仍在卡内
document.querySelector('.appComposerStack > .appComposerDock') !== null        // 读数与思考强度在卡外同一行
document.querySelector('.appHeroSamples .appGlass.appHeroSample') !== null
document.querySelector('.appHeroSettings') !== null                             // C45：首屏的设置入口
document.querySelector('.appHeroSettings').classList.contains('appGlass') === false  // C45 修订：实心深档，不再是玻璃胶囊
document.querySelector('.appHeroSettings').compareDocumentPosition(document.querySelector('.appHeroSamples')) & Node.DOCUMENT_POSITION_FOLLOWING  // 入口在示例**之前**
document.querySelector('.appSidebarUser .appIconButton[aria-label="设置"]') !== null
document.querySelector('.appSidebar .appMenu') === null                          // C45：底部浮层菜单已删
```

## L2 首屏退出条件

**步骤**：分别制造下列任一条件，观察是否离开 hero 阶段（`.appStage[data-phase]` 变 `active`）。

| 条件 | 期望 |
|---|---|
| 出现任何条目（通知/命令回显/助手回答） | 离开 hero |
| 正在流式输出（`busy` 或 `liveContent` 非空） | 离开 hero |
| 有乐观回显气泡（`pendingEcho`） | 离开 hero |
| 以上都没有 | 停在 hero |

**判定**：`document.querySelector('.appStage').dataset.phase`（`.appStageScroll` 上也带同一个 `data-phase`，样式两处都用得到）。

## L3 侧栏折叠与响应式

**步骤**
1. 点**侧栏品牌行右侧**那颗折叠钮（`.appSidebarTop .appIconButton`，`aria-label` 为「展开侧栏」/「收起侧栏」）——C01 删掉顶栏之后，折叠钮与品牌同在侧栏第一行；
2. 把**窗口宽度缩到 ≤1024**，再点这颗按钮（或收起态左上角的「展开」胶囊 `.appCollapseBubble`）展开。

**预期**
- 点击在 `collapsed` / `expanded` 间切换，`.appFrame[data-sidebar]` 同步变化：`--app-sidebar-width` 264px（`--app-sidebar-full`）↔ **0**（≤1024 时由媒体查询强制 0），列宽走 360ms 过渡而不是整块跳变；
- 收起是**抽屉式**：侧栏内容锁宽 248px（`--app-sidebar-content`）并整体 `translateX(-264px)`（240ms，比列宽短一档），所以文字不会被压扁；收起态 `.appSidebar` 同时去掉内距与向右的发散阴影（0 宽的盒子留 8px 内距会被撑到 18px）；
- 收起态左上角出现 `.appCollapseBubbles`（`opacity` / `visibility` 由 0 / `hidden` 切到 1 / `visible`；`backdrop-filter` 只在这一态才挂）；展开态它不可见也不可点——**两态各有一份入口，永远不会同时出现**；
- 缩窄后自动收起；此时**手动展开**，再触发一次 resize（拖动窗口 1px）会**重新收起**——这是既定的强制语义，不是缺陷；
- 会话行的状态与时间不随折叠消失：行尾 `.appNavMeta`（`待确认` / `待登录` / `运行中` / `当前` / 相对时间），行 hover（或键盘聚焦、或菜单已展开）时它淡出、同一位置换上 `.appNavAction`（「···」→ 置顶 / 取消置顶）；
- **会话置顶**（本轮新增）：点某行的「···」→「置顶」，该行进入列表最前的「置顶」分组（组内不显示时间）、点「取消置顶」回到原来的日历日分组；分组顺序固定为 `置顶 / 今天 / 昨天 / 7 天内 / 更早`（空档不渲染）。刷新页面后置顶仍在——它由 `ui.pinned` + `utils/pinnedStorage.ts` 落盘（键 `bgm-assistant.pinned-sessions`），与宿主无关。

**判定**
```js
document.querySelector('.appFrame').dataset.sidebar
document.querySelector('.appSidebarTop .appIconButton').getAttribute('aria-label')     // '展开侧栏' / '收起侧栏'
getComputedStyle(document.querySelector('.appFrame')).gridTemplateColumns              // 第一列 '264px' / '0px'
getComputedStyle(document.querySelector('.appSidebar').firstElementChild).width        // 恒为 '248px'（锁宽）
getComputedStyle(document.querySelector('.appSidebar').firstElementChild).transform    // 收起 'matrix(1, 0, 0, 1, -264, 0)'
getComputedStyle(document.querySelector('.appCollapseBubbles')).visibility             // 收起 'visible'、展开 'hidden'
// 置顶：分组标题顺序与落盘
[...document.querySelectorAll('.appSidebarGroup')].map(g => g.textContent)
JSON.parse(localStorage.getItem('bgm-assistant.pinned-sessions'))                       // 置顶后的会话 id 数组
```

## L4 连接状态（不需模型）

**步骤**
1. 页面打开且宿主在运行 → 看侧栏品牌行右侧那颗 **8px 连接状态点**；
2. **停掉宿主进程**（`Ctrl+C`）→ 再观察；
3. 重新启动宿主 → 再观察（`EventSource` 自带重连）。

**预期**
- 运行中：`data-state="on"`、圆点转绿（`--bgm-success` + 同色 3px 光环）、`title` / `aria-label` 为「已连接」；
- 宿主停止：`data-state="off"`、圆点转红（`--bgm-danger`）、文案「连接中断」；
- 宿主重启：自动恢复「已连接」，**无需刷新页面**；
- 状态点**不占一行**（8px，常态可见）；原来的 26px 连接胶囊随顶栏一并删除。

**判定**
```js
const dot = document.querySelector('.appSidebarStatus');
[dot.dataset.state, dot.getAttribute('aria-label'), getComputedStyle(dot).backgroundColor]
```

## L5 DOM 与类名契约（样式依赖的骨架）

**步骤**：在空会话与至少一轮对话两种状态下，逐项核对下列节点**存在且层级正确**。

主界面骨架是**两列网格**：`.appFrame` 只有「侧栏（`side`）| 对话区（`main`）」两格——顶栏已按 C01 删除，网格里**没有** `top` 行、也没有 `.appFrame > .appTopBar`。`CollapseBubbles` 是 `.appFrame` 的直接子元素，但绝对定位、不参与 grid。首屏阶段 `.appStageScroll` 直接承载 `.appHero`（没有 `.appStageFlow` / `.appStageColumn`）；下表的 `.appStageFlow > .appStageColumn > .appTurn` 只在活动阶段出现，不能据此判定空会话首屏失败。

| 选择器 | 层级/关系 | 谁依赖 |
|---|---|---|
| `.appFrame` | 最外层；`display: grid` + `grid-template-areas: 'side main'`（两列） | 外壳网格 |
| `.appSidebar` | `.appFrame` 的直接子元素（`grid-area: side`） | 侧栏列宽（`--app-sidebar-width`）、抽屉式收起的锁宽与位移 |
| `main.appConversation` | `.appFrame` 的直接子元素（`grid-area: main`） | 会话列 |
| `.appCollapseBubbles` | `.appFrame` 的直接子元素，但 `position: absolute`（**不参与 grid**） | 收起态的两个入口；它是「不占格」的反例，改网格时不要把它算进去 |
| `.appStage` | `.appConversation` 内 | **尺寸容器**（`container-type: inline-size`） |
| `.appStageBody` | `.appStage` 内 | 滚动体与轮次导轨（`.appRail`）的定位上下文 |
| `.appStageScroll` | `.appStageBody` 内（`id="app-stage-scroll"`） | 滚动 + 屏外优化 + `AnimatedContent` 的 `container` |
| `.appStageFlow > .appStageColumn` | `.appStageScroll` 内 | 列宽轴（`100cqw`） |
| `.appStageColumn > .appTurn:first-child` | `.appTurn` 是 `.appStageColumn` 的首个子级；**不应存在** `.appSessionHeadSlot` | 会话头已在 C34 决策中删除（组件、槽位与样式一并删除），列内不再有 sticky 外壳 |
| `.appTurn` | `.appStageColumn` 的直接子级 | 屏外优化选择器 |
| `.appSeat` | `.appStage` 内、`.appStageBody` **之后** | 输入卡座位（`composer` 槽位） |
| `.appComposerStack` / `.appComposerDock` | 前者在 `.appSeat` 内；后者是 `.appComposerStack` 的**第二个子级** | 输入卡与其**卡外一行**（思考强度 + 读数） |
| `.appCardSeat` | 接管时替换 `.appSeat` **内部** | 确认卡座位 |

**判定**（层级与网格归属一并校验）
```js
// 1) 两列网格 + 两个进格的直接子元素（气泡层不进格）
const frame = document.querySelector('.appFrame');
const areas = getComputedStyle(frame).gridTemplateAreas;      // 应为 "side main"
areas.includes('side main') && !areas.includes('top')
document.querySelector('.appFrame > .appTopBar') === null                                 // true（C01：主界面无顶栏）
document.querySelector('.appFrame > aside.appSidebar') !== null
document.querySelector('.appFrame > main.appConversation') !== null
document.querySelector('.appFrame > .appCollapseBubbles') !== null
getComputedStyle(document.querySelector('.appCollapseBubbles')).position === 'absolute'   // true
// 2) 会话区骨架（活动阶段）
document.querySelector('.appStageBody > .appStageScroll#app-stage-scroll > .appStageFlow > .appStageColumn > .appTurn') !== null
document.querySelector('.appStage > .appStageBody + .appSeat') !== null
document.querySelector('.appSeat #composer-input') !== null
// 3) 会话头已删除（C34）：列内不再有 sticky 外壳，首个轮次就是列的首个子级
document.querySelector('.appSessionHeadSlot') === null                                   // true
document.querySelector('.appStageColumn > .appTurn:first-child') !== null                // true（有轮次时）
// 4) 卡外一行（输入卡只留输入与发送）
document.querySelector('.appSeat .appComposerStack > .appComposerDock') !== null
document.querySelector('.appComposerDock .thinkingTrigger') !== null
document.querySelector('.appComposerDock .statsDock') !== null
```

> 特别提醒：`Stage` 必须包含 `.appStage`、`.appStageBody` 与 `.appStageScroll`，但**不含** `.appFrame` / `.appTopBar` / `.appConversation`（由外壳提供）。这条边界改动会导致屏外优化与列宽同时失效。
>
> 会话头已在 C34 决策中删除：组件 `SessionHead.tsx`、`Stage` 的 `sessionHead` 槽位与 `.appSessionHead*` / `.appSessionHeadSlot` 样式一并删除，列内不再有 sticky 外壳（活动阶段 `.appStageColumn` 的首个子级就是 `.appTurn`）；对话区顶部留白由 `.appStageFlow` 的 20px 上内边距承担。空会话首屏下 `.appStageFlow` / `.appStageColumn` / `.appTurn` 都不存在，此时只核对 `.appStageScroll > .appHero`。

## L6 列宽轴

**步骤**：同一窗口宽度下，分别在**侧栏展开**与**收起**两态读取外壳网格、会话列的实际宽度与其 `max-width`。

**预期**
- 外壳两列的来源只有一条：`grid-template-columns: var(--app-sidebar-width) minmax(400px, 1fr)`，其中 `--app-sidebar-width` 展开是 264px（= `--app-sidebar-full`）、`.appFrame[data-sidebar='collapsed']` 与 `@media (max-width: 1024px)` 都是 **0**；收起后对话区因此变宽（不再有"顶栏宽度不变"这条判定——顶栏已删除）；
- 收起是**抽屉**：侧栏内容锁宽 `--app-sidebar-content`（248px）并整体左移 264px，内容 240ms 先滑走、列宽 360ms 后收窄；
- 正文列宽只有一个来源——`.appStageColumn` 的 `max-width: min(calc(100cqw - 48px), clamp(680px, 64cqw, 900px))`，因此展开/收起侧栏后列宽都在 680–900px 区间内变化；`.appStageFlow` 与 `.appSeat` 各给 24px 左右内缩（与公式里的 `- 48px` 同源）。输入卡与确认卡共用**同一条**轴（`.appComposerStack`（`composer.css`）与 `.appStageColumn`（`frame.css`）的表达式一致，`.planCard` 自己只写 `width: 100%`）。

**判定**
```js
// 1) 外壳网格（两态各读一次）
const frame = document.querySelector('.appFrame');
const fs = getComputedStyle(frame);
({ cols: fs.gridTemplateColumns, sidebar: fs.getPropertyValue('--app-sidebar-width').trim() })
// → 展开：首列 '264px'、--app-sidebar-width '264px'；收起或 ≤1024：两者都是 '0px'
//   （`gridTemplateColumns` 返回的是**解析后的轨道尺寸**，第二列是当时的剩余宽度，不必对字符串整体比较）
// 2) 正文列宽轴
const col = document.querySelector('.appStageColumn');
const cs = getComputedStyle(col);
({ maxWidth: cs.maxWidth, width: col.getBoundingClientRect().width })
// width 应落在 680–900 之间（窄窗口下可小于 680，此时受 100cqw - 48px 约束）
getComputedStyle(document.querySelector('.appStageFlow')).paddingLeft    // '24px'
getComputedStyle(document.querySelector('.appSeat')).paddingLeft         // 同为 24px
// 3) 抽屉：收起态侧栏内容锁宽 248px、整体左移 264px
const head = document.querySelector('.appSidebar').firstElementChild;
({ locked: getComputedStyle(head).width, shift: getComputedStyle(head).transform })
```

> **修复记录（第七轮）**：此前输入卡与确认卡与正文列**不共用**同一条宽度轴（`--dsh-chat-content-width` 已不存在，`.planCard` 的 `max-width` 又指向一个全仓从未定义的 `--dsh-composer-card-max-width`，声明作废），宽屏下输入卡与确认卡比正文列更宽。第七轮令牌层清理时那条作废声明被删除，宽度轴收敛成 `.appComposerStack` 与 `.appStageColumn` 上**同一条** `min(calc(100cqw - 48px), clamp(680px, 64cqw, 900px))`（见 `composer.css` / `frame.css` 与 `cards.css` 的 `.planCard`）。

## L7 品牌外观关键形态

**步骤**：对照下列形态逐项看（不需设备，肉眼判定；程序判定见文末）。**动过样式后先重启 `npm run dev:web` 再读 CSSOM**——Windows 上编辑工具的「临时文件 + rename」保存会让 Vite 的 watcher 报 EBUSY 并漏检改动（见 [AGENTS.md](../../../AGENTS.md) §规则「技术栈约束」第 4 条）。

| 项 | 期望 |
|---|---|
| 主色 | 选中态/强调为主色 `--bgm-primary` = `#ec6570`（HSL 355 78% 66%）；主色的文字态是 `--bgm-primary-text` = `color-mix(in srgb, var(--bgm-primary) 62%, #2f2f33)`（旧的 `#f09199` / `#a8575f` 已作废） |
| hover | 按钮 hover：**描边按钮（`.button.outline`）与浮层内的次要按钮填 `--bgm-primary-hover-fill` = `--bgm-primary-deep`（≈`#b7565f`）配白字**（2026-10-06 定案，原为交互蓝 `#369cf8`）；`.button.ghost`（非浮层内）/ `.button.reject` 仍各走交互蓝与危险红；会话行与其他导航行 hover 是主色 6% 的淡粉（`.appNavRow:hover`）；内容条目的位移类 hover 只在 `@media (hover: hover)` 下生效 |
| 卡片 | 内容卡片 1px 描边 + `--app-radius-panel`（**14px**；例：`.contentSubjectCard`、`.contentQuote`），控件取 `--app-radius-control`（10px）、小格取 `--app-radius-cell`（8px）——四档以 [G-tokens](../../design/decisions/G-tokens.md) 为准（8 / 10 / 14 / 18）；写入确认卡 `.planCard` 用 `--app-radius-panel` + 主色 30% 描边；浮起靠两级阴影（内嵌卡片 `--app-shadow-raised`、hover 升到 `--app-shadow-card` 并上移 3px）；阴影色为深粉棕 `--bgm-primary-text` 派生，不是中性灰 |
| 弹窗 | 表面是共享类 `.appGlass`（`Modal` 渲染 `className="appGlass modalSurface"`）：玻璃填充 `--app-glass-fill` + `--app-glass-blur` + 半透明描边，圆角 `--app-radius-float`（浮层档；超椭圆由 `tokens.css` 一处统一下发，浮层不再单独声明），阴影 `--app-shadow-float`（两级投影）——不再是"不透明的 15px 圆角白卡"；**无蒙层**（`.modalOverlay` 只留定位/居中/接住点击，2026-10-06 定案）；进出过渡对称：`scale .98 + y 4px`，由 `modal.css` 的 CSS keyframes 给，**不做 `opacity` 淡入**（2026-10-10：`opacity < 1` 会让 `backdrop-filter` 失效） |
| 弹窗标题与关闭键 | 内容收成单个 `.dlgPane`（内距 20px、纵向 18px 间距）；`.dlgHead` 里是 `.dlgTitle`（17px/600）+ 可选 `.dlgSub`；关闭键是**右上角实心 `×`**（`.dlgCloseTop`，28×28、距右上各 14px、绝对定位，不参与标题行高度），**没有**分隔线，也没有旧的 `.modalHeader` 细线按钮 |
| 弹窗按钮与底栏 | 动作行是 `.dlgActions`（两端对齐：次要靠左、主操作靠右）；按钮是新骨架自己的 `.dlgBtn`（36px 高、`--app-radius-control`，**不再吃 `.button` 基元**），次要 `.dlgBtnGhost`（1px `--bgm-border` + 白底，hover 只把描边转成主色 38%——**不换底色**），主操作 `.dlgBtnPrimary`（`--bgm-primary-deep` + 白字，hover 在同色系里再深一档，**不抬升、不加阴影**）。旧的 `.modalFooter` / `.modalField` / `.modalInput` / `.pickerRow` 等类已随旧骨架删除 |
| 连接状态点 | 侧栏品牌行右侧的 **8px 圆点**（`.appSidebarStatus`）：绿/红取自 `--bgm-success` / `--bgm-danger`，另加同色 3px 光环表态，`title` 与 `aria-label` 同步给文案；旧的 26px `.appChip` 胶囊已随顶栏删除 |
| 输入区 | 输入卡是**浮起层**：`.appGlow` 与卡内 `.appComposerCard` **同为浮层档 `--app-radius-float`（18px）**（两层圆角必须一致，否则玻璃边缘会露一圈台阶）；玻璃填充由 `--card-bg-css` 注入 `BorderGlow` 并配 `backdrop-filter`；卡外一行 `.appComposerDock` 保持素面（思考强度 + 读数，水平居中） |
| 区域底色 | 侧栏与对话区**同为白面**（`--bgm-surface`），分区只靠侧栏投出的一条**向右发散阴影** `--app-shadow-edge`（C44b：侧栏不再用粉底、也去掉描边）；页面底是 `--bgm-bg`（= `--app-surface-sunken`，primary 13% + 白）作纯色阶梯；侧栏里唯一的主色实心操作是整行「开启新对话」（`.appSidebarNew`），会话行 hover 用主色 6% 淡粉。**页面上不应出现中性灰表面**（灰底、灰描边、灰阴影），文字仍是中性深色、语义色保持原值 |
| 浮层材质 | 命令候选 `.appComposerPopup`、思考菜单 `.thinkingMenu`、统计浮层 `.statsPanel`、弹窗 `.modalSurface`、Toast `.appToast` 都直接引共享类 `.appGlass`（玻璃填充 + 模糊 + 半透明描边 + `--app-shadow-panel`）；`.menuMaterial` 与 `.statsPanelMaterial` 仍是 `opacity: 0` 的占位层（看不到第二层表面）。同时出现的模糊层 ≤ 3 |

**判定**（程序化核对；肉眼判定出分歧时优先怀疑 [../styles/readme.md](../styles/readme.md) 里的**引入顺序**）
```js
// 1) 沉淀单一定义：这些类在 CSSOM 里各只有一条形态规则
const rules = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch { return []; } });
const count = cls => rules.filter(r => r.selectorText && r.selectorText.split(',').some(s => s.trim() === cls)).length;
({ glass: count('.appGlass'), topBar: count('.appTopBar'), navRow: count('.appNavRow'), contentRow: count('.contentRow'), contentFill: count('.contentFill') })
// → 各为 1（这个探针只遍历顶层规则；超椭圆由 `tokens.css` 的 `*, *::before, *::after` 统一下发，
//    浮层不再单独声明 corner-shape——common.css 里原先那条 `@supports` 补充规则已删除）
//    另：`.appTopBar` 的形态只定义在 common.css（它现在只服务调试页与文档页，主界面网格里没有 `top` 行）
// 2) 没有中性灰表面：灰底 / 灰描边计数为 0（判据：R=G=B、且不是纯白/纯黑/全透明）
const isGray = v => {
  const m = /^rgba?\((\d+), ?(\d+), ?(\d+)(?:, ?([\d.]+))?\)$/.exec(v);
  if (!m) return false;
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const alpha = m[4] === undefined ? 1 : Number(m[4]);
  return alpha > 0 && r === g && g === b && r !== 255 && r !== 0;
};
[...document.querySelectorAll('*')].filter(el => {
  const cs = getComputedStyle(el);
  return isGray(cs.backgroundColor) || isGray(cs.borderTopColor);
}).length                                                                  // 0
// 3) 玻璃只在浮起层：滚动内容里的内容条目一律没有玻璃层
[...document.querySelectorAll('.contentBlock .appGlass')].length            // 0
```

## L8 样式引入顺序回归

**步骤**：把窗口缩放一次（触发重排）后，抽查三处颜色/形态：侧栏选中行、输入卡边框、弹窗表面。

**预期**：三处都呈品牌值（不是 DSH 默认蓝/白）。若出现"部分生效"，检查 `main.tsx` 的 import 顺序是否为 `tokens → common → frame → composer → cards → modal → bgm → content → debug`：`common.css` 必须紧跟 `tokens.css` 且排在 `frame.css` 之前（顶栏骨架 `.appTopBar*`（调试页 / 文档页用）、品牌组合类 `.appBrandAction`、玻璃 `.appGlass`、导航行 `.appNavRow` 都在那里，外壳规则要能覆盖它们）；`bgm.css` **只有 `--bgm-*` 的定义**——上游 `--dsw-*` / `--dsh-*` 与那套「别名重定向」机制已在第七轮整体删除，它不再需要排在谁之后；`content.css` / `debug.css` 只消费令牌，排在最后不影响前两条。

**判定**：肉眼；命令行核对顺序：`Select-String -Path web/src/main.tsx -Pattern "styles/"`（应看到 tokens → common → frame → composer → cards → modal → bgm → content → debug 共 9 条）。

## L9 焦点环与键盘可达

**步骤**：用 Tab 依次走：侧栏折叠钮 → 品牌落点（`.appBrandAction.appSidebarBrand`，`role="button"` + `tabIndex={0}`，Enter/Space 进调试页）→「开启新对话」→ 会话行（行内的「···」也在 Tab 序列里）→ 底部用户行的「···」→ 输入框 → 卡外一行的思考强度 → 发送键。（顺序与 DOM 顺序一致：先侧栏后对话区——`.appFrame` 里只有 `.appSidebar` / `.appConversation` 两个进格的直接子元素，`.appCollapseBubbles` 在收起态才可见。）

**预期**
- 每个可交互控件都有**可见焦点环**（统一是 `--bgm-focus` 的一圈交互蓝光晕 `rgba(54,156,248,.35)`；不依赖 hover 才看得出）；
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
- 层级从低到高：`.appRail`（5）< `.appComposerPopup`（20）< `.appToast`（40）< `.modalOverlay`（60）< `.thinkingMenu`（100）< `.statsPanel`（1100）；
- 因此**弹窗打开时 toast 会被遮罩压住**（可见但变暗），这是当前实现，不要按"toast 永远在最上层"判定；
- toast 不阻塞点击（它没有铺满屏幕）。

**判定**：肉眼 + 需要时读层级：
```js
['.appRail', '.appComposerPopup', '.appToast', '.modalOverlay', '.thinkingMenu', '.statsPanel']
  .map(s => [s, getComputedStyle(document.querySelector(s)).zIndex])
```

> **修复记录**：统计浮层的根节点 `.statsPanel` 曾在外观层合并中丢掉定位与表面规则（浮层会落到页面流末尾且没有可见表面），现已补回：`position: fixed`、`z-index: 1100`、表面来自**共享类 `.appGlass`**（`--app-glass-fill` + 模糊 + 半透明描边 + `--app-shadow-panel`）、`app-popup-in` 入场；`.statsPanelMaterial` 仍留作 `opacity: 0` 的占位层。详见 [../styles/components.md](../styles/components.md)。

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

**背景**：`Modal` 的进出过渡由 **CSS keyframes** 给（`styles/modal.css` 的 `modalIn` / `modalOut`，只动 `transform`，360ms），**presence 由 `DialogStage` 自己管**：关闭后弹窗先留在 DOM 里播退场动画（表面带 `data-leaving`），`Modal` 在 `animationend` 时报 `onExited`，挂载点才卸载它。**弹窗不做 `opacity` 淡入**——`opacity < 1` 会让 `backdrop-filter` 失效（见 [G09](../../design/decisions/G09-overlay.md) §补充）。`Toast` 仍走 `motion` 的 `AnimatePresence`，进出**对称**（`y 16`（`SHIFT.panel`）+ `scale .98`，240ms，C42 定稿——原先退出是 `y 8 + scale .99`）。统计浮层由 `StatsDock` **portal 到 `body`**（输入卡在滚动容器里，留在卡内的绝对定位浮层会被裁掉）；弹窗**不** portal，它渲染在 `.appFrame` 内靠 `position: fixed` 覆盖全屏。

**`DialogStage` 的 `exited` 表是「还要不要渲染」的唯一判据**（`!open && exited[id]` → 不渲染）：**「从未打开过」与「退场播完了」共用它**，所以它的初值必须是「三个 id 都已退场」。初值为空对象时，首次渲染会把三个弹窗当成「正在退场」各渲染一遍，页面一加载就闪一遍弹窗（2026-10-07 修，见 [C41](../../design/decisions/C41-dialog-stage.md) §补充）。

**步骤**
0. 刚加载完页面（未点任何入口）时，看 DOM 里有没有 `.modalOverlay`；
1. 打开设置弹窗，核对遮罩与表面的标签与角色；
2. 点关闭（或按 Esc），**同一帧**观察表面是否还在、`data-leaving` 是否出现，约 0.5 秒后再看一次；
3. 展开统计浮层，核对它的父节点。

**预期**
- 第 0 步：**一个都没有**（`.modalOverlay` 数量为 0，且加载后 1 秒内不出现）——这是 C41 §补充那条 bug 的回归点；
- `.modalOverlay` 是 `DIV`（**无内联样式**）、`.modalSurface` 是 `SECTION` 且 `role="dialog"`；
- 关闭后表面**不是立刻消失**：先换成 `modalOut` 播 360ms，随后被卸载；`opacity` 全程为 `1`（不做淡入）；
- 进入与退出是**同一组值**（`scale .98 + y 4px`，G09 / C41 定稿）；
- 首次打开的弹窗播的是 **`modalIn`**（不是 `modalOut`）：`exited` 的初值不能把它挡在门外，也不能让它以「退场」的身份登场；
- `.statsPanel` 的 `parentElement` 是 `document.body`。

**判定**
```js
// 第 0 步（页面刚加载、未点任何入口）：
document.querySelectorAll('.modalOverlay').length            // 0
// 打开设置后：
const o = document.querySelector('.modalOverlay'), s = document.querySelector('.modalSurface');
({ overlayTag: o.tagName, surfaceTag: s.tagName, role: s.getAttribute('role'),
   anim: getComputedStyle(s).animationName, opacity: getComputedStyle(s).opacity })
// → DIV / SECTION / 'dialog' / 'modalIn' / '1'
// 点关闭后立刻（同一帧内）：
({ leaving: document.querySelector('.modalSurface')?.dataset.leaving,
   anim: getComputedStyle(document.querySelector('.modalSurface')).animationName })
// → 'true' / 'modalOut'（注意：不能在这之前用 settingsOpen 之类的开关拦渲染）
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
- 侧栏每行右侧展示状态：`待确认` / `待登录` / `运行中` 优先于 `当前`，其余显示相对时间（行是共享基类 `.appNavRow`：`.appNavTitle` 标题 + `.appNavMeta` 状态）。

**判定**
```js
// 在 A 输入 'A 草稿' → 切到 B → 输入 'B 草稿' → 再切回 A：
document.querySelector('#composer-input').value            // 'A 草稿'
// 侧栏状态（每行是 .appNavRow，不再是已删除的 .appSessionRow）：
[...document.querySelectorAll('.appSidebar .appNavRow')].map(r => [
  r.querySelector('.appNavTitle').textContent,
  r.querySelector('.appNavMeta').textContent,
  r.dataset.current,                                       // 'true' / undefined
])
```
