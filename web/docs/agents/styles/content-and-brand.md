# 内容组件库样式与品牌令牌（`content.css` / `bgm.css`）

## 简介

`bgm.css`（Bangumi 品牌令牌：`--bgm-*` 定义与 `--dsw-*` 别名重定向，**不含任何形态规则**）与 `content.css`（内容组件库样式）的约定，以及两者的改动分工；§索引 末尾另登记 `library.css`（组件库文档页的布局与排版：三栏粘性、三栏统一白底、右侧自绘目录、内容区排版；骨架交给 antd、配色在 `page/library/theme.ts`，它只由 `library.tsx` 引入）。

**不覆盖**：外壳与会话区（见 [frame.md](frame.md)）、确认卡与输入区与弹窗（见 [components.md](components.md)）；令牌本体的来源与内容清单见 [tokens.md](tokens.md)。

上层：[readme.md](readme.md)。相关：[../components/content.md](../components/content.md)。

## 使用说明

- **改品牌色之前先读 §规则**：本篇专属 5 条、「为什么只剩令牌」、「`content.css` 的约定」都在那里——为什么不能重写 `tokens.css`、为什么不能再往 `bgm.css` 加形态规则，答案都在那两段里。
- **只想核对某个形态的正确值、或查某个内容条目的类名**：直接查 §索引（视觉规范要点表、`content.css` 的 kind 清单），不必通读 §规则。
- **判断该改令牌还是改组件样式**：查 §规则 末条「两者的改动规则」那张表。
- **改组件库文档页的排版**（`web/library.html` 那一页）：查 §索引「`library.css`（~315 行）：组件库文档页的布局与排版」；**不要**在那里覆写 `content*` 类。这一页的**骨架**（顶栏 / 导航 / 搜索 / 卡片 / 表格）由 antd 提供、配色在 `page/library/theme.ts`，见 [../page/library.md](../page/library.md)。

## 规则

### 本篇专属规则

本层通用规则见 [readme.md](readme.md) 的 §规则「六条硬规则」。本篇专属：

1. **`bgm.css` 必须在 `tokens/frame/composer/cards/modal` 之后引入** —— 违反后果：重定向失效，颜色回到 DSH 默认（见本层 [readme.md](readme.md) §规则「引入顺序是契约」）。
2. **`bgm.css` 里只放令牌**：新增形态（圆角、描边、hover、阴影…）写进对应组件的样式文件，**不要**在这里加形态规则 —— 违反后果：属性出现第二个来源，改组件样式看不到效果（见本层 [readme.md](readme.md) §规则「同一元素同一属性只有一个来源」）。
3. **只重定向组件实际引用到的别名**，不顺手加无关条目 —— 违反后果：后续核对变难。
4. **`content.css` 用 `content` 前缀、不写主题分支** —— 违反后果：与品牌层脱节或样式污染。
5. **派生色用 `color-mix()` 就地算，并保留不支持时的固定值兜底** —— 违反后果：写死色值后换令牌不跟随。

### 为什么只剩令牌

`tokens.css` 有 270 余个变量，5 个形态文件合计约 60KB 规则。整体重写 DSH 语义层的回归面远大于收益，所以做法是"令牌重定向"：换品牌色只改 `--bgm-*`，所有消费语义别名的组件一起变色。

**因此 `bgm.css` 必须在 `tokens/frame/composer/cards/modal` 之后引入**（`main.tsx` 里的顺序即契约）——它靠"后定义覆盖先定义"生效。

### `content.css` 的约定

这一节覆盖的 kind 清单与降级块见 §索引「`content.css`（~1100 行）」。写法约定如下：

1. **品牌色只用 `--bgm-*`**，表面/描边/圆角/阴影/时长用 `--app-*`（后者本身就是从 `--bgm-*` 派生的，见 [tokens.md](tokens.md)）；
2. **类名统一 `content` 前缀**，与组件一一对应（静态复刻页 `docs/bgm-design/component-library.html` 用的是同一批类名，该目录未纳入版本控制）；
3. **不写主题分支**：界面只有浅色一套，所以不关心主题属性挂在哪一层；
4. **派生色用 `color-mix()` 就地算**，不写死十六进制——换令牌即可整体换色；不支持 `color-mix` 的环境用上一行的固定值兜底（两行同属性是刻意的）；
5. **布局自适应容器宽度**：网格用 `auto-fill`；表格类在窄宽度下**横向滚动**（`.contentTableScroll`）而不是挤爆；
6. **文件末尾的补充节**以 `@media (hover: hover)` 包裹：hover 才有的位移、边框与阴影都放在那里，避免触摸设备上"点一下就粘住"的悬停态。

### `content.css` 这一轮的 10 处修复（已归纳为写法规则）

1. **空态是块，不是一行灰字**：`.contentEmpty` = 虚线描边（`--app-hairline-strong`）+ 浅底（`--app-surface-sunken`）+ 居中 + `--app-radius-control`。12 个 `kind` 里 **10 个**共用它（`DataTable` 的文案是「没有可展示的列。」），`quote`（空文本渲染空 body）与 `callout`（空文本只留标记）没有空态块。
2. **简写与长写的顺序**：`.contentCallout` 的 `border-left-width` 一旦写在 `border` 简写**之前**就会被重置成 1px（本轮修的就是这个 bug，现在左侧 3px）。给元素加"某一侧的强调线"时要么写全 `border-left`，要么放在 `border` 之后。
3. **长度 / 高度 / 进度一律走 `transform`，不写 `width` / `height`**：`.contentStatBar` 用 `scaleX()`（`transform-origin: left center`）、`.contentStatColumnBar` 用 `scaleY()`（`origin: bottom center`）、`.contentProgressBar` 用 `scaleX()`。违反后果：数据刷新触发布局重排，违反 [AGENTS.md](../../../AGENTS.md) §规则「外观层硬约定」第 3 条。
4. **竖向柱不是填充条**：`.contentStatColumnBar` 宽度收到 **62%**（与轨道同宽会被读成"填充条"）、渐变改**垂直**（`0deg`，官方那版水平渐变套在柱子上方向是错的）、轨道底色压淡（`color-mix(in srgb, var(--bgm-border-soft) 55%, transparent)`）。
5. **表头整格可点**：`.contentTable thead th` 的 `padding` 归零，`.contentTableSort` 用 `padding: 8px` + `width: 100%` 铺满单元格，hover 有底色（`--app-primary-veil`）。实测点击区 18px → 34px。
6. **表格标题视觉隐藏**：`.contentTableCaption` 用 `position: absolute` + 1px 裁剪（`clip-path: inset(50%)`）只留给读屏器——区块标题 `h3` 已经显示过同一个词，可见的 caption 会把标题读两遍。
7. **同一属性只声明一次**：删掉 `.contentTable tbody td` 里重复声明的 `border-bottom`（本层通用规则「同一元素同一属性只有一个来源」）。
8. **封面占位不用斜纹**：`.contentSubjectCover[data-empty="true"]` = 纯色（`--bgm-surface-alt`）+ `inset` 内描边；`repeating-linear-gradient` 斜纹在密集网格里像噪点，会盖过真实内容。
9. **时间线是一条轴 + 每行一个节点**：`.contentTimelineList::before` 画容器的**连续竖轴**，`.contentTimelineRow::before` 是每行的节点圆点（首项用主色：`box-shadow: 0 0 0 2px var(--bgm-primary)`）。此前每行各画一段 `border-left`，行距一拉开线就断了。
10. **行级入场用 keyframes**（见 [../components/content.md](../components/content.md) §规则「行级入场用 CSS keyframes（`contentRowIn`），不用 JS 观察器」）：`.contentInfoRow` / `.contentTimelineRow` / `.contentSubjectRow` / `.contentLinkRow` 只动 `opacity` / `transform`，前 5 行错峰 30ms 递增，`prefers-reduced-motion: reduce` 下静止。

### 两者的改动规则

| 想做的事 | 改哪里 | 注意 |
|---|---|---|
| 调整品牌主色 / 交互色 | `bgm.css` 的 `--bgm-*` 定义 | 会成片影响全部组件；按 [../regression/shell-and-layout.md](../regression/shell-and-layout.md) 全量回归 |
| 新增一种内容条目的样式 | `content.css` | 类名 `content` 前缀；只用上述两套令牌；同步登记 [../components/content.md](../components/content.md) |
| 让某个组件脱离品牌外观 | 改该组件样式文件里那一条规则 | 不要往 `bgm.css` 加覆写 |
| 引入新的 `--dsw-*` 重定向 | `bgm.css` | 只重定向组件**实际引用**的别名；顺手加无关条目会让后续核对变难 |
| 改弹窗形态 | `modal.css` | 形态与几何现在都在那里；`bgm.css` 只提供令牌 |
| 改某处圆角 / 阴影 / 时长 | 优先改 `--app-*` 令牌 | 单点特殊形状才在组件规则里写；见 [tokens.md](tokens.md) |
| 改组件库文档页的**排版**（三栏粘性、三栏统一白底、右侧自绘目录、预览卡 / 代码块 / 参数表） | `library.css` | 只写 `lib*` 类，**不覆写 `content*`**；骨架（顶栏 / 导航 / 搜索 / 卡片 / 表格）归 antd、配色归 `page/library/theme.ts`——改 `--bgm-*` 令牌时要同步改它；它只由 `library.tsx` 引入，不进 `main.tsx` 的样式链 |
| 改内容条目被 vendor 组件包一层后的外观 | 先用**组合类**（如 `.contentSubjectSpotlight` / `.contentTagGlare` / `.contentCalloutGlow`），或在 `content.css` 改那一条唯一来源 | [../components/readme.md](../components/readme.md) §规则「ReactBits 组件按用途落点」 |

## 索引

### 章节 → 场景

| 章节 | 什么时候读 |
|---|---|
| §索引 → `bgm.css` / §规则 → 为什么只剩令牌 | **改品牌色前必读**（理解为什么不能重写 `tokens.css`，也不能再往这里加形态） |
| §索引 → 视觉规范要点 | 核对某个形态的正确值（弹窗、卡片、胶囊、chip、字体） |
| §索引 → `content.css` / §规则 → `content.css` 的约定 | 改内容条目样式时（`content` 前缀，消费 `--bgm-*` / `--app-*`） |
| §规则 → `content.css` 这一轮的 10 处修复 | 改内容条目的空态、条形 / 柱高 / 进度、表头点击区、表格标题、封面占位或时间线时（**先读这一节再动手**） |
| §索引 → `library.css` | 改组件库文档页的排版、或问"`library.css` 为什么不在 `main.tsx` 里"时 |
| §规则 → 两者的改动规则 | 判断该改令牌还是改组件样式 |

### `bgm.css`（~150 行）：Bangumi 品牌令牌

依据 `docs/bgm-design/ui-style.md`（bgm.tv r771 实测）与 `style-preview.html`，只做两件事：

1. **定义 `--bgm-*` 品牌令牌**（主色、交互色、状态色、表面、文字、描边、圆角阶梯、字体栈、弹窗与焦点阴影等，共 40 条）；
2. 把组件样式**实际引用到的** 60 条 `--dsw-*` / `--dsh-*` 语义别名**重定向**过去——既有颜色与描边会成片跟着变。

文件里**没有任何形态规则**：圆角、描边、hover 填充、点线分隔这些形状原先集中在品牌形态层里，现在已就地并入 `frame.css` / `composer.css` / `cards.css` / `modal.css` / `content.css`。

### 视觉规范要点

| 项 | 值 |
|---|---|
| 主色（选中/强调） | 粉色 `#f09199`；文字态用 `--bgm-primary-text`（`#a8575f`） |
| 交互色（hover） | 蓝 `#369cf8` |
| 危险色 | `#c00`（`--bgm-danger`） |
| 卡片 | 1px 描边（`--app-hairline` 或 `--bgm-border`）+ 10px 圆角（`--app-radius-control`），浮起靠 `--app-shadow-raised`，hover 升到 `--app-shadow-card` 并上移 2px（只在 `@media (hover: hover)` 下） |
| 列表 | 分类用实线、条目用点线（`--bgm-dotted`）；下拉与菜单行 hover = 整行填充交互蓝 + 白字 |
| 标签胶囊 | 主色描边 + `--bgm-primary-soft` 底 + `--bgm-primary-text` 字；选中反转为主色实心白字（`data-selected="true"`） |
| 连接状态 chip | 描边胶囊 + 左侧 6px 圆点：`data-state="on"` 绿底绿晕、`"off"` 红底红晕（文案同时表态） |
| 弹窗 | 15px 圆角（`--app-radius-panel`）+ `--app-shadow-panel`；表面是不透明的 `--app-surface`；遮罩 `rgba(40, 40, 40, .32)` |
| 弹窗标题栏 | 固定 40px：16px/600 标题（`--bgm-text-strong`）+ 右侧 30×30 点击区里的 15px 细线 ×，下压 1px `--app-hairline` 分隔线 |
| 弹窗内容区 | 15px 内边距；字段名是控件上方 12px 灰字；输入框 10px 圆角 + 1px `#d9d9d9`（`--bgm-input-border`）；聚焦走粉色边框 + 3px `--app-primary-veil` 光晕 |
| 弹窗按钮与底栏 | 主按钮粉色实心白字；次要按钮（`.ghost` / `.outline`）`--bgm-border-soft` 底 + `#888` 字；hover 都落交互蓝；底栏上方有 1px `--app-hairline` 分隔线 |
| 字体 | 系统 UI 字体栈（不再使用打包进来的 Montserrat）；正文 14px、次级 13px（不采用站点的 12px 正文基准） |
| 保留项 | 可见焦点环；关键信息不依赖 hover——这两条是刻意规避站点自身可用性问题 |

会话流里的宿主提示（`notice` / `error` 条目）改用 harness 的行内语汇：提示是淡底无描边的一行说明，错误是状态点 + 文本，都不是整条彩色横幅；三段式语义底色只留给正文里的提示块（`callout`）。

### `content.css`（~1100 行）：内容组件库样式

服务 `components/content/` 的 12 个 `kind`（`subjects` / `stats` / `progress` / `infobox` / `table` / `timeline` / `tags` / `gallery` / `compare` / `quote` / `callout` / `links`），另有降级块 `.contentFallback`。

`.contentBlock` 上集中算一次语义派生变量（`--content-accent` / `--content-accent-text` / `--content-accent-soft` / `--content-warn` / `--content-warn-soft`），其余规则引用它们。写法约定见 §规则「`content.css` 的约定」；本轮改动的 10 条结论见 §规则「`content.css` 这一轮的 10 处修复」。

### `library.css`（~315 行）：组件库文档页的布局与排版

只服务组件库文档页（`web/library.html` + `web/src/library.tsx`，见 [../page/library.md](../page/library.md)），**不进 `main.tsx` 的样式链**：

- **骨架不在这里**：顶栏、左侧导航、搜索框、卡片、表格的形态由 antd 提供，配色由 `page/library/theme.ts` 的 `ConfigProvider` token 决定（**改 `--bgm-*` 令牌时要同步改它**，见 [../page/library.md](../page/library.md) §规则「配色映射的唯一代价」）。`library.css` 只负责 antd 管不了的那部分：**三栏粘性布局**（`.libHeader` / `.libSider` / `.libTocSider` 都是 `sticky`）、顶栏内元素间距、右侧**自绘**目录（`.libToc*`，不用 antd 的 `Anchor`）、内容区（预览卡 / 代码块 / 参数表 / 参考行）的少量排版，以及窄屏适配；
- 只声明 `lib*` 前缀的类（`.libFrame`、`.libHeader` / `.libBrand*` / `.libSearch` / `.libTopMenu` / `.libHeaderActions`、`.libBody` / `.libSider` / `.libNavMenu`、`.libContent*`、`.libToc*`、`.libPageTitle` / `.libPageSummary`、`.libBlock*`、`.libPreviewCard`、`.libCode*`、`.libCustomType`、`.libParamTable`、`.libReference*`、`.libEmptyHint`、`.libOverview*` / `.libKindTag`），**不覆写任何全局存在的类**（`content*` 一律不改）；唯一的例外是三条**只在本页类名上下文里**给 antd 元素让位的排版规则——`.libPreviewCard .ant-card-body`（预览卡底）、`.libCodeCard .ant-card-body`（代码块去掉卡片内边距）与 `.libParamTable .ant-table`（表内字号），它们命中的都是本页自己渲染出来的那一个 antd 元素；
- 配色走 `--bgm-*` / `--app-*`，需要透明度时用 `color-mix()` 就地派生（**不写裸色值**）——这一页的间距与阴影尺度可以自定，配色必须与站点一致；
- **三栏统一白底**：`.libFrame` / `.libBody` / `.libContent` 的 `background` 都是 `var(--bgm-surface)`（白 `#fff`），三栏靠 `.libSider` 的 `border-right`、顶栏的 `border-bottom` 这类 1px hairline 分区——此前是灰底（`--bgm-bg` `#f5f5f5`）配白卡；理由与边界见 [../page/library.md](../page/library.md) §规则「三栏统一白底，靠 1px hairline 分区」；
- 窄屏：`@media (max-width: 1100px)` 隐藏右侧目录（`.libTocSider { display: none }`），`@media (max-width: 860px)` 顶栏换行、`.libBody` 由 flex 三栏改单列、左导航由 sticky 变回静态；
- 改这一页的**排版**改这里；改**条目本身**的形态去 `content.css`——在 `library.css` 里改 `.content*` 会让同一属性出现第二个来源。
