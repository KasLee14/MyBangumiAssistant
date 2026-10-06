# 主页面（`main.tsx` + `page/mainPage/`）

## 简介

`MainPage`（薄壳）与 `Shell`（外壳）的装配细节：构建入口、四个生命周期订阅、从 store 到 props 的接线契约，以及常见改动场景。

**不覆盖**：本层的通用规则（见 [readme.md](readme.md) 的 §规则）、组件内部的实现（见 [../components/main-page.md](../components/main-page.md)）。

上层：[readme.md](readme.md)。相关：[../store/hooks-and-stream.md](../store/hooks-and-stream.md)、[../components/main-page.md](../components/main-page.md)。

### `web/src/main.tsx`（构建入口）

```tsx
/** 顶层分流：调试页与主界面互斥挂载。 */
function Root() {
  return debug ? <DebugPage /> : <MainPage />;
}

createRoot(container).render(
  <StrictMode>
    <Provider store={store}>
      <Root />
    </Provider>
  </StrictMode>,
);
```

要点：

- **无路由库，但 hash 参与分流**。`web/index.html` 直接引用 `/src/main.tsx`，整页只有一个挂载点 `#root`；`Root` 按 `isDebugHash()`（`location.hash === '#debug'`）在 `MainPage` 与 `DebugPage` 之间**互斥挂载**，并监听 `hashchange` 同步。查询参数仍不参与渲染决策。开关在 [../utils/debugMode.md](../utils/debugMode.md)，调试页在 [debug.md](debug.md)。
- **互斥而不是"藏起来"**：主界面挂载会建立 SSE 连接、拉取目录，调试页全程不需要宿主；分开挂载后调试期间没有任何到宿主的请求。`Root` 仍然把 `data-debug="on|off"` 写在 `<html>` 上，但 `styles/debug.css` **已不再用它圈定作用域**（调试页的输入列宽度改由页面自己声明的 `.appFrame[data-mode='debug']` 决定）；这个属性目前只是 `<html>` 上的一个状态标记。
- `Provider` 在这一层注入（注入的是**主 store**）。调试页在自己的 `DebugPage` 里再套一层 `Provider`，用的是它自建的独立 store。
- `StrictMode` 保留：开发模式下会双调用 effect，用于暴露清理不彻底的问题（SSE 订阅的清理函数是 `EventSource.close()`）。
- **双击侧栏品牌可进调试页**：落点在 `Sidebar` 渲染的品牌行上（`.appBrandAction.appSidebarBrand`，`data-debug-toggle="true"`，双击或回车/空格触发 `utils/debugMode.ts` 的 `enterDebug()`）；调试页顶栏的同一个落点（`page/debug/index.tsx` 的 `AppTopBar` 品牌槽）则调 `exitDebug()` 返回主界面。主界面**没有顶栏**（C01 删除），品牌与其余应用级入口都在侧栏（见 [../components/main-page.md](../components/main-page.md) 的 §索引「一览」）。

样式引入顺序同样是这一层的契约，见 §规则「样式引入顺序在 `main.tsx` 固定」。

### `Shell` 的 JSX 骨架

```
div.appFrame[data-sidebar=collapsed|expanded]     两列网格：grid-template-areas: 'side main'
├─ <Sidebar />                       唯一外壳：品牌行(双击进调试页 + 8px 连接状态点 + 折叠钮)
│                                    + 实心主色「开启新对话」+ 分组列表(置顶/今天/昨天/7 天内/更早)
│                                    + 底部用户行(头像 + 用户名 + 齿轮设置入口，单击直达设置)
├─ main.appConversation              对话区（grid-area: main）
│  └─ <Stage … />                    会话容器（props 驱动）
│     · composer={<ComposerSeat />}  输入区槽位：只给组件，不给分支
│     · hero={heroPhase ? <Hero onPick={…} onOpenSettings={…} /> : undefined}
│     · pendingEcho={pendingEcho === null ? undefined : <UserBubble … />}
├─ <CollapseBubbles />               收起态左上角的两个气泡（绝对定位在 .appFrame 上，不参与 grid）
├─ <DialogStage />                   浮层：登录输入 / 设置 / 会话弹窗
└─ <Toast />                         一次性提示（4 秒后由动作清空）
```

**两列网格的要点**：`.appFrame` 只有 `side` / `main` 两格（顶栏随 C01 删除，网格里**没有** `top` 行），落位靠组合选择器（`.appFrame > .appSidebar { grid-area: side }`、`.appFrame > .appConversation { grid-area: main }`，见 `styles/frame.css`），所以外壳换结构时改的是网格与类名，不是组件的父子关系。收起是**抽屉式**：列宽 264 → 0（`--app-sidebar-full` → 0），侧栏内容锁宽 248px（`--app-sidebar-content`）后整体左移 264px；展开态与收起态各有一套入口（侧栏里的折叠钮 / `CollapseBubbles` 的两个气泡），永远不会同时出现。

`data-sidebar` 是样式钩子（`frame.css` 用它切换 `--app-sidebar-width` 两档轨道宽度），不是语义属性；调试页另用 `data-mode='debug'` 声明自己的输入列宽度（`styles/debug.css`），这与 `data-sidebar` 是两个互不相干的钩子。

## 使用说明

- **改 `main.tsx`、订阅或槽位接线之前先读 §规则**：样式引入顺序、`composer` 槽位只给组件、接管卡片只换 `.appSeat` 内部内容都在那里；违反会让部分颜色不生效，或让 textarea 丢掉焦点与 IME 组合态。
- **只想查「某个字段从哪来」「某个浮层挂在哪」「某件事改哪里」**：直接查 §索引 的「`Shell` 从 store 取出的数据」「常见改动场景」，以及 §简介 的「`Shell` 的 JSX 骨架」，不必通读 §规则。
- **加或改全局副作用（订阅、快捷键、resize）**：先读 §索引 的「四个订阅，一行一个」，再读 [../store/hooks-and-stream.md](../store/hooks-and-stream.md)；四个订阅必须留在 `index.tsx` 这条硬约束在 [readme.md](readme.md) 的 §规则。
- **动输入区接管**：先读 §规则「`composer` 槽位只给组件，不写分支」，再接 [../components/main-page.md](../components/main-page.md) 的座位分支表。

## 规则

### `composer` 槽位只给组件，不写分支

```tsx
composer={<ComposerSeat />}
```

「此刻输入位置放什么」（默认输入卡 / 写入确认卡 / 未来其它接管形态）由 `ComposerSeat` 内部的分支表判定。页面这里**不做任何分支**，新增接管形态不需要回来改页面——这是"高度模块化处用表不用分支"这条规则的落地示例，细节见 [../components/main-page.md](../components/main-page.md)。

**违反后果**：新增接管形态要回改页面，「页面不写分支逻辑」被破坏。

### 接管卡片替换 `.appSeat` 内部内容，容器本身不换

接管卡片替换的是 `.appSeat` **内部**的内容，容器本身留在原地。原因见 `ComposerSeat` 的注释——容器被卸载重建会让 textarea 丢失焦点与 IME 组合态。

`ComposerSeat` 在内部读取 `stream.sessionId`，默认输入卡是 `<Composer key={sessionId} />`：会话切换时重建输入卡，清掉上一个会话的提交与补全状态，而 `ui.drafts` 中的各会话草稿保留。Esc 在 `ui.switching` 期间不应答也不停止任务。

**违反后果**：textarea 丢失焦点与 IME 组合态。

### 样式引入顺序在 `main.tsx` 固定

**样式引入顺序在这里固定**（`tokens → common → frame → composer → cards → modal → bgm → content → debug`）：`common.css` 放跨三个入口共享的表面原语（顶栏骨架、品牌组合类 `.appBrandAction`、玻璃、导航行、空态、微标签、胶囊、错峰入场），紧跟 `tokens.css` 且必须排在 `frame.css` **之前**，好让外壳规则能覆盖共享骨架；`bgm.css` **只有 `--bgm-*` 的定义**——上游 `--dsw-*` / `--dsh-*` 与「把 DSH 语义别名重定向到 `--bgm-*`」那套机制已在第七轮整体删除，所以它不再有"必须排在谁之后"的约束；`content.css` 只服务内容组件库；`debug.css` 只服务调试页、排在最后。详见 [../styles/readme.md](../styles/readme.md)。

**违反后果**：顺序错了会出现"部分颜色不生效"这类难查的问题。

## 索引

### 章节 → 场景

| 章节 | 什么时候读 |
|---|---|
| §简介「`web/src/main.tsx`（构建入口）」 | 改 Provider、样式引入顺序、挂载方式时 |
| §简介「`Shell` 的 JSX 骨架」 | 改外壳结构、加浮层挂载点时 |
| §规则「`composer` 槽位只给组件，不写分支」 | 动输入区接管逻辑之前 |
| §规则「接管卡片替换 `.appSeat` 内部内容，容器本身不换」 | 改座位结构、遇到 textarea 丢焦点时 |
| §规则「样式引入顺序在 `main.tsx` 固定」 | 加样式文件、调换引入顺序时 |
| §索引「四个订阅，一行一个」 | **加或改全局副作用（订阅、快捷键、resize）时必读** |
| §索引「`Shell` 从 store 取出的数据」 | 给会话容器加字段、调整 props 接线时 |
| §索引「常见改动场景」 | 不知道从哪下手时的入口表 |

### 四个订阅，一行一个（`page/mainPage/index.tsx`）

| hook | 作用 | 备注 |
|---|---|---|
| `useStreamSubscription()` | 建立宿主事件流（`EventSource`），把帧 dispatch 进 store | 只在页面挂载期间存在；卸载即关闭 |
| `useCatalogSync()` | 首屏、会话切换与标题变化后重取目录（模型/会话/提供方/命令） | 失败不提示：打开设置或会话弹窗时还会再取一次 |
| `useResponsiveCollapse()` | `innerWidth <= 1024` 时强制收起侧栏，否则强制展开 | 是**强制**语义：手动展开后下一次 resize 仍会重置 |
| `useEscapeShortcut()` | Esc：有待确认写入→拒绝本次写入；否则本轮进行中→停止本轮 | **顺序不能反**：待确认时 `busy` 也为真。弹窗与思考菜单各自在捕获阶段拦截并 `stopPropagation` |

它们都定义在 `store/`（`hooks.ts`、`stream.ts`），页面只负责调用。

### `Shell` 从 store 取出的数据（`page/mainPage/Shell.tsx`）

纯展示字段（`items`、`liveContent`、`liveThinking`、`busy`、`status`、`cancelling`、`startedAt`、`sessionId`）、交互字段（`pendingEcho`、`reveal`、`collapsed`）与派生布尔 `heroPhase`（`selectHeroPhase`）。动作取 `actions.confirm` / `actions.reject`。

**为什么这些字段在 `Shell` 读、而不是让 `Stage` 自己读**：`Stage` 与 `Turn` / `Streaming` / `MessageParts` / `content/**` 是 props 驱动的展示组件，脱离 store 也能渲染（这是它们可被单独复用与测试的前提）。`Shell` 是唯一"知道 store 存在"的那一层。

### 常见改动场景

| 想做的事 | 改哪里 |
|---|---|
| 加一个新的全局副作用（例如新的快捷键） | 在 `store/hooks.ts` 加 hook，在 `MainPage` 里加一行调用 |
| 会话区多一个数据字段 | 先确认它在协议里（`bangumi/src/web/protocol.ts`），再加进 store 切片与 selector，最后接到 props |
| 加一个浮层（弹窗） | `components/dialog/` 加组件 → `components/mainPage/overlays/DialogStage.tsx` 挂载 → 开合状态放 `store/reducers/ui.ts` |
| 调整外壳布局 | 改 `styles/frame.css` 的 `.appFrame` 两列网格与 `Shell` 的类名结构（两者是契约关系）；顶栏不在主界面（C01） |
| 想进调试页看某个 event / frame 的效果 | **双击侧栏品牌行**（`Sidebar.tsx` 里 `data-debug-toggle="true"` 的元素 → `enterDebug()`），或在地址栏加 `#debug`；细节见 [debug.md](debug.md) |
