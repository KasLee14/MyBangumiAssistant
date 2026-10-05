# 知识库（`docs/agents/`）

## 简介

`web/` 前端知识库的**格式规范**与**总入口**：规定每篇文档的四段式结构（每段收录什么、怎么写），并汇总六个层与回归用例集的入口。

**不覆盖**：宿主（`bangumi/src`）与 Pi 上游（`pi/`）的实现细节；跨层规则、技术栈与外观约定在 [AGENTS.md](../../AGENTS.md)。

上层：[AGENTS.md](../../AGENTS.md)。

## 使用说明

- **写或改任何一篇文档前，先读 §规则**：它规定四段式与各段的收录范围。偏离之后，知识库会重新退化成一堆随手笔记，索引也就找不回东西了。
- **只想找某层入口、或某个主题该去哪**：直接查 §索引 的两张表（层 → 入口、各层文件），不必通读本文。
- 本文只讲「文档怎么写」；「代码怎么写」在 [AGENTS.md](../../AGENTS.md) 与各层文档里。

## 规则

### 四段式：每篇文档都要有这四段，顺序固定

| 段 | 放什么 | 判断标准 |
|---|---|---|
| `## 简介` | 这份文档是什么、覆盖什么、**不覆盖**什么、上层与相关文档链接 | 读者据此判断「要不要继续读」 |
| `## 使用说明` | 怎么用这篇文档：先读哪段、什么时候查索引、本篇的阅读顺序或前提 | 读者据此知道「怎么读最快」 |
| `## 规则` | 必须遵守的约束：**必须 / 不得 / 缺一不可**，每条附理由与违反后果；必要时附操作步骤或检查清单 | 违反会出 bug、或让风格漂移的内容 |
| `## 索引` | 定位表：文件 → 场景、章节 → 场景、符号 / action / 字段清单、步骤清单 | 用来「按需跳读」的内容 |

**四段之外不放正文**。描述性内容若不属于这四段，说明它该并入 `## 简介`（讲背景）或 `## 规则`（讲理由）；两者都放不下时，先怀疑这段内容该不该留。

### 各段的写法约定

1. **规则条目要能被检验**：写「必须 / 不得 / 违反后果」，不写「建议」「尽量」「最好」。违反后果要具体——哪个组件会重渲染、哪处状态会残留、哪份数据会不同步。
2. **规则要带理由或指向实现**：只写「必须 X」而不写为什么，下一个人会当成可以商量的偏好；理由可以是指向源码位置、也可以是设计权衡。
3. **索引表每行都要有「什么时候读」**：只有路径、没有问题场景的表等于没有索引。
4. **不重复**：同一句话只在一处出现。跨层规则放 [AGENTS.md](../../AGENTS.md)，本篇只写「见 AGENTS.md §…」；层内通用规则放该层 `readme.md` 的 §规则，子文档只写本篇专属并链接过去。
5. **子标题用 `###`**：四段是 `##`，段内细目一律 `###`，不再往下一级分。层级超过三层通常说明该拆成两篇文档了。
6. **原文保留**：类名、函数名、CSS 选择器、文件路径、命令一律照抄，不翻译、不改写、不「顺手优化」措辞。
7. **例外：`regression/` 不套四段式**。那 5 篇的正文就是用例条目（`L1`–`L10`、`A1`–`A7`、`S1`–`S10`、`K1`–`K14`、`C1`–`C10`），套进来反而会把步骤与预期拆散；它们保持现有结构，只要求 §索引 里的编号表准确。

### 改动纪律

1. **与代码同批更新**：改了某层代码，就在同一次改动里更新该层文档（[AGENTS.md](../../AGENTS.md) §规则 的「首要规则」第一条）。
2. **文档不是事实源**：发现文档与源码不符时向用户暴露差异，不自行裁决改哪边（[AGENTS.md](../../AGENTS.md) §规则 的「首要规则」第二条）。
3. **新增文档时**：按四段式建骨架，并同时更新所属层 `readme.md` 的 §索引 表与本文 §索引 的层表——只加文件、不加索引，等于没人能找到它。

## 索引

### 六层入口

| 层 / 主题 | 入口 | 什么时候读 |
|---|---|---|
| 页面装配与生命周期订阅 | [page/readme.md](page/readme.md) | 改 `main.tsx`、`page/mainPage/**` 时 |
| 组件（外壳 / 弹窗 / 内容渲染） | [components/readme.md](components/readme.md) | 加或改组件、判断某段 UI 该放哪时 |
| 状态（切片 / 动作 / 选择器 / hooks） | [store/readme.md](store/readme.md) | 加状态、加 action、改帧合并时 |
| 工具（纯函数与宿主接口） | [utils/readme.md](utils/readme.md) | 接宿主端点、加本地命令、改投影时 |
| 样式（令牌与形态） | [styles/readme.md](styles/readme.md) | 改样式、令牌、品牌外观时 |
| 回归用例 | [regression/readme.md](regression/readme.md) | 改动后挑选要跑的用例时 |
| 跨层规则、技术栈、外观约定 | [AGENTS.md](../../AGENTS.md) | 不确定该放哪、要动依赖或外观时 |

### 各层文件

| 层 | 文件 |
|---|---|
| page | [readme.md](page/readme.md)、[main-page.md](page/main-page.md)、[debug.md](page/debug.md) |
| components | [readme.md](components/readme.md)、[main-page.md](components/main-page.md)、[dialog.md](components/dialog.md)、[content.md](components/content.md) |
| store | [readme.md](store/readme.md)、[reducers.md](store/reducers.md)、[actions-and-operations.md](store/actions-and-operations.md)、[hooks-and-stream.md](store/hooks-and-stream.md)、[selectors-and-instance.md](store/selectors-and-instance.md) |
| utils | [readme.md](utils/readme.md)、[api.md](utils/api.md)、[commands.md](utils/commands.md)、[turns.md](utils/turns.md)、[credentialLabel.md](utils/credentialLabel.md)、[relativeTime.md](utils/relativeTime.md)、[debugMode.md](utils/debugMode.md) |
| styles | [readme.md](styles/readme.md)、[tokens.md](styles/tokens.md)、[frame.md](styles/frame.md)、[components.md](styles/components.md)、[content-and-brand.md](styles/content-and-brand.md)、[debug.md](styles/debug.md) |
| regression | [readme.md](regression/readme.md)、[commands-and-shortcuts.md](regression/commands-and-shortcuts.md)、[session-flow.md](regression/session-flow.md)、[settings-and-credentials.md](regression/settings-and-credentials.md)、[shell-and-layout.md](regression/shell-and-layout.md)（不套四段式，见 §规则） |
