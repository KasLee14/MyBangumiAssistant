# 组件层（`web/src/components/`）

## 简介

组件层的分类规则与索引：三类组件的边界判据、两条数据来源规则、文件粒度约定，以及新增组件的检查清单。

**不覆盖**：各组件内部的实现细节（见三个子文档）。上层入口：[AGENTS.md](../../../AGENTS.md)。

### 三类的边界

组件层按**用途**分三个目录，判据只有一条：**这个组件服务谁**。

| 目录 | 服务对象 | 判据 | 子文档 |
|---|---|---|---|
| `mainPage/` | 主界面外壳 | 为会话外壳而写；**允许被第二个外壳复用**（`SidebarBrand` 就被调试页复用），但判据不是"被谁用"，而是"它不依赖 store、只靠 props 就能摆进任何外壳" | [main-page.md](main-page.md) |
| `dialog/` | 弹窗与浮层 | 有遮罩层、独立于会话流、可被多处唤起 | [dialog.md](dialog.md) |
| `content/` | 内容条目渲染 | 输入是协议里的内容 `kind`，可脱离外壳单独渲染 | [content.md](content.md) |

拿不准时按这个顺序问：① 它是内容 `kind` 的渲染器吗 → `content/`；② 它带遮罩、整页浮在会话之上吗 → `dialog/`；③ 否则 → `mainPage/`。

`components/` 下还有一个**不属于上述三类**的目录：

| 目录 | 服务对象 | 说明 |
|---|---|---|
| `motion/` | 动效原语 | `vendor/` 是从 ReactBits 抓取并做最小适配的组件源码，共 **16 个**：外壳与流程 6 个（`BlurText`、`TextType`、`BorderGlow`、`Magnet`、`AnimatedContent`、`CountUp`）、内容条目 5 个（`SpotlightCard`、`GlareHover`、`ShinyText`、`StarBorder`、`Counter`）、**当前无落点 5 个**（`AnimatedList`、`Stepper`、`LineSidebar`、`LogoLoop`、`PixelTransition`，见 §索引「`motion/vendor/` 的组件与落点」）；`motionTokens.ts` 是 JS 侧动效令牌，与 `styles/tokens.css` 的 `--app-*` 一一对应 |

依赖方向是单向的：`mainPage/**`、`dialog/**` 可以 import `motion/**`，也可以复用 `content/**` 里 props 驱动的渲染器；**反向不行**——`motion/**` 是被依赖的叶子，只 import `react` / `motion` / `gsap` 与自带的 `.css`，不 import 外壳、弹窗或 `store`。

## 使用说明

- **加新组件前先读 §规则**：五条规则覆盖数据来源、文件粒度与登记要求，每条都带违反后果；放哪个目录的判据见 §简介「三类的边界」。
- **只想查「某个组件读写哪些 store 字段」「某个文件放哪」**：直接查 §索引 的四张表（文件 → 场景、组件 → 数据来源、`mainPage/` 的子目录与文件、章节 → 场景），不必通读 §规则。
- **新增内容条目**：先按 [content.md](content.md) §规则 的「新增一种内容 `kind` 的完整清单」（7 步）做，再回本文 §规则 末条「新增组件检查清单」走一遍。
- **新增组件**：先读 §规则「展示组件一律 props 驱动」与「外壳与弹窗直接消费 store，不层层透传」定数据来源，再按 §规则 末条收尾。

## 规则

### 展示组件一律 props 驱动

**规则 A：展示组件一律 props 驱动。** `conversation/**`（`Stage`、`Turn`、`Streaming`、`Hero`、`MessageParts`、`ConfirmationCard`）、`content/**`、`markdown.tsx`、`StatsDock.tsx` 只接收 props，不 import `store`。理由：它们描述"长什么样"，与"数据从哪来"解耦后可以脱离外壳渲染（历史上存在过的 `?preview=1` 调试面板就是靠这一点复用同一套组件）。

判定方法：**如果这个组件能在一张空页面上独立渲染出有意义的东西，它就属于规则 A。**

**违反后果**：无法脱离外壳复用与测试，数据来源出现第二个真相（是全局规则「内容组件不读 store」在本层的落地）。

### 外壳与弹窗直接消费 store，不层层透传

**规则 B：外壳与弹窗可以直接消费 store。** `Sidebar`、`Header`、`Composer`、`ComposerSeat`、`ThinkingPicker`、`DialogStage`、`Toast`、`SettingsDialog` 与全部子弹窗都通过 `useAppSelector` / `useActions` 自己取数据与动作。理由：它们本来就是"外壳的一部分"，强行 props 钻透只会让页面变胖。

**违反后果**：页面变胖、prop 钻透难维护。每个组件属于哪条规则见 §索引「组件 → 数据来源」。

### 一个组件一个文件，不建 `index` 桶

- **一个组件一个文件**，文件名 = 组件名（`Sidebar.tsx`、`MessageParts.tsx`）。没有 `index.ts` 桶文件，导入路径始终指向真实文件，避免循环引用与"这个符号到底在哪"的追查成本。
- 同文件导出的多个小组件必须是同一主题（`MessageParts.tsx` 导出会话流里的原子行：`UserBubble` / `NoticeRow` / `ErrorRow` / `SessionBanner`；流式区不在这个文件里，它是 `conversation/Streaming.tsx` 的 `Streaming`）。

**违反后果**：循环引用，以及"这个符号到底在哪"的追查成本。

### 不做过度 memo

只有流式期间会被高频重渲染的行才 `memo`（`MessageParts` 的四行、`Turn`、`Streaming` 内部的 `Clock` / `LiveText` / `ThinkingBlock` / `RunningRow`、`ContentItem`、`Markdown`），普通组件不加。

**违反后果**：比较开销白付、代码噪音。

### ReactBits 组件按用途落点，不再是「全局只有一个」

跨层约定见 [AGENTS.md](../../../AGENTS.md) §规则「外观层硬约定」第 6 条。**旧规则是「每个 ReactBits 组件全局只能有一个落点」；现在改成按用途落点**：外壳与流程各有一个位置，内容组件库的 12 种条目也可以各带一个落点——同一个 vendor 组件仍不应在界面上出现两次，但"内容条目这一层能不能用动效"不再需要全局排他地论证。

落点清单见 §索引「`motion/vendor/` 的组件与落点」。**无落点不等于不可用**：`AnimatedList`、`Stepper`、`LineSidebar`、`LogoLoop`、`PixelTransition` 都留在 `vendor/` 里待命（各自的不用理由写在表里）。**不得为了"用上某个组件"去找位置**——那会把语义塞进不相干的形态，或让信息藏进 hover（见 [content.md](content.md) §规则「每个 `kind` 的动效落点」）。

**违反后果**：为了用组件而扭曲语义（例如把多步向导塞进章节网格），或同一个动效在界面里出现两次。

### 新增组件后登记进本文件

**违反后果**：下一次对话找不到它（是全局规则「每次开发后更新文档」在本层的落地）。步骤见 §规则「新增组件检查清单」。
### 新增组件检查清单

1. 用上面的判据选目录；
2. 用规则 A/B 定数据来源（选 B 时，状态必须加在 `store/reducers/*`，动作加在 `store/operations.ts`，不要就地 `useState` 存全局数据）；
3. 样式类名沿用既有语汇（见 [../styles/readme.md](../styles/readme.md)），需要新类时按所属样式文件的前缀命名；
4. 在本文件或对应子文档的表格里登记；
5. `npm run typecheck`，并按 [../regression/readme.md](../regression/readme.md) 选相关用例回归。

## 索引

### 文件 → 场景

| 文件 | 什么时候读 |
|---|---|
| 本文件 | **加新组件前必读**——先在这里判定放哪个目录、用哪种数据来源 |
| [main-page.md](main-page.md) | 改外壳组件（侧栏 / 顶栏 / 会话容器 / 输入区 / 浮层）、动 `ComposerSeat` 座位分支时 |
| [dialog.md](dialog.md) | 加或改弹窗、调弹窗开合层级与关闭语义时 |
| [content.md](content.md) | 改内容条目渲染；**新增一种内容 `kind` 时必读**（有逐步清单） |

### 组件 → 数据来源

| 组件 | 规则 | 数据来源 |
|---|---|---|
| `Stage` / `Turn` / `Streaming` / `MessageParts` / `ConfirmationCard` / `Hero` | A | props（由 `Shell` 从 store 读出后传入） |
| `content/**`、`content/markdown.tsx` | A | props（协议条目） |
| `StatsDock` | A | props（由 `Composer` 从 store 读出后传入） |
| `SidebarBrand` | A | props（`onDoubleClick` / `title` / `children`；主界面传"进入调试页"、调试页传"返回主界面"，见 [../utils/debugMode.md](../utils/debugMode.md)） |
| `motion/**` | A | props 或无状态 |
| `Sidebar` / `Header` / `Composer` / `ComposerSeat` / `ThinkingPicker` / `DialogStage` / `Toast` | B | store |
| `dialog/**` | B | store（弹窗开合状态在 `store/reducers/ui.ts`） |

### `mainPage/` 的子目录与文件

`mainPage/` 下再按**界面区域**分四个子目录：

| 子目录 | 区域 | 文件 |
|---|---|---|
| `shell/` | 侧栏与顶栏 | `Sidebar.tsx`、`SidebarBrand.tsx`、`Header.tsx` |
| `conversation/` | 会话正文 | `Stage.tsx`、`Turn.tsx`、`Streaming.tsx`、`Hero.tsx`、`MessageParts.tsx`、`ConfirmationCard.tsx` |
| `composer/` | 输入区 | `Composer.tsx`、`ComposerSeat.tsx`、`StatsDock.tsx`、`ThinkingPicker.tsx` |
| `overlays/` | 浮层挂载点 | `DialogStage.tsx`、`Toast.tsx` |

### `motion/vendor/` 的组件与落点

`vendor/` 共 **16** 个组件（每个都是 `Xxx.tsx` + `Xxx.css` 成对，改造规范见 [AGENTS.md](../../../AGENTS.md) §规则「技术栈约束」第 5 条）。落点 = 当前唯一引用它的地方：

| 组件 | 落点 | 什么时候读 |
|---|---|---|
| `BlurText` | 首屏标题（`mainPage/conversation/Hero.tsx`） | 改首屏入场时 |
| `TextType` | 流式光标（`mainPage/conversation/Streaming.tsx`）：传空文本 + `loop={false}`，**不接管真实流式文本** | 改流式光标时 |
| `BorderGlow` | 输入卡边缘光（`mainPage/composer/Composer.tsx`） | 改输入卡光效时 |
| `Magnet` | 发送按钮（`composer/Composer.tsx`，幅度压到约 6px） | 改发送键指针跟随、觉得按钮"抖"时 |
| `AnimatedContent` | 内容条目入场（`conversation/Turn.tsx`，`container="#app-stage-scroll"`） | 内容条目不可见、改入场时（回归用例见 [../regression/shell-and-layout.md](../regression/shell-and-layout.md)） |
| `CountUp` | 统计底栏读数（`composer/StatsDock.tsx`） | 改统计读数时 |
| `SpotlightCard` | `content/SubjectCards.tsx` 的网格卡（组合类 `.contentSubjectSpotlight`） | 改条目卡光斑时 |
| `GlareHover` | `content/TagCloud.tsx` 包裹整个标签云（`playOnce`；组合类 `.contentTagGlare`） | 改标签云掠光时 |
| `ShinyText` | `content/QuoteBlock.tsx` 的标题（高光取主色、渐变两端用底字色——浅色主题下白色扫过等于没扫） | 改引用块标题时 |
| `StarBorder` | `content/Callout.tsx`，**仅 `tone === 'progress'`** 时作装饰层（组合类 `.contentCalloutGlow`、`animated`） | 改「进行中」提示边框时 |
| `Counter` | `content/StatsCard.tsx` 的主数字（只在 `headline.value` 是纯数字字符串时启用） | 改统计主数字时 |
| `AnimatedList` | **无落点**：只接受 `items: string[]` 并统一渲染 `<p class="item-text">`，承载不了结构化行（侧栏与内容行的错峰入场由 CSS keyframes 实现） | 想用它承载侧栏或条目行时 |
| `Stepper` | **无落点**：`<Step>` children 形状的多步向导，与章节网格语义不符 | 想给章节 / 进度做向导时 |
| `LineSidebar` | **无落点**：`items` 是 `string[]` 且不含 `<a>`，承载不了链接列表 | 想给内容条目做侧栏导航时 |
| `LogoLoop` | **无落点**：跑马灯会复制 DOM——链接会重复、键盘方向键滚动会失效 | 想给 gallery / 横向轨道加流动时 |
| `PixelTransition` | **无落点**：双面切换要把信息藏进 hover，违反内容组件「信息不藏在 hover 里」的既有原则 | 想给 compare 加切换揭示时 |

### 章节 → 场景

| 章节 | 什么时候读 |
|---|---|
| §简介「三类的边界」 | 判定新组件放哪个目录、核对依赖方向时 |
| §规则「展示组件一律 props 驱动」 | 决定组件能不能 import `store` 时 |
| §规则「外壳与弹窗直接消费 store，不层层透传」 | 组件要读全局状态、纠结要不要透传时 |
| §规则「一个组件一个文件，不建 `index` 桶」 | 拆文件、起文件名时 |
| §规则「不做过度 memo」 | 想给组件加 `memo` 时 |
| §规则「ReactBits 组件按用途落点，不再是「全局只有一个」」 | 想给界面加 ReactBits 动效、或拿不准"该不该为了用而用"时 |
| §索引「`motion/vendor/` 的组件与落点」 | 找某个 vendor 组件的落点、或查某个组件"为什么没有落点"时 |
| §规则「新增组件后登记进本文件」 | 组件写完收尾时 |
| §规则「新增组件检查清单」 | 新增组件时逐步照做 |
