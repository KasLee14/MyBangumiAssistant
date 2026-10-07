# 外壳与会话区（`frame.css`）

## 使用说明

### 这份文档是什么

`frame.css` 的分区索引与骨架约束：`.appFrame` 的两列网格与槽位契约、侧栏（含抽屉式收起）、会话容器的尺寸链、消息行 / 过程区 / 轮尾操作行、Markdown、响应式，以及一批「看着可以简化、其实不能动」的写法。

**不覆盖**：输入区（见 [composer-cards-modal.md](composer-cards-modal.md)）、内容条目（见 [content.md](content-and-brand.md)）、令牌定义（见 [tokens.md](tokens.md)）、组件实现（见 [../components/main-page.md](../components/main-page.md)、[../page/readme.md](../page/readme.md)）。上层入口：[../readme.md](../readme.md)。

### 怎么读

| 你要改的地方 | 读哪一节 |
|---|---|
| 外壳网格、槽位、侧栏收放 | §索引「框架与侧栏」 |
| 会话滚动、列宽、首屏 | §索引「会话主区」 |
| 用户气泡、助手正文、错误行 | §索引「消息」 |
| 思考行、工具行、轮首控制行 | §索引「过程区」 |
| 复制按钮、用量面板 | §索引「轮尾操作行」 |
| 正文里的标题 / 表格 / 代码 | §索引「Markdown」 |
| 不确定某个写法能不能简化 | §规则 |

### 必须遵守的规则

1. **`.appFrame` 是两列一行，没有 `top` 行**：`grid-template-areas: 'side main'`，槽位是 `.appSidebar`（`grid-area: side`）与 `.appConversation`（`grid-area: main`）。顶栏已按设计决策 C01 删除，功能全在侧栏。调试页需要顶栏，由 `debug.css` 只在 `[data-mode='debug']` 上把三段式网格恢复回来。违反后果：调试页的 `AppTopBar` 会被自动放置到隐式的第二行，宽度只等于侧栏列宽。
2. **`.appStage` 是尺寸容器（`container-type: inline-size`）**：列宽与输入卡宽度都按 `cqw` 算，`cards.css` 的卡宽度轴也依赖它。违反后果：`cqw` 解析成视口宽度，内容列在窄屏上撑爆。
3. **内容列宽度只有一处来源**：`min(calc(100cqw - 48px), clamp(680px, 64cqw, 900px))`。`.appStageColumn`（这里）与 `.appComposerStack`（`composer.css`）共用同一条，卡片只写 `width: 100%`。违反后果：输入卡与内容列错位。
4. **会话区不做 layout 动画**：`.appStageScroll` 里用了 `content-visibility: auto` 做屏外优化，流式期间另有 `memo`。违反后果：layout 动画会强制重排，这两条优化同时失效（见 [../readme.md](../readme.md) §规则第 4 条）。
5. **`.appSidebar` 的 `position: relative; z-index: 1` 不能删**：侧栏与对话区**同为白面**，分层完全靠侧栏投出的 `--app-shadow-edge`；两块都是 grid item，对话区在 DOM 里靠后，会把侧栏的阴影盖掉。违反后果：分区消失，两块白面糊成一片。
6. **侧栏收起是抽屉，不是压扁**：内容**锁宽**（`--app-sidebar-content`）并整体左移，窗口（grid 列宽）随后收窄到 0；位移用短一档的时长（240ms）而窗口用 360ms。违反后果：内容宽度自适应会被一路压窄，文字被挤——那不是「收起来」。
7. **行距不用 `flex gap`，用相邻兄弟 `margin-top`**：过程紧凑、回答分开。违反后果：过程行之间被撑开，一轮里「思考 / 工具 / 正文」的层级感丢失。
8. **改任何 DOM 骨架前先回读本文件**：`.appFrame` 的网格、两个槽位、`.appStage*` 内部链、`.appComposerDock` 被样式大量依赖（容器查询、屏外优化、贴底滚动）。违反后果：三处优化同时失效且没有报错。

## 索引

### 框架与侧栏

| 选择器 | 作用 | 不能动的点 |
|---|---|---|
| `.appFrame` | 外壳网格：`grid-template-columns: var(--app-sidebar-width) minmax(400px, 1fr)`、`grid-template-rows: minmax(0, 1fr)`、`areas: 'side main'` | 列宽读 `--app-sidebar-width`，展开态由 `--app-sidebar-full` 给（**全站唯一那份 264px**），收起态重绑为 0；折叠过渡走 `grid-template-columns` 的 360ms |
| `.appFrame[data-sidebar='collapsed']` | 列宽归零（C44b 定稿是 0，不是 60px 窄条） | — |
| `.appFrame > .appSidebar` / `> .appConversation` | 两个槽位落位 | 用 `>` 组合选择器，避免污染共享组件的其它用法 |
| `.appSidebar` | 白面 + 向右发散阴影，无描边 | `position: relative; z-index: 1` 必需（见 §规则第 5 条） |
| `.appSidebarTop` / `-Brand` / `-Status` | 顶部一行：品牌、8px 连接状态点（`data-state='on'|'off'`）、折叠钮 | 配色走 `--bgm-*` 派生，语义色取状态色 |
| `.appSidebarNew` | 实心主色整行「开启新对话」 | 与 `cards.css` 的实心按钮同一套底色 / 字色 / hover 口径 |
| `.appSidebarScroll` / `-Group` | 分组列表（置顶 / 今天 / 昨天 / 7 天内 / 更早） | 就地展开（不是浮层），因为父级是滚动容器 |
| `.appSidebarUser` / `-Avatar` / `-UserName` | 底部用户行 + 齿轮「设置」入口 | 齿轮单击直达设置（C45 定稿 B，原「···」浮层菜单已删） |
| `.appCollapseBubbles` | 收起态的两个入口气泡（展开 / 新对话） | 绝对定位在 `.appFrame` 上、**不参与 grid** |
| `@keyframes app-frame-in` | 外壳入场（`opacity` 0→1） | — |

### 会话主区

| 选择器 | 作用 | 不能动的点 |
|---|---|---|
| `.appConversation` | 对话区容器 | 与侧栏同为白面 |
| `.appStage` | 尺寸容器：`container-type: inline-size` | 见 §规则第 2 条 |
| `.appStageBody` / `.appStageScroll` | 滚动体：`overflow-y: auto`、`scrollbar-gutter: stable`、`scroll-behavior: smooth` | 平滑滚动被轮次导航与「回到底部」共用 |
| `.appStageScroll[data-phase='hero']` | 首屏态垂直居中 | — |
| `.appStageFlow` | 内边距 `20px 24px 8px` | — |
| `.appStageColumn` | 内容列：宽度轴（见 §规则第 3 条）+ `margin: 0 auto` | 宽度轴与 `composer.css` 的 `.appComposerStack` 必须同值 |
| `.appTurn` / 屏外轮次优化 | `content-visibility: auto` | **故意不配 `contain-intrinsic-size`**：给固定估算高度虽能让首帧更快，但会话切换后「滚到最新一条」会按估算高度落位，等真实高度算出来后视图停在历史中段（实测偏差可达 3000px+）。滚动位置正确比省一次布局更值 |

### 消息

| 选择器 | 作用 | 不能动的点 |
|---|---|---|
| `.userRow` / `.userStack` | 用户消息右对齐 | 气泡最大宽 **88%**（C38 定稿 B，原 78%） |
| `.bubble` | 用户气泡：主色浅底 `#fdeff0` + `1px solid rgba(236,101,112,.22)` + 主色深字 + 四角一致 + **无阴影** | 早先写成「右下角不对称圆角 + raised 阴影 + 中性深字」三处都偏离样张，不要再回去 |
| `.assistantRow` / `.assistantBody` | 助手正文 | `.assistantBody` 有左侧 2px 槽线 + 10px 内缩（在文件的「外观层补充」段） |
| `.errorRow` / `.stateDot` / `.errorText` | 错误条目 | 状态点是 `::after` 内缩 20% 的实心圆；文本 `overflow-wrap: anywhere` |

### 过程区

结构是**轮首控制行 + 过程行列表**，两者是同一级折叠（本项目一轮只对应一个过程组）：

| 选择器 | 作用 | 不能动的点 |
|---|---|---|
| `.processBar` / `.processBarTitle` / `.processBarText` | 轮首控制行：图标 + 文字 + 状态 | 标题本身就是状态行——进行中与失败由**文字着色**表态；左侧 2px 主色槽线 + 右转圆角 |
| `.processGroupBody` | 过程行列表容器 | — |
| `.reasoningRow` | 思考行（流式期与历史期**同一个组件**，流式期用一个合成条目喂它） | 不要为流式另写形态，否则文本写完那一瞬会跳变 |
| `.toolRow` | 工具行（子调用递归缩进） | 参数摘要 / 结果内容块由宿主导出，样式只负责呈现 |
| 参数与结果体 | 工具行的展开体 | 结果体交给内容块渲染器（`.contentBlock`），**不在过程区另长一套卡片族** |
| 折叠容器 | `hidden="until-found"` | 用这个属性而不是 `display:none`，Ctrl+F 才能命中折叠内容并自动展开 |

### 轮尾操作行与 Markdown

| 选择器 | 作用 |
|---|---|
| `.turnActions` | 轮尾复制按钮 + 每轮用量面板（面板材质直接引共享类 `.appGlass`） |
| `.markdown`（含 `code` / 表格 / 列表等） | 正文排版：标题四档取自 `--app-font-md-h1..h4`，行内 `code` 走 `--bgm-sunken`，代码字体栈 `--bgm-mono` |
| `.appStreamingCursor` | 流式光标：6×13px 实心方块 + 1.06s 硬切闪烁（不用 `TextType` 接管真实文本） |

### 响应式与文件末段

| 段 | 作用 |
|---|---|
| 响应式（`@media`） | 窄屏自动收起侧栏（`--app-sidebar-width: 0px`） |
| `prefers-reduced-motion` | 关掉 `animation`（`animation: none !important`） |
| 「外观层补充」段 | 集中放基础文件里没有的形状（由原先分散的覆写层合并而来）。**与基础同名的选择器已经并入上面的规则**，所以这里不会再出现「同一元素同一属性两个来源」；新增规则时如果发现要覆写上面已有的同名选择器，应该回上面改那一处，而不是在末段覆写 |

## 规则

### 为什么有「外观层补充」

文件历史上有一层独立的覆写样式表。合并进 `frame.css` 时把同名选择器**并入基础规则**，只把基础里没有的形状留在末段的「外观层补充」里。因此：

- 末段**不是**覆盖层，不要把它当「高优先级区」用；
- 要改一个已经存在的属性，改它原来的那一处；
- 只有在加**新**形状（新选择器）时才写进末段，或者直接写进它所属的分区。

### `frame.css` 里放什么、不放什么

放：外壳网格与槽位、侧栏全部形态、会话容器与轮次、消息行、过程区、轮尾操作行、流式区、Markdown。

不放：输入区（`composer.css`）、弹窗（`modal.css`）、确认卡（`cards.css`）、内容条目（`content.css`）、跨入口共享的表面原语（`common.css`）、调试页与文档页（`debug.css` / `library.css`）。

判据：**这段规则服务的元素只在这一个文件里被声明**。拿不准时看 `readme.md` §索引「文件 → 职责」。

## 现状：已知的写法与未做

1. **顶部数值注释指向 DSH 的组件清单**（文件头 1–13 行）：它记录的是「这些尺寸对齐的是上游哪个组件」，不是依赖——配色、圆角与阴影一律走本项目令牌，**不引入上游 `--dsw-*`**。
2. **过程区注释里仍写「不引入上游 `--dsw-*`」**：这是准确的（上游令牌已整体删除），保留它是因为它是条硬约束。
3. **`.appSidebarNew` 之外另有一条「同款实心按钮」规则**（约 1179 行，注释说明保留是因为样张脚手架 `web/docs/design/demo.js` 仍在用）：产品侧已无消费点，但删掉会让样张与实现分叉。动它之前先确认 `demo.js` 的三处引用。
4. **`.appConversation` 附近有一条已无消费点的遗留规则**（原粘性会话头留下的顶部留白，注释里写明「产品侧已无消费点」，连接状态已收成侧栏 8px 状态点）：改这段时顺手删，不要再往里加东西。
