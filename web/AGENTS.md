# web 交互终端：开发知识库

> 这里只覆盖 Chrome 侧前端（`web/`）。宿主（`bangumi/src`）与 Pi 上游（`pi/`）不在范围内，只在「与宿主的分界」处提及。
> 渐进披露：本文件只讲**技术栈、模块化设计风格、文档索引**三件事；细节在 `docs/agents/` 下按维度分文件夹，每个文件夹的 `readme.md` 是那一层的入口。

## 1. 技术栈

| 项 | 选型 | 说明 |
|---|---|---|
| UI 框架 | React 19.2 | 只用函数组件 + hooks，无类组件、无状态库以外的全局对象 |
| 语言 | TypeScript 5.9 | `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`verbatimModuleSyntax`、`noUnusedLocals/Parameters` |
| 构建 | Vite 8.3 | 配置在 `bangumi/vite.config.ts`，`root` 指向 `../web`，产物落 `bangumi/dist/web` |
| 状态 | redux 5.0 + react-redux 9.3 | **裸 redux**：无 RTK、无中间件；异步动作是闭包 `dispatch` 的普通函数 |
| 样式 | 手写 CSS + 设计令牌 | 无 CSS 框架、无 CSS-in-JS、无 CSS Modules；共 8 个文件在 `web/src/styles/` |
| 路由 | 无 | 单页应用；查询参数不参与分流 |
| 测试 | 无测试运行器 | 回归靠 `docs/agents/regression/` 的文档化用例 + `npm run typecheck` |

依赖**只装在** `bangumi/node_modules`：`web/` 没有自己的 `package.json`，而 Node/Vite/tsc 都从 importer 逐级向上找 `node_modules`、不会拐进兄弟目录。因此新增任何第三方包，都要在 `bangumi/vite.config.ts` 的 `resolve.alias` 与 `web/tsconfig.json` 的 `paths` 各注册一次——现有 `react`、`react-dom`、`redux`、`react-redux` 就是这么接的。

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
styles/       样式：8 个文件，令牌驱动，前缀隔离
```

### 五条硬规则

1. **内容组件不读 store**：`components/content/**`、`components/mainPage/conversation/**`、`components/content/markdown.tsx` 一律 props 驱动，数据由页面从 store 取后传入。这样它们才能脱离会话外壳被单独渲染与测试。
2. **改全局状态只能落在 `store/`**：组件里的 `useState` 只允许承载组件私有、高频或临时的状态（输入草稿、菜单开合、弹窗内输入框、滚动位置）。跨组件共享的数据、以及来自宿主的数据，一律进 store 并用 selector 读。
3. **样式不写裸值**：颜色走令牌（`--dsw-*` 语义令牌、`--bgm-*` 品牌令牌），不写死十六进制；每个样式文件的选择器不得越出本文件的命名前缀（详见 `styles/readme.md`）。
4. **高度模块化处用「表」，不用「分支」**：新增一种形态应当只改一张表 + 一份类型，而不是在多个组件里加 `if`。两个范例：
   - `components/content/registry.tsx`：`kind → 渲染器`注册表，配 `satisfies` 穷尽性检查 + 协议覆盖率断言；
   - `components/mainPage/composer/ComposerSlot.tsx`：输入区「座位」分支表，按优先级取第一个命中项。
5. **文档与代码同步**：改动触及某维度的约定时同步更新对应 `docs/agents/*/` 文档；新增文件要登记进所属层的 `readme.md`。

### 与宿主的分界

浏览器只做两件事：提交命令、展示宿主下发的文本。授权判定、工具执行、会话与模型都在宿主 `bangumi/src/web/` 里。

- **命令（HTTP）**：封装在 `utils/api.ts`，全部是同源相对路径 `./api/...`。
- **状态（SSE）**：`GET ./api/events` 逐帧下发；帧类型是 `ServerEvent`，合并语义见 `store/reducers.md`。
- **类型**：跨端类型一律从 `bangumi/src/web/protocol.ts` 取，**前端不复制一份**。

## 3. 文档索引

| 维度 | 入口 | 子文档 |
|---|---|---|
| 页面 | [page/readme.md](docs/agents/page/readme.md) | `main-page.md` |
| 组件 | [components/readme.md](docs/agents/components/readme.md) | `main-page.md`、`dialog.md`、`content.md` |
| 工具 | [utils/readme.md](docs/agents/utils/readme.md) | `api.md`、`commands.md`、`turns.md`、`credentialLabel.md` |
| 状态 | [store/readme.md](docs/agents/store/readme.md) | `reducers.md`、`actions-and-operations.md`、`hooks-and-stream.md`、`selectors-and-instance.md` |
| 样式 | [styles/readme.md](docs/agents/styles/readme.md) | `tokens.md`、`frame.md`、`components.md`、`content-and-brand.md` |
| 回归用例 | [regression/readme.md](docs/agents/regression/readme.md) | `session-flow.md`、`settings-and-credentials.md`、`commands-and-shortcuts.md`、`shell-and-layout.md` |

设计历史（不在本知识库内，位于被 gitignore 的仓库根 `docs/`）：`modularization-plan.md`（分层方案）、`modularization-record.md`（实施与验收记录）、`model-credential-persistence.md`（模型配置持久化）、`bgm-design/*`（组件库与视觉规范）。
