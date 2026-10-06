# 组件层（`web/src/components/`）

## 使用说明

### 这份文档是什么

组件层的分类规则与索引：**四类**组件的边界判据（`common/` / `mainPage/` / `dialog/` / `content/`，另有动效原语目录 `motion/`）、跨入口共享原语的收件标准、两条数据来源规则、文件粒度约定，以及新增组件的检查清单。

**不覆盖**：各组件内部的实现细节（见三个子文档）。上层入口：[AGENTS.md](../../../AGENTS.md)。

### 怎么读（文件 → 场景）

| 文件 | 什么时候读 |
|---|---|
| 本文件 | **加新组件前必读**——先在这里判定放哪个目录、用哪种数据来源 |
| [main-page.md](main-page.md) | 改外壳组件（侧栏 / 会话视图 / 输入区 / 浮层）、动 `ComposerSeat` 座位分支时 |
| §四类的边界「`common/` 的定位」 | 要往 `components/common/` 加一个原语、或判断某个组件够不够格进这一层时 |
| [dialog.md](dialog.md) | 加或改弹窗、调弹窗开合层级与关闭语义时 |
| [content.md](content.md) | 改内容条目渲染；**新增一种内容 `kind` 时必读**（有逐步清单） |

### 必须遵守的规则

1. **展示组件一律 props 驱动**：能独立渲染出意义的那类组件不得 import store。违反后果：无法脱离外壳复用与测试，数据来源出现第二个真相。见 §数据来源（是全局规则「内容组件不读 store」在本层的落地）。
2. **外壳侧直接消费 store，不层层透传**：`mainPage/**`、`dialog/**` 与 `common/**` 都算外壳侧，可以直接用 `useAppSelector` / `useActions`；`content/**` 与 `mainPage/conversation/**` 不行。违反后果：页面变胖、prop 钻透难维护。判据见 §数据来源。
3. **一个组件一个文件，不建 `index` 桶**：违反后果：循环引用，以及"这个符号到底在哪"的追查成本。见 §文件粒度与命名。
4. **不做过度 memo**：只有流式期间会被高频重渲染的行才 `memo`。违反后果：比较开销白付、代码噪音。见 §文件粒度与命名。
5. **新增组件后登记进本文件**：违反后果：下一次对话找不到它（是全局规则「每次开发后更新文档」在本层的落地）。步骤见 §新增组件检查清单。
6. **`common/` 只收「≥ 2 个入口共用」的原语**：判据是"去掉主界面之后，调试页与文档页还需要它吗"。三个入口（主界面 / 调试页 / 组件库文档页）共用同一批表面原语，所以顶栏只有 `common/AppTopBar` 一份定义，不为某一个入口另写一份——**主界面已经没有顶栏**（[C01](../../design/decisions/C01-app-top-bar.md) 删除；`AppTopBar` 现在只服务调试页与组件库文档页）。违反后果：共享层变成单页专用件的杂物间，三个入口的外观各自漂移（重构前顶栏分头实现就是这么来的）。
   会话与授权语义同样只有一份：待授权只在输入区出现一次（`ComposerSeat` 复用 `ConfirmationCard`），不因为入口不同而另建会话状态。详见 [main-page.md](main-page.md)。
7. **批次活动统一使用 `ToolActivity`**：等待、部分完成、未知与失败分别呈现；成功时也显示宿主的批次计数。
   不把浏览器里的原始 JSON 或提交回执当作批次主反馈，不在组件判断写入是否可以继续。

## 四类的边界

组件层按**用途**分四个目录，判据只有一条：**这个组件服务谁**。

| 目录 | 服务对象 | 判据 | 子文档 |
|---|---|---|---|
| `common/` | 三个入口共用的表面原语 | 去掉主界面之后，调试页与文档页还需要它（顶栏骨架、玻璃浮起层、逐项入场、微标签与胶囊） | 本文件 §索引「目录 → 文件」 |
| `mainPage/` | 主界面外壳 | 只在会话外壳内部使用；换成别的外壳就不需要它 | [main-page.md](main-page.md) |
| `dialog/` | 弹窗与浮层 | 有遮罩层、独立于会话流、可被多处唤起 | [dialog.md](dialog.md) |
| `content/` | 内容条目渲染 | 输入是协议里的内容 `kind`，可脱离外壳单独渲染 | [content.md](content.md) |

拿不准时按这个顺序问：① 它是内容 `kind` 的渲染器吗 → `content/`；② 它带遮罩、整页浮在会话之上吗 → `dialog/`；③ 它是两个以上入口都要用的表面原语吗 → `common/`；④ 否则 → `mainPage/`。

### `common/` 的定位

这一层是**共享表面的收件箱**，不是工具箱——它存在的唯一理由是让三个入口的同一块表面只有一份定义。因此：

- **只放跨入口的东西**：单页专用件留在那一页（文档页的目录、调试页的面板都不在这里）；
- **组件不 import 上层组件**：现有 3 个原语都只吃 props（`AppTopBar` / `Stagger` / `Pill`），没有一个 import `store` 或 `mainPage/**`、`content/**`——虽然这一层与 `mainPage/**`、`dialog/**` 同权，可以直接消费 store（见 §数据来源）；
- **类名与骨架都在 `styles/common.css`**：改共享原语的形态只改那一处，组件里不写第二份样式钩子。

`components/` 下还有一个**不属于上述四类**的目录：`motion/`——它服务的是「动效原语」，谁都可以 import 它。

| 目录 | 服务对象 | 说明 |
|---|---|---|
| `motion/` | 全站的动效原语 | `vendor/` 是从 ReactBits 与 magicui 抓取并做最小适配的组件源码，现共 **17 个**（每个是 `Xxx.tsx`，其中 13 个另有 `Xxx.css` 跟随组件；**已有 9 个落点**，另 3 个原有落点、已按用户选择移除，清单见 §索引）；`motionTokens.ts` 是 JS 侧动效令牌，与 `styles/tokens.css` 的 `--app-*` 一一对应（`DURATION.reveal` / `SHIFT.reveal` 例外：它们只在 JS 侧消费，见 §索引「`motion/vendor/` 的组件与落点」） |

依赖方向是单向的：`mainPage/**`、`content/**`、`dialog/**` 都可以 import `motion/vendor/**` 与 `motionTokens.ts`；**反向不行**——`motion/**` 不 import 任何上层组件，vendor 源码只依赖 `motion` / `gsap` 与自己的 CSS。`common/**` 另有一条同向的约束：它只吃 props，不 import `mainPage/**` / `content/**`。

历史上还存在过一套动效版外壳（`components/v2/**`）与配套的外观切换（`data-ui` 作用域、`ShellV2`、`styles/v2/tokens.css`），**它们已全部删除**：现在只有一套外壳（`page/mainPage/Shell.tsx`），动效直接落在 `mainPage/**` 与 `content/**` 的组件里。看到相关描述一律以源码为准。

`mainPage/` 下再按**界面区域**分四个子目录：

| 子目录 | 区域 | 文件 |
|---|---|---|
| `shell/` | 侧栏（**唯一外壳**） | `Sidebar.tsx`（品牌行 + 8px 连接状态点 + 折叠钮、实心主色整行「开启新对话」、分组列表（置顶 / 今天 / 昨天 / 7 天内 / 更早），入场交给 `<Stagger>`）、`CollapseBubbles.tsx`（收起态左上角的两个胶囊：展开 / 新对话）、`icons.tsx`（外壳图标 `PanelIcon` / `EditIcon` / `GearIcon`，16×16 / `stroke-width` 1.4 统一规格）。`Header.tsx` 已随 [C01](../../design/decisions/C01-app-top-bar.md) 删除——主界面不再有顶栏 |
| `conversation/` | 会话正文 | `Stage.tsx`、`Turn.tsx`、`Streaming.tsx`、`ToolActivity.tsx`、`MessageParts.tsx`、`ConfirmationCard.tsx`、`Hero.tsx` |
| `composer/` | 输入区 | `Composer.tsx`、`ComposerSeat.tsx`、`StatsDock.tsx`、`ThinkingPicker.tsx` |
| `overlays/` | 浮层挂载点 | `DialogStage.tsx`、`Toast.tsx` |

## 数据来源：两条规则

**规则 A：展示组件一律 props 驱动。** `mainPage/conversation/**`、`content/**`、`markdown.tsx`、`StatsDock.tsx` 只接收 props，不 import `store`。理由：它们描述"长什么样"，与"数据从哪来"解耦后可以脱离外壳渲染——调试页把 `<Stage>` 挂进它自建的独立 store、组件库文档页把真实 `ContentBlock` 挂进静态示例，靠的都是这一点。外壳需要它们"顺手写一次全局状态"时由外壳注入回调（`Hero` 的示例 chip 要写输入草稿 → `onPick`；首屏那枚设置胶囊要开弹窗 → `onOpenSettings`；两者都由 `Shell` 注入），不要为了少写一个 props 让它读 store。

**规则 B：外壳侧可以直接消费 store。** `mainPage/**`（`Sidebar`、`CollapseBubbles`、`Composer`、`ComposerSeat`、`ThinkingPicker`、`DialogStage`、`Toast`）、`dialog/**`（`SettingsDialog` 与全部子弹窗）以及 `common/**` 都通过 `useAppSelector` / `useActions` 自己取数据与动作。理由：它们本来就是"外壳的一部分"，强行 props 钻透只会让页面变胖。`common/**` 与 `mainPage/**`、`dialog/**` **同权**——它也是外壳侧，可以直接消费 store；只是现有 3 个原语恰好都是 props 驱动或无状态的。

判定方法：**如果这个组件能在一张空页面上独立渲染出有意义的东西，它就属于规则 A。**

| 组件 | 规则 | 数据来源 |
|---|---|---|
| `Stage` / `Turn` / `Streaming` / `MessageParts` / `ConfirmationCard` / `Hero` | A | props（`Shell` 从 store 读出后传入） |
| `content/**`、`content/markdown.tsx` | A | props（协议条目） |
| `StatsDock` | A | props（由 `Composer` 从 store 读出后传入） |
| `common/**`（`AppTopBar` / `Stagger` / `Pill`） | B（同权） | props 或无状态（外壳侧，允许直接消费 store；现有 3 个原语都不读） |
| `Sidebar` / `CollapseBubbles` / `Composer` / `ComposerSeat` / `ThinkingPicker` | B | store |
| `DialogStage` / `Toast` | B | store |
| `motion/**` | — | 无状态动效原语（props 驱动） |
| `dialog/**` | B | store（弹窗开合状态在 `store/reducers/ui.ts`） |

## 文件粒度与命名

- **一个组件一个文件**，文件名 = 组件名（`Sidebar.tsx`、`MessageParts.tsx`）。没有 `index.ts` 桶文件，导入路径始终指向真实文件，避免循环引用与"这个符号到底在哪"的追查成本。（`content/index.tsx` 是内容块分发器，不是桶文件。）
- 同文件导出的多个小组件必须是同一主题（`MessageParts.tsx` 导出会话流里的原子行：`UserBubble` / `NoticeRow` / `ErrorRow` / `SessionBanner` / `StreamingBlock`；`AppTopBar.tsx` 导出骨架与它的栏目 `AppTopBarTab`）。
- **不做过度 memo**：只有流式期间会被高频重渲染的行才 `memo`（`MessageParts`、`Turn`、`MessageBlocks`、`ContentBlock`、`Markdown`，以及 `Streaming` 内部的 `Clock` / `LiveBlocks` / `ThinkingBlock` / `RunningRow`），普通组件不加。

## 新增组件检查清单

1. 用上面的判据选目录（**两个以上入口都要用的表面原语才进 `common/`**，单页专用件留在那一页）；
2. 用规则 A/B 定数据来源（选 B 时，状态必须加在 `store/reducers/*`，动作加在 `store/operations.ts`，不要就地 `useState` 存全局数据）；
3. 样式类名沿用既有语汇（见 [../styles/readme.md](../styles/readme.md)），需要新类时按所属样式文件的前缀命名；进 `common/` 的原语写进 `styles/common.css`；
4. 在本文件或对应子文档的表格里登记；
5. `npm run typecheck`，并按 [../regression/readme.md](../regression/readme.md) 选相关用例回归。

## 索引

### 目录 → 文件

| 目录 | 文件 | 说明 |
|---|---|---|
| `common/` | `AppTopBar.tsx`（`AppTopBar` + `AppTopBarTab`）、`Stagger.tsx`、`Pill.tsx` | 三个入口共享的表面原语；每个文件对应 `styles/common.css` 里的一组类（`.appTopBar*` / `.appStagger` / `.appPill`）；玻璃与微标签只以共享类 `.appGlass` / `.appMicroLabel` 存在于 `styles/common.css`，不再各占一个组件文件 |
| `mainPage/` | `shell/`、`conversation/`、`composer/`、`overlays/` | 四个子目录的分工见 §四类的边界；细节见 [main-page.md](main-page.md) |
| `dialog/` | `Modal.tsx` + 各弹窗 | 见 [dialog.md](dialog.md) |
| `content/` | `index.tsx`（分发器）、`registry.tsx`、`markdown.tsx`、`MessageBlocks.tsx`、`validate.ts` + 各条目渲染器 | 见 [content.md](content.md) |
| `motion/` | `motionTokens.ts` + `vendor/**` | JS 侧动效令牌与 ReactBits / magicui 源码 |

### `motion/vendor/` 的组件与落点

vendor 里现共 **17 个**组件（`Xxx.tsx`；13 个另带自己的 `Xxx.css`），其中 **9 个有落点**：

| 组件 | 落点 |
|---|---|
| `BlurText` | `conversation/Hero`（首屏标题） |
| `TextType` | `conversation/Streaming`（流式光标：空文本 + `loop={false}`，**不接管真实流式文本**） |
| `BorderGlow` | `composer/Composer`（输入卡边缘光） |
| `AnimatedContent` | `content/MessageBlocks`（内容条目入场） |
| `CountUp` | `composer/StatsDock`（统计底栏的精确读数） |
| `GlareHover` | `content/TagCloud`（标签云掠光，强度按 `content-fix` 压到 32%） |
| `StarBorder` | `content/Callout`（只在「进行中」这一态流动） |
| `Counter` | `content/StatsCard`（统计主数字） |
| `BentoGrid`（含 `BentoCard`） | `dialog/SettingsDialog`（设置弹窗的四格：整格可点、无底部动作条，[C29](../../design/decisions/C29-settings-dialog.md)） |

**原本有落点、按用户选择已移除（3 个；文件仍留在 `motion/vendor/`）**：`Magnet`（磁吸）、`SpotlightCard`（指针光斑）、`ShinyText`（常驻闪光）——用户在 `style-demo-interaction.html` 选的是「A · 只精修状态反馈」，明确排除磁吸与指针光斑；`ShinyText` 的常驻闪光与「V3 · 点睛对比」把引用块标题退成等宽小字的做法冲突。判断依据与落点替代方案见 [content.md](content.md) §规则「每个 `kind` 的动效落点」与 [../../AGENTS.md](../../../AGENTS.md) §规则「外观层硬约定」第 6 条。

**暂无落点（5 个：`AnimatedList` / `Stepper` / `LineSidebar` / `LogoLoop` / `PixelTransition`）**——各自与用途的冲突写在 [content.md](content.md) §规则「每个 `kind` 的动效落点」与 [../../AGENTS.md](../../../AGENTS.md) §索引「现状：已完成 / 已知未做」第 1 条。**不要为了"用上"而把它们塞进语义不符的位置。**

### 跨层伴生文件

| 文件 | 与这一层的关系 |
|---|---|
| `styles/common.css` | `common/**` 的类名与骨架都定义在这里；改共享原语只改这一处（[../styles/readme.md](../styles/readme.md)） |
| `utils/revealOnScroll.ts` | 「滚进视口才浮现」的**唯一** `IntersectionObserver`：按滚动容器缓存、元素进入即 `unobserve`，配合 `common.css` 的 `.appReveal` / `.appReveal.in`。不要在列表里各建一个观察器 |
| `components/motion/motionTokens.ts` ↔ `styles/tokens.css` | 动效令牌只有一处定义、两处消费：CSS 用 `--app-dur-*` / `--app-ease-*` / `--app-shift-*` / `--app-stagger`，JS 用 `motionTokens.ts` 的常量；改一处必须同时改另一处。**例外**：`DURATION.reveal` / `SHIFT.reveal`（内容块滚动入场，C19 定稿 460ms / 18px）只在 JS 侧消费（`AnimatedContent` 由 motion 驱动），CSS 侧没有对应消费点，因此不建同名 CSS 令牌 |
