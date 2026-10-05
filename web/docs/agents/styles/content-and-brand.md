# 内容组件库样式与品牌令牌（`content.css` / `bgm.css`）

## 简介

`bgm.css`（Bangumi 品牌令牌：`--bgm-*` 定义与 `--dsw-*` 别名重定向，**不含任何形态规则**）与 `content.css`（内容组件库样式）的约定，以及两者的改动分工。

**不覆盖**：外壳与会话区（见 [frame.md](frame.md)）、确认卡与输入区与弹窗（见 [components.md](components.md)）；令牌本体的来源与内容清单见 [tokens.md](tokens.md)。

上层：[readme.md](readme.md)。相关：[../components/content.md](../components/content.md)。

## 使用说明

- **改品牌色之前先读 §规则**：本篇专属 5 条、「为什么只剩令牌」、「`content.css` 的约定」都在那里——为什么不能重写 `tokens.css`、为什么不能再往 `bgm.css` 加形态规则，答案都在那两段里。
- **只想核对某个形态的正确值、或查某个内容条目的类名**：直接查 §索引（视觉规范要点表、`content.css` 的 kind 清单），不必通读 §规则。
- **判断该改令牌还是改组件样式**：查 §规则 末条「两者的改动规则」那张表。

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

这一节覆盖的 kind 清单与降级块见 §索引「`content.css`（~980 行）」。写法约定如下：

1. **品牌色只用 `--bgm-*`**，表面/描边/圆角/阴影/时长用 `--app-*`（后者本身就是从 `--bgm-*` 派生的，见 [tokens.md](tokens.md)）；
2. **类名统一 `content` 前缀**，与组件一一对应（静态复刻页 `docs/bgm-design/component-library.html` 用的是同一批类名，该目录未纳入版本控制）；
3. **不写主题分支**：界面只有浅色一套，所以不关心主题属性挂在哪一层；
4. **派生色用 `color-mix()` 就地算**，不写死十六进制——换令牌即可整体换色；不支持 `color-mix` 的环境用上一行的固定值兜底（两行同属性是刻意的）；
5. **布局自适应容器宽度**：网格用 `auto-fill`；表格类在窄宽度下**横向滚动**（`.contentTableScroll`）而不是挤爆；
6. **文件末尾的补充节**以 `@media (hover: hover)` 包裹：hover 才有的位移、边框与阴影都放在那里，避免触摸设备上"点一下就粘住"的悬停态。

### 两者的改动规则

| 想做的事 | 改哪里 | 注意 |
|---|---|---|
| 调整品牌主色 / 交互色 | `bgm.css` 的 `--bgm-*` 定义 | 会成片影响全部组件；按 [../regression/shell-and-layout.md](../regression/shell-and-layout.md) 全量回归 |
| 新增一种内容条目的样式 | `content.css` | 类名 `content` 前缀；只用上述两套令牌；同步登记 [../components/content.md](../components/content.md) |
| 让某个组件脱离品牌外观 | 改该组件样式文件里那一条规则 | 不要往 `bgm.css` 加覆写 |
| 引入新的 `--dsw-*` 重定向 | `bgm.css` | 只重定向组件**实际引用**的别名；顺手加无关条目会让后续核对变难 |
| 改弹窗形态 | `modal.css` | 形态与几何现在都在那里；`bgm.css` 只提供令牌 |
| 改某处圆角 / 阴影 / 时长 | 优先改 `--app-*` 令牌 | 单点特殊形状才在组件规则里写；见 [tokens.md](tokens.md) |

## 索引

### 章节 → 场景

| 章节 | 什么时候读 |
|---|---|
| §索引 → `bgm.css` / §规则 → 为什么只剩令牌 | **改品牌色前必读**（理解为什么不能重写 `tokens.css`，也不能再往这里加形态） |
| §索引 → 视觉规范要点 | 核对某个形态的正确值（弹窗、卡片、胶囊、chip、字体） |
| §索引 → `content.css` / §规则 → `content.css` 的约定 | 改内容条目样式时（`content` 前缀，消费 `--bgm-*` / `--app-*`） |
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

### `content.css`（~980 行）：内容组件库样式

服务 `components/content/` 的 12 个 `kind`（`subjects` / `stats` / `progress` / `infobox` / `table` / `timeline` / `tags` / `gallery` / `compare` / `quote` / `callout` / `links`），另有降级块 `.contentFallback`。

`.contentBlock` 上集中算一次语义派生变量（`--content-accent` / `--content-accent-text` / `--content-accent-soft` / `--content-warn` / `--content-warn-soft`），其余规则引用它们。写法约定见 §规则「`content.css` 的约定」。
