# page/lab：卡片实验室

> 覆盖 `web/src/page/lab/` ｜ 核对 2026-10-12

## 功能介绍

`/lab` 是**内容块的调试台**，版式对齐卡片工作台：三列——左 200px「卡片」列表 / 中「模拟聊天栏」
预览（工具条长在这一列上，右侧是「组件库」与「原始 JSON」；预览内容放在**与 `.appStageColumn` 同宽（900px）
的居中列**里，不加头像与气泡——助手消息在真实会话里就是裸内容块）/ 右 424px「配置项」（字段名 + 可选勾选 +
控件 + 说明，头部带「边界状态」切换与 `‹ ›`，底部唯一主按钮是「复制载荷 JSON」）。

数组字段渲染成**结构化列表编辑器**（「第 N 项 + 删除 + 添加一项 + 子字段控件」），不再是一段 JSON
文本框：改一条条目不用碰语法。元素形状不是对象时（`Record<string,string>[]`、`string[]`）仍然退回文本框。

边界状态（默认 / 空载荷 / 缺必填 / 类型错误）**由字段元数据现场推**，不引 `cases` 文件：哪个 kind
适合哪些状态也由它的字段决定（没有必填字段就没有「缺必填」，没有数字/JSON 字段就没有「类型错误」）。

它取代了原来的 `/debug`（手输 event / frame 的宿主模拟器）。差别是**粒度**：调试页演练的
是整条会话（帧、轮次、流式、写入确认），实验室只管**一个内容块的载荷**——载荷坏了怎么降级、
哪种密度更好看，都在这里看。会话级行为现在只由宿主与主界面负责，前端不再复刻模拟器。

## 索引

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `index.tsx` | 入口与装配：当前 kind、字段草稿、边界状态、原始 JSON 开关、复制与重置 | `web/src/page/lab/index.tsx` | 改实验室的装配与交互 |
| `types.ts` | `LabCard` / `LabField` / `LabFieldKind`：与生成物 `content-cards.generated.json` 同形（手写，因为 JSON 导入推断出的是宽泛类型） | `web/src/page/lab/types.ts` | 改生成物结构时同步 |
| `reducer.ts` | 纯函数：字段草稿 ↔ payload、JSON 文本 ↔ payload | `web/src/page/lab/reducer.ts` | 改字段与载荷之间的转换规则 |
| `components/LabCardList.tsx` | 左列：12 种 kind（名称 + kind 名）；选中态品牌色浅底 | `web/src/page/lab/components/LabCardList.tsx` | 改左侧列表 |
| `components/LabFieldForm.tsx` | 右列「配置项」：字段名 + 可选勾选 + 控件 + 说明；`list` 字段交给内部的 `LabListField` 渲染子卡组 | `web/src/page/lab/components/LabFieldForm.tsx` | 改控件形态或可选字段的「缺省」开关 |
| `components/LabPreview.tsx` | 预览：真实 `ContentBlock`（外面包 `ContentErrorBoundary`）；列宽与外壳由 `index.tsx` 的 `.labColumn` 给 | `web/src/page/lab/components/LabPreview.tsx` | 改预览区 |
| `styles/lab.css` | 版式（`.labFrame` 三列网格）与皮肤，只用令牌 | `web/src/page/lab/styles/lab.css` | 改实验室皮肤 |

## 规则

### 单一真相源

**1. 字段表单不手写，全部来自生成物。**

- **规则**：`content-cards.generated.json` 由 `node web/tools/gen-content-cards.mjs` 从各组件自己声明的 `XxxProps` interface + JSDoc 生成；组件加了字段、改了枚举、写了例值，重跑脚本即可，实验室代码一行不用改。
- **为什么**：手写表单会和组件的真实入参漂移，而漂移的表现是「实验室里改不到那个字段」——不报错，也没人发现。
- **后果**：`node web/tools/gen-content-cards.mjs --check` 会把「生成物与源码不一致」判成失败，所以生成物永远不许手改。

### 复用真实链路

**2. 预览必须走 `ContentBlock`，不许直接调组件。**

- **规则**：`<ContentBlock block={{ type, pending: false, props }} />`，外面套 `ContentErrorBoundary`。
- **为什么**：只有走分发器，实验室才同时验证「注册表映射正确」与「组件的降级形态」；直接调组件会绕开 `CONTENT_RENDERERS`，改注册表时实验室发现不了。
- **后果**：分成两条渲染路径后，实验室里正常的块在会话里可能渲染不出来。

### 与文档页的分工

**3. 文档页讲契约，实验室改数据。**

- **规则**：`/library` 只读（预览 + 参数表 + 可复制的载荷 JSON），`/lab` 可编辑。两页都不 import 对方的 constants/utils（`web/AGENTS.md` 规则 2：页面之间不互引）；实验室的字段元数据来自生成物，不来自 `page/library/constants/sections.ts`。
- **为什么**：文档页的数据是「一份好样例」，实验室要的是「控件该长什么样」——两件事的真相源不同。
- **后果**：互相 import 会把两页焊在一起，改一页的两页都红。

### 边界状态不写用例文件

**4. 「边界状态」由字段元数据现推，不引 `cases` 文件。**

- **规则**：`index.tsx` 的 `CASES` 只定义「草稿变换」（全清空 / 清必填 / 数字填非数、JSON 填标量），`casesOf(card)` 再按该 kind 的字段筛掉无意义的状态。新增字段不需要动它。
- **为什么**：写死的用例表会随字段漂移，而漂移的表现是「实验室里那个状态点了没反应」；用元数据推则字段一改状态自动跟着变。
- **后果**：它测不到业务语义（缺图、重复 id、未知货币），那些仍要手写或靠真实会话发现。

### 预览列宽必须与真实会话一致

**5. 预览不加头像/气泡，列宽照抄 `.appStageColumn`。**

- **规则**：`.labChat` 里的 `.labColumn` 用 `max-width: 900px; margin: 0 auto`，外层 24px 内距；`.labAssistant` 给 `padding-left: 10px` + `border-left: 1.5px`（照抄 `.assistantBody`）；面板底色是 `--bgm-surface`（照抄 `.appConversation` 的白底）。这三个数都是从真实会话页实测的。**不要给预览套气泡或头像。**
- **为什么**：套一层气泡等于换了容器宽度，实验室里看着刚好的卡片，进了会话会换行、会变大变小；而 bgm 的助手消息本来就没有气泡。
- **后果**：列宽一旦漂移，`SubjectCards` 的网格列数、`DataTable` 的横向滚动、文本换行全都会与真实会话对不上，而这类差异在实验室里完全看不出来。

**6. 底部输入框是假的，只为「像会话」。**

- **规则**：`.labComposer` 只有外观（18px 圆角卡 + 提示文案 + 圆形按钮），容器带 `aria-hidden="true"` 且不接任何事件。
- **为什么**：预览需要「会话内」的比例感——没有输入框时，内容块贴着窗口底部，看不出真实留白。
- **后果**：一旦给它接上事件，实验室就会出现第二个会写数据的入口，而它没有宿主校验、没有登录态，写出去的行为不可预期。
