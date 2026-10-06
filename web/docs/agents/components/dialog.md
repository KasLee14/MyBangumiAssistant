# 弹窗（`components/dialog/`）

## 简介

弹窗层的规格：基础件 `Modal` 的行为、八个弹窗的对照表、开合状态与两级关闭语义、表单约定与新增步骤。

**不覆盖**：浮层挂载点与进出过渡的实现（见 [main-page.md](main-page.md) 的浮层挂载点）。

上层：[readme.md](readme.md)。这些组件**直接消费 store**（规则 B）；开合状态住在 `store/reducers/ui.ts`。

## 使用说明

- **动开合、`pane`、互斥或关闭语义之前先读 §规则**：互斥只在 reducer 里保证一次、两级关闭各管一层、失败写本地 `error`；违反会让两处逻辑分叉、Esc 行为错乱，或让用户看不出是哪个字段错了。
- **只想查「某个弹窗读写什么」「`Modal` 有哪些行为」**：直接查 §索引 的三张表（基础件、八个弹窗、章节 → 场景），不必通读 §规则。
- **新增弹窗**：先读 §规则 末条「新增一个弹窗的步骤」（6 步），再从 §索引「八个弹窗」里挑一个最接近的照抄结构。
- 这些弹窗都套 `Modal`，Esc 与遮罩的关闭行为由它统一提供（见 §索引「基础件：`Modal.tsx`」）。

## 规则

### 互斥由 reducer 保证，组件不重复判断

两个布尔 + 一个 pane 决定当前显示什么：

```ts
ui.settingsOpen: boolean          // 设置弹窗是否打开
ui.settingsPane: SettingsPane | null   // 'credential' | 'model' | 'proxy' | 'login' | 'logout' | null
ui.sessionsOpen: boolean          // 会话弹窗是否打开
```

- **互斥由 reducer 保证**：`ui/settingsOpened` 会同时把 `sessionsOpen` 置 false，`ui/sessionsOpened` 反之。组件里不要再写互斥逻辑。
- `settingsPane` 住在 store 而不是 `SettingsDialog` 的 `useState`，是为了让 `/model` 命令能从外部直达"模型选择"行。
- 「模型选择」格在没有可用模型时置灰，且 `SettingsDialog` 会在 `pane === 'model' && models.length === 0` 时退回主面板。

**违反后果**：两处逻辑分叉。

### 两级关闭不得混用：`closePane` 回设置主面板，`closeSettings` 关整个弹窗

**两级关闭语义**（容易写错）：

- `closePane()` → `settingsPane = null`：从子弹窗**回到设置主面板**（设置弹窗仍打开）；
- `closeSettings()` → `settingsOpen = false`：关闭整个设置弹窗；
- `closeSessions()` → 关闭会话弹窗。

**违反后果**：Esc 行为错乱。

### 弹窗内的失败写本地 `error`，不吞成全局提示

每个弹窗自己持有**输入与请求状态**（`useState`：字段值、`busy`、`error`），因为它们是组件私有的临时状态：

| 约定 | 说明 |
|---|---|
| 成功 | 动作函数内部已 dispatch 提示（`ui/notice`）→ 组件只管 `closePane()` / `closeSettings()` |
| 失败 | 动作函数**抛出**（`applyCredential`、`pickModel`、`applyProxy`、`startBangumiLogin`、`bangumiLogout`），组件 `catch` 后写进本地 `error` 并在弹窗内显示；不要吞成全局提示，否则用户看不到是哪个字段错了 |
| 例外 | `pickThinkingLevel` 成功与失败都只发全局提示（它是常驻菜单，没有弹窗承载错误文案） |
| 忙碌 | 请求期间禁用提交按钮（`busy`），避免重复提交 |
| 输入清空 | 失败的登录只清密码、保留邮箱，方便重试 |

**违反后果**：用户看不出是哪个字段错了。

### 表单请求走 `useActions()`，不直接 `import utils/api`

**违反后果**：绕过提示与状态更新（见 [../store/readme.md](../store/readme.md) 的「改全局状态只能经 store/ 的动作」）。

### 新增一个弹窗的步骤

1. 在 `components/dialog/` 建 `XxxDialog.tsx`，套 `Modal`；
2. 数据用 `useAppSelector` 取，动作用 `useActions()` 取（**不要**在组件里直接 `import utils/api`，那会绕过提示与状态更新）；
3. 若它是设置里的某一行：在 `store/reducers/ui.ts` 的 `SettingsPane` 里加成员、在 `SettingsDialog` 加一格（`BentoGrid` 的 `BentoCard`）与分支、在 `store/operations.ts` 加 `switchPane` 的调用点；
4. 若它是独立浮层（如会话弹窗）：在 `ui` 切片加开合字段 + 动作，并在 `overlays/DialogStage.tsx` 挂载；
5. 在本文件与 [readme.md](readme.md) 的表格里登记；
6. `npm run typecheck`，回归 [../regression/settings-and-credentials.md](../regression/settings-and-credentials.md) 的相关用例。

## 索引

### 章节 → 场景

| 章节 | 什么时候读 |
|---|---|
| §规则「互斥由 reducer 保证，组件不重复判断」 | **动开合、`pane`、互斥时必读** |
| §规则「两级关闭不得混用：`closePane` 回设置主面板，`closeSettings` 关整个弹窗」 | 改 Esc、关闭按钮或返回主面板的语义时 |
| §规则「弹窗内的失败写本地 `error`，不吞成全局提示」 | 写弹窗表单、忙态与错误显示时 |
| §规则「表单请求走 `useActions()`，不直接 `import utils/api`」 | 弹窗里要发请求时 |
| §规则「新增一个弹窗的步骤」 | 新增弹窗时逐步照做 |
| §索引「基础件：`Modal.tsx`」 | 新增弹窗、改 Esc 或遮罩关闭行为时 |
| §索引「八个弹窗」 | 查某个弹窗的数据来源与成功后的行为 |

### 基础件：`Modal.tsx`

所有弹窗都套它。它只做四件事：

| 行为 | 实现 |
|---|---|
| 居中 + 遮罩 | `.modalOverlay`（遮罩）+ `.appGlass.modalSurface`（表面，样式在 `styles/modal.css`） |
| Esc 关闭 | `window` 上**捕获阶段**监听，`stopPropagation()` 后关闭——避免顺带触发会话层的「停止本轮 / 拒绝确认」 |
| 点遮罩关闭 | `onMouseDown` 且 `event.target === event.currentTarget`（拖拽选词不会误关） |
| 结构 | 内容收成**单个 `.dlgPane`**：右上角实心关闭键 `.dlgCloseTop`（`×`，`aria-label="关闭"`）+ `.dlgHead`（`.dlgTitle` + 可选 `.dlgSub`）+ children + 可选 `footer`（放进 `.dlgActions`） |

props：`title`、`eyebrow?`、`wide?`、`onClose`、`children`、`footer?`、`leaving?`、`onExited?`。`eyebrow` 现在是标题下方那句说明（`.dlgSub`），与 `title` 相同时不渲染，避免「设置 / 设置」这种重复。

**进出过渡**：[G09](../../design/decisions/G09-overlay.md) / [C41](../../design/decisions/C41-dialog-stage.md) 定稿为 `scale .98 + y 4px`，进入与退出同一组值。载体是 **CSS keyframes**（`styles/modal.css` 的 `modalIn` / `modalOut`，时长 `--app-dur-slow`、曲线 `--app-ease-out`），不再是 `motion`。这一档 4px 是弹窗专属，不在 `SHIFT` 的两级刻度（`row` 8 / `panel` 16）上。

**不要给弹窗加 `opacity` 动画**（2026-10-10 实测）：Chromium 在元素有效 `opacity` 小于 1 时会跳过它的 `backdrop-filter`，于是淡入期间弹窗等于「74% 白 + 完全清晰的背景文字」，动画一结束模糊才突然生效——就是「出现时卡一下、突然就不透明了」。同理 `.modalOverlay` 也不做动画（它没有背景，淡入既看不见，又会让表面掉进 `opacity < 1` 的子树）。

**留场**：`leaving` 为真时表面加 `data-leaving`（换成 `modalOut`），播完由 `onAnimationEnd` 报 `onExited`。挂载点（`overlays/DialogStage.tsx`）因此**不能**用 `settingsOpen` 这类开关决定渲不渲染：它在关闭的同一帧就是 false，子树会连同退场动画一起被卸载。`SettingsDialog` 的五个子面板经由 `Modal.tsx` 导出的 `DialogPresenceProvider` / `useDialogPresence` 拿到这两个值，不必逐层透传；`prefers-reduced-motion: reduce` 下动画被关掉，`Modal` 用 `matchMedia` 立即回报，避免弹窗留在 DOM 里关不掉。

**子面板的「关」有两个含义，别混**（`store/operations.ts`）：

| 动作 | 语义 | 状态变化 |
|---|---|---|
| `closePane` | 回设置主屏（换屏，弹窗**不**关） | `settingsOpened(null)` |
| `closeSettings` | 关掉整个设置弹窗（此时才播退场） | `settingsClosed()` |

换屏时**渲染分支会变**（子面板 → 主屏 Modal），React 会换掉整棵子树。这在弹窗开着时是想要的效果；但**退场期间**换屏就等于把正在播的退场动画一起卸掉（实测：元素留在 DOM 里、`data-leaving` 从未出现）。所以 `SettingsDialog` 取屏的口径是 `leaving ? selectLastSettingsPane : selectSettingsPane`——退场期间沿用屏幕上最后画出来的那一屏（`ui.lastSettingsPane`，见 [store/readme.md](../store/readme.md)）。

### 八个弹窗

| 文件 | 唤起方式 | 读什么 | 成功后做什么 |
|---|---|---|---|
| `SettingsDialog.tsx` | 侧栏底部用户行的**齿轮按钮**（[C45](../../design/decisions/C45-settings-entry.md) 之后单击直达，原「···」菜单已删）、空会话首屏的 `.appHeroSettings`（实心深档按钮，2026-10-10 起位于说明与示例之间）、`/model` 命令 | `ui.settingsPane`、catalog 切片、流切片中的 `modelLabel` / proxy / login 字段 | 关闭设置（`closeSettings`） |
| `ModelDialog.tsx` | 设置主面板「模型配置」格（整格可点） | `catalog.providers`、`catalog.canPersistCredentials`、`ui.credentialProvider` | `applyCredential` / `clearCredential` → 重取目录 → 回设置主面板 |
| `ModelPickerDialog.tsx` | 设置主面板「模型选择」格（整格可点，无可用模型时置灰） | `catalog.models` | `pickModel` → 回设置主面板 |
| `ProxyDialog.tsx` | 设置主面板「代理端口」格（整格可点） | `stream.proxyMode` / `proxyAddress` | `applyProxy` → 回设置主面板 |
| `BangumiLoginDialog.tsx` | 设置主面板「登录状态」格（未登录时整格可点） | `stream.loginBusy` / `loginStatus` | `startBangumiLogin` → 回设置主面板；关闭时 `cancelBangumiLogin` |
| `BangumiLogoutDialog.tsx` | 设置主面板「登录状态」格（已登录时整格可点） | `stream.loginUsername` | `bangumiLogout` → 回设置主面板 |
| `SessionDialog.tsx` | `/sessions` 命令、`openSessions()` | `catalog.sessions` | `pickSession`（底部动作行是「取消 / 切换」，先关弹窗再切换） |
| `LoginDialog.tsx` | 宿主下发 `stream.loginPrompt` 时由 `DialogStage` 自动挂载 | props 里的 `prompt.id`（用于换请求时清空输入） | `answerLoginInput`（提交或取消） |
| `Modal.tsx` | —（基础件） | — | — |

`SettingsDialog` 的主面板是 **`BentoGrid` 的四格**（[C29](../../design/decisions/C29-settings-dialog.md)）：模型配置与模型选择各跨两行（大卡）、代理端口与登录状态各一行（小卡）；**只有当前状态、没有底部动作条**——动作由整格承担（`BentoCard` 本身是 `<button>`，hover 浮出「配置 →」这类提示），说明文字升为弹窗副标题，关闭走右上角 `×` 或 Esc。原来那四行 `.settingsRow` 与每行的「编辑」按钮已删除。

子弹窗的表单骨架统一是 `modal.css` 的 `.dlg*`（`.dlgFields` / `.dlgField` / `.dlgInput` / `.dlgHint` / `.dlgCheck` / `.dlgChoices` / `.dlgChoice` / `.dlgStatus` / `.dlgDot` / `.dlgActions` / `.dlgBtn*`），选择类控件**不用原生 `<select>`**：`ModelDialog` 的提供方用自绘 `.dlgCombo`（`.dlgTrigger` + `.dlgCaret` + `.dlgMenu` + `.dlgOption`，由 `useState` 管开合），`ModelPickerDialog` 与 `SessionDialog` 用 `.dlgList` + `.dlgRow`（`.dlgRowMain` / `.dlgRowMeta` / `.dlgRowMark`）。`ModelPickerDialog` 的主按钮文案是「使用」。

`SessionDialog` 与侧栏按 `session.id === stream.sessionId` 判断当前会话，并优先显示「待确认 / 待登录 / 运行中 / 当前」。其余行共用 [`relativeTimeLabel`](../utils/relativeTime.md) 显示「最后对话时间」（`刚刚` / `N分钟` / `N小时` / `N天` / `N个月` / `N年`）。两处口径必须一致。
