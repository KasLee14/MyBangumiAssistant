# web 交互终端：开发知识库

## 0. 首要规则（先读这一节）

这两条决定这套知识库能不能被信任，**优先级高于本文其它一切内容**。

### 每次开发后都要更新对应的知识库文档

只要改动落到了某一层（页面 / 组件 / 工具 / 状态 / 样式），就要在**同一次开发里**更新那一层的文档：

- 改了某层的约定、边界或步骤 → 改对应 `docs/agents/<层>/` 的文档；
- 新增或删除了文件 → 更新所属层 `readme.md` 的「怎么读」场景表与文件清单；
- 新增了一条约束 → 按"分层归置"加进所属层 `readme.md` 的「必须遵守的规则」；跨层的加到本节与 §使用说明 的规则表。

**违反后果**：下一次对话按过期文档改错地方。知识库越用越不可信——这比没有知识库更糟。

### 知识库不是事实源，必须与源码交叉验证

知识库的定位只有两条：**协助快速找到相关代码逻辑**、**保持跨对话的开发风格统一**。它**不是**代码的事实源（source of truth）——文档会滞后、会写错、会与源码不一致。

因此使用任何一篇文档时：

1. **文档只用来定位**：按它给出的路径、符号、章节去找到对应代码；
2. **定位之后必须读源码交叉验证**：结论、参数、行为、边界一律以**当前源码**为准，不以文档描述为准；
3. **发现不符时向用户暴露，不要自行裁决**：停下来把差异报给用户确认——文档说什么、代码是什么、影响范围多大——由用户决定是改文档还是改代码；
   - **禁止**默默按文档去改代码；
   - **禁止**默默按代码改掉文档后当作无事发生；
4. 用户确认后的处理结果要落回文档（与上一节的「每次开发后更新文档」衔接）。

**违反后果**：把过期描述当事实依据，会直接产出错误改动；更糟的是错误会被"文档就是这么写的"掩盖，事后极难发现。

## 使用说明

### 这份文档是什么

`web/` 下前端（浏览器侧）的**唯一入口**：技术栈与运行命令、五维模块化设计风格、跨层强制规则，以及"要做什么 → 去哪一层"的索引。

**不覆盖**：宿主（`bangumi/src`）、Pi 上游（`pi/`），以及各层的实现细节——那些在 `docs/agents/` 下按维度展开。

### 怎么读（要做什么 → 去哪一层）

| 你要做的事 | 进哪一层 | 入口 |
|---|---|---|
| **读下面任何一篇文档之前** | 本文 | **§0 首要规则（必读）** |
| 改页面装配、加生命周期订阅 | 页面层 | [page/readme.md](docs/agents/page/readme.md) |
| 加或改组件（外壳 / 弹窗 / 内容渲染） | 组件层 | [components/readme.md](docs/agents/components/readme.md) |
| 接宿主接口、改命令表、改条目投影 | 工具层 | [utils/readme.md](docs/agents/utils/readme.md) |
| 加状态、加动作、改帧合并、加 selector | 状态层 | [store/readme.md](docs/agents/store/readme.md) |
| 改样式、令牌、品牌外观 | 样式层 | [styles/readme.md](docs/agents/styles/readme.md) |
| 改动完成后回归验证 | 回归用例 | [regression/readme.md](docs/agents/regression/readme.md) |
| 查技术栈、环境、命令 | 本文 | §1 技术栈 |
| 不确定该放哪、跨层边界不清 | 本文 | §2 模块化设计风格 |
| 改外观语言、动效、层次或首屏 | 本文 | §3 外观层 |

各层 `readme.md` 是该层的入口，再往下按"文件 → 场景"精确到篇。

### 必须遵守的规则

跨层强制约束。**这不是参考建议**——违反会让跨对话的实现风格漂移，或直接引入 bug。

1. **内容组件不读 store**：`components/content/**`、`components/mainPage/conversation/**`、`content/markdown.tsx` 一律 props 驱动。违反后果：这些组件无法脱离会话外壳复用与测试，数据来源出现第二个真相。详见 [components/readme.md](docs/agents/components/readme.md)。
2. **改全局状态只能落在 `store/`**：组件里的 `useState` 只承载组件私有状态（草稿、菜单开合、滚动位置）。违反后果：状态更新散落各处，流式帧与界面不同步。详见 [store/readme.md](docs/agents/store/readme.md)。
3. **样式不写裸值、不越界声明**：颜色走令牌；每个样式文件只负责它那一类元素，同一元素同一属性只声明一次。违反后果：改一处不生效，出问题无法定位来源。详见 [styles/readme.md](docs/agents/styles/readme.md)。
4. **高度模块化处用「表」，不用「分支」**：新增一种形态只应改一张表 + 一份类型。违反后果：每加一种形态都要回来改多处且容易漏。范例：`components/content/registry.tsx`、`components/mainPage/composer/ComposerSeat.tsx`。
5. **§0 的两条本节不重复**：① 每次开发后更新对应文档；② 知识库不是事实源，须与源码交叉验证、发现不符时报给用户确认。

## 1. 技术栈

| 项 | 选型 | 说明 |
|---|---|---|
| UI 框架 | React 19.2 | 只用函数组件 + hooks，无类组件、无状态库以外的全局对象 |
| 语言 | TypeScript 5.9 | `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`verbatimModuleSyntax`、`noUnusedLocals/Parameters` |
| 构建 | Vite 8.3 | 配置在 `bangumi/vite.config.ts`，`root` 指向 `../web`，产物落 `bangumi/dist/web` |
| 状态 | redux 5.0 + react-redux 9.3 | **裸 redux**：无 RTK、无中间件；异步动作是闭包 `dispatch` 的普通函数 |
| 样式 | 手写 CSS + 设计令牌 | 无 CSS 框架、无 CSS-in-JS、无 CSS Modules；共 7 个文件在 `web/src/styles/`（见 §3） |
| 动效 | motion 14 + gsap 3.15 | ReactBits 组件的原生依赖；两处登记见本表末尾 |
| 路由 | 无 | 单页应用；查询参数不参与分流 |
| 测试 | Node 内置 `node:test` | `bangumi/test/web-*.test.mjs` 自动回归；浏览器用例见 `docs/agents/regression/` |

依赖**只装在** `bangumi/node_modules`：`web/` 没有自己的 `package.json`，而 Node/Vite/tsc 都从 importer 逐级向上找 `node_modules`、不会拐进兄弟目录。因此新增任何第三方包，都要在 `bangumi/vite.config.ts` 的 `resolve.alias` 与 `web/tsconfig.json` 的 `paths` 各注册一次——现有 `react`、`react-dom`、`redux`、`react-redux`、`motion`、`motion/react`、`gsap`、`gsap/ScrollTrigger` 就是这么接的。

**子路径别名必须排在裸包名之前**（`'motion/react'` 在 `motion` 前、`'gsap/ScrollTrigger'` 在 `gsap` 前），否则子路径会先命中裸包名规则、被截成一个不存在的目录。

### 运行与验证命令

在 `bangumi/` 下执行：

| 命令 | 用途 |
|---|---|
| `npm run dev:web` | 本地调试：一条命令起宿主 + Vite dev server（**HMR**，`/api` 反代给宿主）。改 `web/src` 立即热更新 |
| `npm run build:web` | 只重建前端产物到 `bangumi/dist/web` |
| `npm run typecheck` | 宿主与前端一起类型检查（`tsc -p tsconfig.json && tsc -p ../web/tsconfig.json`） |
| `npm run build` | `build:web` + 宿主 tsc + 复制策略 Skills |
| `npm run test:web` | Web 状态、并行会话、HTTP/SSE 与账户队列的离线自动测试（先 build） |
| `npm run web` | 起宿主 Web 终端（用构建产物，无 HMR）；`--no-open` 只打印带一次性令牌的地址 |

`dev:web` 由 `bangumi/dev-web.mjs` 实现：自动挑端口（宿主默认 8787、dev server 默认 5173，被占用则顺延）、捕获宿主启动时打印的一次性令牌并注入 Vite，因此浏览器侧仍是同源相对路径 `./api/...`，**不需要 CORS**。相关环境变量：`BGM_WEB_PORT`、`BGM_DEV_PORT`、`BGM_WEB_TOKEN`。

**改动后至少跑 `npm run typecheck`**；动到样式、DOM 结构或状态流时，按 `docs/agents/regression/` 的用例过一遍主链路。

**Windows 上的一个坑**：同一秒内对多个文件做写入可能被 Vite 的 watcher 漏检，表现为 dev server 仍提供旧模块（界面看起来「改动没生效」，或直接报 `does not provide an export named ...`）。此时重启 `npm run dev:web` 即可，不要按「代码写错了」去查。

## 2. 模块化设计风格

### 五个维度与依赖方向

```
page/         页面：装配与生命周期，不含业务逻辑
  │ 从 store 取数据 → 以 props 传入组件
  ▼
components/   组件：三类（mainPage / dialog / content），边界判定见 components/readme.md
  │ 调用纯函数与宿主接口
  ▼
utils/        工具：按功能类别一个文件，纯函数 + 宿主接口封装
store/        状态：三切片 + 动作 + 选择器 + hooks（与 page/components 双向：读用 selector，写用 actions）
styles/       样式：7 个文件，令牌驱动，按作用对象分文件（见 §3）
```

### 与宿主的分界

浏览器只做两件事：提交命令、展示宿主下发的文本。授权判定、工具执行、会话与模型都在宿主 `bangumi/src/web/` 里。

- **命令（HTTP）**：封装在 `utils/api.ts`，全部是同源相对路径 `./api/...`。
- **状态（SSE）**：`GET ./api/events` 逐帧下发；帧类型是 `ServerEvent`，合并语义见 `store/reducers.md`。
- **类型**：跨端类型一律从 `bangumi/src/web/protocol.ts` 取，**前端不复制一份**。

## 3. 外观层：分层与约定

> **这一节随实现推进更新。**未完成 / 未验证项集中列在 §3.5，改外观之前先读那一段，
> 避免把「还没做」当成「已经这样设计」。

### 3.1 文件与命名

```
page/mainPage/
  index.tsx    薄壳：四个生命周期订阅 + 装配 Shell（订阅必须留在这里，见文件注释）
  Shell.tsx    外壳装配：取 store 数据 → 按槽位交给组件
components/mainPage/
  shell/         Header / Sidebar（顶栏与侧栏）
  conversation/  Stage / Turn / Streaming / Hero（会话容器、轮次、流式区、首屏）
                 MessageParts / ConfirmationCard（props 驱动的共享原子行与确认卡）
  composer/      Composer / ComposerSeat / StatsDock / ThinkingPicker（输入区、座位、读数、思考强度）
  overlays/      DialogStage / Toast（浮层的挂载点）
components/motion/
  vendor/          ReactBits 组件源码（BlurText / TextType / BorderGlow / Magnet / AnimatedContent / CountUp / AnimatedList）
  motionTokens.ts  JS 侧动效令牌，与 styles/tokens.css 的 --app-* 一一对应
styles/           7 个文件：tokens / frame / composer / cards / modal / bgm / content（见 3.3）
```

**命名规则**：外壳与容器类用 `app*` 前缀（`.appFrame`、`.appStage`、`.appComposerCard`…）；
会话流里的原子行、过程折叠块、确认卡、思考块、统计底栏、内容条目沿用**共享渲染器的类名**
（`.userRow`、`.bubble`、`.processTitle`、`.planCard`、`.contentTable`…），组件与样式两边改一处即可。

### 3.2 四条硬约定

1. **同一元素同一属性只有一个来源**：样式按作用对象分文件（外壳 → `frame.css`，
   输入区 → `composer.css`，卡片与按钮 → `cards.css`，弹窗 → `modal.css`，内容条目 →
   `content.css`），令牌集中在 `tokens.css`（`--dsw-*` / `--dsh-*`）与 `bgm.css`（`--bgm-*`
   与语义别名重定向）。**不要在别处再覆写一遍**——这层没有"覆盖层"概念，重复声明会被当成 bug。
2. **动效令牌只有一处定义、两处消费**：CSS 用 `styles/tokens.css` 的
   `--app-dur-*` / `--app-ease-*` / `--app-shift-*`，JS 用 `components/motion/motionTokens.ts`。
   改一处必须同时改另一处。
3. **只动 `transform` / `opacity`（少量 `filter`）**：不做 layout 动画。会话区的
   `content-visibility: auto` 屏外优化与流式期间的 `memo` 都依赖稳定结构，
   motion 的 layout 动画会强制重排并让它们失效。
4. **不做常驻循环动画**：没有呼吸、脉冲、无限扫光。`BorderGlow` 传 `animated={false}`；
   唯一例外是流式光标（它表达「还在写」，且只在流式期间存在）。

### 3.3 视觉语言与动效分工

配色全部走 Bangumi 浅色令牌（`--bgm-*`），**不引入新色值**。层次语言是：**对话区与侧栏同为
白面**，两者靠 1px hairline 分开；卡片不靠底色差、而靠「描边 + 两级阴影」浮起；输入卡
用比白面略沉一档的 `--bgm-surface-alt`，否则整张卡只剩一圈描边可辨。三级阴影
（`--app-shadow-raised` / `--app-shadow-card` / `--app-shadow-panel`）分别给内嵌元素、
浮起卡片与浮层。

动效分工：

- **流程过渡（主体）**：会话切换、流式光标、确认卡接管、弹窗进出、
  侧栏折叠、Toast 进出、连接状态、聚焦与 hover——都由组件自己的样式与 motion 实现。
  （会话流的轮次与普通行目前**没有**入场动画：逐行动画要付出 JS 开销与每节点观察器，
  只有内容条目这一层挂了 `AnimatedContent`。）
- **ReactBits 组件（点状使用，每个只有一个落点）**：`BlurText` 首屏标题、
  `TextType` 流式光标（传空文本 + `loop={false}`，**不接管真实流式文本**）、
  `BorderGlow` 输入卡边缘光、`Magnet` 发送按钮（幅度压到约 6px）、
  `AnimatedContent` 内容条目入场、`CountUp` 统计读数、`AnimatedList` 见 §3.5。

### 3.4 样式文件的职责与引入顺序

`main.tsx` 的引入顺序是契约：

```ts
tokens → frame → composer → cards → modal → bgm → content
```

| 文件 | 作用对象 | 令牌体系 |
|---|---|---|
| `tokens.css` | DSH 语义令牌 + **外观层令牌**（`--app-*`：时长、缓动、位移、阴影、表面、圆角） | 定义 `--dsw-*` / `--dsh-*` / `--app-*` |
| `frame.css` | 外壳网格（`.appFrame`）、侧栏、顶栏、提示条、会话容器与轮次、首屏、轮次导航，以及共享渲染器（消息行、过程折叠、思考块、流式区、Markdown） | 消费 `--bgm-*` / `--app-*` |
| `composer.css` | 输入卡、命令候选、发送按钮、思考强度菜单、统计底栏与其浮层 | 消费 `--bgm-*` / `--app-*` |
| `cards.css` | 写入确认卡与按钮基元 | 消费 `--bgm-*` / `--app-*` |
| `modal.css` | 弹窗（遮罩、表面、字段、选项行、状态条、设置行、会话选择列表） | 消费 `--bgm-*` / `--app-*` |
| `bgm.css` | **只有令牌**：定义 `--bgm-*`，并把组件实际用到的 `--dsw-*` 别名重定向过去 | 定义 `--bgm-*`，重定向 `--dsw-*` |
| `content.css` | 内容组件库（12 种内容条目的皮肤） | 只用 `--bgm-*` |

关键顺序约束：`bgm.css` 必须在 `tokens/frame/composer/cards/modal` **之后**（重定向靠
"后定义覆盖先定义"生效），`content.css` 最后（它只消费 `--bgm-*`）。

### 3.5 现状：已完成 / 已知未做

**已完成**：外壳（框架 / 侧栏 / 顶栏）；会话区（轮次、流式区光标、轮次导航、首屏
`BlurText`）；输入区（`BorderGlow` + `Magnet` + 命令候选）；`Modal` 的进出过渡与
`DialogStage` 的 `AnimatePresence`；`Toast` 进出过渡；思考菜单、统计底栏、确认卡的观感；
`CountUp`（统计底栏的**精确**读数；胶囊上的缩写读数不滚动）；`AnimatedContent`
（内容条目入场，`container="#app-stage-scroll"`）；12 种内容条目的皮肤
（`styles/content.css`）；回归用例（[regression/shell-and-layout.md](docs/agents/regression/shell-and-layout.md)
的 `L1`–`L10` 与 `A1`–`A4`）。

**已知未做 / 未验证**：

1. **`AnimatedList` 未采用**：它只接受 `items: string[]` 并统一渲染
   `<p class="item-text">`，无法承载侧栏「标题 + 相对时间」两栏；且内部固定
   `marginBottom: 1rem`、默认全局拦下 Tab/方向键。侧栏因此按同样的动势自己实现
   逐项入场（`components/mainPage/shell/Sidebar.tsx`）。该组件仍留在
   `components/motion/vendor/`（未被任何代码引用）。
2. 12 种内容条目的皮肤只做了**静态**核对：没有逐个 kind 造出真实载荷跑一遍，
   回退防线是「只改皮肤属性、不碰布局」这条写法约束。
3. 浏览器实测覆盖（**均已实机确认**）：首页与会话渲染、轮次导航、侧栏收放、
   输入区与命令候选、弹窗进出与 Esc 关闭、统计底栏读数、**对话区白底**、
   **`TextType` 用法**（空文本 + `loop={false}` 不启动打字、光标在 0.33↔0.90 间闪烁、
   光标 7px 宽度生效）、**`BorderGlow` 指针链路**（`--edge-proximity` 与 `--cursor-angle`
   随指针变化）、**`Magnet`**（指针靠近位移约 2px，离开回位）、**`CountUp`**
   （探针实测渐近到目标值）、**`AnimatedContent`**（探针放进真实滚动容器：
   `visibility: hidden` → `visible`，滚动到位后 opacity 0→1、`translateY` 16px→0；
   证明 `container="#app-stage-scroll"` 被正确解析）。
4. **仍未实机验证**：写入确认卡接管——它需要宿主发起 `pending` 确认，即一次真实写入
   流程，不能在自动化里安全触发；12 种内容条目也尚未逐个用真实载荷跑过；
   首屏 hero 的当前观感未在改造后单独复验（其规则原样搬运，未改值）。
   两条环境限制：(a) `BorderGlow` 的 `edge-light` 显隐还依赖真实 `:hover`，而 CDP 驱动下
   `element.matches(':hover')` 恒为 false，自动化只能验证到「CSS 变量 → 透明度公式」
   这一环；(b) Windows 上同一秒内的多次写入可能被 Vite 的 watcher 漏检（见 §1 末尾）。

## 4. 设计历史与外部文档

设计规范中的视觉与交互两份文档**已迁入本知识库**：[ui-style.md](docs/agents/desgin/ui-style.md)（bgm.tv r771 实测的视觉规范）、[interaction-style.md](docs/agents/desgin/interaction-style.md)（交互语汇与动效刻度），实测截图在 `docs/agents/desgin/assets/`。

设计过程中的方案与验收记录不在本知识库内（它们位于未被 git 跟踪的仓库根 `docs/`）：`modularization-plan.md`（分层方案）、`modularization-record.md`（实施与验收记录）、`model-credential-persistence.md`（模型配置持久化）；内容组件库的生成物也仍在根 `docs/bgm-design/`（`component-library.html`、`component-library.template.html`、`build-component-library.py`）。
