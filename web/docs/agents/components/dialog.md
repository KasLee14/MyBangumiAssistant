# 弹窗（`components/dialog/`）

## 使用说明

### 这份文档是什么

弹窗层的规格：基础件 `Modal` 的行为、九个弹窗的对照表、开合状态与两级关闭语义、表单约定与新增步骤。

上层：[readme.md](readme.md)。这些组件**直接消费 store**（规则 B）；开合状态住在 `store/reducers/ui.ts`。

### 怎么读（章节 → 场景）

| 章节 | 什么时候读 |
|---|---|
| §基础件：`Modal.tsx` | 新增弹窗、改 Esc 或遮罩关闭行为时 |
| §九个弹窗 | 查某个弹窗的数据来源与成功后的行为 |
| §弹窗状态与层级 | **动开合、`pane`、互斥或关闭语义时必读** |
| §表单约定 | 写弹窗表单、忙态与错误显示时 |
| §新增一个弹窗的步骤 | 新增弹窗时逐步照做 |

### 必须遵守的规则

本层通用规则见 [readme.md](readme.md) 的「必须遵守的规则」。本篇专属：

1. **互斥由 reducer 保证，组件不重复判断** —— 违反后果：两处逻辑分叉。
2. **两级关闭不得混用**：`closePane` 回设置主面板，`closeSettings` 关整个弹窗 —— 违反后果：Esc 行为错乱。
3. **弹窗内的失败写本地 `error`，不吞成全局提示** —— 违反后果：用户看不出是哪个字段错了。
4. **表单请求走 `useActions()`，不直接 `import utils/api`** —— 违反后果：绕过提示与状态更新（见 [../store/readme.md](../store/readme.md) 的「改全局状态只能经 store/ 的动作」）。

## 基础件：`Modal.tsx`

所有弹窗都套它。它只做四件事：

| 行为 | 实现 |
|---|---|
| 居中 + 遮罩 | `.modalOverlay` + `.modalSurface`（样式在 `styles/modal.css`） |
| Esc 关闭 | `window` 上**捕获阶段**监听，`stopPropagation()` 后关闭——避免顺带触发会话层的「停止本轮 / 拒绝确认」 |
| 点遮罩关闭 | `onMouseDown` 且 `event.target === event.currentTarget`（拖拽选词不会误关） |
| 结构 | `header`（可选 `eyebrow` + 标题 + 关闭按钮）+ `body`（children）+ `footer`（可选） |

props：`title`、`eyebrow?`、`wide?`、`onClose`、`children`、`footer?`。`eyebrow` 与 `title` 相同时不渲染，避免「设置 / 设置」这种重复。

遮罩与表面用 motion 渲染并声明 `exit`，presence 由 `overlays/DialogStage.tsx` 的 `AnimatePresence` 提供——因此「关闭」也是先播完过渡再卸载。Esc 与点遮罩都走同一个 `onClose`，两种关闭语义由调用方决定。

## 九个弹窗

| 文件 | 唤起方式 | 读什么 | 成功后做什么 |
|---|---|---|---|
| `SettingsDialog.tsx` | 顶栏设置按钮、`/model` 命令 | `ui.settingsPane`、catalog 切片、流切片中的 proxy/login 字段 | 关闭设置（`closeSettings`） |
| `ModelDialog.tsx` | 设置 → 模型配置行「编辑」 | `catalog.providers`、`catalog.canPersistCredentials`、`ui.credentialProvider` | `applyCredential` / `clearCredential` → 重取目录 → 回设置主面板 |
| `ModelPickerDialog.tsx` | 设置 → 模型选择行「编辑」 | `catalog.models` | `pickModel` → 回设置主面板 |
| `ProxyDialog.tsx` | 设置 → 代理端口行「编辑」 | `stream.proxyMode` / `proxyAddress` | `applyProxy` → 回设置主面板 |
| `BangumiLoginDialog.tsx` | 设置 → 登录状态行「登录」 | `stream.loginBusy` / `loginStatus` | `startBangumiLogin` → 回设置主面板；关闭时 `cancelBangumiLogin` |
| `BangumiLogoutDialog.tsx` | 设置 → 登录状态行「退出登录」 | `stream.loginUsername` | `bangumiLogout` → 回设置主面板 |
| `SessionDialog.tsx` | `/sessions` 命令、`openSessions()` | `catalog.sessions` | `pickSession`（先关弹窗再切换） |
| `LoginDialog.tsx` | 宿主下发 `stream.loginPrompt` 时由 `DialogStage` 自动挂载 | props 里的 `prompt.id`（用于换请求时清空输入） | `answerLoginInput`（提交或取消） |
| `Modal.tsx` | —（基础件） | — | — |

`SessionDialog` 每行右侧与侧栏常驻列表共用 [`../utils/relativeTime.ts`](../utils/relativeTime.md) 的「最后对话时间」（`刚刚` / `N分钟` / `N小时` / `N天` / `N个月` / `N年`），当前会话那行显示 `当前`。两处口径必须一致——改这里等于同时改侧栏。

## 弹窗状态与层级

两个布尔 + 一个 pane 决定当前显示什么：

```ts
ui.settingsOpen: boolean          // 设置弹窗是否打开
ui.settingsPane: SettingsPane | null   // 'credential' | 'model' | 'proxy' | 'login' | 'logout' | null
ui.sessionsOpen: boolean          // 会话弹窗是否打开
```

- **互斥由 reducer 保证**：`ui/settingsOpened` 会同时把 `sessionsOpen` 置 false，`ui/sessionsOpened` 反之。组件里不要再写互斥逻辑。
- **两级关闭语义**（容易写错）：
  - `closePane()` → `settingsPane = null`：从子弹窗**回到设置主面板**（设置弹窗仍打开）；
  - `closeSettings()` → `settingsOpen = false`：关闭整个设置弹窗；
  - `closeSessions()` → 关闭会话弹窗。
- `settingsPane` 住在 store 而不是 `SettingsDialog` 的 `useState`，是为了让 `/model` 命令能从外部直达"模型选择"行。
- 「模型选择」行在没有可用模型时置灰，且 `SettingsDialog` 会在 `pane === 'model' && models.length === 0` 时退回主面板。

## 表单约定

每个弹窗自己持有**输入与请求状态**（`useState`：字段值、`busy`、`error`），因为它们是组件私有的临时状态：

| 约定 | 说明 |
|---|---|
| 成功 | 动作函数内部已 dispatch 提示（`ui/notice`）→ 组件只管 `closePane()` / `closeSettings()` |
| 失败 | 动作函数**抛出**（`applyCredential`、`pickModel`、`applyProxy`、`startBangumiLogin`、`bangumiLogout`），组件 `catch` 后写进本地 `error` 并在弹窗内显示；不要吞成全局提示，否则用户看不到是哪个字段错了 |
| 例外 | `pickThinkingLevel` 成功与失败都只发全局提示（它是常驻菜单，没有弹窗承载错误文案） |
| 忙碌 | 请求期间禁用提交按钮（`busy`），避免重复提交 |
| 输入清空 | 失败的登录只清密码、保留邮箱，方便重试 |

## 新增一个弹窗的步骤

1. 在 `components/dialog/` 建 `XxxDialog.tsx`，套 `Modal`；
2. 数据用 `useAppSelector` 取，动作用 `useActions()` 取（**不要**在组件里直接 `import utils/api`，那会绕过提示与状态更新）；
3. 若它是设置里的某一行：在 `store/reducers/ui.ts` 的 `SettingsPane` 里加成员、在 `SettingsDialog` 加一行与分支、在 `store/operations.ts` 加 `switchPane` 的调用点；
4. 若它是独立浮层（如会话弹窗）：在 `ui` 切片加开合字段 + 动作，并在 `overlays/DialogStage.tsx` 挂载（`AnimatePresence` 里的每个弹窗都要给 `key`）；
5. 在本文件与 [readme.md](readme.md) 的表格里登记；
6. `npm run typecheck`，回归 [../regression/settings-and-credentials.md](../regression/settings-and-credentials.md) 的相关用例。
