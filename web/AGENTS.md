# web 交互终端：开发知识库

## 简介

`web/` 下前端（浏览器侧）的**唯一入口**：跨层强制规则、技术栈约束、五维模块化设计风格、外观层约定，以及「要做什么 → 去哪一层」的索引。

**不覆盖**：宿主（`bangumi/src`）与 Pi 上游（`pi/`）的实现细节——宿主看 [../bangumi/AGENTS.md](../bangumi/AGENTS.md)，上游看 [../pi/AGENTS.md](../pi/AGENTS.md)，仓库全景看 [../AGENTS.md](../AGENTS.md)；以及各层的细节——那些在 `docs/agents/` 下按维度展开；知识库的格式规范与六层总索引见 [docs/agents/readme.md](docs/agents/readme.md)。

## 使用说明

- **动手之前先读 §规则 的最前面几条**（「首要规则」）：第 0 条是当前正在进行的 UI 重构（必读设计决策记录，它是唯一验收依据）；第 1、2 条决定这套知识库能不能被信任——开发后同步文档、以及「知识库不是事实源，必须与源码交叉验证」。这几条的违反后果最重，所以放在 §规则 最前面。
- **只想找某件事该去哪一层**：直接查 §索引 的「要做什么 → 去哪一层」表，不必通读本文。
- **要动依赖、目录结构或外观**：先读 §规则 的「技术栈约束」「模块化：依赖方向与宿主分界」「外观层硬约定」三段。
- 本文只讲跨层的事；某一层的细节进该层入口（见 §索引 的「要做什么 → 去哪一层」）。

## 规则

### 首要规则（先读这几条）

这几条决定这套知识库能不能被信任，**优先级高于本文其它一切内容**。

**0.（当前生效）UI 重构期间，动手前必须先读设计决策记录。** 本仓库做过一次**从零开始**的 UI 重构；第七轮（2026-10-06）已把 G01–G10 与 C01–C44 按样张落地到代码（含外壳改「无顶栏 + 侧栏承载」、弹窗改 `.dlg*` 骨架、设置弹窗改 BentoGrid）。**决策记录仍是外观的唯一事实源**，后续任何外观改动都先读它：

- **必读**：`web/docs/design/decisions.md`（开发须知 + 总表 + 进度）与 `web/docs/design/decisions/G-tokens.md`
  （设计令牌总表，唯一事实源）；再读本次要做的那个组件那一篇 `web/docs/design/decisions/C**.md`。
- ⚠️ **这整棵 `web/docs/design/` 被 `.gitignore` 忽略**（`web/docs/design/*`），**新克隆的仓库里没有它们**——只能在本机工作树上读。因此这里的路径都不要当成「仓库里必然存在」的引用；缺失原因与取向见 [docs/agents/readme.md](docs/agents/readme.md) §现状。
- **这两份必须始终留在上下文里**：它们是本次重构的**唯一验收依据**，离开它们就没有验收标准。
- 这次重构期间，**本文下面的「外观层硬约定」不再是设计前提**：`tokens.css` / `bgm.css` / `motionTokens.ts`
  的取值以 `G-tokens.md` 那张表为准，与本文冲突的旧描述一律作废；**为保证没有残余，相关样式可以完全删掉重写**。
- **验收标准是样张**：`web/docs/design/index.html` 里每一项都能点进对应 demo，最终实现的效果必须与 demo 一致
  （同尺寸、同间距、同圆角、同层次、同状态与同交互）。

**1. 每次开发后都要更新对应的知识库文档。** 只要改动落到了某一层（页面 / 组件 / 工具 / 状态 / 样式），就要在**同一次开发里**更新那一层的文档：

- 改了某层的约定、边界或步骤 → 改对应 `docs/agents/<层>/` 的文档；
- 新增或删除了文件 → 更新所属层 `readme.md` 的 §索引（场景表与文件清单）；
- 新增了一条约束 → 按"分层归置"加进所属层 `readme.md` 的 §规则；跨层的加到本节与本文的 §规则。

四段式（`简介 / 使用说明 / 规则 / 索引`）的完整规范见 [docs/agents/readme.md](docs/agents/readme.md) §规则。

**违反后果**：下一次对话按过期文档改错地方。知识库越用越不可信——这比没有知识库更糟。

**2. 知识库不是事实源，必须与源码交叉验证。** 知识库的定位只有两条：**协助快速找到相关代码逻辑**、**保持跨对话的开发风格统一**。它**不是**代码的事实源（source of truth）——文档会滞后、会写错、会与源码不一致。

因此使用任何一篇文档时：

1. **文档只用来定位**：按它给出的路径、符号、章节去找到对应代码；
2. **定位之后必须读源码交叉验证**：结论、参数、行为、边界一律以**当前源码**为准，不以文档描述为准；
3. **发现不符时向用户暴露，不要自行裁决**：停下来把差异报给用户确认——文档说什么、代码是什么、影响范围多大——由用户决定是改文档还是改代码；
   - **禁止**默默按文档去改代码；
   - **禁止**默默按代码改掉文档后当作无事发生；
4. 用户确认后的处理结果要落回文档（与上一条的「每次开发后更新文档」衔接）。

**违反后果**：把过期描述当事实依据，会直接产出错误改动；更糟的是错误会被"文档就是这么写的"掩盖，事后极难发现。

### 跨层强制约束

**这不是参考建议**——违反会让跨对话的实现风格漂移，或直接引入 bug。

1. **内容组件不读 store**：`components/content/**`、`components/mainPage/conversation/**`、`content/markdown.tsx` 一律 props 驱动。违反后果：这些组件无法脱离会话外壳复用与测试，数据来源出现第二个真相。详见 [components/readme.md](docs/agents/components/readme.md)。
2. **改全局状态只能落在 `store/`**：组件里的 `useState` 只承载组件私有状态（提交标记、菜单开合、滚动位置）；输入草稿按会话统一保存在 `ui.drafts`。违反后果：状态更新散落各处，流式帧与界面不同步。详见 [store/readme.md](docs/agents/store/readme.md)。
3. **样式不写裸值、不越界声明**：颜色走令牌；每个样式文件只负责它那一类元素，同一元素同一属性只声明一次。违反后果：改一处不生效，出问题无法定位来源。详见 [styles/readme.md](docs/agents/styles/readme.md)。
4. **高度模块化处用「表」，不用「分支」**：新增一种形态只应改一张表 + 一份类型。违反后果：每加一种形态都要回来改多处且容易漏。范例：`components/content/registry.tsx`、`components/mainPage/composer/ComposerSeat.tsx`。
5. **助手消息的正文只有一个渲染入口（`components/content/MessageBlocks`）**：流式区（`Streaming`）与历史条目（`Turn`）都必须把 `MessageBlock[]` 交给它渲染，不得各自处理块、也不得绕过它直接渲染文本。违反后果：流式期与历史条目的形态会不一致（文本写完那一瞬跳变），并把「骨架 / 降级 / 未知块丢弃」三套分支复制到两处，迟早各自漂移。
6. **流式正文有两份，界面只读「显示投影」；收尾播放期间历史条目必须让位**：`stream.liveContent` 是宿主下发的**权威值**，`stream.displayedContent` 是**屏幕上的那一份**（由 [store/pacing.ts](src/store/pacing.ts) 按时间逐字推进，约 60 字/秒），`pacedTarget` 是它追赶的目标。组件一律经 `selectDisplayedContent` 读投影；判「这一轮是否还在进行」看权威值。宿主在流式结束那一帧把权威正文清空，而屏幕上的字还没播完——这段**收尾播放**期间由 `Stage` 的 `pacedTail` 让最后一轮 `Turn` 隐藏自己的助手正文（`hideAssistant`），播完再由历史条目无缝接管。违反后果：上游的突发批次直接上屏（一次冒出十几个字，这正是本次要解决的问题），或收尾期间屏幕上同时出现两份同样的回答。
7. **过程区与正文的边界来自宿主下发的轮次，前端只分组、不判定**：`assistant` / `reasoning` / `tool` 三类条目都带 `turn`（用户回合）与 `step`（该回合内第几次模型响应），轮次边界由 `kind:'turn'` 条目给出（宿主在 `agent_start`/`agent_end` 发；历史重建时按 user 消息推导，因为落盘条目没有轮次字段）。[utils/turns.ts](src/utils/turns.ts) 只按这些字段把平铺条目切成轮次，[utils/process.ts](src/utils/process.ts) 只把 `reasoning` 与 `tool` 收进过程区——**谁算「最终回答」、哪条属于过程，都不在浏览器判定**。回退规则只有一条：条目带轮次号却没有对应轮次条目时，按「user 开新轮」兜底。违反后果：宿主换了分组规则界面不跟，或前端又长出一套与宿主不一致的轮次语义（改造前正是「按 user 条目猜轮次」）。
8. **工具结果走与助手正文同一个渲染入口**：`ToolResultView.blocks` 就是 `MessageBlock[]`，工具行展开体把它交给 `MessageBlocks`，因此 Bangumi 工具结果里的 `presentation`（`prepare_candidate_output` / `prepare_candidate_table` 那类载荷）与正文用的是同一套 12 种内容块。宿主侧由 [bangumi/src/web/tool-view.ts](../bangumi/src/web/tool-view.ts) 做投影。违反后果：过程区另长出一套卡片族，同一份载荷在正文里能渲染、在工具行里渲染不出来。

### 技术栈约束

依赖**只装在** `bangumi/node_modules`：`web/` 没有自己的 `package.json`，而 Node/Vite/tsc 都从 importer 逐级向上找 `node_modules`、不会拐进兄弟目录。因此：

1. **新增任何第三方包，都要在 `bangumi/vite.config.ts` 的 `resolve.alias` 与 `web/tsconfig.json` 的 `paths` 各注册一次**——现有 `react`、`react-dom`、`redux`、`react-redux`、`motion`、`motion/react`、`gsap`、`gsap/ScrollTrigger` 就是这么接的。违反后果：类型能过、运行时解析失败，或反之。
2. **子路径别名必须排在裸包名之前**（`'motion/react'` 在 `motion` 前、`'gsap/ScrollTrigger'` 在 `gsap` 前），否则子路径会先命中裸包名规则、被截成一个不存在的目录。
3. **改动后至少跑 `npm run typecheck`**；动到样式、DOM 结构或状态流时，按 `docs/agents/regression/` 的用例过一遍主链路。
4. **Windows 上的 watcher 漏检（根因已定位）**：编辑工具是「写临时文件 + rename」保存的，Vite 的 chokidar 碰到这个临时文件会报 `EBUSY: resource busy or locked, watch '...\<file>.<pid>.<uuid>.tmpdir\<file>.tmp'`，于是**真正的改动不被感知**——dev server 继续提供旧模块（界面看起来「改动没生效」，或直接报 `does not provide an export named ...`）。**判定方式**：不要只看磁盘文件，用 CDP 读 CSSOM（`document.styleSheets` 里那条规则是新是旧）或看 dev server 输出里有没有那行 EBUSY。**处理**：改完样式重启 `npm run dev:web`（每批改完就重启是最省事的做法，约 3 秒），不要按「代码写错了」去查。
5. **ReactBits 一律「源码拷贝 + 四处改造」**：组件放 `components/motion/vendor/`，`Xxx.tsx` 顶部 `import './Xxx.css'`（CSS 跟着组件走，不并进 `styles/`）。拷进来必须完成四件事，缺一件就不许合入：① **配色令牌化**——TSX/CSS 里不得出现 `#hex` / `rgb()` / `rgba()` / `hsl()`（含 props 默认值），透明度用 `color-mix(in srgb, var(--令牌) N%, transparent)` 就地派生；② **动画只动 `transform` / `opacity` / `filter` / `background-position`**；③ **常驻循环默认静止**（`animated` / `shimmer` / `playOnce` 一类开关）；④ **尊重 `prefers-reduced-motion`**。文件头用中文写「来源链接 / 相对官方的逐条改动 / 为什么改」。需要给 vendor 类补属性时起**组合类**（范例：`.contentTagGlare`——把 `GlareHover` 的掠光压到 32%、`.contentCalloutGlow`——把 `StarBorder` 的色带压到 34%），不要改 vendor 自己的类。
6. **UI 框架：none（曾经的 antd 例外已取消）**：组件库文档页的骨架已改为**自绘**，与主界面、调试页共用同一批共享组件（`components/common/`）与同一套令牌。因此：① 项目里不再有任何 UI 框架依赖，新增第三方 UI 库要先问过用户；② **主界面没有顶栏**（C01 已删除）：`components/common/AppTopBar` 只服务调试页与组件库文档页，**不要给主界面加回顶栏，也不要为某一个入口另写顶栏**；③ 文档页的骨架改动进 `page/library/`、样式进 `styles/library.css`，两者都不许引入框架类名。违反后果：三个入口的外观各自漂移，或主包体积被一个只服务单一页面的框架拖大。

技术栈选型见 §索引「技术栈选型」，运行命令见 §索引「运行与验证命令」。

### 模块化：依赖方向与宿主分界

```
page/         页面：装配与生命周期，不含业务逻辑（mainPage 主界面、debug 调试页）
  │ 从 store 取数据 → 以 props 传入组件
  ▼
components/   组件：三类（mainPage / dialog / content），边界判定见 components/readme.md
  │ 调用纯函数与宿主接口
  ▼
utils/        工具：按功能类别一个文件，纯函数 + 宿主接口封装
store/        状态：三切片 + 动作 + 选择器 + hooks（与 page/components 双向：读用 selector，写用 actions）
styles/       样式：10 个文件，令牌驱动，按作用对象分文件（含跨入口共享的 common.css）
```

**依赖方向不得反向**：页面只装配、组件 props 驱动、工具层无状态。违反后果：分层失效，同一份数据出现第二个来源。

浏览器只做两件事：提交命令、展示宿主下发的文本。授权判定、工具执行、会话与模型都在宿主 `bangumi/src/web/` 里：

- **命令（HTTP）**：封装在 `utils/api.ts`，全部是同源相对路径 `./api/...`。
- **状态（SSE）**：`GET ./api/events` 逐帧下发；帧类型是 `ServerEvent`，合并语义见 `store/reducers.md`。
- **类型**：跨端类型一律从 `bangumi/src/web/protocol.ts` 取，**前端不复制一份**。违反后果：协议改动后类型静默不同步。

### 外观层硬约定

1. **同一元素同一属性只有一个来源**：样式按作用对象分文件（跨入口共享的表面原语 → `common.css`，外壳 → `frame.css`，输入区 → `composer.css`，卡片与按钮 → `cards.css`，弹窗 → `modal.css`，内容条目 → `content.css`，调试页 → `debug.css`，文档页 → `library.css`），令牌集中在 `tokens.css`（`--app-*`）与 `bgm.css`（`--bgm-*`）——**上游的 `--dsw-*` / `--dsh-*` 已在第七轮删除**，`bgm.css` 那套「把 DSH 语义别名重定向到 `--bgm-*`」的机制也随之去掉。**不要在别处再覆写一遍**——这层没有"覆盖层"概念，重复声明会被当成 bug。需要给既有组件类加属性时，起一个**组合类**（范例：`common.css` 的 `.appBrandAction`——它只补「这里可点是调试入口」这一件事，不去改顶栏骨架的 `.appTopBarBrand`），而不是在第二个文件里改那个既有类。**同一种形态在多个条目里重复时**（行、柔光填充、轨道、标签、表格外壳），把它收敛成 `content.css` §共享基类里的一条**选择器列表**，而不是在每处各写一遍。
2. **动效令牌只有一处定义、两处消费**：CSS 用 `styles/tokens.css` 的 `--app-dur-*` / `--app-ease-*` / `--app-shift-*`，JS 用 `components/motion/motionTokens.ts`。改一处必须同时改另一处。
3. **只动 `transform` / `opacity`（少量 `filter`、`background-position`）**：不做 layout 动画——`width` / `height` / `top` / `left` 的变化一律不算动效载体（内容组件的横向条形与进度条用 `scaleX`、竖向柱高用 `scaleY`，两者都要配对写 `transform-origin`）。会话区的 `content-visibility: auto` 屏外优化与流式期间的 `memo` 都依赖稳定结构，motion 的 layout 动画会强制重排并让它们失效。
4. **常驻循环必须「有语义且可关」**：不做纯装饰的呼吸、脉冲、无限扫光，默认一律静止。允许的循环只有两类：(a) 表达「正在发生」的进程（流式光标、`StarBorder` 只在 `progress` 态流动）；(b) 表达「这里还能交互」的指针效果。每个循环都必须有显式开关（`animated` / `shimmer` / `playOnce` / `speed<=0`），默认关闭或只在对应语义下开启，并尊重 `prefers-reduced-motion: reduce`（静止）。
5. **配色不引入新色值，且不使用中性灰表面**：全部走 Bangumi 浅色令牌（`--bgm-*`），表面与描边一律由主色 `--bgm-primary` `#ec6570`（HSL 355 78% 66%）用 `color-mix()` 就地派生——**页面上不出现灰色表面**（文字色阶仍是中性深色，语义色一律保留原值）。实心按钮另取加深一档的 `--bgm-primary-deep`，让白字达到 AA（主色本身只有约 3.1:1）。
   层次语言（[C44b](docs/design/decisions/C44-sidebar.md) 第七轮定稿）是：**侧栏与对话区同为白面**，两者靠侧栏投出的一条**向右发散阴影**（`--app-shadow-edge`，26/60/36%）分区；主界面**没有顶栏**（[C01](docs/design/decisions/C01-app-top-bar.md) 已删除，`AppTopBar` 只留给调试页与组件库文档页）；卡片不靠底色差、而靠「描边 + 两级阴影」浮起；**五档阴影**（`--app-shadow-raised` / `-chip` / `-card` / `-panel` / `-float`）分别给内嵌元素、胶囊与标签、浮起卡片、浮层、**弹窗的深扩散**，阴影色由深粉棕 `--bgm-primary-text` 半透明派生。
   **表面按内容类型分配装饰预算**（全项目最重要的一条外观判断）：浮起层用玻璃（`--app-glass-fill` / `-stroke` / `-blur`，同时出现的模糊层 ≤ 3）、只有数据可视化用柔光（`.contentFill` 的渐变 + 端点高光 + 光晕）、文本密集类与内容卡片一律素（纯色 + 描边 + 留白 + 字重）。**装饰性径向底光已按 G07 全部删除**（`--app-glow-ambient` 不复存在，任何地方都不得再新增），面板底只用纯色阶梯（页面底 / 内嵌块 / 卡片浅面 / 白面四档）。正文底仍是纯白。
   **算不出 `color-mix()`、只能写实色的抄本**，改令牌时必须同步：`index.html` 与 `library.html` 的预涂底色与 `theme-color`。圆角只走四档（`--app-radius-cell` / `-control` / `-panel` / `-float` = **8 / 10 / 14 / 18**，以 `web/docs/design/decisions/G-tokens.md` §二 为准），**元素越小圆角越小**；超椭圆 `superellipse(1.4)` 由 `tokens.css` 的 `*, *::before, *::after` **一处统一下发**（曲率令牌 `--dsw-corner-shape`）——**不要在浮层或别处再声明一次**，那是同一属性两个来源；胶囊与正圆用 `corner-shape: round` 退出。
   **上游令牌与别名重定向已在第七轮整体删除**：`--dsw-*` / `--dsh-*` 的 65 处消费点全部迁到 `--app-*` / `--bgm-*`，`bgm.css` 里那套「把 DSH 语义别名重定向过去」的机制随之去掉（现在它**只有** `--bgm-*` 的定义）。因此「重定向必须写 `:root, body` 两处」这条坑不再适用；仅 `--dsw-corner-shape`（超椭圆曲率）作为一条独立的上游令牌保留。
6. **动效分工**：流程过渡（会话切换、流式光标、确认卡接管、弹窗进出、侧栏折叠、Toast 进出、连接状态、聚焦与 hover）由组件自己的样式与 motion 实现。ReactBits 组件按用途落点，**不再限定「全局只有一个」**：

   - 外壳与流程：`BlurText` 首屏标题、`TextType` 流式光标（传空文本 + `loop={false}`，**不接管真实流式文本**；光标本身是 6×13px 的实心方块，见 `frame.css` 的 `.appStreamingCursor`）、`BorderGlow` 输入卡边缘光、`AnimatedContent` 内容条目入场、`CountUp` 统计底栏读数。**`Magnet` 已移除**——用户在设计阶段的交互样张（当时的 `style-demo-interaction.html`，**该文件已不存在**，样张现集中在 `web/docs/design/`）里选的是「A · 只精修状态反馈」，明确排除磁吸与指针光斑；
   - 内容组件库：12 种条目可以各带一个落点，当前是 `GlareHover`（标签云掠光，强度按 `content-fix` 的「压低强度、只 hover 一次」收到 32%）、`StarBorder`（仅「进行中」提示的细光：色带 34%、透明度 12%、单程 2.2s）、`Counter`（统计主数字）。**`SpotlightCard` 与 `ShinyText` 已移除**：前者同属被排除的指针效果，后者的常驻闪光与「V3 · 点睛对比」把引用块标题退成等宽小字的做法冲突。

   **动效有两条路径、一套参数**：组件挂载即入场用 `<Stagger>`（CSS keyframes，55ms 错峰 + spring，只给短列表）；**滚动容器内的行**用 `content.css` 的 CSS keyframes（`contentRowIn`）；**滚进视口才浮现**用 `utils/revealOnScroll.ts` 的共享 `IntersectionObserver`（按滚动容器缓存，进入即 `unobserve`——全站只有这一个模块建观察器，不要在每个列表里各建一个）。三条路径的时长 / 曲线 / 位移 / 错峰全部取自同一批令牌（`--app-dur-*` / `--app-ease-*` / `--app-shift-*` / `--app-stagger`）。浮层的展开方向由**结构**决定（`transform-origin` 写在各自的浮层规则里），不做 JS 坐标计算。

## 索引

### 要做什么 → 去哪一层

| 你要做的事 | 进哪一层 | 入口 |
|---|---|---|
| 改页面装配、加生命周期订阅 | 页面层 | [page/readme.md](docs/agents/page/readme.md) |
| 加或改组件（外壳 / 弹窗 / 内容渲染） | 组件层 | [components/readme.md](docs/agents/components/readme.md) |
| 接宿主接口、改命令表、改条目投影 | 工具层 | [utils/readme.md](docs/agents/utils/readme.md) |
| 加状态、加动作、改帧合并、加 selector | 状态层 | [store/readme.md](docs/agents/store/readme.md) |
| 改样式、令牌、品牌外观 | 样式层 | [styles/readme.md](docs/agents/styles/readme.md) |
| 调试页（输入 event / frame 预览渲染） | 页面层 | [page/debug.md](docs/agents/page/debug.md) |
| 组件库文档页（UI 预览 / customType / 参数 / event 与 frame） | 页面层 | [page/library.md](docs/agents/page/library.md) |
| 改动完成后回归验证 | 回归用例 | [regression/readme.md](docs/agents/regression/readme.md) |
| 查技术栈、环境、命令 | 本文 | §索引 的「技术栈选型」「运行与验证命令」 |
| 不确定该放哪、跨层边界不清 | 本文 | §规则 的「模块化：依赖方向与宿主分界」 |
| 改外观语言、动效、层次或首屏 | 本文 | §规则 的「外观层硬约定」 |
| 写或改知识库文档本身 | 知识库规范 | [docs/agents/readme.md](docs/agents/readme.md) |

各层 `readme.md` 是该层的入口，再往下按"文件 → 场景"精确到篇。

### 技术栈选型

| 项 | 选型 | 说明 |
|---|---|---|
| UI 框架 | React 19.2 | 只用函数组件 + hooks，无类组件、无状态库以外的全局对象 |
| 语言 | TypeScript 5.9 | `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`verbatimModuleSyntax`、`noUnusedLocals/Parameters` |
| 构建 | Vite 8.3 | 配置在 `bangumi/vite.config.ts`，`root` 指向 `../web`，产物落 `bangumi/dist/web` |
| 状态 | redux 5.0 + react-redux 9.3 | **裸 redux**：无 RTK、无中间件；异步动作是闭包 `dispatch` 的普通函数 |
| 样式 | 手写 CSS + 设计令牌 | 无 CSS 框架、无 CSS-in-JS、无 CSS Modules、**无 UI 框架**；共 10 个文件在 `web/src/styles/`（`common.css` 是跨入口共享的表面原语，`debug.css` 与 `library.css` 各服务一个入口） |
| 动效 | motion 14 + gsap 3.15 | ReactBits 组件的原生依赖 |
| 路由 | 无路由库 | 单页应用；`main.tsx` 的 `Root` 按 URL hash（`#debug`）在 `MainPage` 与 `DebugPage` 之间互斥挂载，其余查询参数不参与分流 |
| 测试 | 无前端测试运行器 | 前端回归靠 `docs/agents/regression/` 的文档化用例 + `npm run typecheck`；宿主侧另有 `npm run test:mcp`（node:test，不覆盖前端） |

### 运行与验证命令

在 `bangumi/` 下执行：

| 命令 | 用途 |
|---|---|
| `npm run dev:web` | 本地调试：一条命令起宿主 + Vite dev server（**HMR**，`/api` 反代给宿主）。改 `web/src` 立即热更新 |
| `npm run build:web` | 只重建前端产物到 `bangumi/dist/web` |
| `npm run typecheck` | 宿主与前端一起类型检查（`tsc -p tsconfig.json && tsc -p ../web/tsconfig.json`） |
| `npm run build` | `build:web` + 宿主 tsc + 复制策略 Skills |
| `npm run web` | 起宿主 Web 终端（用构建产物，无 HMR）；`--no-open` 只打印带一次性令牌的地址 |

`dev:web` 由 `bangumi/dev-web.mjs` 实现：自动挑端口（宿主默认 8787、dev server 默认 5173，被占用则顺延）、捕获宿主启动时打印的一次性令牌并注入 Vite，因此浏览器侧仍是同源相对路径 `./api/...`，**不需要 CORS**。相关环境变量：`BGM_WEB_PORT`、`BGM_DEV_PORT`、`BGM_WEB_TOKEN`。

### 外观层：文件与命名

```
page/mainPage/
  index.tsx    薄壳：五个生命周期订阅（含 [store/pacing.ts](src/store/pacing.ts) 的 `usePacing`）+ 装配 Shell（订阅必须留在这里，见文件注释）
  Shell.tsx    外壳装配：取 store 数据 → 按槽位交给组件
page/debug/
  index.tsx    调试页：左侧输入 event/frame、右侧预览；自带独立 store（与主 store 隔离）
  simulator.ts event → frame 映射器（宿主 handleEvent 的浏览器侧复刻）
  DebugInputPanel.tsx / DebugPreview.tsx  两侧面板，props 驱动；输入面板另在顶栏挂「组件库」链接（`./library.html`，新标签，见 page/debug.md）
page/library/
  index.tsx    只做导出：`export { LibraryPage } from './App'`
  App.tsx      骨架（**自绘**）：顶栏用共享组件 AppTopBar（品牌 + 栏目 + 搜索 + 三个入口互链）/ 左导航（两层分组，行用共享基类 `.appNavRow`）/ 内容区 / 右侧自绘目录（PageToc）
  router.ts     极简 hash 路由：总览页 / `#/components/<kind>` 详情页 / 其它 hash 落到「没有这个组件」
  search.ts     顶部搜索的过滤口径（kind 名 / 标题 / summary / 载荷 JSON / 参数表）
  Overview.tsx  总览页：每个 kind 一张自绘卡（数量与文案取自 `LIBRARY_SECTIONS`，不写死数字），卡里是真实 `ContentBlock` 小预览
  ComponentPage.tsx  详情页：严格四块（UI 预览 / 参数 / event / frame）+ 参数表五列 + 一行参考附注；`PAGE_ANCHORS` 是这四块的 id 契约
  items.ts      载荷 → 条目 / event / frame 文本（所见即所粘）
  samples.ts    两张数据表：`LIBRARY_SECTIONS`（12 个 kind 的载荷 / 参数 / 参考）+ `LIBRARY_GROUPS`（左侧导航的分组）；新增 kind 只改这里
components/common/
  AppTopBar / Pill / Stagger
                三个入口共享的表面原语（骨架、胶囊、错峰入场）；只放「≥ 2 个入口共用」的东西
                （`SessionHead` 已按 C03 决策删除、并在 C34 落地——对话区顶部不再有常驻标题行；
                 `GlassSurface` / `MicroLabel` 也已并入 `styles/common.css` 的类，不再各占一个文件）
                （浮起层本身沉淀在 `styles/common.css` 的 `.appGlass`——六处浮层直接引这个类，
                 不再包一层组件：Modal 与 Toast 是 motion 元素，包成组件反而要处理 `as` 的类型）
components/mainPage/
  shell/         Sidebar / CollapseBubbles / icons（侧栏是**唯一外壳**：品牌行 + 8px 连接状态点 + 折叠钮、
                 实心主色「开启新对话」、分组列表、底部用户行与齿轮设置入口（C45：原「···」菜单已删）；收起态的两个胶囊在
                 CollapseBubbles.tsx。Header.tsx 已随 C01 删除——主界面不再有顶栏）
  conversation/  Stage / Turn / Streaming / Hero（会话容器、轮次、流式区、首屏；Hero 的 props 是
                 onPick（填草稿）与 onOpenSettings（开设置弹窗），都由 `page/mainPage/Shell.tsx` 注入。
                 Stage 另有 `pacedTail`（收尾播放）——此时让最后一轮 Turn 用 `hideAssistant` 藏起助手正文，
                 避免与流式区同时显示同一段回答；贴底跟随由 ResizeObserver 观察 `.appStageFlow` 驱动，
                 不再每帧读 `scrollHeight`。Streaming 的 `cursor`（= busy）为假时不渲染流式光标；
                 思考块走 `ReasoningRow` 的流式形态——与历史条目**同一个组件**，只是数据来自标量
                 `liveThinking`（用一个合成条目喂它），因此流式期与历史期的思考行形态一致）
                 过程区：ProcessGroup（`TurnProcessBar` 轮首控制行 + 过程行列表，两者是同一级折叠——
                 本项目一轮只对应一个过程组）/ ProcessRows（`ReasoningRow` / `ToolRow` / `ProcessRow`
                 + `useUntilFound` 的折叠容器）/ ProcessIcons（按工具族的 14px 图标）/ TurnActions
                 （轮尾复制 + 每轮用量面板；面板材质直接引共享类 `.appGlass`）
                 MessageParts / ConfirmationCard（props 驱动的共享原子行与确认卡）
                 （`ToolActivity.tsx` 已删除：工具行由 `ToolRow` 取代，旧的「一行文字 + 三字符串」不再存在）
  composer/      Composer / ComposerSeat / StatsDock / ThinkingPicker（输入区、座位、读数、思考强度）
  overlays/      DialogStage / Toast（浮层的挂载点）
components/motion/
  vendor/          ReactBits 组件源码（每个都是 Xxx.tsx + Xxx.css 成对，改造规范见 §规则 技术栈约束第 5 条）
                   共 17 个（9 个有落点 / 8 个暂无落点）
                   有落点：BlurText / TextType / BorderGlow / AnimatedContent / CountUp /
                           GlareHover / StarBorder / Counter / BentoGrid（设置弹窗四格，C29）
                   原本有落点、按用户选择**已移除**（文件仍留在 vendor）：Magnet（磁吸）、
                           SpotlightCard（指针光斑）、ShinyText（常驻闪光）
                           ——见 §规则「外观层硬约定」第 6 条
                   本就无落点：AnimatedList / Stepper / LineSidebar / LogoLoop / PixelTransition
                           （各自的原因见 §现状「已知未做」第 1 条）
  motionTokens.ts  JS 侧动效令牌，与 styles/tokens.css 的 --app-* 一一对应
styles/           10 个文件：tokens / common / frame / composer / cards / modal / bgm / content / debug / library
                  （`common.css` 放三个入口共享的表面原语；`library.css` 只负责文档页的三栏布局 + 内容区排版）
```

两个 HTML 入口：`index.html`（主界面与调试页，按 hash 分流）与 `library.html`（组件库文档页，不连宿主）。

**命名规则**：外壳与容器类用 `app*` 前缀（`.appFrame`、`.appStage`、`.appComposerCard`…）；会话流里的原子行、过程行、轮控制行、确认卡、统计底栏、内容条目沿用**共享渲染器的类名**（`.userRow`、`.bubble`、`.processBarTitle` / `.processRowTitle`、`.reasoningRow` / `.toolRow`、`.planCard`、`.contentTable`…），组件与样式两边改一处即可。

### 样式文件的职责与引入顺序

`main.tsx` 是契约；`library.tsx` 用同一顺序、末位换成 `library.css`（**不再有额外的前置 reset**——UI 框架已移除）：

```ts
tokens → common → frame → composer → cards → modal → bgm → content → debug
```

| 文件 | 作用对象 | 令牌体系 |
|---|---|---|
| `tokens.css` | **外观层令牌**（`--app-*`：时长、缓动、位移、阴影、表面、圆角四档、玻璃、字体阶梯、间距刻度、侧栏宽与抽屉内容宽、spring 与错峰）；另保留唯一一条上游令牌 `--dsw-corner-shape`（超椭圆曲率） | 定义 `--app-*` |
| `common.css` | **共享的表面原语**：顶栏骨架 `.appTopBar*`（只服务调试页与文档页）、品牌组合类 `.appBrandAction`、玻璃 `.appGlass`、导航行 `.appNavRow`、空态、微标签、胶囊、错峰入场、视口入场 | 消费 `--bgm-*` / `--app-*` |
| `frame.css` | 外壳网格（`.appFrame`）、侧栏（品牌行 / 新建 / 分组列表 / 用户行 / 菜单 / 收起态胶囊 / **抽屉式收起**）、提示条、会话容器与轮次、首屏、轮次导航，以及共享渲染器（消息行、**过程区**：轮首控制行 `.processBar*` / 思考行 `.reasoningRow` / 工具行 `.toolRow` / 参数与结果体、**轮尾操作行** `.turnActions` 与用量面板、流式区、Markdown） | 消费 `--bgm-*` / `--app-*` |
| `composer.css` | 输入卡、命令候选、发送按钮、思考强度菜单、统计底栏与其浮层 | 消费 `--bgm-*` / `--app-*` |
| `cards.css` | 写入确认卡与按钮基元 | 消费 `--bgm-*` / `--app-*` |
| `modal.css` | 弹窗：共享表面（`.modalOverlay` / `.modalSurface`）+ **`.dlg*` 表单骨架**（`.dlgPane` / `.dlgHead` / `.dlgField` / `.dlgInput` / `.dlgList` / `.dlgRow` / `.dlgCombo` / `.dlgChoices` / `.dlgActions` / `.dlgBtn*` …） | 消费 `--bgm-*` / `--app-*` |
| `bgm.css` | **只有令牌**：定义 `--bgm-*`（主色、表面阶梯、描边、状态色、圆角、焦点环、字体栈）。第七轮之后**不再有别名重定向**——上游 `--dsw-*` 已删 | 定义 `--bgm-*` |
| `content.css` | 内容组件库（12 种内容条目的皮肤） | 消费 `--bgm-*` / `--app-*` |
| `debug.css` | 调试页（输入区、预览条、空态）、组合类 `.debugLink`（顶栏「组件库」链接，只补 `text-decoration: none`），以及 `.appFrame[data-mode='debug']` 的输入列宽度（`.appBrandAction` 已移到 `common.css`——它现在被两个入口共用） | 消费 `--bgm-*` / `--app-*` |
| `library.css` | 组件库文档页（三栏粘性布局、顶栏内元素、自绘卡片与网格、代码块、参数表的组合类补充、窄屏适配）；只由 `library.tsx` 引入，排在 `content.css` **之后** | 消费 `--bgm-*` / `--app-*` |

关键顺序约束：`common.css` 紧跟 `tokens.css`（它只消费令牌，但要排在 `frame.css` 之前，好让外壳规则能覆盖共享骨架）；`bgm.css` 保持在 `tokens/common/frame/composer/cards/modal` **之后**（历史上它靠"后定义覆盖先定义"做别名重定向，**该机制已在第七轮随上游令牌一起删除**，位置保持不变是为了让「颜色定义在文件末尾」这件事一眼可见）；`content.css`、`debug.css` 与 `library.css` 排在最后（它们只消费令牌，位置不影响前两条）。

### 现状：已完成 / 已知未做

**已完成**：外壳（框架 / 侧栏 / 顶栏，含「待确认 / 待登录 / 运行中 / 当前」状态展示）；会话区（轮次、流式区光标、轮次导航、首屏 `BlurText`）；输入区（`BorderGlow` 边缘光 + 命令候选，草稿按会话保存在 `ui.drafts`，切换中/未就绪/断线时禁用）；`Modal` 的进出过渡与 `DialogStage` 的留场管理（**2026-10-10 起**：进出动画改由 `modal.css` 的 CSS keyframes 给、只动 `transform`，弹窗**不做 `opacity` 淡入**——`opacity < 1` 会让 `backdrop-filter` 失效，presence 也不再由 `AnimatePresence` 提供，见 [G09](docs/design/decisions/G09-overlay.md) §补充与 [C41](docs/design/decisions/C41-dialog-stage.md)）；`Toast` 进出过渡；思考菜单、统计底栏、确认卡的观感（待授权只在输入区呈现一次，历史模式只呈现结果）；`CountUp`（统计底栏的**精确**读数；胶囊上的缩写读数不滚动）；`AnimatedContent`（内容条目入场，`container="#app-stage-scroll"`）；12 种内容条目的皮肤（`styles/content.css`）；回归用例（[regression/readme.md](docs/agents/regression/readme.md) 的 `L` 组与 `A` 组）；**12 种内容条目已用真实载荷逐个实机渲染核对**（组件库文档页与调试页两条入口）；**3 个 ReactBits 动效落点**接入内容条目（`GlareHover` / `StarBorder` / `Counter`；`SpotlightCard`、`ShinyText` 与 `Magnet` 已按「A · 只精修状态反馈」移除，见 §规则「外观层硬约定」第 6 条）；**组件库文档页 `library.html` 改为自绘骨架**（与主界面、调试页共用 `AppTopBar` 与同一套令牌：总览页 + 一组件一页 + 搜索过滤 + 详情页四块；12 种条目仍是真实 `ContentItem` 渲染 + 参数表 + 可直接粘进调试页的 event / frame）。**全仓 UI 重构完成**（方案见 `docs/ui-restyle-plan.md`）：8 组沉淀令牌（玻璃、底光、圆角四档、超椭圆、字体阶梯、间距刻度、spring 与错峰、行高）、`components/common/` 共享层与 `styles/common.css`、主界面在第七轮改为 **C44b 的「无顶栏 + 侧栏承载」结构**（品牌行、折叠钮、新建、会话列表、底部用户行与三入口菜单全在侧栏；顶栏已按 C01 删除；粘性会话头已在 C34 决策中删除）、12 种内容条目按定稿改版（含共享基类的选择器列表收敛）、调试页与文档页与主界面**同构**、**antd 全量移除**、ReactBits 全部按新曲线重调参。**2026-10-07 流式输出改造**（诊断见被 gitignore 的 `artifacts/web-streaming-diagnosis-and-plan.md`）：删掉宿主每 delta 的全量 JSON 日志（单轮 stdout 从 MB 级降到 333 字节）、SSE 合并窗口 40ms → 16ms、正文与思考改**增量帧**（下发带宽 O(n²) → O(n)）、会话区贴底跟随改 `ResizeObserver`（生产构建下浏览器长任务 24 个/轮 → 0 个，同毫秒帧簇 104 → 3）、新增 `store/pacing.ts` 的**逐字摊平与收尾播放**（实测 59.5 字/秒）。

**会话输出展示对齐 DeepSeek Harness**（方案见被 gitignore 的 `artifacts/dsh-output-alignment-plan.md`）：思考从「只活在流式期」改为随轮次落条目（历史里也有）；工具从「`label` + `state` + `detail` 一行文字」升级为结构化条目（中文标题 / 工具族 / 参数摘要 / 参数原文 / 结果内容块 / 耗时 / 读写）；轮次边界由宿主下发（`kind:'turn'` 条目，历史重建时按 user 消息推导），每轮带耗时与 token 用量；会话区改为「轮首过程控制行 + 过程行列表（思考行 / 工具行）+ 正文 + 轮尾操作行」；折叠统一走 `hidden="until-found"`，因此 Ctrl+F 能命中折叠内容并自动展开。实机验证覆盖：调试页注入的完整链路（思考 → 工具 → 结构化结果 → 正文 → 轮结束）、**改造前产生的旧会话的回溯**（13 轮思考行与 7 个工具行、耗时、用量全部还原；工具结果里的 `presentation` 载荷渲染成 `SubjectCards` 内容块）、进行中的轮默认展开、状态行「正在读取列表 · 摘要」。**踩到的坑**：`dev:web` 起的宿主跑的是**构建产物** `dist/src/main.js`（`dev-web.mjs` 的 `HOST_ENTRY`），所以改完 `bangumi/src` 必须 `tsc -p tsconfig.json` 重建并重启 dev server——前端有 HMR 会立刻生效，容易让人以为整条链路都更新了（实测症状：界面里没有任何过程控制行，因为宿主还是旧的投影）。

**已知未做 / 未验证**：

1. **5 个 vendor 组件「已 vendor、无落点」，不等于不可用**：`AnimatedList`（只接受 `items: string[]` 并统一渲染 `<p class="item-text">`，承载不了侧栏「标题 + 状态」两栏与结构化内容行；且内部固定 `marginBottom: 1rem`、默认全局拦下 Tab/方向键。侧栏因此按同样的动势自己实现逐项入场，见 `components/mainPage/shell/Sidebar.tsx`）、`Stepper`（`<Step>` children 形状的多步向导，与章节网格语义不符）、`LineSidebar`（`items` 是 `string[]` 且不含 `<a>`，承载不了链接列表）、`LogoLoop`（跑马灯会复制 DOM——链接会重复、键盘方向键滚动会失效）、`PixelTransition`（双面切换要把信息藏进 hover，违反内容组件「信息不藏在 hover 里」的既有原则）。五者都留在 `components/motion/vendor/`，落点清单见 [components/readme.md](docs/agents/components/readme.md) §索引「`motion/vendor/` 的组件与落点」。
2. **12 种内容条目的逐一渲染核对已完成**（本轮）：用真实载荷在组件库文档页与调试页两条入口逐个渲染，12 种全部无降级；示例数据另有脚本按 `validate.ts` 的规则自检。此前「只做静态核对」的记录作废。
3. 浏览器实测覆盖（**均已实机确认**）：首页与会话渲染、轮次导航、侧栏收放、输入区与命令候选、弹窗进出与 Esc 关闭、统计底栏读数、**对话区白底、侧栏同为白面并靠向右发散阴影（`--app-shadow-edge`）分区**、**`TextType` 用法**（空文本 + `loop={false}` 不启动打字；光标是 6×13px 的实心方块 + 1.06s 硬切闪烁，见 `frame.css` 的 `.appStreamingCursor`）、**`BorderGlow` 指针链路**（`--edge-proximity` 与 `--cursor-angle` 随指针变化）、**`CountUp`**（探针实测渐近到目标值）、**`AnimatedContent`**（`container="#app-stage-scroll"` 被正确解析，元素不会被卡成不可见）、**弹窗进出动画（2026-10-10 复测）**：进场 `animationName = modalIn`、退场 `modalOut`，表面 `opacity` 全程为 `1`（不做淡入），退场由 `data-leaving` 触发、播完约 400ms 才从 DOM 移除；同时实测确认 **Chromium 在 `opacity < 1` 时会跳过 `backdrop-filter`**（同一条 `blur(20px)`，`opacity: 1` 时背后文字糊掉、`opacity: .5` 时清晰可读；`will-change` / `translateZ(0)` / 子层承载模糊 / 祖辈承载透明度，四种写法都无效）——这条是弹窗不做淡入的直接依据。
4. **仍未实机验证**：写入确认卡接管——它需要宿主发起 `pending` 确认，即一次真实写入流程，不能在自动化里安全触发。三条环境限制：(a) `BorderGlow` 的 `edge-light` 与 `GlareHover` 的掠光都依赖真实 `:hover`，而 CDP 驱动下 `element.matches(':hover')` 恒为 false，自动化只能验证到「CSS 变量 → 透明度公式」这一环；(b) Windows 上 Vite 的 watcher 会因编辑工具的「临时文件 + rename」保存方式报 EBUSY 而漏检改动（见 §规则 的「技术栈约束」第 4 条），所以样式改动后要重启 dev server 再验证；(c) 本机浏览器与 harness **都访问不了外网**（`bgm.tv` / `lain.bgm.tv` 全部 fetch 失败），因此链接「能真实打开」只验证到 `href` / `target` / `rel` 契约与域名路径，图片走的是加载失败回落。
5. **文档页的右侧页内目录是自绘的**：目录项若直接写 `location.hash`，会与「一组件一页」的 hash 路由（`#/components/<kind>`）互相覆盖。取舍是**保路由**（前进后退、可直连 URL 都已实机确认），目录用 `PageToc` + `IntersectionObserver` 自己实现——代价是平滑滚动与目标高亮都要自己写。
6. **逐字摊平只在注入帧下完整验证过，真实模型的完整一轮尚未跑通**：验证时用 React fiber 拿到 store 后注入模拟帧（state 帧 + 增量帧 + 结束帧），逐字速率（59.5 字/秒）、收尾播放（流式结束后继续播完 164 字）、条目隐藏（收尾期 `.assistantBody` 计数为 0）与无缝交接都已确认；但几次真实提交恰好都落在「模型只输出思考、正文为空」的情形上，因此**真实 SSE 帧下的端到端一轮仍待复测**。另外两点有意为之、不要当 bug：**思考文本不摊平**（思考动辄上千字，逐字播要几十秒），**摊平速度与显示器刷新率解耦**（按经过的毫秒数折算，120Hz 屏幕上仍是 60 字/秒）。

### 设计历史与外部文档

设计过程中的方案与验收记录不在本知识库内（它们位于被 gitignore 的仓库根 `docs/`）：`modularization-plan.md`（分层方案）、`modularization-record.md`（实施与验收记录）、`model-credential-persistence.md`（模型配置持久化）、`ui-restyle-plan.md`（**本次全仓 UI 重构的方案**：目标、沉淀与复用设计、12 种条目的逐项定稿、防土硬规则、验收标准、文档同步清单）、`bgm-design/*`（内容组件库与视觉规范）。
