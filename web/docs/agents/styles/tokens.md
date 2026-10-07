# 令牌（`tokens.css` / `bgm.css`）

## 使用说明

### 这份文档是什么

两家令牌的职责分界与清单：`tokens.css` 的 `--app-*`（与品牌无关的量）与 `bgm.css` 的 `--bgm-*`（品牌色与基础刻度），以及加令牌、改令牌、两处同步的规则。

**不覆盖**：哪些元素该用哪一档（见 [readme.md](readme.md) §索引、[frame.md](frame.md) / [content.md](content-and-brand.md) / [composer-cards-modal.md](composer-cards-modal.md)）。上层入口：[../readme.md](../readme.md) → [AGENTS.md](../../../AGENTS.md)。

### 怎么读

| 你要做的事 | 读哪一节 |
|---|---|
| 加一枚新令牌 | §规则「加令牌的四步」 |
| 改一个现有的量（时长 / 圆角 / 阴影 / 字号…） | §索引对应的表 + §规则「哪些地方必须同步改」 |
| 判断一个值该不该收成令牌 | §规则「什么时候才收成令牌」 |
| 想知道某枚令牌现在存不存在 | §索引的两张表（已删令牌另见 §现状） |

### 必须遵守的规则

1. **`--app-*` 可以派生自 `--bgm-*`，反向不行**。违反后果：品牌刻度被通用量绑死，换品牌要动两个文件。
2. **动效参数与 `../components/motion/motionTokens.ts` 一一对应，改一处必须同时改另一处**（时长、缓动、位移、错峰四组）。违反后果：同一个界面出现两条缓动曲线，浮层与内容条目的节奏对不上。
3. **超椭圆曲率只由 `tokens.css` 的 `*, *::before, *::after` 下发一次**，不要在浮层或别处再声明 `corner-shape`（胶囊与正圆的 `corner-shape: round` 是退出，不算第二处）。违反后果：同一属性两个来源，改一处不生效。
4. **不新增色值**：颜色的定义只允许出现在 `bgm.css` 的 `:root` 里。`tokens.css` 里的字面色值只有玻璃三枚与滚动条宽度这类「表达白玻璃 / 几何量」的例外，不要扩大。
5. **已删除的令牌不许复活**：`tokens.css` 与 `bgm.css` 里保留了若干「这里曾经有 X、为什么删」的注释块。要恢复某个视觉决策，先读对应的设计决策记录（`../../design/decisions/`），不要在令牌层就地加回来。违反后果：与决策记录冲突的旧写法回流，验收标准失效（底光 `--app-glow-ambient` 就是这么被明令删除的）。

## 两家令牌的边界

判据只有一句：**换一个品牌，这个值会不会变？**

| 问题 | 答案 | 归属 |
|---|---|---|
| 主色、表面阶梯、文字色阶、语义色、描边、字体栈、圆角半径原值 | 会变 | `bgm.css` 的 `--bgm-*` |
| 时长、缓动、位移、错峰、间距刻度、字号阶梯、阴影、玻璃、表面派生、滚动条、圆角语义四档 | 不会变 | `tokens.css` 的 `--app-*` |

`tokens.css` 顶部的注释写明了它的上游来源（deepseek-harness 客户端主题包，MIT）以及第七轮令牌层清理删掉了什么。**唯一保留的上游令牌是 `--dsw-corner-shape`**，它只在 `@supports (corner-shape: superellipse(1.4))` 块里定义并统一下发。

本应用只有浅色一套外观：没有 `data-ds-dark-theme` 之类的主题覆盖块，也没有主题切换机制。写到「主题分支」的代码一律是错的。

## 索引

### `tokens.css` 的令牌分组

| 分组 | 令牌 | 备注 |
|---|---|---|
| 时长阶梯 | `--app-dur-instant` 100ms / `-fast` 150ms / `-base` 240ms / `-slow` 360ms / `-slower` 450ms | 与 `motionTokens.ts` 的 `DURATION` 一一对应 |
| 缓动 | `--app-ease-out` / `-in-out` / `-spring` / `-spring-soft` | `-spring` 用于悬停抬升与浮层进出；`-spring-soft` 是大面积收敛版（浮层与弹窗只允许极小过冲） |
| 位移 | `--app-shift-row` 8px / `--app-shift-panel` 16px | 入场位移只有两级 |
| 错峰 | `--app-stagger` 55ms | 只给短列表；长列表一次性入场 |
| 间距 | `--app-space-4/6/8/10/12/16/24/32` | 4px 网格、按 px 值命名；**全站间距只从这八档里取** |
| 侧栏 | `--app-sidebar-full` 264px / `--app-sidebar-content` 248px | `.appFrame` 把 full 绑给 `--app-sidebar-width`，收起态把后者重绑为 0；内容宽必须写字面值，写成 `calc(var(--app-sidebar-width) - …)` 会在收起态解析成 0 |
| 行高与字号 | `--app-line-base` 1.72、`--app-font-body/-sub/-note/-tiny`、`--app-tracking-title/-num` | **15px 及以上的展示型大字明确豁免令牌化**（标题 17 / 区块 16 / 页面 20 / 数值 21 / 首屏 26 / 统计 28 直接写 px） |
| Markdown 标题 | `--app-font-md-h1..h4`（21 / 19 / 18 / 14px） | 值照搬上游 markdown 标题令牌，字体栈换成 `--bgm-font`；h4 与正文同号、只加粗 |
| 玻璃 | `--app-glass-fill` / `-stroke` / `-blur` | 浮起层的**唯一来源**（输入卡 / 命令候选 / 思考菜单 / 统计浮层 / 弹窗 / Toast），不各写一份 rgba + blur；同时出现的模糊层 ≤ 3 |
| 阴影 | `--app-shadow-raised` / `-chip` / `-card` / `-panel` / `-float` / `-edge` | 五档语义 + 侧栏的单向发散阴影；弹窗另有共享档约定，见 [composer-cards-modal.md](composer-cards-modal.md) |
| 表面与描边 | `--app-surface` / `-sunken` / `-tint`、`--app-hairline` / `-strong`、`--app-primary-veil` / `--app-accent-veil` | 全部由 `--bgm-*` 派生 |
| 滚动条 | `--app-scrollbar-thumb` / `-hover` / `-width` 5px / `-track-margin` | 抬高的浮层可在自己的容器上重绑宽度与边距（`.menuViewport` 用 6px / 12px）；滑块深浅不再分档 |
| 圆角语义四档 | `--app-radius-cell` → `--bgm-r-sm` / `-control` → `-md` / `-panel` → `-lg` / `-float` → `-tag` | **元素越小圆角越小**（8 / 10 / 14 / 18） |
| 焦点环与滚动条接线 | `:focus-visible` 的 `outline-color` / `outline-width`、`::-webkit-scrollbar*`、`@supports not selector(::-webkit-scrollbar)` | 只做接线，颜色与宽度不设中间令牌 |
| 曲率 | `--dsw-corner-shape: superellipse(1.4)`（`@supports` 内） | 唯一保留的上游令牌，由 `*, *::before, *::after` 一处下发 |

`tokens.css` 还带三组 `@font-face`（Montserrat 400/300/500，OFL）。**界面已不再使用这份字体**（`--bgm-font` 改走系统 UI 字体栈之后没有消费点），保留是因为字体文件与许可随仓库存在。

### `bgm.css` 的令牌分组

| 分组 | 令牌 | 备注 |
|---|---|---|
| 主色 | `--bgm-primary` `#ec6570`（HSL 355 78% 66%）、`--bgm-primary-soft`（10% 混白）、`--bgm-primary-text`（62% 混 `#2f2f33`）、`--bgm-primary-deep`（72% 混 `#2f2f33`）、`--bgm-primary-hover-fill`、`--bgm-primary-mist` `#ffd9d3` | 实心按钮用 `-deep`，因为主色本身的白字只有约 3.1:1；`-mist` 是柔光渐变端点，反解配比三通道不一致所以保留精确值 |
| 前景 | `--bgm-on-accent` `#fff` | 实心底上的白字**唯一来源**；以后要整体换米白只改这一行 |
| 语义色 | `--bgm-interactive` `#369cf8`、`--bgm-link` `#0084b4`、`--bgm-danger` / `-soft` / `-border`、`--bgm-success` / `-soft` / `-border` / `-text`、`--bgm-warn` | 一律保持原值，不参与粉调派生 |
| 表面阶梯 | `--bgm-surface` `#fff`、`--bgm-surface-alt`（主色 4%）、`--bgm-bg`（9%）、`--bgm-sunken`（15%） | 由浅到深是 surface → surface-alt → bg → sunken；**页面上不出现中性灰表面**；**没有遮罩令牌**（弹窗无蒙层，见 [composer-cards-modal.md](composer-cards-modal.md)） |
| 文字色阶 | `--bgm-text` `#444`、`-strong` `#333`、`-muted` `#666`、`-weak` `#999`、`-disabled` `#aaa` | 中性深色，不粉调化 |
| 描边 | `--bgm-border`（主色 36% 混白）、`-soft`（20%）、`--bgm-dotted`（30%）、`--bgm-input-border`（42%）、`--bgm-tint`（26%） | 控件描边比 hairline 深一档 |
| 图标 | `--bgm-close-icon` | 站点 `#TB_closeWindowButton` 的 15px 细线 ×，以 mask 形式保存，hover 变色不需要第二份资源 |
| 圆角半径 | `--bgm-r-sm` 8 / `-md` 10 / `-lg` 14 / `-tag` 18 / `-pill` 999 | `--app-radius-*` 的取值来源；`-pill` 只给胶囊与正圆 |
| 阴影 | `--bgm-shadow-soft`、`--bgm-shadow-modal` | 站点风格的遗留两枚；主层次走 `--app-shadow-*` |
| 焦点环 | `--bgm-focus`（3px 主色 45%） | 按钮等控件的 box-shadow 通道；`tokens.css` 的 `:focus-visible` outline 是另一条通道 |
| 字体 | `--bgm-font`（系统 UI 字体栈）、`--bgm-mono`（末尾补中文兜底） | 代码字体栈补中文是刻意的：裸 `monospace` 在 Windows 上会把中文交给宋体 |

## 规则

### 什么时候才收成令牌

判据是**「同一个值是否在≥ 2 个地方表达同一个决策」**，不是「这个值看起来很重要」：

- 收：出现三次以上、且它们必须同时改（间距、时长、圆角、阴影档位）。
- 不收：只用一次、且它是某个组件自己的形状（例：某张卡的 `max-height: 336px`）。
- 不收：15px 及以上的展示型大字（见 §索引，这是 2026-10-06 的明确收敛决定）。
- 注意反例：`cards.css` 曾有一条 `max-width` 指向**全仓从未定义**的令牌——声明在计算值阶段就作废、等于没写，宽屏下卡反而比内容列宽。**指向不存在的令牌比写裸值更糟**，因为它连报错都没有。

### 加令牌的四步

1. 判断归属：换品牌会变 → `bgm.css`；不会变 → `tokens.css`。
2. 写进对应分组，**按现有格式补注释**：这个值从哪来（样张 / 决策记录 / 实测）、为什么是这个档。
3. 找消费点：先把现有裸值替换成新令牌，确认替换后渲染一致。
4. 更新本文档 §索引对应的表行。

### 哪些地方必须同步改

| 改了 | 必须同步 |
|---|---|
| `--app-dur-*` / `--app-ease-*` / `--app-shift-*` / `--app-stagger` | `../components/motion/motionTokens.ts` 的 `DURATION` / `EASE_*` / `SHIFT` / `STAGGER` |
| `--bgm-primary` 及其派生 | `index.html` 与 `library.html` 的预涂底色与 `theme-color`（这两处算不出 `color-mix()`，只能写实色） |
| `--bgm-r-*` 四档半径 | `../../design/decisions/G-tokens.md` §二（它是取值的事实源） |
| 圆角四档的语义分配 | 收窄 / 放大元素时的「元素越小圆角越小」判据，见 [readme.md](readme.md) §规则 |
| `--dsw-corner-shape` | 无需同步；但确认没有第二处 `corner-shape` 声明 |

## 现状：已删除的令牌与注释块

这些名字**不再存在**，看到它们就是过期信息：

| 已删除 | 曾经的用途 | 现在的做法 |
|---|---|---|
| `--dsw-*` / `--dsh-*`（65 处消费点） | 上游 DSH 语义别名（色板、specific 组、elevation、滚动条、markdown 字体、焦点环宽度） | 消费点直接改指 `--app-*` / `--bgm-*` 或就地 `color-mix()` |
| `bgm.css` 的别名重定向机制 | 把 DSH 语义别名指向 `--bgm-*`（靠「后定义覆盖先定义」，必须写 `:root, body` 两处） | 整体删除，`bgm.css` 现在只有 `--bgm-*` 定义。**因此那条「重定向必须写两处」的坑不再适用** |
| `--app-glow-ambient` / `--bgm-primary-warm` | 装饰性径向底光 | 按 G07 全部删除，面板底只用纯色阶梯四档。**任何地方都不得再新增装饰性径向渐变底光** |
| 中性灰表面阶梯（`#f5f5f5` / `#fafafa`） | 页面底与内嵌块 | 改为粉调派生（`--bgm-bg` 9% / `--bgm-sunken` 15%） |
| `--app-space-40` / `-48`、`--app-line-tight` / `-loose`、滚动条 l1/l2 两级别名 | 零消费者或两档取值完全相同 | 一并删除 |
| 上游 markdown 字体可变轴 | JS 往根注入 10–22px 正文字号，标题与正文共享像素差 | 本应用固定正文 14px，标题直接写定值，不再有 calc 链 |
