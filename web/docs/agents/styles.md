# styles：通用样式与令牌层

> 覆盖 `web/src/styles/` ｜ 核对 2026-10-11

## 功能介绍

`web/src/styles/` 是**跨页面通用**的样式与令牌层，手写 CSS（无 Tailwind、无 CSS-in-JS、无 CSS Modules、无预处理器）。分两块：

- `web/src/styles/base/` 是**令牌层**，按族分七个目录（color / typography / motion / space / elevation / shape / interaction），只写 `:root` 变量与全局伪元素规则；
- `web/src/styles/common.css` 是跨入口共用的**表面原语**（顶栏骨架、玻璃浮起层、可选中行、空态、微标签、错峰入场），`web/src/styles/content.css` 是**内容组件库样式**（12 种内容块）。

页面专有的样式在 `web/src/page/<页面>/styles/`。令牌是全局的，不属于任何页面。

## 索引

按功能模块分组：**令牌层**按族拆文件（改配色、字体、间距先来这里），**共享形态**是跨入口的表面原语与内容块样式，**引入链**在 `web/src/main.tsx`。

### base/ —— 令牌层（按族分）

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `color/bgm.css` | Bangumi 令牌：`--bgm-*`（主色 `#ec6570` 及其混白/混深派生、文字色阶、语义色、焦点色）；**只有令牌定义，无形态规则** | `web/src/styles/base/color/bgm.css` | 改品牌色、表面与描边、语义色 |
| `color/app.css` | `--app-*` 外观层令牌：浮层材质（`--app-glass-*`）、发丝描边、markdown 字号轴等；来源与清理历史见文件头 | `web/src/styles/base/color/app.css` | 改 `--app-*` 外观层令牌 |
| `typography/typography.css` | Montserrat 三条 `@font-face`、字体栈 `--bgm-font` / `--bgm-mono`、字号阶梯 `--app-font-*`（含 markdown 四档）、`--app-line-base`、`--app-tracking-*` | `web/src/styles/base/typography/typography.css` | 改字体栈、`@font-face` 或字号阶梯 |
| `typography/fonts/` | Montserrat 三个 `woff2`（light / regular / medium）与 OFL 许可文本 | `web/src/styles/base/typography/fonts/` | 换字体文件 |
| `motion/motion.css` | `--app-dur-*` / `--app-ease-*` / `--app-shift-*` / `--app-stagger`，与 `web/src/constants/motion.ts` 一一对应 | `web/src/styles/base/motion/motion.css` | 改时长、缓动、入场位移、错峰间隔（必须与 `web/src/constants/motion.ts` 同步） |
| `space/space.css` | 4px 网格间距八档 `--app-space-*`、侧栏宽 `--app-sidebar-full` / `--app-sidebar-content` | `web/src/styles/base/space/space.css` | 改间距刻度或侧栏宽度 |
| `elevation/elevation.css` | 玻璃三枚 `--app-glass-*`（浮起层的唯一来源）与阴影四档 `--app-shadow-*`（raised / chip / card / panel） | `web/src/styles/base/elevation/elevation.css` | 改阴影或玻璃浮起层材质 |
| `shape/shape.css` | 圆角 `--bgm-r-*` 与四档语义 `--app-radius-*`（元素越小圆角越小）、`--dsw-corner-shape` 的超椭圆曲率 | `web/src/styles/base/shape/shape.css` | 改圆角半径或超椭圆曲率 |
| `interaction/interaction.css` | 焦点环（`:focus-visible` 与指针模态下的抑制）与滚动条皮肤（`--app-scrollbar-*`） | `web/src/styles/base/interaction/interaction.css` | 改焦点环或滚动条皮肤 |

### 共享形态样式

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `common.css` | 跨入口共用的表面原语：`.appTopBar*`、品牌组合、玻璃浮起层、可选中行、空态、微标签与胶囊、会话头、逐项错峰入场；**不新增色值** | `web/src/styles/common.css` | 改顶栏骨架、空态、微标签等共享原语 |
| `content.css` | 内容组件库样式：`.content*` 前缀，与 `web/src/components/content/` 的组件一一对应；只用 `--bgm-*` 令牌，语义色就地 `color-mix()` 派生 | `web/src/styles/content.css` | 改 12 种内容块（条目卡、统计、进度、表格、时间线…）的样式 |

### 样式引入链与页面皮肤

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `main.tsx`（在 `web/src/`） | 样式引入链的**唯一**定义处 | `web/src/main.tsx` | 改样式引入顺序（顺序是契约） |
| `page/<页面>/styles/` | 页面专有皮肤（`lib*` / `lab*` 前缀，只新增自己的类） | `web/src/page/<页面>/styles/` | 改某个页面的皮肤 |

## 规则

### 单一真相源

**1. 只有浅色一套外观，派生色从令牌算。**

- **规则**：不写主题切换、不写 `data-*` 主题分支；需要浅底/深字或强调色时用 `color-mix()` 从 `--bgm-*` / `--app-*` 现算，不写死十六进制。
- **为什么**：换主色时全部派生色跟着变；界面本来就只交付浅色。
- **后果**：写死的色值会在配色调整后成为唯一的残留色块，且不易被搜索出来。

### 归位与命名

**2. 令牌按族分文件。**

- **规则**：改令牌去 `web/src/styles/base/` 的对应族；重构前的旧路径已经不存在，清单见「不要去找的旧路径」。
- **为什么**：按族拆开后一档取值只有一个来源；但多条 CSS 注释与组件注释还停留在重构前的写法，照着找会落空。
- **后果**：误判「文件丢了」，或按旧路径新建一份重复的令牌文件，从此出现两套取值。

**3. 类名按前缀分区。**

- **规则**：共享原语用 `app*`（如 `.appTopBar`、`.appEmpty`、`.appFallbackPage`），内容块用 `content*`，各页皮肤用自己页面的前缀（`lib*` / `lab*`）。令牌用 `--bgm-*`（品牌）与 `--app-*`（外观层）；唯一的例外是从上游继承的 `--dsw-corner-shape`（超椭圆曲率，见 `web/src/styles/base/shape/shape.css`）。
- **为什么**：页面皮肤只应新增自己的类，不覆写既有组件的类——两个入口才能共用同一批组件而不互相污染。
- **后果**：跨页覆写会导致「改文档页样式、主界面跟着变」，而且很难定位。

### 模块边界

**4. `base/` 只写令牌，不写形态。**

- **规则**：`web/src/styles/base/` 里的文件只定义 `:root` 变量（外加焦点环、滚动条这类全局伪元素规则），组件形态规则写在 `common.css` / `content.css` / 各页 `styles/` 里。
- **为什么**：令牌层与形态分层后，「换配色」不必翻组件样式，「改组件」也不会误动全局取值。
- **后果**：形态规则混进令牌文件后，任何一次配色调整都可能连带改掉某个组件的盒子模型。

### 改动联动

**5. JS 与 CSS 的动效令牌一一对应。**

- **规则**：`web/src/styles/base/motion/motion.css` 与 `web/src/constants/motion.ts` 是同一套刻度（CSS 侧给过渡用，JS 侧给 motion 的 `transition` 用），改一处必须同时改另一处；只有 JS 侧消费的档位（如 `DURATION.reveal`）不建同名 CSS 令牌。
- **为什么**：同一个过渡若出现两条曲线，界面上会看到两种节奏。
- **后果**：缓动或时长只在一边改，同一组件的 CSS 过渡与 JS 动画速度不一致，观感是「卡一下」。

### 顺序契约

**6. 样式引入顺序是契约。**

- **规则**：顺序由 `web/src/main.tsx` 决定，改动要在那里进行：

  ```
  base 七族令牌 → common.css → 主界面四件（frame / composer / cards / modal）→ content.css → lab.css → library.css
  ```

- **为什么**：令牌层只写变量（顺序不影响取值），形态层则依赖先后覆盖；`content.css` 必须在文档页皮肤之前（文档页要展示内容条目）。
- **后果**：把某页皮肤提到 `content.css` 之前，会被内容块样式反向覆盖；令牌层放最后虽不影响变量，但会让「谁定义颜色」的阅读顺序失真。

## 不要去找的旧路径

下列路径在目录重构后**已不存在**。部分 CSS 注释与组件注释还停留在旧写法，照着找会落空：

| 旧路径 | 现状 |
|---|---|
| `web/src/styles/tokens.css` | 令牌已按族拆进 `web/src/styles/base/`（color / typography / motion / space / elevation / shape / interaction） |
| `web/src/styles/bgm.css` | 已拆成 `web/src/styles/base/color/bgm.css` |
| `web/src/components/motion/motionTokens.ts` | 动效令牌现在在 `web/src/constants/motion.ts` 与 `web/src/styles/base/motion/motion.css` |
| `web/src/components/common/` | 跨页面共享的表面原语现在在 `web/src/styles/common.css` 与 `web/src/components/` 下的各层目录 |
