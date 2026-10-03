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
| 样式 | 手写 CSS + 设计令牌 | 无 CSS 框架、无 CSS-in-JS、无 CSS Modules；共 8 个文件在 `web/src/styles/` |
| 路由 | 无 | 单页应用；查询参数不参与分流 |
| 测试 | Node 内置 `node:test` | `bangumi/test/web-*.test.mjs` 自动回归；浏览器用例见 `docs/agents/regression/` |

依赖**只装在** `bangumi/node_modules`：`web/` 没有自己的 `package.json`，而 Node/Vite/tsc 都从 importer 逐级向上找 `node_modules`、不会拐进兄弟目录。因此新增任何第三方包，都要在 `bangumi/vite.config.ts` 的 `resolve.alias` 与 `web/tsconfig.json` 的 `paths` 各注册一次——现有 `react`、`react-dom`、`redux`、`react-redux` 就是这么接的。

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
styles/       样式：8 个文件，令牌驱动，前缀隔离
```

### 与宿主的分界

浏览器只做两件事：提交命令、展示宿主下发的文本。授权判定、工具执行、会话与模型都在宿主 `bangumi/src/web/` 里。

- **命令（HTTP）**：封装在 `utils/api.ts`，全部是同源相对路径 `./api/...`。
- **状态（SSE）**：`GET ./api/events` 逐帧下发；帧类型是 `ServerEvent`，合并语义见 `store/reducers.md`。
- **类型**：跨端类型一律从 `bangumi/src/web/protocol.ts` 取，**前端不复制一份**。

## 3. 设计历史与外部文档

设计过程中的方案与验收记录不在本知识库内（它们位于被 gitignore 的仓库根 `docs/`）：`modularization-plan.md`（分层方案）、`modularization-record.md`（实施与验收记录）、`model-credential-persistence.md`（模型配置持久化）、`bgm-design/*`（内容组件库与视觉规范）。
