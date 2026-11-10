# components：跨页面共享组件层

> 覆盖 `web/src/components/` ｜ 核对 2026-10-11

## 功能介绍

`web/src/components/` 是**跨页面共享**的组件层：助手正文与 12 种内容块的渲染、会话与过程区的渲染、顶栏骨架，以及动效组件封装。判据是「被两个及以上页面消费」——只被一个页面消费的组件在 `web/src/page/<页面>/components/`，不在这里。

本层分为三块：`web/src/components/content/`（内容块与正文）、`web/src/components/conversation/`（会话、轮次、过程区）、`web/src/components/motion/`（动效封装，实际是第三方组件的存放处），加上顶层的 `web/src/components/AppTopBar.tsx`。

## 索引

按功能模块分组。只被一个页面消费的组件不在这里，见该页的 `components.md`。

### 顶栏骨架

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `AppTopBar.tsx` | 顶栏骨架：卡片实验室与文档页共用（主界面已删顶栏，功能迁进侧栏）；样式在 `web/src/styles/common.css` 的 `.appTopBar*` | `web/src/components/AppTopBar.tsx` | 改顶栏骨架 |

### content/ —— 内容块与正文

按下面几组分：**分发与注册**（加一种内容块从这里入手）、**校验**（载荷合法性）、**正文入口**（助手正文的唯一渲染路径）、**内容块渲染器**（各管一种载荷形态）。

#### 分发与注册

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `index.tsx` | 内容块分发器：只做信封三件事——`pending` → 骨架、`type` 未登记 → 丢弃 + 告警、其余交给组件并套 `ContentErrorBoundary`；并转出 `ContentBlockView`。**载荷判定不在这里** | `web/src/components/content/index.tsx` | 改内容块的分发与容错出口 |
| `registry.tsx` | 「type → 组件」注册表：`satisfies { [K in ContentKind]: … }` 要求每个 kind 都有组件；`CONTENT_KINDS` **由本表的键序派生**；`render` 的入参是 `unknown`（逼组件自己收窄） | `web/src/components/content/registry.tsx` | 加 / 改 12 种内容块之一；查某个 type 由哪个组件渲染 |

#### 载荷判定与降级

**判定与降级在各自组件里**，没有中央校验表。共享的只有收窄原语。

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `payload.ts` | 12 种载荷共用的**收窄原语**（取字符串/数字/枚举/数组、按元素过滤、`miss` 记一次降级）。**不含任何 kind 知识**：一旦出现「哪几种 kind 共用一个规则」，规则就又回到了中心化 | `web/src/components/content/payload.ts` | 加 / 改某个数值或数组的收窄方式 |
| 各 `Xxx.tsx` 里的 `readXxx` | 该 kind 自己的判定与局部降级策略（丢哪一项、回落到什么、什么时候整块不可渲染）。模块私有，只有本组件的 `view: unknown` 入口会调 | 同目录 12 个组件 | 改某一种载荷「坏了怎么显示」 |

#### 正文入口与 Markdown

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `MessageBlocks.tsx` | **助手正文唯一渲染入口**（文本 + 内容块），带块级 `memo` 比较以压住流式期的重渲染 | `web/src/components/content/MessageBlocks.tsx` | 改助手正文（文本 + 内容块）的排布与重渲染规则 |
| `markdown.tsx` | 手写 Markdown 子集渲染：粗体、行内码、链接、表格、分隔线 | `web/src/components/content/markdown.tsx` | 改助手正文里的 Markdown 渲染 |

#### 骨架、兜底与原始数据

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `ContentSkeleton.tsx` | `pending` 骨架：与 kind 无关；扫光由 `aria-busy` 开关，不要求与真实块等高 | `web/src/components/content/ContentSkeleton.tsx` | 改「加载中」骨架 |
| `ContentRaw.tsx` | 「整块不可渲染」的出口：一句说明 + 折叠的原始 JSON。**由各组件决定何时调**，分发器不判断 | `web/src/components/content/ContentRaw.tsx` | 改原始数据兜底块 |
| `ContentErrorBoundary.tsx` | 最后一道兜底：catch 组件渲染期抛错，回落成 `ContentRaw`；载荷引用变化即重试 | `web/src/components/content/ContentErrorBoundary.tsx` | 改「判定漏了」时的兜底行为 |

#### 内容块渲染器

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `SubjectCards.tsx` | 内容块 `SubjectCards`：条目卡与收藏卡 | `web/src/components/content/SubjectCards.tsx` | 改 `SubjectCards` 内容块 |
| `StatsCard.tsx` | 内容块 `StatsCard`：统计条/柱 + 数字滚动；`ratio` 越界由组件夹取 | `web/src/components/content/StatsCard.tsx` | 改 `StatsCard` 内容块 |
| `ProgressView.tsx` | 内容块 `ProgressView`：章节进度（数值条 + 章节格 + 状态文字） | `web/src/components/content/ProgressView.tsx` | 改 `ProgressView` 内容块 |
| `InfoBox.tsx` | 内容块 `InfoBox`：名称–值信息栏（`dl` + CSS 网格） | `web/src/components/content/InfoBox.tsx` | 改 `InfoBox` 内容块 |
| `DataTable.tsx` | 内容块 `DataTable`：结构化表格 + 本地表头排序（宿主给的默认序有意义） | `web/src/components/content/DataTable.tsx` | 改 `DataTable` 内容块 |
| `Timeline.tsx` | 内容块 `Timeline`：时间线（`ol`；时间用 `<time>`，actor 为独立列） | `web/src/components/content/Timeline.tsx` | 改 `Timeline` 内容块 |
| `TagCloud.tsx` | 内容块 `TagCloud`：标签云（纯展示 `span`，首次悬停掠光一次） | `web/src/components/content/TagCloud.tsx` | 改 `TagCloud` 内容块 |
| `Gallery.tsx` | 内容块 `Gallery`：横向卡片，逐卡记录封面加载失败并回落占位块 | `web/src/components/content/Gallery.tsx` | 改 `Gallery` 内容块 |
| `CompareTable.tsx` | 内容块 `CompareTable`：修改前后对比（`<ins>` / `<del>` + 行尾第二通道标签） | `web/src/components/content/CompareTable.tsx` | 改 `CompareTable` 内容块 |
| `QuoteBlock.tsx` | 内容块 `QuoteBlock`：引用块；`mono` 时用 `<pre>`，两种形态都不截断 | `web/src/components/content/QuoteBlock.tsx` | 改 `QuoteBlock` 内容块 |
| `Callout.tsx` | 内容块 `Callout`：四态提示；图标是装饰，语义由可见文字承担 | `web/src/components/content/Callout.tsx` | 改 `Callout` 内容块 |
| `LinkList.tsx` | 内容块 `LinkList`：链接列表；`target="_blank"` 必配 `rel="noreferrer"` | `web/src/components/content/LinkList.tsx` | 改 `LinkList` 内容块 |

### conversation/ —— 会话、轮次与过程区

分三组：**会话容器**（滚动与轮次导航）、**轮次与流式**（一个轮次怎么拼、流式期画什么）、**过程区**（思考与工具行）。

#### 会话容器

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `Stage.tsx` | 会话容器：滚动、贴底跟随（`ResizeObserver` 观察 flow 尺寸）、轮次高亮与导航；完整祖先链 `.appStageScroll > .appStageFlow > .appStageColumn > .appTurn` 是屏外优化的前提 | `web/src/components/conversation/Stage.tsx` | 改会话滚动、贴底跟随、轮次高亮与导航 |

#### 轮次与流式

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `Turn.tsx` | 一个轮次：用户气泡 → 过程区 → 主体（正文/通知/错误/确认卡）→ 轮尾操作 | `web/src/components/conversation/Turn.tsx` | 改一个轮次的结构（气泡 / 过程 / 主体 / 轮尾） |
| `Streaming.tsx` | 流式区：正文、思考块、运行状态行、流式光标（光标单独一行，挂在块序列末尾） | `web/src/components/conversation/Streaming.tsx` | 改流式区（正文、思考块、状态行、光标） |
| `MessageParts.tsx` | 原子行：`UserBubble` / `NoticeRow` / `ErrorRow` / `SessionBanner`，全部 props 驱动 + `memo` | `web/src/components/conversation/MessageParts.tsx` | 改用户气泡、提示行、错误行、会话头 |
| `ConfirmationCard.tsx` | 写入确认卡：待授权 / 已授权 / 已取消；`answering` 只用于防重复提交，不是宿主 `busy` | `web/src/components/conversation/ConfirmationCard.tsx` | 改写入确认卡 |
| `TurnActions.tsx` | 轮尾操作行：复制本轮回答正文 + 每轮用量 | `web/src/components/conversation/TurnActions.tsx` | 改轮尾「复制回答」与每轮用量 |

#### 过程区

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `ProcessGroup.tsx` | 过程区：轮首控制行（状态 / 耗时 / 步骤计数）+ 过程行列表；一级折叠，`hidden="until-found"` | `web/src/components/conversation/ProcessGroup.tsx` | 改过程区控制行、折叠、耗时与步骤计数 |
| `ProcessRows.tsx` | 过程区原子行：思考行与工具行；含 `useUntilFound`（维护 `hidden="until-found"`） | `web/src/components/conversation/ProcessRows.tsx` | 改工具行 / 思考行的行内形态与展开体 |
| `ProcessIcons.tsx` | 过程区图标：14px 自绘 SVG，按工具族区分（与侧栏图标不是一套） | `web/src/components/conversation/ProcessIcons.tsx` | 改过程区图标 |

### motion/ —— 动效封装

`web/src/components/motion/vendor/` 是**第三方动效组件**（ReactBits 等）的存放处，不是本项目的风格基准。仓库内实际被引用的是下面这些：

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `AnimatedContent.tsx` | 第三方动效组件：滚动触发的内容入场 | `web/src/components/motion/vendor/AnimatedContent.tsx` | 改内容块入场时参考（现用于 `MessageBlocks`，流式期不挂） |
| `Counter.tsx` | 第三方动效组件：数字滚动 | `web/src/components/motion/vendor/Counter.tsx` | 改统计数字滚动时参考（现用于 `StatsCard`） |
| `StarBorder.tsx` | 第三方动效组件：描边流光 | `web/src/components/motion/vendor/StarBorder.tsx` | 改提示块外观时参考（现用于 `Callout`） |
| `GlareHover.tsx` | 第三方动效组件：悬停掠光（`playOnce` 只掠一次） | `web/src/components/motion/vendor/GlareHover.tsx` | 改标签云悬停反馈时参考（现用于 `TagCloud`） |
| `TextType.tsx` | 第三方动效组件：打字机与光标 | `web/src/components/motion/vendor/TextType.tsx` | 改流式光标时参考（现用于 `Streaming`，只用光标不接管文本） |
| `BorderGlow.tsx` | 第三方动效组件：边框辉光 | `web/src/components/motion/vendor/BorderGlow.tsx` | 改输入卡外观时参考（现用于 `Composer`） |
| `BlurText.tsx` | 第三方动效组件：逐词模糊入场 | `web/src/components/motion/vendor/BlurText.tsx` | 改首屏标题入场时参考（现用于 `Hero`） |
| `CountUp.tsx` | 第三方动效组件：数值递增 | `web/src/components/motion/vendor/CountUp.tsx` | 改统计浮层数值时参考（现用于 `StatsDock`） |
| `BentoGrid.tsx` | 第三方动效组件：网格与卡片（`BentoGrid` / `BentoCard`） | `web/src/components/motion/vendor/BentoGrid.tsx` | 改设置弹窗分区时参考（现用于 `SettingsDialog`） |

`web/src/components/motion/vendor/` 下的其余文件（`AnimatedList`、`LineSidebar`、`LogoLoop`、`Magnet`、`PixelTransition`、`ShinyText`、`SpotlightCard`、`Stepper` 等）目前**无人引用，是可挑选的备选**，不删；需要动效时可从这里挑，但**不要**以它们的写法为准去改自有组件。

## 规则

### 引用方向

**1. 状态由调用方传入，组件不读 store。**

- **规则**：`Stage` / `Turn` / `Streaming` / `ProcessRows` 一律 props 驱动，展开状态、开合状态由上层传入；本层组件内不做 `useSelector`。
- **为什么**：宿主每 40ms 合并下发一帧，重渲染范围必须能按 props 收窄；卡片实验室也要用同一批组件渲染同一份数据。
- **后果**：组件一旦绑死全局 store，实验室无法复用，流式期会出现整树重渲染。

### 单一真相源

**2. 助手正文只走 `MessageBlocks`。**

- **规则**：流式区与历史条目的助手正文都渲染 `<MessageBlocks>`，不在别处直接遍历 `content` 数组。
- **为什么**：文本块与内容块的顺序、间距、入场行为只有一份实现，文本写完那一瞬才不会跳变；流式期的块级 `memo` 比较也挂在这里。
- **后果**：绕开它会立刻出现两条渲染路径，随后任何正文形态调整都要改两处并逐渐漂移。

### 模块边界

**3. 内容块组件是纯展示（判定只回答「能不能渲染」）。**

- **规则**：载荷由宿主给——组件不换算单位、不生成业务文案、不重排数据顺序；组件内的 `readXxx` 同理，只做类型收窄与降级选择，**不做业务裁决**（不判断 URL 可达、不判断交叉引用是否成立）。这条与 `web/src/components/content/payload.ts` 顶部写的三条边界一致。
- **为什么**：宿主已经算好并校验过；前端再算一次就是第二份真相。
- **后果**：同一件事出现两个数，且不一致时无人知道该信哪个。

### 改动联动

**4. 新增第 13 种内容块改三处，且全部有护栏。**

- **规则**：宿主协议加成员 → `web/src/components/content/registry.tsx` 的渲染表加一项（组件文件放在 `web/src/components/content/` 下）→ 该组件自己写 `readXxx`（判定 + 局部降级 + `view: unknown` 入口）→ `web/src/page/library/constants/sections.ts` 加一条 section（带 `group`）。
- **为什么**：`kind` 清单只剩两处「表」——注册表与文档页数据表；`ContentKind` 由协议派生（`web/src/types/content.ts`）、`CONTENT_KINDS` 由注册表键序派生、左导航分组由 section 的 `group` 派生，**这三样都不再手写**。原来还有一张中央校验规则表，已于改造中删除。
- **后果**：漏改注册表 → `satisfies { [K in ContentKind]: ContentRenderer }` **编译失败**；组件漏写 `view: unknown` 的收窄、或直接对 `unknown` 取字段 → **编译失败**；漏写 `group` → `LibrarySection` 的字面量**编译失败**。只有样式（`content.css`）与文档索引没有编译护栏。
- **另**：新增 kind 追加到注册表表尾（`CONTENT_KINDS` 的键序 = 文档页章节顺序）。

### 失败与降级

**5. 三种「不完美」各有归属，不能混用。**

- **规则**：`pending`（载荷还没到）→ 分发器的 `ContentSkeleton`；**载荷坏了** → 由该组件的 `readXxx` 就地降级（丢坏项、字段回落、格子留空），用户侧不显示任何问题痕迹，诊断只进开发期 `console.warn`；**结构性失败**（载荷根不是对象、必填数组不是数组）→ 该组件渲染 `ContentRaw`；**渲染期抛错** → `ContentErrorBoundary` 兜成 `ContentRaw`。
- **为什么**：这四件事对用户意味着完全不同的东西——「还没到」「有一条数据缺字段」「整块给的东西完全不对」「组件自己崩了」。改造前它们被压成一张通用降级卡（kind + 问题清单 + 原始 JSON），任何一条脏数据都会让整块变成转储。
- **后果**：把坏数据整块换成 `ContentRaw`，会让 5 张正常卡片陪一条坏数据殉葬；反过来把结构性失败渲染成空态，则会让「上游发了个数组给我」这种错误静默无害地过去。

**6. 空态与降级是两件事。**

- **规则**：数组是空数组 → 正常空态（`.contentEmpty` 文案，不留任何问题痕迹）；数组根本不是数组 → `ContentRaw`。判定依据是「结构对不对」，不是「有没有内容」。
- **为什么**：空是业务事实（还没有收藏、章节未同步），坏是数据事故；两者混用会让事故伪装成正常。
- **后果**：全部子项都被剔除时走空态，是刻意的——那说明宿主给的都是坏项，但用户只需要知道「这里没有可显示的东西」，细节在控制台。
