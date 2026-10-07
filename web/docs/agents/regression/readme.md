# 回归用例（`docs/agents/regression/`）

## 使用说明

### 这份文档是什么

这套用例的执行前提、判定约定与索引：怎么跑、结果怎么算通过、改了什么该跑哪些。

**不覆盖**：用例的具体步骤（见四个用例文档）。上层入口：[AGENTS.md](../../../AGENTS.md)。

### 怎么读（文件 → 场景）

| 文件 | 什么时候读 |
|---|---|
| 本文件 | **开始回归前必读**：前提、判定约定、"按改动范围选最小集" |
| [session-flow.md](session-flow.md) | 动会话主链路（提交 / 流式 / 工具活动 / 确认卡 / 会话切换 / 内容条目）之后 |
| [settings-and-credentials.md](settings-and-credentials.md) | 动设置弹窗、模型配置、凭据持久化、代理、登录之后 |
| [commands-and-shortcuts.md](commands-and-shortcuts.md) | 动命令表、补全、Esc 行为、思考强度、toast 之后 |
| [shell-and-layout.md](shell-and-layout.md) | 动样式、DOM 结构、类名、外壳布局之后（**改类名或层级必跑**；`A1`–`A7` 覆盖外观与动效契约） |

> **`V` 组（`ui-variants.md`）已作废**：v2 完全不存在——源码里没有 `components/v2/`、`styles/v2/`、`ShellV1.tsx` / `ShellV2.tsx`、`data-ui` 作用域与 `ui.variant`，配套的用例文件（`ui-variants.md`，`V1`–`V12`）与浏览器离线套件（`test/web-ui-variants.test.mjs`）都已删除。原 `V` 组里**仍然有效**的几条已并入 [shell-and-layout.md](shell-and-layout.md) 的 `A` 组：`V7` → `A2`（内容条目不得被入场动画卡成不可见）、`V8`/`V9` → `A3`/`A4`（动效约束与 `prefers-reduced-motion` 降级）、`V11` → `A6`（待授权只显示一张卡）、`V12` → `A7`（会话草稿隔离）。看到 `V1`–`V12` 的引用一律按作废处理。

### 必须遵守的规则

1. **标注「需模型」「需登录」的用例不得用假数据替代判定**：违反后果：结论不成立，等于没验证。见 §执行前提。
2. **每条用例都要核对 Console 无 error / warn**：违反后果：回归被隐藏。浏览器请求 `favicon.ico` 的 404 属既存现象，可忽略。见 §判定约定。
3. **涉及写本机配置的用例（C3–C6）执行前后都要核对并还原** `pi/auth.json` 与 `pi/settings.json`：违反后果：污染真实环境。见 §执行前提。
4. **失败必须记录用例号 + 实际现象 + 复现步骤 + Console 输出**：违反后果：无法定位，等于没跑。见 §记录模板。
5. **改样式后先重启 `npm run dev:web` 再判定**：Windows 上编辑工具的「临时文件 + rename」保存会让 Vite 的 chokidar 报 `EBUSY` 并**漏检真实改动**，此时"样式没生效"是缓存问题而不是样式写错——判定方式是读 CSSOM（`document.styleSheets` 里那条规则是新是旧）或看 dev server 输出里有没有那行 EBUSY（见 [AGENTS.md](../../../AGENTS.md) §规则「技术栈约束」第 4 条）。违反后果：按"代码写错了"去查一个不存在的 bug。
6. **不再有 `V` 组可跑**：v2 与 `ui-variants.md` 都已删除（理由见 §怎么读 的说明），任何改动的最小回归集都从 `L` / `A` / `S` / `C` / `K` 里选。

## 这是什么

**文档化的回归用例**，覆盖 web 交互终端的主链路，是"照着做就能判定通过/失败"的清单。项目另有宿主侧的 Node 内置测试：在 `bangumi/` 先执行 `npm run build`，再执行 `npm run test:mcp`（= `tsc -p tsconfig.json && node scripts/copy-strategy-skills.mjs && node --test test/*.test.mjs`）；只跑授权文案与固定确认政策时用 `node --test test/write-preview.test.mjs test/confirmation-policy.test.mjs`。它**不覆盖前端**——前端回归靠本文档的用例 + `npm run typecheck`。离线自动测试与真实模型、真实登录的验收应分别记录。

`test/web-ui-variants.test.mjs`（在真实浏览器里加载构建产物、用本地离线 HTTP/SSE 验证授权卡去重、应答状态、**外观切换**与会话草稿的那套离线套件）**已随 v2 一起删除**：`bangumi/test/` 下不再有它，`BGM_WEB_TEST_BROWSER` 与 `BGM_WEB_TEST_SCREENSHOT_DIR` 也不再有任何消费者。需要浏览器侧自动核对时，按 [shell-and-layout.md](shell-and-layout.md) 的判定表达式在 DevTools Console 里跑。

设计目标有两个：

1. 改动后能按范围挑出**最小回归集**，而不是每次全量；
2. 每条用例都有**可机器判定的表达式**（DevTools Console 可粘贴），让 AI 不必靠"看起来对"下结论。

## 执行前提

| 项 | 要求 |
|---|---|
| 宿主 | 已构建（`npm run build`）；用 `npm run web` 起，或用 `npm run dev:web` 同时起前端（推荐，HMR） |
| 地址 | 宿主打印的 `/?token=...` 地址；dev 模式下用 dev server 地址（令牌已由 dev server 注入） |
| 真实模型 | **标注「需模型」**的用例要求至少一个提供方已配置凭据（模型列表非空） |
| 真实登录 | **标注「需登录」**的用例要求已登录 Bangumi |
| 环境还原 | 涉及写本机配置的用例（`C3`–`C6`）执行前先记录 `%LOCALAPPDATA%\MyBangumiAssistant-Pi\pi\{auth.json,settings.json}` 的内容，结束后还原 |

## 判定约定

1. **功能判定**：按"预期"逐条核对；给出表达式的用例以表达式结果为准。
2. **无副作用判定**：每一步结束后 Console 不应出现 error / warn（浏览器自动请求 `favicon.ico` 的 404 属既存现象，可忽略）。
3. **视觉判定**：不追求逐像素；核对"关键形态"（配色、圆角、边框、层级、遮挡关系）。有条件时与自己上一次的截图对比。
4. **失败记录**：记录**用例号 + 实际现象 + 复现步骤 + Console 输出**，不要只写"不通过"。

## 编号与索引

| 前缀 | 文档 | 覆盖 |
|---|---|---|
| `S` | [session-flow.md](session-flow.md) | 会话主链路：提交、流式、过程区（思考 / 工具）、轮控制行与轮尾、确认卡、会话切换、轮次导航、内容条目、历史回溯 |
| `C` | [settings-and-credentials.md](settings-and-credentials.md) | 设置四格（`BentoGrid`）、模型配置与凭据持久化、模型选择、代理、登录 |
| `K` | [commands-and-shortcuts.md](commands-and-shortcuts.md) | 命令补全与本地命令、Esc 行为、思考强度、toast |
| `L` | [shell-and-layout.md](shell-and-layout.md) | 外壳与布局：首屏、侧栏、连接状态、DOM/类名契约、宽度轴、品牌外观 |
| `A` | [shell-and-layout.md](shell-and-layout.md) | 外观与动效契约：容器查询与屏外优化、内容条目可见性、非常驻循环动画、`prefers-reduced-motion` 降级、弹窗过渡与浮层挂载点、接管卡去重、会话草稿隔离 |
| `V` | 已删除（原 `ui-variants.md`） | **已作废**：v2 不存在，用例文件也已删除。原覆盖「两版外观：切换与持久化、作用域契约、v1 零改动、v2 的 DOM 契约、动效约束与降级、两版功能一致」，其中仍有效的条目见 §怎么读 的映射（`V7`→`A2`、`V8`/`V9`→`A3`/`A4`、`V11`→`A6`、`V12`→`A7`） |

## 按改动范围选用例

| 改动 | 最小回归集 |
|---|---|
| 只改文案 | 涉及该文案的用例 + `L5` |
| 改组件结构 / 类名 | `L5`、`L6` + 该组件所在链路的用例 |
| 改 store 切片 / 动作 | 该切片相关的全部用例 + `K9`、`L4` |
| 改样式文件 | `L1`、`L5`、`L6`、`L7`（动令牌（`--app-*` / `--bgm-*`，含唯一的 `--dsw-corner-shape`）则全量 `L`） |
| 改 `utils/api.ts` 或协议 | 对应端点的用例（`C*` / `S*`）+ `L4` |
| 改消息渲染 / 内容组件 | `S2`、`S3`、`S9` + [../components/content.md](../components/content.md) 的"新增 kind 清单"核对 |
| 改流式渲染 / 逐字摊平 / 贴底跟随 / 帧节奏 | `S13`（逐字与收尾播放，**需模型**）、`S12`（骨架与落定，离线走调试页）+ `S2`、`S3`；再按 [../components/main-page.md](../components/main-page.md) 的两条流式规则核对（`ResizeObserver` 贴底、收尾期让位与光标） |
| 改批次活动 / 额度进度 | `S11`（离线展示通过与真实账户写入分别记录）+ `S15`（工具行的展开体与结果内容块）；原 `V3`、`V4` 随 v2 作废 |
| 改思考条目 / 工具条目 / 轮次边界（协议、宿主投影或前端分组） | `S3`、`S15`、`S16`（工具与轮控制行）、`S14`（思考历史化）、`S19`（历史回溯）+ [../utils/turns.md](../utils/turns.md) 与 [../utils/process.md](../utils/process.md) 的规则核对 |
| 改过程区折叠 / 展开状态 | `S18`（`hidden="until-found"` 与 Ctrl+F）、`S3`、`S4`（`/details`）+ `K7` |
| 改轮尾操作行 / 每轮用量 | `S17`（复制范围与用量面板）+ `S13`（收尾期让位） |
| 改 `page/mainPage/*`、`components/mainPage/**`、`components/common/**`、`styles/common.css`、`components/motion/**` | `L1`–`L10` + `A1`–`A7`（其中 `L5`、`L6`、`A2` 是关键项）；原 `components/v2/**`、`styles/v2/**` 与 `V1`–`V10` 已作废 |
| 改**共享组件**（`Modal`、`StatsDock`、`MessageParts`、`content/**`） | 该组件所在链路的用例；浮层类（`Modal` / `StatsDock`）补 `A5`，内容条目（`MessageParts` / `content/**`）补 `A2` |
| 加动效或改动效令牌 | `A3`、`A4` + [../styles/readme.md](../styles/readme.md) 的引入顺序核对 |

## 冒烟集（任何改动后至少跑这 5 条）

`L1`（首屏渲染）→ `L4`（连接状态）→ `K1`+`K2`（命令补全与 `/help`）→ `L5`（DOM 契约）→ `L3`（侧栏折叠）。

改动落到外壳结构、共享组件或共享表面原语（`styles/common.css`、`components/common/**`）时，在冒烟集之后追加：`A1`（容器查询与屏外优化）→ `A2`（内容条目可见性，**最容易静默失败的一条**）→ `A5`（弹窗进出与浮层挂载点）。原「外观版本」相关的追加项（`V1` / `V4` / `V3`）随 v2 作废，不再有替代品——现在只有一套外壳。

## 记录模板

```
日期/环境：
用例号：
结果：通过 / 失败
实际现象：
Console：
备注（是否需真实模型/登录）：
```
