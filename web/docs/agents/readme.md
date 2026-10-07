# 前端知识库：格式规范与分层总索引

## 使用说明

### 这份文档是什么

`web/docs/agents/**` 这套知识库的**元文档**：它规定文档怎么写（四段式、章节名、引用方式），并给出各层的总索引。

**不覆盖**：任何一层的内容本身——那是各层 `readme.md` 的事。跨层规则与「要做什么 → 去哪一层」的查表在 [AGENTS.md](../../AGENTS.md)。

### 怎么读

| 你要做的事 | 读哪一节 |
|---|---|
| 新建一篇分层文档 | §规则「四段式怎么写」+ §规则「什么时候该新建一篇」 |
| 改现有文档 | §规则「引用与章节名」+ §规则「每次开发后同步」 |
| 找某一层的入口 | §索引「分层总索引」 |
| 确认某篇文档是否真的存在 | §索引「文件清单」 |
| 想知道这套知识库哪里还欠账 | §现状 |

### 必须遵守的规则

1. **知识库不是事实源**：它只用来**定位代码**与**保持跨对话的风格统一**；结论、参数、行为一律以当前源码为准，发现不符时报给用户确认，不要自行裁决。详见 [AGENTS.md](../../AGENTS.md) §规则首要规则第 2 条。
2. **每次开发后同步**：改动落到哪一层，就在同一次开发里更新那一层的文档；新增/删除文件要更新 §索引的表；新增约束按「分层归置」写进对应层。违反后果：下一次对话按过期文档改错地方。
3. **分层归置**：一条约束只写在它**真正生效的那一层**。跨层规则写进 [AGENTS.md](../../AGENTS.md)；只对某一层成立的写进该层 `readme.md` 的 §规则；只对某一个文件成立的写进那篇子文档。
4. **引用一律用相对路径**，从当前文件出发算；指向源码时从 `web/` 根出发写（例：`src/styles/tokens.css`），并在文中明确它是相对 `web/` 的。违反后果：文档被移动后引用全断，读者无法判断基准目录。
5. **章节名固定**：本知识库用 `§使用说明` / `§规则` / `§索引` / `§现状` 这一组名字（少数文档另有 `§这一层的职责` / `§目录`）。引用时写「[文件](路径) §规则」而不是「见上文」，因为读者常常是跳着读的。
6. **改了文档就要检查它引用的路径**：本知识库历史上出现过整层文档缺失、以及十余处指向不存在文件的引用（见 §现状）。新增引用时用文件系统确认目标存在。

## 四段式怎么写

一套文档的骨架固定为四段（**两个入口文档例外**，见下）：

| 段 | 写什么 | 判据 |
|---|---|---|
| `## 使用说明` | 「这份文档是什么」+「怎么读（文件 → 场景表）」+「必须遵守的规则（带违反后果）」 | 读者只读这一段就能决定要不要继续读 |
| `## 这一层的职责`（或 `## 规范` / `## 四类的边界`） | 这一层负责什么、不负责什么、与相邻层的边界 | 边界不清时的裁决依据 |
| `## 目录` / `## 索引` | 文件 → 场景、符号 → 文件、章节 → 场景的查表 | 用来定位，不是用来通读 |
| `## 规则` | 本层独有的强制约束，每条都要写**违反后果** | 「违反后果」是本知识库的核心风格：它让 AI 判断优先级 |

**两个入口文档例外**（`web/AGENTS.md`、`web/docs/agents/readme.md`，即本文）：它们的首段是 `## 简介`，因为它们在讲「跨层的总纲」而不是「某一层的用法」。

### 每篇文档的固定提问

写或改一篇文档时，逐条回答；答不上来的那一段就还不该写：

1. 读者**什么时候**会打开它？（对应 §使用说明 的「怎么读」表）
2. 它**不覆盖**什么，那些东西该去哪？（对应 §使用说明 的「不覆盖」句）
3. 这一层**只做哪两件事**？（对应 §职责）
4. 违反哪条会出**什么后果**？（对应 §规则）
5. 上层入口是谁？（在「不覆盖」句里给出上一级的链接）

### 什么时候该新建一篇

判据是**「有没有一个新的独立主题」**，不是「行数多不多」：

- 一个文件一个主题 → 一篇（例：`store/reducers.md`）；
- 一类文件共享一套规则 → 一篇，另在层 `readme.md` 里索引（例：`styles/components.md`）；
- 只多了一两句约束 → 加进已有文档的 §规则，**不要**新建。

## 分层总索引

`web/` 共六层：`AGENTS.md` 是顶层（跨层规则 + 查表），下面五层各有入口，另一组「回归用例」不占目录但同样是一层文档。

| 层 | 源码目录 | 入口 | 子文档 |
|---|---|---|---|
| 顶层（跨层） | — | [AGENTS.md](../../AGENTS.md) | 首要规则、跨层强制约束、技术栈约束、模块化与宿主分界、外观层硬约定、查表 |
| 页面层 | `web/src/page/` | [page/readme.md](page/readme.md) | [main-page.md](page/main-page.md)、[debug.md](page/debug.md)、[library.md](page/library.md) |
| 组件层 | `web/src/components/` | [components/readme.md](components/readme.md) | [main-page.md](components/main-page.md)、[dialog.md](components/dialog.md)、[content.md](components/content.md) |
| 工具层 | `web/src/utils/` | [utils/readme.md](utils/readme.md) | `api` / `commands` / `turns` / `process` / `toolViews` / `credentialLabel` / `relativeTime` / `debugMode` 各一篇 |
| 状态层 | `web/src/store/` | [store/readme.md](store/readme.md) | [reducers.md](store/reducers.md)、[actions-and-operations.md](store/actions-and-operations.md)、[hooks-and-stream.md](store/hooks-and-stream.md)、[selectors-and-instance.md](store/selectors-and-instance.md) |
| 样式层 | `web/src/styles/` | [styles/readme.md](styles/readme.md) | [tokens.md](styles/tokens.md)、[frame.md](styles/frame.md)、[content-and-brand.md](styles/content-and-brand.md)、[composer-cards-modal.md](styles/composer-cards-modal.md)、[components.md](styles/components.md)、[debug.md](styles/debug.md) |
| 回归用例（跨层） | — | [regression/readme.md](regression/readme.md) | [shell-and-layout.md](regression/shell-and-layout.md)、[session-flow.md](regression/session-flow.md)、[settings-and-credentials.md](regression/settings-and-credentials.md)、[commands-and-shortcuts.md](regression/commands-and-shortcuts.md) |

### 层的判据

| 问题 | 是 → 进哪层 |
|---|---|
| 它在做装配与生命周期，不含业务逻辑？ | 页面层 |
| 它渲染一块界面、输入是 props 或协议里的 `kind`？ | 组件层 |
| 它是纯函数或宿主接口的封装？ | 工具层 |
| 它持有跨组件共享的状态？ | 状态层 |
| 它只声明视觉形态？ | 样式层 |
| 它在描述「怎么验证一件事没坏」？ | 回归用例 |

`components/motion/**` 是**服务全站的动效原语**，不占第六层——它的入口在 [components/readme.md](components/readme.md) §四类的边界。

## 现状

### 本层的欠账（已补 / 待补）

| 项 | 状态 |
|---|---|
| `styles/` 层文档整体缺失（含 `readme.md` / `frame.md` / `content-and-brand.md` / `components.md` / `debug.md` / `tokens.md` 等） | **已补**（本轮）。此前 13 处引用指向空目录 |
| 本文（格式规范与六层总索引）缺失 | **已补**（本轮） |
| `page/readme.md` 的 §目录表可能漏列后续新增的页面文件 | 待核 |

### 已知的引用问题

1. **指向仓库根 `docs/` 的引用全部落空**：`web/AGENTS.md`、`styles/**`、`components/readme.md` 等多处引用 `docs/ui-restyle-plan.md`、`docs/bgm-design/*`，而根 `docs/` **不存在于本机工作树，且在 `.gitignore` 中**（新克隆的仓库里也没有）。读到时按「本地开发资产」理解，不要当成缺失的必读文件。
2. **指向 `docs/design/` 的引用只在本地有效**：`web/docs/design/**`（设计决策记录与样张，外观的唯一事实源）**被 `.gitignore` 忽略**，不在 git 里。这是当前最大的结构性风险——引用量最大的「事实源」不入库。已记录待决策，不要在文档里假设它在别的机器上存在。
3. **`docs/design/**` 内部有 4 处失效引用**（属既有问题，未修）：`decisions.md` → `design/token-coverage-and-extraction.md`、`decisions/C14-quote-block.md` → `decisions.md`、`decisions/C21-modal.md` → `G01-surface.md`、`decisions/C40-tool-activity.md` → `../../../src/components/mainPage/conversation/ToolActivity.tsx`（该组件已删除，由 `ProcessRows.tsx` 的 `ToolRow` 取代）。修它们之前先定 §现状 第 2 条的 gitignore 取向。
4. **`styles/**` 与 `content.css` 里的行内注释**也有同类引用（如「见 docs/ui-restyle-plan.md §四 B」「样张 `web/style-demo-*.html`」）：`style-demo-*.html` 这批**命名已不存在**（样张现集中在 `web/docs/design/` 的 `components/` / `global/` / `pages/`），`docs/` 与 `docs/bgm-design/` 也不在本机工作树。改那些注释时顺手改成可解析的说法，或标注「本地资产」。

### 文档写作的口径

- **全中文**，但代码、命令、路径、标识符、协议名保留原文。
- **结论先行**：每段的第一句就是结论，细节在后面。
- **不堆砌客套**：没有「本文档旨在」「希望对你有帮助」这类句子。
- **案例优先于抽象**：写规则时给一个具体文件 / 选择器 / 符号作为范例（本知识库通篇如此），比写「应当保持一致性」有用得多。
