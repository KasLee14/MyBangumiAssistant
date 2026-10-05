# 主页面（`main.tsx` + `page/mainPage/`）

## 简介

`MainPage`（薄壳）与 `Shell`（外壳）的装配细节：构建入口、四个生命周期订阅、从 store 到 props 的接线契约，以及常见改动场景。

**不覆盖**：本层的通用规则（见 [readme.md](readme.md) 的 §规则）、组件内部的实现（见 [../components/main-page.md](../components/main-page.md)）。

上层：[readme.md](readme.md)。相关：[../store/hooks-and-stream.md](../store/hooks-and-stream.md)、[../components/main-page.md](../components/main-page.md)。

### `web/src/main.tsx`（构建入口）

```tsx
createRoot(container).render(
  <StrictMode>
    <Provider store={store}>
      <MainPage />
    </Provider>
  </StrictMode>,
);
```

要点：

- **无路由、无分流**。`web/index.html` 直接引用 `/src/main.tsx`，整页只有一个挂载点 `#root`；查询参数不参与渲染决策。
- `Provider` 在这一层注入，页面与组件因此都能用 `useAppSelector` / `useActions`。
- `StrictMode` 保留：开发模式下会双调用 effect，用于暴露清理不彻底的问题（SSE 订阅的清理函数是 `EventSource.close()`）。

样式引入顺序同样是这一层的契约，见 §规则「样式引入顺序在 `main.tsx` 固定」。

### `Shell` 的 JSX 骨架

```
div.appFrame[data-sidebar=collapsed|expanded]
├─ <Sidebar />                        侧栏：会话列表 + 折叠 + 新建
├─ main.appConversation
│  ├─ <Header />                      顶栏：标题 + 当前栏 + 连接状态 + 设置入口
│  └─ <Stage … />                     会话容器（props 驱动）
│     · composer={<ComposerSeat />}   输入区槽位：只给组件，不给分支
│     · hero={heroPhase ? <Hero /> : undefined}
│     · pendingEcho={pendingEcho === null ? undefined : <UserBubble … />}
├─ <DialogStage />                    浮层：登录输入 / 设置 / 会话弹窗
└─ <Toast />                          一次性提示（4 秒后由动作清空）
```

`data-sidebar` 是样式钩子（`frame.css` 用它切换两列轨道宽度），不是语义属性。

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

**样式引入顺序在这里固定**（`tokens → frame → composer → cards → modal → bgm → content`）：`bgm.css` 只定义 `--bgm-*` 并把组件实际用到的 `--dsw-*` 别名重定向过去，必须排在它重定向的那些文件之后（重定向靠「后定义覆盖先定义」生效）；`content.css` 只服务内容组件库。详见 [../styles/readme.md](../styles/readme.md)。

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

纯展示字段（`items`、`liveText`、`liveThinking`、`busy`、`status`、`cancelling`、`startedAt`、`sessionId`）、交互字段（`pendingEcho`、`reveal`、`collapsed`）与派生布尔 `heroPhase`（`selectHeroPhase`）。动作取 `actions.confirm` / `actions.reject`。

**为什么这些字段在 `Shell` 读、而不是让 `Stage` 自己读**：`Stage` 与 `Turn` / `Streaming` / `MessageParts` / `content/**` 是 props 驱动的展示组件，脱离 store 也能渲染（这是它们可被单独复用与测试的前提）。`Shell` 是唯一"知道 store 存在"的那一层。

### 常见改动场景

| 想做的事 | 改哪里 |
|---|---|
| 加一个新的全局副作用（例如新的快捷键） | 在 `store/hooks.ts` 加 hook，在 `MainPage` 里加一行调用 |
| 会话区多一个数据字段 | 先确认它在协议里（`bangumi/src/web/protocol.ts`），再加进 store 切片与 selector，最后接到 props |
| 加一个浮层（弹窗） | `components/dialog/` 加组件 → `components/mainPage/overlays/DialogStage.tsx` 挂载 → 开合状态放 `store/reducers/ui.ts` |
| 调整外壳布局 | 改 `styles/frame.css` 与 `Shell` 的类名结构（两者是契约关系） |
