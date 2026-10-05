# 设计令牌（`styles/tokens.css`）

## 简介

设计令牌本体：来源与命名约定、内容清单、**外观层令牌 `--app-*`** 的构成与对应关系，以及"什么时候该改这里"的判据。

**不覆盖**：具体组件样式（外壳与会话区见 [frame.md](frame.md)，组件见 [components.md](components.md)）与品牌令牌 `--bgm-*` 的定义（见 [content-and-brand.md](content-and-brand.md)）。

上层：[readme.md](readme.md)。

## 使用说明

- **改令牌之前先读 §规则**：四条约定（只有浅色一套、`--dsw-*` 只在这里定义、改令牌 = 全局改版、外观层刻度两处同步）与「什么时候该改这里」的判据都在那里；漏读的后果是令牌出现两个定义处，或同一个交互出现两种节奏。
- **只想查某类令牌、或某枚 `--app-*` 的定义与对应关系**：直接查 §索引（章节 → 场景、来源与命名、内容清单、外观层令牌四段），不必通读 §规则。
- **改时长 / 缓动 / 位移**：先读 §索引「外观层令牌（`--app-*`）」里的对应关系表，改完两边各读一次（理由见 §规则 第 4 条）。

## 规则

### 四条约定

本层通用规则见 [readme.md](readme.md) 的 §规则「六条硬规则」。本篇专属的四条：

1. **只有浅色一套**：上游的深色覆盖块（`body[data-ds-dark-theme]`）与主题切换机制**没有移植**。上游在两处重复声明的同名静态色板这里只声明一次，语义不变。
   **违反后果**：死代码与不可维护的分支（见本层 [readme.md](readme.md) §规则「唯一浅色外观」）。
2. **不要在别处定义 `--dsw-*`**：语义令牌只有这一个定义处；`bgm.css` 只做**重定向**（改变量的值），不新增语义名。
   **违反后果**：令牌出现两个定义处。
3. **改令牌 = 全局改版**：`--dsw-alias-*` 被 `frame/composer/cards/modal` 大量引用，改一个值会成片改变外观。`--app-*` 同理（它驱动所有过渡、阴影与表面）。
   **违反后果**：改一个值就成片改变外观——影响面最大，回归方式见 §规则「什么时候该改这里」。
4. **外观层刻度是"一处定义、两处消费"**：CSS 读 `--app-dur-*` / `--app-ease-*` / `--app-shift-*`，JS 读 `motionTokens.ts`；两边不一致时，同一个交互会看起来像两种节奏。
   **违反后果**：同一个界面出现两条缓动曲线或两种位移距离。

### 什么时候该改这里

**不为局部问题新增令牌**，优先用现有令牌派生 —— **违反后果**：令牌表膨胀，后续没人敢改。

| 场景 | 做法 |
|---|---|
| 整体色板/圆角/字体要变 | 改这里（或经由 `bgm.css` 重定向）——影响面最大，必须按 [../regression/shell-and-layout.md](../regression/shell-and-layout.md) 全量回归 |
| 改时长 / 缓动 / 位移刻度 | 改 `--app-*` **并同步** `components/motion/motionTokens.ts`；再跑 [../regression/shell-and-layout.md](../regression/shell-and-layout.md) 的 `A` 组 |
| 改卡片或浮层的层次 | 改 `--app-shadow-*`（三档语义不要混用：内嵌用 `card`、抬升用 `raised`、浮层用 `panel`） |
| 单个组件要特殊颜色 | 在该组件样式文件里用现有令牌派生（`color-mix()`），不要新增令牌 |
| 补一枚上游语义 alias 的重定向 | 加在 `bgm.css` 的重定向段，只重定向组件**实际引用**的别名 |
| 要支持深色主题 | 属于产品级改动：需要引入主题属性、补一套 alias 覆盖块，并重新设计所有派生色——当前项目明确不做 |
| 新增字体 | 放 `fonts/`（附许可文件）+ 在 `tokens.css` 加 `@font-face` + 加进字体栈令牌 |

## 索引

### 章节 → 场景

| 章节 | 什么时候读 |
|---|---|
| §索引 → 来源与命名 | 想知道某个 `--dsw-*` 从哪来、为什么保持上游命名 |
| §索引 → 内容清单 | 找某类令牌（语义色、字体、圆角、焦点环、滚动条、外观层） |
| §索引 → 外观层令牌（`--app-*`） | **改时长、缓动、位移、阴影、表面或圆角前必读**（与 `motionTokens.ts` 的对应关系） |
| §规则 → 四条约定 | **改令牌前必读**（只有浅色、只此一处定义、改动影响面、外观层两处同步） |
| §规则 → 什么时候该改这里 | 判断"该改令牌，还是改组件样式" |

### 来源与命名

移植自 deepseek-harness 客户端主题包（MIT），逐项对应上游文件：

| 上游文件 | 本文件承载 |
|---|---|
| `design-platform.css` | 色板与语义 alias |
| `base.css` | 字体栈、缓动、圆角刻度 |
| `focus.css` | 焦点环 |
| `scrollbar.css` | 滚动条皮肤 |
| `corner-shape.css` | 超椭圆圆角 |
| `brand-font.css` | Montserrat（OFL，`fonts/` 下三个字重 + 许可文件） |

**变量名保持上游的 `--dsw-*` / `--dsh-*` 命名**，便于与上游逐项核对。

本应用自己的令牌有两套，都**不**来自上游：

- `--bgm-*`（Bangumi 品牌色）定义在 `bgm.css`，见 [content-and-brand.md](content-and-brand.md)；
- `--app-*`（外观层：时长、缓动、位移、阴影、表面、描边、圆角）定义在**本文件末尾**，见下一节。

### 内容清单

1. **`@font-face`**：Montserrat 三个字重（light/regular/medium），字体文件在同目录 `fonts/`。
2. **静态色板**：中性色与品牌色阶（`--dsw-static-*`）。
3. **语义 alias**：`--dsw-alias-*` —— 背景（`bg-*`）、描边（`border-*`）、文本（`label-*`）、状态（`state-*`）、交互（`interactive-*`）等。组件样式**只消费这一层**，不消费静态色板。
4. **字体与尺寸刻度**：`--dsw-font-*`（组合的 `font` 简写）、`--dsw-radius-*`、`--dsh-content-font-size` 及其派生（`--dsh-content-font-delta` 等）、`--dsw-shadow-*`、elevation 三件套。
5. **焦点环与滚动条**：`--dsw-focus-*`、`--dsh-scrollbar-*`。
6. **外观层令牌**：`--app-*`（见下一节）。

> 移植时还带进来三枚上游的布局轴：`--dsh-composer-side-clearance`、`--dsh-composer-dock-inset`、`--dsh-composer-text-max-height`。**当前没有任何规则消费它们**，只是保留了定义；改输入区间距请改 `composer.css` 里实际生效的声明，不要以为改这三枚会有效果。

### 外观层令牌（`--app-*`）

定义在 `tokens.css` 末尾的 `:root` 里，共 21 条。它们是这一层唯一的"外观刻度表"：组件样式里出现的时长、缓动、位移、三级阴影、表面色、描边与圆角都从这里取，不各写一个字面值。

**与 `motionTokens.ts` 的对应关系**：CSS 用 `--app-*`，JS（motion 的 `transition`）用 `components/motion/motionTokens.ts` 导出的常量。**两处值必须一致**（见 §规则 第 4 条）：

| CSS 令牌 | 值 | `motionTokens.ts` |
|---|---|---|
| `--app-dur-instant` | `100ms` | `DURATION.instant`（`0.1`） |
| `--app-dur-fast` | `150ms` | `DURATION.fast`（`0.15`） |
| `--app-dur-base` | `200ms` | `DURATION.base`（`0.2`） |
| `--app-dur-slow` | `300ms` | `DURATION.slow`（`0.3`） |
| `--app-dur-slower` | `450ms` | `DURATION.slower`（`0.45`） |
| `--app-ease-out` | `cubic-bezier(.22, 1, .36, 1)` | `EASE_OUT`（`[0.22, 1, 0.36, 1]`） |
| `--app-ease-in-out` | `cubic-bezier(.4, 0, .2, 1)` | `EASE_IN_OUT`（`[0.4, 0, 0.2, 1]`） |
| `--app-shift-row` | `8px` | `SHIFT.row`（`8`） |
| `--app-shift-panel` | `16px` | `SHIFT.panel`（`16`） |

motion 的时长单位是秒、CSS 是毫秒，写的时候容易只改一边；改完请两边各读一次。

**层次：三级阴影**

| 令牌 | 用在哪 |
|---|---|
| `--app-shadow-card` | 内嵌但需要浮起的卡片（内容条目卡、确认卡） |
| `--app-shadow-raised` | 小面积抬升（侧栏「新建会话」、导轨、内容卡片 hover） |
| `--app-shadow-panel` | 浮层与弹窗（命令候选、思考菜单、统计浮层、`.modalSurface`、`.appToast`） |

层次语言是"描边 + 两级阴影"表达浮起，不靠底色差；描边另有 `--app-hairline` / `--app-hairline-strong` 两档。

**由 `--bgm-*` 派生：表面、描边与圆角**

这一组**不新增色值**，全部从 Bangumi 令牌算出来；引用的是定义在 `bgm.css` 里的 `--bgm-*`：

| 令牌 | 定义 |
|---|---|
| `--app-surface` | `var(--bgm-surface)` |
| `--app-surface-sunken` | `var(--bgm-bg)` |
| `--app-surface-tint` | `color-mix(in srgb, var(--bgm-surface) 86%, var(--bgm-primary-soft))` |
| `--app-hairline` | `color-mix(in srgb, var(--bgm-border) 62%, transparent)` |
| `--app-hairline-strong` | `color-mix(in srgb, var(--bgm-border) 88%, transparent)` |
| `--app-primary-veil` | `color-mix(in srgb, var(--bgm-primary) 14%, transparent)` |
| `--app-accent-veil` | `color-mix(in srgb, var(--bgm-interactive) 12%, transparent)` |
| `--app-radius-control` | `var(--bgm-r-md)`（10px） |
| `--app-radius-panel` | `var(--bgm-r-lg)`（15px） |

其中两个表面各有明确归属：`--app-surface` 是对话区与顶栏的白面，`--app-surface-sunken` 是侧栏与 `.appFrame` 的下沉灰面——「导航灰 / 内容白」的分区就建立在它们之上。

两点值得记住：

1. **引用后定义的令牌是成立的**：`--bgm-*` 由排在后面的 `bgm.css` 声明，但自定义属性在**计算值**阶段做替换——同一元素（`:root`）上最终胜出的 `--bgm-surface` 会被用上。所以顺序上不必把 `--app-*` 挪到 `bgm.css` 里去"就近定义"，它必须留在 `tokens.css` 才能和 `motionTokens.ts` 对照着读。
2. **圆角只留两档**："控件"（10px）与"容器"（15px）。需要胶囊/圆形时用 `--bgm-r-pill` / `50%`，不要再开第三档。
