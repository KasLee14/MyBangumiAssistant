# 选择器与 store 实例（`store/selectors.ts` + `store/index.ts`）

## 使用说明

### 这份文档是什么

selector 清单与新增规则、store 实例与 `preloadedState`、类型导出，以及"稳定引用"这条硬要求。

上层：[readme.md](readme.md)。相关：[reducers.md](reducers.md)、[hooks-and-stream.md](hooks-and-stream.md)。

### 怎么读（章节 → 场景）

| 章节 | 什么时候读 |
|---|---|
| §选择器清单 | 找现成 selector、判断要不要新增时 |
| §两个派生 selector | 改首屏判定（`selectHeroPhase`）或设置行提供方回落逻辑时 |
| §稳定引用要求 | **写 selector 前必读**（三条反例与对应做法） |
| §store 实例 | 改初值、`preloadedState`、类型导出时 |
| §新增一个 selector | 加 selector 时逐步照做 |

### 必须遵守的规则

本层通用规则见 [readme.md](readme.md) 的「必须遵守的规则」。本篇专属：

1. **selector 不得新建对象或数组** —— 违反后果：每帧判定"变了"，整棵树重渲染（见本层「selector 不得新建引用」）。
2. **`selectHeroPhase` 的条件不得只看 `items.length`** —— 违反后果：有通知或流式输出时被首屏遮住。
3. **`preloadedState` 只覆盖 `collapsed`** —— 违反后果：把浏览器环境读取散进 reducer，破坏纯函数。

## 选择器清单（`selectors.ts`）

| 分组 | 导出 |
|---|---|
| 会话流 | `selectStream`、`selectItems`、`selectLiveText`、`selectLiveThinking`、`selectBusy`、`selectPending`、`selectPendingEcho` |
| 目录 | `selectModels`、`selectSessions`、`selectProviders`、`selectCommands`、`selectCanPersistCredentials` |
| 界面 | `selectSettingsOpen`、`selectSettingsPane`、`selectSessionsOpen`、`selectCollapsed`、`selectReveal`、`selectNotice`、`selectProblem` |
| 派生 | `selectHeroPhase`、`selectCredentialProvider` |

直接用 `state.xxx` 的字段访问在组件里也见得多（`useAppSelector(state => state.stream.busy)`），两者都合法：**被多处复用或需要派生计算时，才值得抽一个具名 selector。**

### 两个派生 selector

```ts
// 首屏：完全空且空闲时才显示引导
export const selectHeroPhase = (state) =>
  state.stream.items.length === 0 && !state.stream.busy
  && !state.stream.liveText && !state.stream.liveThinking
  && state.stream.pendingEcho === null;

// 设置行显示的提供方：没有显式选择时回落到目录里的当前提供方
export const selectCredentialProvider = (state) =>
  state.ui.credentialProvider
  ?? state.catalog.providers.find(p => p.current)?.id
  ?? state.catalog.providers[0]?.id
  ?? '';
```

`selectHeroPhase` 的条件不能只看 `items.length`：只要有通知、命令回显或正在流式输出，就必须进入会话视图，否则首屏会把宿主提示挡住（这是历史 bug 的修复点）。

### 稳定引用要求（重要）

`useSelector` 用 `Object.is` 比较返回值。**selector 里不要新建对象或数组**：

| 反例 | 后果 | 正确做法 |
|---|---|---|
| `state => state.catalog.commands.map(...)` | 每帧返回新数组 → 每帧重渲染 | 在 reducer 里算好存进 state（`commands` 就是先例） |
| `state => ({ a: state.a, b: state.b })` | 同上（`shallowEqual` 也只缓解一层） | 拆成两个 selector，或改成直接返回已有引用 |
| `state => state.stream.items.filter(...)` | 同上 | 把过滤放进 `useMemo`（依赖 `items`）或投影函数（如 `projectTurns`） |

## store 实例（`index.ts`）

```ts
export const store = createStore(rootReducer, {
  ...INITIAL_ROOT_STATE,
  ui: { ...INITIAL_UI_STATE, collapsed: initialCollapsed() },
});

export type AppStore = typeof store;
export type AppDispatch = typeof store.dispatch;
```

- **裸 `createStore`**（redux 5）：不引入 RTK，也不挂中间件；
- **`preloadedState` 只覆盖 `collapsed`**：初值按窗口宽度算（`innerWidth <= 1024`），首帧就是正确形态，避免"先展开再收起"的闪动。这是唯一一处"在创建 store 时读浏览器环境"的地方；
- 类型从实例反推（`typeof store`），保证 `AppDispatch` 与 `AppAction` 精确对应——若手写 `Store<RootState>`，`dispatch` 的参数类型会退化成任意 action。

### 转出的类型与值

| 导出 | 用途 |
|---|---|
| `RootState` | selector 与 `useAppSelector` 的泛型 |
| `AppStore` / `AppDispatch` | `hooks.ts` 与 `operations.ts` |
| `PendingEcho` | `actions.ts` 的 `pendingEchoSet` 参数 |
| `SettingsPane` | `actions.ts` / `operations.ts` / `SettingsDialog` |

`RootState`、`AppAction`、`INITIAL_ROOT_STATE` 定义在 `reducers/index.ts`，`store/index.ts` 只做**转出**（保持"组件只从 `store/` 顶层拿类型"的习惯）。

## 新增一个 selector

1. 先判断是否真的需要：只在一个组件用、且只是字段访问 → 直接 `state.xxx`，不要加；
2. 派生计算要**纯**且**不新建引用**（返回已有引用或原始值）；
3. 命名 `selectXxx`，与既有分组注释的排布保持一致；
4. 在本文件的表格登记。
