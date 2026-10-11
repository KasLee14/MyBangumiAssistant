# web 前端：知识库入口

## 简介

`web/` 是这个项目的**浏览器侧前端**：Bangumi AI 助手的 Web 终端界面。React 19 + 裸 redux + 手写 CSS，无 UI 组件库、无 CSS 框架。

三条边界事实：

- **没有自己的 `package.json`**：依赖装在 `bangumi/node_modules`，类型路径由 `web/tsconfig.json` 的 `paths` 显式指过去；构建配置在 `bangumi/vite.config.ts`（`root` 指向 `web/`，产物落在 `bangumi/dist/web`）。
- **只做两件事**：提交命令（`POST ./api/...`）与展示宿主下发的文本（`GET ./api/events` 的 SSE）。授权判定、工具执行、会话与模型都在宿主 `bangumi/src/web/`。
- **唯一 HTML 入口**是 `web/index.html`，它只引用 `web/src/main.tsx`。

本文档与 `web/docs/agents/` 下的路径一律**仓库根相对**，以 `web/` 或 `bangumi/` 开头。

## 技术选型

| 面 | 选型 | 说明 |
|---|---|---|
| 框架 | React 19.2（react-dom 19.2） | 函数组件 + hooks；挂载点是 `web/index.html` 的 `#root` |
| 路由 | react-router 7.18 | `createBrowserRouter`（History 模式）；路由表在 `web/src/router/routes.tsx` |
| 全局状态 | redux 5.0.1 + react-redux 9.3 | **裸 redux：不引入 RTK，也不挂中间件**；异步动作是 `web/src/store/operations.ts` 里闭包 `dispatch` 的普通函数 |
| 动效 | motion 14（主）+ gsap 3.15 | motion 用于界面过渡与弹层；gsap 只出现在 `web/src/components/motion/vendor/` 的少数组件（`AnimatedContent` 用到 `ScrollTrigger`） |
| 样式 | 手写 CSS + CSS 变量令牌 | 无 Tailwind / CSS-in-JS / CSS Modules；类名与令牌按前缀分区，清单见 [docs/agents/styles.md](docs/agents/styles.md) 规则 5 |
| 类型 | TypeScript 5.9 | `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `verbatimModuleSyntax` + `noEmit`；前端类型检查由 `web/tsconfig.json` 承担（在 `bangumi` 侧执行） |
| 构建 | Vite 8.3 + `@vitejs/plugin-react` | 配置文件不在 `web/` 下，在 `bangumi/vite.config.ts` |

## 目录结构

```
web/
├─ index.html                 唯一 HTML 入口：预涂底色 #fdf1f2 防首帧闪白，引 src/main.tsx
├─ tsconfig.json              前端类型检查配置（noEmit；include 含宿主的 protocol.ts）
└─ src/
   ├─ main.tsx                装配入口：样式引入链 + createRoot + <Provider> + <AppRouter>
   ├─ router/                 路由：唯一装配点、路由表、未命中页
   ├─ page/                   页面：每页一个目录，入口只做装配
   │  ├─ mainPage/            主界面（会话流 + 外壳 + 输入区 + 弹窗）
   │  ├─ debug/               调试页（手输 event / frame，用真实渲染链路预览）
   │  └─ library/             内容组件库文档页
   ├─ components/             跨页面共享组件
   │  ├─ content/             12 种内容块渲染器 + 注册表 + 接收侧校验
   │  ├─ conversation/        会话正文与过程区渲染
   │  └─ motion/              动效封装（vendor/ 下是第三方动效组件）
   ├─ store/                  全局状态：reducers/ + actions / operations / hooks / selectors / stream / pacing
   ├─ utils/                  跨页面通用工具函数（以纯函数为主）
   ├─ styles/                 通用样式与令牌层：base/ 七族令牌 + common.css + content.css
   ├─ constants/              跨页面常量（叶子层）：paths / tools / motion
   └─ types/                  跨模块类型（叶子层）：protocol 中转 + turns / content / process / commands / api / tools
```

每个页面目录内部同构，按需建目录、不建空目录：

```
page/<页面>/
├─ index.tsx        页面入口：只做装配
├─ components/      该页可视组件（按功能模块再分子目录）
├─ constants/       该页专有常量
├─ styles/          该页样式（CSS 文件）
├─ types/           该页专有类型
└─ utils/           该页逻辑
```

## 目录构成的特点

**1. 八个部分，顶层本身就是通用池。** 分类轴固定为：路由、页面、组件、全局状态、样式、工具函数、类型、常量，加上入口文件。顶层**不套一层 `common/`**——页面专有的内容已经全部收进 `web/src/page/<页面>/`，`common` 这个标签在顶层没有区分对象。

**2. 归位判据是「谁在消费它」，不是文件名。**

- 被**两个及以上页面**消费 → 顶层对应目录；
- 只被**一个页面**消费 → `web/src/page/<该页>/` 对应目录；
- 与页面无关（只被路由或全局状态消费，`store` 算全局消费者）→ 顶层对应目录。

新增「共享」组件前先确认它真的被两个以上页面使用，否则应留在页面内。

**3. 单向引用链不可逆。**

```
路由 → 页面 → 组件 → 工具
```

- **类型与常量是叶子层**：谁都可以引用，它们自己不引用业务模块；
- **全局状态各层都可以引用**；
- **禁止**：组件引路由、工具引页面或组件、页面之间互引、顶层通用目录引 `web/src/page/**`；
- 遇到逆向引用，优先改成引用叶子层。本仓库就是这么做的：路径字面量从 `web/src/router/` 提到 `web/src/constants/paths.ts`，该文件因此是**零 import 的叶子模块**，`router → page → components → router` 的环随之消失。

**4. 派生与互锁定义就地保留。** 由实现反推的类型（`typeof` / `ReturnType`）、与类型互锁的常量、模块私有的 Props 不搬进叶子层——搬过去会造成循环依赖，或让一份清单变成两处维护。本仓库例子：`ContentKind`（`web/src/types/content.ts`）与 `web/src/components/content/registry.tsx` 的渲染表是同一张表，「12 个键逐键齐全」的断言留在注册表里。

**5. 页面入口只做装配。** 页面专有的可视组件、逻辑、常量、类型、样式分别进该页的 `components/` `constants/` `styles/` `types/` `utils/`；页面内部不再设 `common/`；同一页的功能模块之间可以互相引用，**页面之间不行**——页面只引顶层与本页。

**6. 令牌与形态分层。** `web/src/styles/base/` 按**族**分目录：`color/` `typography/` `motion/` `space/` `elevation/` `shape/` `interaction/`，只写 `:root` 变量与全局伪元素规则；页面形态样式在 `web/src/styles/common.css`、`web/src/styles/content.css` 与各页 `styles/` 下。**引入顺序构成契约**，见 `web/src/main.tsx`：

```
base 七族令牌 → common.css → 主界面四件（frame / composer / cards / modal）→ content.css → debug.css → library.css
```

令牌是全局的，不属于任何页面：新增令牌进 `web/src/styles/base/` 的对应族，新增页面皮肤进该页 `styles/`。

## 知识库用法

知识库入口是 [web/docs/agents/index.md](docs/agents/index.md)：在那里判断问题属于**哪一层 / 哪一页**，进该层文档的**索引**节定位到具体文件，然后**打开源码交叉验证**——知识库只负责把你送到文件，结论一律以源码为准。读法与写作格式见该篇的「功能介绍」与「写作规范」。

组织原则：**父级文档只描述当前层级的内容，子级内容通过对子级的索引引导**，不重复展开。所以 `index.md` 只讲顶层有哪些层、每层归哪篇文档、页面入口；本文档只讲项目边界、技术选型、目录结构与归位判据，各层的文件清单与规则归各层文档。
