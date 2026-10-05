# web 交互终端：开发知识库

## 简介

`web/` 下前端（浏览器侧）的**唯一入口**：跨层强制规则、技术栈约束、五维模块化设计风格、外观层约定，以及「要做什么 → 去哪一层」的索引。

**不覆盖**：宿主（`bangumi/src`）与 Pi 上游（`pi/`）的实现细节，以及各层的细节——那些在 `docs/agents/` 下按维度展开；知识库的格式规范与六层总索引见 [docs/agents/readme.md](docs/agents/readme.md)。

## 使用说明

- **动手之前先读 §规则 的前两条**（「首要规则」）：它们决定这套知识库能不能被信任——开发后同步文档、以及「知识库不是事实源，必须与源码交叉验证」。这两条的违反后果最重，所以放在 §规则 最前面。
- **只想找某件事该去哪一层**：直接查 §索引 的「要做什么 → 去哪一层」表，不必通读本文。
- **要动依赖、目录结构或外观**：先读 §规则 的「技术栈约束」「模块化：依赖方向与宿主分界」「外观层硬约定」三段。
- 本文只讲跨层的事；某一层的细节进该层入口（见 §索引 的「要做什么 → 去哪一层」）。

## 规则

### 首要规则（先读这两条）

这两条决定这套知识库能不能被信任，**优先级高于本文其它一切内容**。

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

### 技术栈约束

依赖**只装在** `bangumi/node_modules`：`web/` 没有自己的 `package.json`，而 Node/Vite/tsc 都从 importer 逐级向上找 `node_modules`、不会拐进兄弟目录。因此：

1. **新增任何第三方包，都要在 `bangumi/vite.config.ts` 的 `resolve.alias` 与 `web/tsconfig.json` 的 `paths` 各注册一次**——现有 `react`、`react-dom`、`redux`、`react-redux`、`motion`、`motion/react`、`gsap`、`gsap/ScrollTrigger`、`antd` 就是这么接的（`antd` 的 `paths` 指向 `../bangumi/node_modules/antd/es/index.d.ts`）。违反后果：类型能过、运行时解析失败，或反之。
2. **子路径别名必须排在裸包名之前**（`'motion/react'` 在 `motion` 前、`'gsap/ScrollTrigger'` 在 `gsap` 前），否则子路径会先命中裸包名规则、被截成一个不存在的目录。
3. **改动后至少跑 `npm run typecheck`**；动到样式、DOM 结构或状态流时，按 `docs/agents/regression/` 的用例过一遍主链路。
4. **Windows 上的一个坑**：同一秒内对多个文件做写入可能被 Vite 的 watcher 漏检，表现为 dev server 仍提供旧模块（界面看起来「改动没生效」，或直接报 `does not provide an export named ...`）。此时重启 `npm run dev:web` 即可，不要按「代码写错了」去查。
5. **ReactBits 一律「源码拷贝 + 四处改造」**：组件放 `components/motion/vendor/`，`Xxx.tsx` 顶部 `import './Xxx.css'`（CSS 跟着组件走，不并进 `styles/`）。拷进来必须完成四件事，缺一件就不许合入：① **配色令牌化**——TSX/CSS 里不得出现 `#hex` / `rgb()` / `rgba()` / `hsl()`（含 props 默认值），透明度用 `color-mix(in srgb, var(--令牌) N%, transparent)` 就地派生；② **动画只动 `transform` / `opacity` / `filter` / `background-position`**；③ **常驻循环默认静止**（`animated` / `shimmer` / `playOnce` 一类开关）；④ **尊重 `prefers-reduced-motion`**。文件头用中文写「来源链接 / 相对官方的逐条改动 / 为什么改」。需要给 vendor 类补属性时起**组合类**（范例：`.contentSubjectSpotlight`、`.contentTagGlare`、`.contentCalloutGlow`），不要改 vendor 自己的类。
6. **`antd` 是「只服务组件库文档页（`library.html`）的骨架」的例外**：它**不得**被主界面与调试页引入——`web/src/library.tsx` 是唯一的引入点，构建产物里 antd 全部落在 `library-*.js`，主入口 `index-*.js` 的体积不受它影响。两条附带约束：① antd 的 token 色值抄在 `web/src/page/library/theme.ts`（`LIBRARY_THEME`），因为 antd 的 token 要参与色阶推导，传 `var(--bgm-*)` 算不出来、会退回默认蓝，所以**改 `--bgm-*` 令牌时必须同步改它**；② `Divider` 的标题位置在 v6 叫 `titlePlacement`（`orientation` 在 v6 表示**分割线方向**，horizontal / vertical）。违反后果：主界面体积被 antd 拖大，或文档页配色退回 antd 默认蓝。

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
styles/       样式：9 个文件，令牌驱动，按作用对象分文件
```

**依赖方向不得反向**：页面只装配、组件 props 驱动、工具层无状态。违反后果：分层失效，同一份数据出现第二个来源。

浏览器只做两件事：提交命令、展示宿主下发的文本。授权判定、工具执行、会话与模型都在宿主 `bangumi/src/web/` 里：

- **命令（HTTP）**：封装在 `utils/api.ts`，全部是同源相对路径 `./api/...`。
- **状态（SSE）**：`GET ./api/events` 逐帧下发；帧类型是 `ServerEvent`，合并语义见 `store/reducers.md`。
- **类型**：跨端类型一律从 `bangumi/src/web/protocol.ts` 取，**前端不复制一份**。违反后果：协议改动后类型静默不同步。

### 外观层硬约定

1. **同一元素同一属性只有一个来源**：样式按作用对象分文件（外壳 → `frame.css`，输入区 → `composer.css`，卡片与按钮 → `cards.css`，弹窗 → `modal.css`，内容条目 → `content.css`，调试页 → `debug.css`），令牌集中在 `tokens.css`（`--dsw-*` / `--dsh-*` / `--app-*`）与 `bgm.css`（`--bgm-*` 与语义别名重定向）。**不要在别处再覆写一遍**——这层没有"覆盖层"概念，重复声明会被当成 bug。需要给既有组件类加属性时，起一个**组合类**（范例：`debug.css` 的 `.appBrandAction` 与 `.appBrand` 并用），而不是在第二个文件里改那个既有类。
2. **动效令牌只有一处定义、两处消费**：CSS 用 `styles/tokens.css` 的 `--app-dur-*` / `--app-ease-*` / `--app-shift-*`，JS 用 `components/motion/motionTokens.ts`。改一处必须同时改另一处。
3. **只动 `transform` / `opacity`（少量 `filter`、`background-position`）**：不做 layout 动画——`width` / `height` / `top` / `left` 的变化一律不算动效载体（内容组件的横向条形与进度条用 `scaleX`、竖向柱高用 `scaleY`，两者都要配对写 `transform-origin`）。会话区的 `content-visibility: auto` 屏外优化与流式期间的 `memo` 都依赖稳定结构，motion 的 layout 动画会强制重排并让它们失效。
4. **常驻循环必须「有语义且可关」**：不做纯装饰的呼吸、脉冲、无限扫光，默认一律静止。允许的循环只有两类：(a) 表达「正在发生」的进程（流式光标、`StarBorder` 只在 `progress` 态流动）；(b) 表达「这里还能交互」的指针效果。每个循环都必须有显式开关（`animated` / `shimmer` / `playOnce` / `speed<=0`），默认关闭或只在对应语义下开启，并尊重 `prefers-reduced-motion: reduce`（静止）。
5. **配色不引入新色值**：全部走 Bangumi 浅色令牌（`--bgm-*`）。层次语言是：**侧栏取站点页面底色（`--app-surface-sunken` = `--bgm-bg` `#f5f5f5`），白面留给对话区与顶栏**，两块区域靠底色分区、再由 1px hairline 收边；卡片不靠底色差、而靠「描边 + 两级阴影」浮起；输入卡用比白面略沉一档的 `--bgm-surface-alt`，否则整张卡只剩一圈描边可辨。三级阴影（`--app-shadow-raised` / `--app-shadow-card` / `--app-shadow-panel`）分别给内嵌元素、浮起卡片与浮层。
6. **动效分工**：流程过渡（会话切换、流式光标、确认卡接管、弹窗进出、侧栏折叠、Toast 进出、连接状态、聚焦与 hover）由组件自己的样式与 motion 实现。ReactBits 组件按用途落点，**不再限定「全局只有一个」**：

   - 外壳与流程：`BlurText` 首屏标题、`TextType` 流式光标（传空文本 + `loop={false}`，**不接管真实流式文本**）、`BorderGlow` 输入卡边缘光、`Magnet` 发送按钮（幅度压到约 6px）、`AnimatedContent` 内容条目入场、`CountUp` 统计底栏读数；
   - 内容组件库：12 种条目可以各带一个落点，当前是 `SpotlightCard`（条目卡光斑）、`GlareHover`（标签云掠光）、`ShinyText`（引用块标题）、`StarBorder`（仅「进行中」提示的边框）、`Counter`（统计主数字）。

   **会话流的轮次与普通行不做 JS 入场动画**：逐行动画要付出 JS 开销与每节点观察器。内容条目这一层挂 `AnimatedContent`，行级入场用 `content.css` 的 CSS keyframes（`contentRowIn`，只动 opacity/transform + 尊重 reduced-motion）。

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
| 样式 | 手写 CSS + 设计令牌 | 无 CSS 框架、无 CSS-in-JS、无 CSS Modules；共 9 个文件在 `web/src/styles/`（第 8 个是调试页的 `debug.css`，第 9 个是组件库文档页的 `library.css`）。**唯一例外**：组件库文档页的*骨架*用 antd（CSS-in-JS），且只服务 `library.html`——见 §规则「技术栈约束」第 6 条 |
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
  index.tsx    薄壳：四个生命周期订阅 + 装配 Shell（订阅必须留在这里，见文件注释）
  Shell.tsx    外壳装配：取 store 数据 → 按槽位交给组件
page/debug/
  index.tsx    调试页：左侧输入 event/frame、右侧预览；自带独立 store（与主 store 隔离）
  simulator.ts event → frame 映射器（宿主 handleEvent 的浏览器侧复刻）
  DebugInputPanel.tsx / DebugPreview.tsx  两侧面板，props 驱动；输入面板另在顶栏挂「组件库」链接（`./library.html`，新标签，见 page/debug.md）
page/library/
  index.tsx    只做导出：`export { LibraryPage } from './App'`
  App.tsx      骨架（antd）：Header（品牌 + 搜索 + 栏目）/ Sider（两层分组导航）/ Content / 右侧自绘目录（PageToc）
  router.ts     极简 hash 路由：总览页 / `#/components/<kind>` 详情页 / 其它 hash 落到「没有这个组件」
  search.ts     顶部搜索的过滤口径（kind 名 / 标题 / summary / 载荷 JSON / 参数表）
  Overview.tsx  总览页：每个 kind 一张卡（数量与文案取自 `LIBRARY_SECTIONS`，不写死数字），卡里是真实 `ContentItem` 小预览
  ComponentPage.tsx  详情页：严格五块（UI 预览 / customType / 参数 / event / frame）+ 参数表五列 + 一行参考附注；`PAGE_ANCHORS` 是这五项的 id 契约
  items.ts      载荷 → 条目 / event / frame 文本（所见即所粘）
  samples.ts    两张数据表：`LIBRARY_SECTIONS`（12 个 kind 的载荷 / 参数 / 参考）+ `LIBRARY_GROUPS`（左侧导航的分组）；新增 kind 只改这里
  theme.ts      antd 主题：token 色值抄自 `bgm.css` 的 `--bgm-*`（改令牌要同步改它）
components/mainPage/
  shell/         Header / Sidebar / SidebarBrand（顶栏、侧栏与品牌区）
  conversation/  Stage / Turn / Streaming / Hero（会话容器、轮次、流式区、首屏）
                 MessageParts / ConfirmationCard（props 驱动的共享原子行与确认卡）
  composer/      Composer / ComposerSeat / StatsDock / ThinkingPicker（输入区、座位、读数、思考强度）
  overlays/      DialogStage / Toast（浮层的挂载点）
components/motion/
  vendor/          ReactBits 组件源码（每个都是 Xxx.tsx + Xxx.css 成对，改造规范见 §规则 技术栈约束第 5 条）
                   已有：BlurText / TextType / BorderGlow / Magnet / AnimatedContent / CountUp / AnimatedList
                   本轮新增且有落点：SpotlightCard / GlareHover / ShinyText / StarBorder / Counter
                   本轮新增但暂无落点：Stepper / LineSidebar / LogoLoop / PixelTransition
  motionTokens.ts  JS 侧动效令牌，与 styles/tokens.css 的 --app-* 一一对应
styles/           9 个文件：tokens / frame / composer / cards / modal / bgm / content / debug / library（`library.css` 现在只负责文档页的三栏布局 + 内容区排版，骨架已交给 antd，见下）
```

两个 HTML 入口：`index.html`（主界面与调试页，按 hash 分流）与 `library.html`（组件库文档页，不连宿主）。

**命名规则**：外壳与容器类用 `app*` 前缀（`.appFrame`、`.appStage`、`.appComposerCard`…）；会话流里的原子行、过程折叠块、确认卡、思考块、统计底栏、内容条目沿用**共享渲染器的类名**（`.userRow`、`.bubble`、`.processTitle`、`.planCard`、`.contentTable`…），组件与样式两边改一处即可。

### 样式文件的职责与引入顺序

`main.tsx` 是契约；`library.tsx` 用同一顺序、末位换成 `library.css`（并在**最前面**多引一份 `antd/dist/reset.css`）：

```ts
tokens → frame → composer → cards → modal → bgm → content → debug
```

| 文件 | 作用对象 | 令牌体系 |
|---|---|---|
| `tokens.css` | DSH 语义令牌 + **外观层令牌**（`--app-*`：时长、缓动、位移、阴影、表面、圆角） | 定义 `--dsw-*` / `--dsh-*` / `--app-*` |
| `frame.css` | 外壳网格（`.appFrame`）、侧栏、顶栏、提示条、会话容器与轮次、首屏、轮次导航，以及共享渲染器（消息行、过程折叠、思考块、流式区、Markdown） | 消费 `--bgm-*` / `--app-*` |
| `composer.css` | 输入卡、命令候选、发送按钮、思考强度菜单、统计底栏与其浮层 | 消费 `--bgm-*` / `--app-*` |
| `cards.css` | 写入确认卡与按钮基元 | 消费 `--bgm-*` / `--app-*` |
| `modal.css` | 弹窗（遮罩、表面、字段、选项行、状态条、设置行、会话选择列表） | 消费 `--bgm-*` / `--app-*` |
| `bgm.css` | **只有令牌**：定义 `--bgm-*`，并把组件实际用到的 `--dsw-*` 别名重定向过去 | 定义 `--bgm-*`，重定向 `--dsw-*` |
| `content.css` | 内容组件库（12 种内容条目的皮肤） | 消费 `--bgm-*` / `--app-*` |
| `debug.css` | 调试页（左侧输入区、预览条、空态）、组合类 `.appBrandAction` 与 `.debugLink`（顶栏「组件库」链接，只补 `text-decoration: none`），以及 `html[data-debug='on']` 下的侧栏加宽 | 消费 `--bgm-*` / `--app-*` |
| `library.css` | 组件库文档页（三栏粘性布局、顶栏内元素间距、右侧自绘目录、内容区预览卡 / 代码块 / 参数表排版与窄屏适配）；只由 `library.tsx` 引入，排在 `content.css` **之后**，而 `antd/dist/reset.css` 在整条链**最前** | 消费 `--bgm-*` / `--app-*` |

关键顺序约束：`bgm.css` 必须在 `tokens/frame/composer/cards/modal` **之后**（重定向靠"后定义覆盖先定义"生效），`content.css`、`debug.css` 与 `library.css` 排在最后（它们只消费令牌，位置不影响前两条）；`library.tsx` 额外在最前面引 `antd/dist/reset.css`，它只服务这一个入口。

### 现状：已完成 / 已知未做

**已完成**：外壳（框架 / 侧栏 / 顶栏，含「待确认 / 待登录 / 运行中 / 当前」状态展示）；会话区（轮次、流式区光标、轮次导航、首屏 `BlurText`）；输入区（`BorderGlow` + `Magnet` + 命令候选，草稿按会话保存在 `ui.drafts`，切换中/未就绪/断线时禁用）；`Modal` 的进出过渡与 `DialogStage` 的 `AnimatePresence`；`Toast` 进出过渡；思考菜单、统计底栏、确认卡的观感（待授权只在输入区呈现一次，历史模式只呈现结果）；`CountUp`（统计底栏的**精确**读数；胶囊上的缩写读数不滚动）；`AnimatedContent`（内容条目入场，`container="#app-stage-scroll"`）；12 种内容条目的皮肤（`styles/content.css`）；回归用例（[regression/readme.md](docs/agents/regression/readme.md) 的 `L` 组与 `A` 组）；**12 种内容条目已用真实载荷逐个实机渲染核对**（组件库文档页与调试页两条入口）；**5 个 ReactBits 动效落点**接入内容条目（`SpotlightCard` / `GlareHover` / `ShinyText` / `StarBorder` / `Counter`，见 §规则「外观层硬约定」第 6 条）；**组件库文档页 `library.html` 改造成 antd 骨架的文档站形态**（antd 只服务这一个入口：总览页 + 一组件一页 + 搜索过滤 + 详情页五块；12 种条目仍是真实 `ContentItem` 渲染 + 参数表 + 可直接粘进调试页的 event / frame）。

**已知未做 / 未验证**：

1. **5 个 vendor 组件「已 vendor、无落点」，不等于不可用**：`AnimatedList`（只接受 `items: string[]` 并统一渲染 `<p class="item-text">`，承载不了侧栏「标题 + 状态」两栏与结构化内容行；且内部固定 `marginBottom: 1rem`、默认全局拦下 Tab/方向键。侧栏因此按同样的动势自己实现逐项入场，见 `components/mainPage/shell/Sidebar.tsx`）、`Stepper`（`<Step>` children 形状的多步向导，与章节网格语义不符）、`LineSidebar`（`items` 是 `string[]` 且不含 `<a>`，承载不了链接列表）、`LogoLoop`（跑马灯会复制 DOM——链接会重复、键盘方向键滚动会失效）、`PixelTransition`（双面切换要把信息藏进 hover，违反内容组件「信息不藏在 hover 里」的既有原则）。五者都留在 `components/motion/vendor/`，落点清单见 [components/readme.md](docs/agents/components/readme.md) §索引「`motion/vendor/` 的组件与落点」。
2. **12 种内容条目的逐一渲染核对已完成**（本轮）：用真实载荷在组件库文档页与调试页两条入口逐个渲染，12 种全部无降级；示例数据另有脚本按 `validate.ts` 的规则自检。此前「只做静态核对」的记录作废。
3. 浏览器实测覆盖（**均已实机确认**）：首页与会话渲染、轮次导航、侧栏收放、输入区与命令候选、弹窗进出与 Esc 关闭、统计底栏读数、**对话区白底与侧栏灰底**、**`TextType` 用法**（空文本 + `loop={false}` 不启动打字、光标闪烁、光标 7px 宽度生效）、**`BorderGlow` 指针链路**（`--edge-proximity` 与 `--cursor-angle` 随指针变化）、**`Magnet`**（指针靠近位移约 2px，离开回位）、**`CountUp`**（探针实测渐近到目标值）、**`AnimatedContent`**（`container="#app-stage-scroll"` 被正确解析，元素不会被卡成不可见）。
4. **仍未实机验证**：写入确认卡接管——它需要宿主发起 `pending` 确认，即一次真实写入流程，不能在自动化里安全触发。三条环境限制：(a) `BorderGlow` 的 `edge-light` 与 `SpotlightCard` / `GlareHover` 的指针效果都依赖真实 `:hover`，而 CDP 驱动下 `element.matches(':hover')` 恒为 false，自动化只能验证到「CSS 变量 → 透明度公式」这一环；(b) Windows 上同一秒内的多次写入可能被 Vite 的 watcher 漏检（见 §规则 的「技术栈约束」）；(c) 本机浏览器与 harness **都访问不了外网**（`bgm.tv` / `lain.bgm.tv` 全部 fetch 失败），因此链接「能真实打开」只验证到 `href` / `target` / `rel` 契约与域名路径，图片走的是加载失败回落。
5. **文档页的右侧页内目录是自绘的，没有用 antd 的 `Anchor`**（本轮取舍）：`Anchor` 的锚点实现依赖写 `location.hash`，而文档页的「一组件一页」路由也占着 hash（`#/components/<kind>`），两者会互相覆盖。取舍是**保路由**（前进后退、可直连 URL 都已实机确认），目录改用 `PageToc` + `IntersectionObserver` 自己实现——代价是平滑滚动与目标高亮都要自己写。

### 设计历史与外部文档

设计过程中的方案与验收记录不在本知识库内（它们位于被 gitignore 的仓库根 `docs/`）：`modularization-plan.md`（分层方案）、`modularization-record.md`（实施与验收记录）、`model-credential-persistence.md`（模型配置持久化）、`bgm-design/*`（内容组件库与视觉规范）。
