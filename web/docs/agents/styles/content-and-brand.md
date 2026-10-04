# 内容组件库样式与 Bangumi 令牌层（`content.css` / `bgm.css`）

## 使用说明

### 这份文档是什么

`bgm.css`（**只有令牌**：`--bgm-*` 定义与 `--dsw-*` 别名重定向）与 `content.css`（内容组件库样式）的约定、视觉规范要点，以及两者的改动分工。

上层：[readme.md](readme.md)。相关：[../components/content.md](../components/content.md)。

### 怎么读（章节 → 场景）

| 章节 | 什么时候读 |
|---|---|
| §`bgm.css` → 它做什么 / 为什么只重定向 | **改品牌色前必读**（理解为什么不能重写 `tokens.css`） |
| §`bgm.css` → 视觉规范要点 | 核对某个形态的正确值（弹窗、卡片、胶囊、列表行、连接状态） |
| §`content.css` | 改内容条目样式时（只用 `--bgm-*`、`content` 前缀） |
| §两者的改动规则 | 判断该改令牌还是改组件样式 |

### 必须遵守的规则

本层通用规则见 [readme.md](readme.md) 的「必须遵守的规则」。本篇专属：

1. **`bgm.css` 必须在 `tokens/frame/composer/cards/modal` 之后引入** —— 违反后果：重定向失效，颜色与圆角回到 DSH 默认（见本层「引入顺序固定」）。
2. **`bgm.css` 里不写形态规则**，形态就近写进它所属的组件样式文件 —— 违反后果：同一元素的同一属性出现第二个来源。
3. **只重定向组件实际引用到的别名**，不顺手加无关条目 —— 违反后果：后续核对变难。
4. **`content.css` 只用 `--bgm-*`、类名 `content` 前缀、不写主题分支** —— 违反后果：与品牌层脱节或样式污染。
5. **派生色用 `color-mix()` 就地算，并保留不支持时的固定值兜底** —— 违反后果：写死色值后换令牌不跟随。

## `bgm.css`（160 行）：Bangumi 令牌层

### 它做什么

依据 `docs/bgm-design/ui-style.md`（bgm.tv r771 实测）与 `style-preview.html`，只做两件事：

1. 在 `:root` 定义 **40 个 `--bgm-*` 品牌令牌**（色板、表面、文字、描边、圆角、阴影、焦点、字体栈、关闭图标 `mask`）；
2. 在 `:root` 把组件样式**实际引用到的 61 条 DSH 令牌重定向**到 `--bgm-*`——既有颜色、描边、圆角与阴影会成片跟着变。

文件里**没有任何选择器**，因此也不可能有形态规则。形态规则的落点：外壳与会话区在 `frame.css`，输入区在 `composer.css`，卡片与按钮在 `cards.css`，弹窗在 `modal.css`，内容条目在 `content.css`。

### 为什么只重定向，不重写 `tokens.css`

`tokens.css` 有 271 条自定义属性声明，`frame/composer/cards/modal` 合计约 55KB 规则。整体重写的回归面远大于收益，重定向把改动收敛到"换一批令牌值"。

**因此 `bgm.css` 必须在 `tokens/frame/composer/cards/modal` 之后引入**（`main.tsx` 里的顺序即契约）——同名变量的覆盖靠"后定义生效"。反过来，`--app-*` 这类**引用**关系（`var(--bgm-*)`）在计算时才解析，不受先后影响。

### 视觉规范要点

| 项 | 当前值 |
|---|---|
| 主色（选中/强调） | 粉色 `#f09199`（`--bgm-primary`），浅底 `#fdf0f1`，深字 `#a8575f` |
| 交互色（hover / 焦点） | 蓝 `#369cf8`（`--bgm-interactive`） |
| 链接 | `#0084b4`（`--bgm-link`），hover 转交互蓝 + 下划线 |
| 表面层次 | 对话区与侧栏**同为白面**（`--app-surface` = `--bgm-surface`），靠 1px `--app-hairline` 分开；页面底色 `--bgm-bg`；卡内下沉块用 `--bgm-surface-alt` |
| 卡片 | 1px 描边 + 两级阴影浮起：内嵌元素 `--app-shadow-raised`、会话里的卡片 `--app-shadow-card`、浮层 `--app-shadow-panel`；**不靠底色差** |
| 圆角 | 只用两档：控件 `--app-radius-control`（= `--bgm-r-md` 10px）、容器 `--app-radius-panel`（= `--bgm-r-lg` 15px）；行内代码一类小元素用 `--bgm-r-sm`（5px）；胶囊、圆点与条形用 `--bgm-r-pill` |
| 列表 | 分类标题 12px 灰字；行高 32px；分隔用实线（内容/时间线）或点线（工具活动、动态）；hover 填充（侧栏会话行 `--bgm-surface-alt`，选择列表整行交互蓝 + 白字）；**当前项用主色浅底 + 主色文字，不用整块实心** |
| 标签/徽标 | 描边主色胶囊 + 主色浅底 + 主色文字；选中反转为主色实心白字 |
| 连接状态 chip | 描边胶囊 + 6px 圆点 + 3px 彩色光晕（`data-state='on'` 绿 / `'off'` 红），文案同时表态（「已连接」/「连接中断」），不只靠颜色 |
| 输入卡 | 底色、描边与边缘光由 `BorderGlow` 提供（`#fafafa` + 主色系光）；内层不再画边框与阴影；键盘聚焦补 3px `--app-primary-veil` 光晕 |
| 按钮 | 胶囊基元（`--bgm-r-pill`）：主按钮粉底白字、hover 落交互蓝；次要动作是 `#eee` 底 `#888` 字；按下 1px 位移或缩到 `.94`–`.97` |
| 弹窗 | 遮罩 `rgba(40, 40, 40, .32)`，**不做背景模糊**；表面 1px `--app-hairline-strong` + `--app-shadow-panel`；40px 标题栏 + 15px 细线 ×；内容区 15px 内边距 |
| 浮层材质 | 命令候选、思考菜单、统计面板的底色与描边走子层（`--dsw-specific-menu` = `--bgm-surface`，`--dsw-elevation-stroke` = 1px `--bgm-border`）；**背景模糊已关闭**（`--dsw-menu-backdrop-filter: none`） |
| 字体 | 系统 UI 字体栈（`--bgm-font`），不再使用打包进来的 Montserrat；正文 14px、次级 13px、辅助 12px（不采用站点的 12px 正文基准） |
| 焦点 | `--bgm-focus`（`0 0 0 2px rgba(54, 156, 248, .35)`）为主，个别控件（模态关闭键）用 `outline: 2px solid var(--bgm-interactive)` |
| 保留项 | 可见焦点环；关键信息不依赖 hover——这两条是刻意规避站点自身可用性问题 |

会话流里的宿主提示（`notice` / `error` 条目）改用 harness 的行内语汇：提示是淡底描边的一行说明，错误是状态点 + 文本，都不是整条彩色横幅；三段式语义底色只留给正文里的提示块（`callout`）。

## `content.css`（1010 行）：内容组件库样式

服务 `components/content/` 的 12 个 `kind`（`subjects` / `stats` / `progress` / `infobox` / `table` / `timeline` / `tags` / `gallery` / `compare` / `quote` / `callout` / `links`）。

约定：

1. **只用 `--bgm-*` 令牌**，不消费 `--dsw-*`；
2. **类名统一 `content` 前缀**，与组件一一对应（静态复刻页 `docs/bgm-design/component-library.html` 用的是同一批类名）；
3. **不写主题分支**：界面只有浅色一套，所以不关心主题属性挂在哪一层；
4. **派生色用 `color-mix()` 就地算**，不写死十六进制——换令牌即可整体换色；不支持 `color-mix` 的环境用上一行的固定值兜底（两行同属性是刻意的）；
5. **布局自适应容器宽度**：网格用 `auto-fill`；表格类在窄宽度下**横向滚动**而不是挤爆（`@media (max-width: 420px)` 还有一档窄容器兜底：信息行收成单列，时间线与统计条压缩标签列宽）。

文件结构上有四处固定的落点：

- **`.contentBlock` 上集中算一次语义派生变量**（`--content-accent*`、`--content-warn*`），其余规则引用它们；
- **末尾一节"内容条目观感"**：12 种条目的皮肤属性（描边、圆角、底色、层次、数字字体）**就地写在各自的规则里**，另把 hover/active 补充规则集中放在文件末尾，逐条用 `@media (hover: hover)` 包住——这样触屏设备不会拿到粘住的 hover 态。这一节只改皮肤，**不碰布局**：网格、横滚与宽度轴由各条目自己的规则决定；
- **降级块 `.contentFallback*`**：`kind` 认识、载荷不合法时的局部兜底（问题清单 + 可折叠原始 JSON），语义色取自 `.contentBlock` 派生的 `--content-warn-*`，不是整条彩色横幅；
- **`.contentTableScroll`**：表格类（`DataTable` / `CompareTable`）在窄宽度下的统一横滚壳；画廊用 `.contentGalleryTrack` 自己横向滚动。

## 两者的改动规则

| 想做的事 | 改哪里 | 注意 |
|---|---|---|
| 调整品牌主色 | `bgm.css` 的 `--bgm-*` 定义 | 会成片影响全部组件（`--app-*` 的表面与描边也由它派生）；按 [../regression/shell-and-layout.md](../regression/shell-and-layout.md) 全量回归 |
| 调整某个形态（圆角、描边、胶囊、行高） | 该元素所属的组件样式文件 | **不要**在 `bgm.css` 里再加一条覆盖——那会让同一属性出现两个来源 |
| 新增一种内容条目的样式 | `content.css` | 类名 `content` 前缀；只用 `--bgm-*`；同步登记 [../components/content.md](../components/content.md) |
| 引入新的 `--dsw-*` 重定向 | `bgm.css` | 只重定向组件**实际引用**的别名；顺手加无关条目会让后续核对变难 |
| 改弹窗形态 | `modal.css` | `bgm.css` 只提供令牌，几何与形态都在 `modal.css` |
| 改时长、缓动或入场位移 | `tokens.css` 的 `--app-*` + `components/motion/motionTokens.ts` | 两处必须同时改（见 [tokens.md](tokens.md) §外观层令牌） |
