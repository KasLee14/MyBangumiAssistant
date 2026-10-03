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

各层 `readme.md` 是该层的入口，再往下按"文件 → 场景"精确到篇。

### 必须遵守的规则

跨层强制约束。**这不是参考建议**——违反会让跨对话的实现风格漂移，或直接引入 bug。

1. **内容组件不读 store**：`components/content/**`、`components/mainPage/conversation/**`、`content/markdown.tsx` 一律 props 驱动。违反后果：这些组件无法脱离会话外壳复用与测试，数据来源出现第二个真相。详见 [components/readme.md](docs/agents/components/readme.md)。
2. **改全局状态只能落在 `store/`**：组件里的 `useState` 只承载组件私有状态（草稿、菜单开合、滚动位置）。违反后果：状态更新散落各处，流式帧与界面不同步。详见 [store/readme.md](docs/agents/store/readme.md)。
3. **样式不写裸值、选择器不越界**：颜色走令牌；每个样式文件只用自己的命名前缀。违反后果：品牌覆盖层失效、样式互相污染。详见 [styles/readme.md](docs/agents/styles/readme.md)。
4. **高度模块化处用「表」，不用「分支」**：新增一种形态只应改一张表 + 一份类型。违反后果：每加一种形态都要回来改多处且容易漏。范例：`components/content/registry.tsx`、`components/mainPage/composer/ComposerSlot.tsx`。
5. **§0 的两条本节不重复**：① 每次开发后更新对应文档；② 知识库不是事实源，须与源码交叉验证、发现不符时报给用户确认。

## 1. 技术栈

| 项 | 选型 | 说明 |
|---|---|---|
| UI 框架 | React 19.2 | 只用函数组件 + hooks，无类组件、无状态库以外的全局对象 |
| 语言 | TypeScript 5.9 | `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`verbatimModuleSyntax`、`noUnusedLocals/Parameters` |
| 构建 | Vite 8.3 | 配置在 `bangumi/vite.config.ts`，`root` 指向 `../web`，产物落 `bangumi/dist/web` |
| 状态 | redux 5.0 + react-redux 9.3 | **裸 redux**：无 RTK、无中间件；异步动作是闭包 `dispatch` 的普通函数 |
| 样式 | 手写 CSS + 设计令牌 | 无 CSS 框架、无 CSS-in-JS、无 CSS Modules；v1 共 8 个文件在 `web/src/styles/`，v2 另有一套在 `web/src/styles/v2/`（见 §3） |
| 动效 | motion 14 + gsap 3.15 | **只有 v2 用它**。ReactBits 组件的原生依赖；两处登记见 §1 末尾。v1 不含任何动效库调用 |
| 路由 | 无 | 单页应用；查询参数不参与分流 |
| 测试 | 无测试运行器 | 回归靠 `docs/agents/regression/` 的文档化用例 + `npm run typecheck` |

依赖**只装在** `bangumi/node_modules`：`web/` 没有自己的 `package.json`，而 Node/Vite/tsc 都从 importer 逐级向上找 `node_modules`、不会拐进兄弟目录。因此新增任何第三方包，都要在 `bangumi/vite.config.ts` 的 `resolve.alias` 与 `web/tsconfig.json` 的 `paths` 各注册一次——现有 `react`、`react-dom`、`redux`、`react-redux`、`motion`、`motion/react`、`gsap`、`gsap/ScrollTrigger` 就是这么接的。

**子路径别名必须排在裸包名之前**（`'motion/react'` 在 `motion` 前、`'gsap/ScrollTrigger'` 在 `gsap` 前），否则子路径会先命中裸包名规则、被截成一个不存在的目录。

### 运行与验证命令

在 `bangumi/` 下执行：

| 命令 | 用途 |
|---|---|
| `npm run dev:web` | 本地调试：一条命令起宿主 + Vite dev server（**HMR**，`/api` 反代给宿主）。改 `web/src` 立即热更新 |
| `npm run build:web` | 只重建前端产物到 `bangumi/dist/web` |
| `npm run typecheck` | 宿主与前端一起类型检查（`tsc -p tsconfig.json && tsc -p ../web/tsconfig.json`） |
| `npm run build` | `build:web` + 宿主 tsc |
| `npm run web` | 起宿主 Web 终端（用构建产物，无 HMR）；`--no-open` 只打印带一次性令牌的地址 |

`dev:web` 由 `bangumi/dev-web.mjs` 实现：自动挑端口（宿主默认 8787、dev server 默认 5173，被占用则顺延）、捕获宿主启动时打印的一次性令牌并注入 Vite，因此浏览器侧仍是同源相对路径 `./api/...`，**不需要 CORS**。相关环境变量：`BGM_WEB_PORT`、`BGM_DEV_PORT`、`BGM_WEB_TOKEN`。

**改动后至少跑 `npm run typecheck`**；动到样式、DOM 结构或状态流时，按 `docs/agents/regression/` 的用例过一遍主链路。

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
styles/       样式：v1 8 个文件 + v2 6 个文件，令牌驱动，前缀与作用域隔离（见 §3）
```

### 与宿主的分界

浏览器只做两件事：提交命令、展示宿主下发的文本。授权判定、工具执行、会话与模型都在宿主 `bangumi/src/web/` 里。

- **命令（HTTP）**：封装在 `utils/api.ts`，全部是同源相对路径 `./api/...`。
- **状态（SSE）**：`GET ./api/events` 逐帧下发；帧类型是 `ServerEvent`，合并语义见 `store/reducers.md`。
- **类型**：跨端类型一律从 `bangumi/src/web/protocol.ts` 取，**前端不复制一份**。

## 3. v2（新版）外观：分层与约定

> **这一节随实现推进更新。**未完成 / 未验证项集中列在 §3.4，改 v2 之前先读那一段，
> 避免把「还没做」当成「已经这样设计」。
>
> **术语**：两版在界面上分别叫**旧版**与**新版**（顶栏切换按钮的文案就是这两个词），
> 代码与文档里沿用 `v1` / `v2`。**默认是新版**——只有用户显式选过旧版才回落 v1，
> 读取偏好失败（隐私模式、值被改坏）时同样给新版，判据见 `reducers/ui.ts` 的
> `readStoredVariant()`。

### 3.1 两版怎么分叉

同一个界面有两套实现，靠 `store.ui.variant`（`'v1' | 'v2'`，持久化在 `localStorage`
的 `bangumi.uiVariant`）在页面层二选一：

```
page/mainPage/
  index.tsx    薄壳：四个生命周期订阅 + 按 variant 选树（订阅必须留在这里，见文件注释）
  ShellV1.tsx  v1 装配（既有外观，JSX 与数据读取保持原样）
  ShellV2.tsx  v2 装配（新版，默认）
components/v2/ v2 的全部外壳组件（shell / conversation / composer / overlays）
components/motion/
  vendor/          ReactBits 组件源码（BlurText / TextType / BorderGlow / Magnet / …）
  motionTokens.ts  JS 侧动效令牌，与 styles/v2/tokens.css 一一对应
components/mainPage/header/UiVariantToggle.tsx  两版共用的切换控件
styles/v2/      v2 的 6 个样式文件（tokens / shell / conversation / composer / overlays / content）
```

**共用的是数据，不是外观**：两版共用同一份 store、同一套订阅、同一批 props 驱动的
渲染器（`Markdown`、`content/**`、`ConfirmationCard`、`MessageParts` 的原子行、
`StatsDock`、`ThinkingPicker`、`Modal`）。因此「功能一致」由数据来源保证，而不是靠
两份代码手工对齐。

### 3.2 五条硬约定

1. **v2 的样式必须落在作用域里**：自有组件用 `v2*` 类名；覆写共享组件的既有类时，
   选择器必须带 `[data-ui='v2']` 祖先前缀。作用域属性写在 `<html>` 上（`main.tsx`
   首帧前预置、`ShellV2` 的 effect 维护），因为统计浮层与弹窗是 portal 到 `body` 的，
   挂在子树里会让它们落在作用域外。v1 的样式文件里没有任何 `[data-ui]` 选择器。
2. **动效令牌只有一处定义、两处消费**：CSS 用 `styles/v2/tokens.css` 的
   `--v2-dur-*` / `--v2-ease-*` / `--v2-shift-*`，JS 用 `components/motion/motionTokens.ts`。
   改一处必须同时改另一处。
3. **只动 `transform` / `opacity`（少量 `filter`）**：不做 layout 动画。会话区的
   `content-visibility: auto` 屏外优化与流式期间的 `memo` 都依赖稳定结构，
   motion 的 layout 动画会强制重排并让它们失效。
4. **不做常驻循环动画**：没有呼吸、脉冲、无限扫光。`BorderGlow` 传 `animated={false}`；
   唯一例外是流式光标（它表达「还在写」，且只在流式期间存在）。
5. **v1 不接受除「切换按钮」以外的改动**：`components/mainPage/header/Header.tsx` 里
   多了一个 `UiVariantToggle`，那是「能切回旧版」这个需求本身要求的入口；v1 其余组件
   与 8 个样式文件不改。

### 3.3 视觉语言与动效分工

两版都用 Bangumi 浅色令牌，v2 **不引入任何新色值**。层次语言是：**对话区与侧栏同为
白面**，两者靠 1px hairline 分开；卡片不靠底色差、而靠「描边 + 两级阴影」浮起；输入卡
用比白面略沉一档的 `--bgm-surface-alt`，否则整张卡只剩一圈描边可辨。三级阴影
（`--v2-shadow-raised` / `--v2-shadow-card` / `--v2-shadow-panel`）分别给内嵌元素、
浮起卡片与浮层。

动效分工：

- **流程过渡（主体）**：会话切换、消息与轮次入场、流式光标、确认卡接管、弹窗进出、
  侧栏折叠、Toast 进出、连接状态、聚焦与 hover——都由 v2 自己的组件与样式实现。
- **ReactBits 组件（点状使用，每个只有一个落点）**：`BlurText` 首屏标题、
  `TextType` 流式光标（传空文本 + `loop={false}`，**不接管真实流式文本**）、
  `BorderGlow` 输入卡边缘光、`Magnet` 发送按钮（幅度压到约 6px）、
  `AnimatedContent` 内容条目入场、`CountUp` 统计读数、`AnimatedList` 见 §3.4。

### 3.4 现状：已完成 / 已知未做

**已完成**：切换按钮与持久化；v2 外壳（框架 / 侧栏 / 顶栏）；v2 会话区（轮次、行入场、
流式区光标、轮次导航、首屏 `BlurText`）；v2 输入区（`BorderGlow` + `Magnet` + 命令候选）；
`Modal` 的 v2 动效分支与 `DialogStageV2` 的进出过渡；`ToastV2`；共享部件（思考菜单、
统计底栏、确认卡）在 v2 下的样式覆写；`CountUp`（统计底栏的**精确**读数——共享
`StatsDock` 新增可选 `countUp`，缺省仍渲染静态文本，v1 不受影响）；`AnimatedContent`
（内容条目入场，`container="#v2-stage-scroll"`）；12 种内容条目的 v2 观感
（`styles/v2/content.css`）；两版回归用例
（[regression/ui-variants.md](docs/agents/regression/ui-variants.md) 的 `V1`–`V10`）。

**已知未做 / 未验证**：

1. **`AnimatedList` 未采用**：它只接受 `items: string[]` 并统一渲染
   `<p class="item-text">`，无法承载侧栏「标题 + 相对时间」两栏；且内部固定
   `marginBottom: 1rem`、默认全局拦下 Tab/方向键。v2 侧栏因此按同样的动势自己实现
   逐项入场（`SidebarV2`）。
2. 12 种内容条目的 v2 观感只做了**静态**核对：没有逐个 kind 造出真实载荷跑一遍，
   回退防线是「只改皮肤属性、不碰布局」这条写法约束（见 `styles/v2/content.css` 的注释）；
3. 浏览器实测覆盖（**均已实机确认**）：v1 首页、v1↔v2 切换、刷新持久化、v2 首页、
   v2 宽/窄屏、v2 历史会话渲染与轮次导航、**对话区白底**（`.v2Conversation` 的
   `backgroundColor` = `rgb(255, 255, 255)`）、**v2 弹窗进出过渡**（opacity
   0→0.25→0.009→0 且 surface 缩放到 0.98，700ms 才卸载）、**v2 Toast 进出过渡**
   （28ms 位移淡入、4s 停留、约 200ms 退出）、**v1 弹窗零变化**（原生 `DIV`/`SECTION`、
   无内联 motion 样式、关闭后 4ms 内即卸载）、**`TextType` 用法**（空文本 +
   `loop={false}` 不启动打字、`contentText` 为空、光标在 0.33↔0.90 间闪烁、
   `v2StreamingCursor` 的 7px 宽度生效）、**`BorderGlow` 指针链路**
   （`--edge-proximity` 0→99.6、`--cursor-angle` 随位置在 0°↔270° 变化）、
   **`Magnet`**（指针靠近位移 1.97px，离开回位）、**`CountUp`**（在 `contextTrigger`
   里挂载；探针实测 0 → 15,538 → 40,730 → 65,426 → 89,363 → 109,406 → 120,084
   渐近 123,456）、**`AnimatedContent`**（探针放进真实滚动容器：内联 `visibility:
   hidden` → `visible`，滚动到位后 opacity 0→1、`translateY` 16px→0；证明
   `container="#v2-stage-scroll"` 被正确解析，元素不会被卡成永不显示）。
4. **仍未实机验证**：写入确认卡接管——它需要宿主发起 `pending` 确认，即一次真实写入
   流程，不能在自动化里安全触发；12 种内容条目也尚未逐个用真实载荷跑过。
   两条环境限制：(a) `BorderGlow` 的 `edge-light` 显隐还依赖真实 `:hover`，而 CDP 驱动下
   `element.matches(':hover')` 恒为 false，自动化只能验证到「CSS 变量 → 透明度公式」
   这一环；(b) **Windows 上同一秒内的多次写入可能被 Vite 的 watcher 漏检**——表现为
   dev server 仍在提供旧模块（界面看起来「改动没生效」，实测 `StatsDock.tsx` 更新了而
   `ComposerV2.tsx` 没有）。此时重启 `npm run dev:web` 即可，不要按「代码写错了」去查。

## 4. 设计历史与外部文档

设计过程中的方案与验收记录不在本知识库内（它们位于被 gitignore 的仓库根 `docs/`）：`modularization-plan.md`（分层方案）、`modularization-record.md`（实施与验收记录）、`model-credential-persistence.md`（模型配置持久化）、`bgm-design/*`（内容组件库与视觉规范）。
