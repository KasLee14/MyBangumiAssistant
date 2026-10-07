# 样式层（`web/src/styles/`）

## 使用说明

### 这份文档是什么

样式层的规则与索引：这一层有哪些文件、每个文件负责哪一类元素、令牌怎么分两家、引入顺序为什么是固定的，以及「改样式只改一处」的判据。

**不覆盖**：各文件的取值明细与逐段结构（见 [tokens.md](tokens.md)、[frame.md](frame.md)、[content-and-brand.md](content-and-brand.md)、[composer-cards-modal.md](composer-cards-modal.md)）、组件本身的实现（见 [../components/readme.md](../components/readme.md)）。上层入口：[AGENTS.md](../../../AGENTS.md)。

### 怎么读（文件 → 场景）

| 文件 | 什么时候读 |
|---|---|
| 本文件 | **加样式规则前必读**——先在这里判定写进哪个文件、用哪些令牌 |
| [tokens.md](tokens.md) | 加或改令牌、改时长 / 缓动 / 阴影 / 圆角 / 字号阶梯时 |
| [frame.md](frame.md) | 改外壳骨架、侧栏、会话区、消息与过程行、Markdown 时 |
| [content-and-brand.md](content-and-brand.md) | 改 12 种内容条目的皮肤、共享基类、行入场时 |
| [composer-cards-modal.md](composer-cards-modal.md) | 改输入区、确认卡、弹窗骨架时 |
| [components.md](components.md) | 改跨入口共享的表面原语（顶栏骨架、玻璃、导航行、胶囊、错峰入场）时 |
| [debug.md](debug.md) | 改调试页或组件库文档页的皮肤时 |
| §索引「文件 → 职责」 | 不确定一条规则该写进哪个文件时 |
| §规则「引入顺序为什么固定」 | 要新建样式文件、或要调整 `main.tsx` / `library.tsx` 的 import 顺序时 |

### 必须遵守的规则

1. **同一元素同一属性只有一个来源**：每个文件只负责它那一类元素（见 §索引「文件 → 职责」），同一属性不写第二遍。这层**没有覆盖层概念**——重复声明会被当成 bug 查，不是「后写的生效」这么简单。要给既有组件的类补属性时起**组合类**（范例：`common.css` 的 `.appBrandAction`，它只补「这里是可点的调试入口」这一件事，不去改顶栏骨架的 `.appTopBarBrand`）。违反后果：改一处不生效，出问题无法定位来源。
2. **同一种形态在多个条目里出现时收敛成选择器列表**：行、柔光填充、轨道、标签、表格外壳这类重复形态，写进 `content.css` §共享基类的一条**选择器列表**，而不是在每处各写一遍。违反后果：同一形态十几份实现，改一处漏九处。
3. **配色不写裸值**：颜色的唯一来源是 `bgm.css` 的 `--bgm-*`；表面与描边一律由主色 `color-mix()` 就地派生，透明度用 `color-mix(in srgb, var(--令牌) N%, transparent)`。`styles/` 下不得出现 `#hex` / `rgb()` / `rgba()` / `hsl()` 字面值（`tokens.css` 的玻璃三枚与滚动条声明是既有例外，不要扩大）。违反后果：换令牌换不动，粉白体系被单点色值破坏。
4. **动效只动 `transform` / `opacity`（少量 `filter` / `background-position`）**：`width` / `height` / `top` / `left` 的变化一律不算动效载体。违反后果：会话区的 `content-visibility: auto` 屏外优化与流式期间的 `memo` 都依赖稳定结构，layout 动画会强制重排并让它们失效。
5. **常驻循环必须「有语义且可关」**：不做纯装饰的呼吸、脉冲、无限扫光；每个循环都要有显式开关并尊重 `prefers-reduced-motion: reduce`。违反后果：页面看起来一直在加载，且无障碍上不可接受。
6. **动效参数只在两处定义**：CSS 用本层的 `tokens.css`（`--app-dur-*` / `--app-ease-*` / `--app-shift-*` / `--app-stagger`），JS 用 `../components/motion/motionTokens.ts`。改一处必须同时改另一处。违反后果：同一界面出现两条缓动曲线。
7. **改动落进本层就要在同一次开发里更新本层文档**：加了文件 → 更新本文件的 §索引；加了约束 → 按分层归置写进对应子文档的 §规则。违反后果见 [AGENTS.md](../../../AGENTS.md) §规则首要规则第 1 条。
8. **`common.css` 只收「≥ 2 个入口共用」的原语**：判据是「去掉主界面之后，调试页与文档页还需要它吗」。违反后果：共享层变成单页专用件的杂物间，三个入口的外观各自漂移。判据与清单见 [components.md](components.md)。
9. **两个次要入口的装配自己写，表面语言必须复用**：调试页与文档页各有自己的 CSS，但令牌、共享原语与顶栏骨架都是同一批；「工具页另有一套外观」这个例外已取消。违反后果：三处入口外观分叉，或为一个入口另写一套顶栏。见 [debug.md](debug.md)。
10. **链接颜色不出现蓝色**：页面里的链接统一「主色深字 + 下划线」（`.libInlineLink` / `.libReferenceLine a` 等）。违反后果：浏览器默认蓝 `rgb(0,0,238)` 漏进粉白体系——这类漏网正是「不写裸色值」这条规则要防的东西。

## 这一层的职责

样式层是**唯一允许声明视觉形态的地方**。组件的 TSX 里不写样式钩子以外的形态，页面不写区间样式，令牌不在别处重复定义。

它同时是**沉淀层**：全站重复出现的形态（表面、阴影、圆角、间距、字号、时长、缓动）先在 `tokens.css` 定义一次，组件样式只消费。新增形态时先问「这是不是已经在令牌里了」，再问「这条规则该写进哪个文件」。

## 目录

| 文件 | 行数量级 | 作用对象 | 令牌角色 |
|---|---|---|---|
| `tokens.css` | ~265 | **外观层令牌**（`--app-*`）：时长、缓动、位移、错峰、间距、侧栏宽、行高、字号阶梯、Markdown 标题、玻璃、阴影、表面派生、滚动条、圆角四档；外加焦点环声明、滚动条接线、`@font-face`、超椭圆曲率 | **定义** `--app-*` |
| `bgm.css` | ~118 | **品牌令牌**（`--bgm-*`）：主色及其派生、表面阶梯、文字色阶、描边、语义色、圆角半径四档、字体栈与代码字体栈 | **定义** `--bgm-*`，**不含任何形态规则** |
| `common.css` | ~330 | **跨入口共享的表面原语**：顶栏骨架 `.appTopBar*`（只服务调试页与文档页）、品牌组合类 `.appBrandAction`、玻璃 `.appGlass`、可选中行 `.appNavRow`、空态、微标签、胶囊、错峰入场、视口驱动入场 | 消费两家令牌 |
| `frame.css` | ~1575 | **外壳与会话区**：`.appFrame` 网格、侧栏（品牌行 / 状态点 / 折叠钮 / 新建 / 分组列表 / 底部用户行 / 收起态气泡）、会话容器与轮次、消息行、过程区（轮首控制行 / 思考行 / 工具行 / 参数与结果体）、轮尾操作行、流式区、Markdown | 消费两家令牌 |
| `composer.css` | ~690 | **输入区**：输入卡、命令候选、锚定菜单、思考强度入口、发送键、统计底栏与其浮层、内容列宽度轴 `.appComposerStack` | 消费两家令牌 |
| `cards.css` | ~228 | **写入确认卡与按钮基元**：`.planCard` 及其状态变体、预览块、动作行、`.button` 三态 | 消费两家令牌 |
| `modal.css` | ~561 | **弹窗**：共享表面 `.modalOverlay` / `.modalSurface`、进出动画 keyframes，以及内容骨架 `.dlg*`（`.dlgPane` / `.dlgHead` / `.dlgField` / `.dlgInput` / `.dlgList` / `.dlgRow` / `.dlgCombo` / `.dlgChoices` / `.dlgActions` / `.dlgBtn*`） | 消费两家令牌 |
| `content.css` | ~1636 | **12 种内容条目的皮肤** + 共享基类 + 行入场 keyframes + 内容块 `pending` 骨架 | 消费两家令牌 |
| `debug.css` | ~252 | **调试页皮肤**：`.appFrame[data-mode='debug']` 的三段式网格与 400px 输入列、输入区、预览条、空态、组合类 `.debugLink` | 消费两家令牌 |
| `library.css` | ~377 | **组件库文档页皮肤**：三栏粘性布局、顶栏内元素、自绘卡片与网格、代码块、参数表组合类、窄屏适配 | 消费两家令牌 |

两个 HTML 入口各有一个构建入口，样式顺序由它们声明：`main.tsx`（主界面 + 调试页）与 `library.tsx`（文档页，末位换成 `library.css`）。

## 规则

### 引入顺序为什么固定

```ts
// main.tsx（library.tsx 同序，末位换成 library.css）
tokens → common → frame → composer → cards → modal → bgm → content → debug
```

三条顺序约束，都不是审美问题：

1. **`common.css` 紧跟 `tokens.css`、排在 `frame.css` 之前**：它只消费令牌，但要给外壳留出覆盖共享骨架的机会（调试页与文档页共用 `.appTopBar`，外壳规则在后）。
2. **`bgm.css` 排在 `tokens / common / frame / composer / cards / modal` 之后**：历史上它靠「后定义覆盖先定义」把上游语义别名重定向到 `--bgm-*`；**第七轮已把别名与重定向整体删除**，现在它只有 `--bgm-*` 的定义。位置保持不变——既有的消费点都写成 `var(--bgm-*)`，只要定义早于绘制即可，而把定义留在末尾可以让「谁定义颜色」这件事在文件里一眼可见。
3. **`content.css` / `debug.css` / `library.css` 排在最后**：它们只消费令牌，位置不影响结果；`library.css` 另排 `content.css` 之后（文档页要展示内容条目）。

**新增样式文件时**：先判断它是否真的需要独立成文件（判据是「作用对象是不是一类」，不是「行数多不多」），再在两个入口里各注册一次、顺序按上面三条推。只在一个入口用的文件（`library.css`）不许被另一个入口 import。

### 令牌分两家，职责不重叠

- `tokens.css` 定义 `--app-*`：**与品牌无关的量**——时长、缓动、位移、间距、字号阶梯、阴影、圆角四档、玻璃、表面派生。这些值换品牌也不变。
- `bgm.css` 定义 `--bgm-*`：**品牌色与基础刻度**——主色及其派生、表面阶梯、文字色阶、描边、语义色、圆角半径原值、字体栈。这些值换品牌就变。

因此：**`--app-radius-cell` 指向 `--bgm-r-sm`** 这类「`--app-*` 派生自 `--bgm-*`」是正确方向，反过来不行。`--app-*` 里出现字面色值只允许在三个地方：玻璃三枚（`rgba(255,255,255,.74)` 等，因为它们表达的是「白玻璃」而不是品牌色）、滚动条宽度与轨道边距、以及各 `cubic-bezier` / 时长。

唯一保留的上游令牌是 `--dsw-corner-shape`（超椭圆曲率 `superellipse(1.4)`），它由 `tokens.css` 的 `*, *::before, *::after` **一处统一下发**——不要在浮层或别处再声明一次，那是同一属性两个来源；胶囊与正圆用 `corner-shape: round` 退出。

## 索引

### 要做什么 → 进哪个文件

| 你要做的事 | 进哪个文件 | 细节 |
|---|---|---|
| 加一个时长 / 缓动 / 位移 / 间距 / 阴影 | `tokens.css` | [tokens.md](tokens.md) |
| 改品牌主色、表面阶梯、语义色、字体栈 | `bgm.css` | [tokens.md](tokens.md) |
| 改外壳网格、侧栏、会话容器、消息与过程行、Markdown | `frame.css` | [frame.md](frame.md) |
| 加一种内容条目的皮肤、改共享基类 | `content.css` | [content-and-brand.md](content-and-brand.md) |
| 改输入卡、命令候选、思考菜单、统计底栏 | `composer.css` | [composer-cards-modal.md](composer-cards-modal.md) |
| 改确认卡、按钮基元 | `cards.css` | [composer-cards-modal.md](composer-cards-modal.md) |
| 改弹窗表面或 `.dlg*` 骨架 | `modal.css` | [composer-cards-modal.md](composer-cards-modal.md) |
| 改跨入口共享的表面原语（顶栏骨架、玻璃、导航行、胶囊） | `common.css` | 本文件 §规则 |
| 改调试页 | `debug.css` | [page/debug.md](../page/debug.md) |
| 改组件库文档页 | `library.css` | [page/library.md](../page/library.md) |
| 补一个既有类的属性（不改它的骨架） | 起**组合类**放共用文件 | 本文件 §规则第 1 条 |

### 类名前缀约定

| 前缀 | 归属 | 例子 |
|---|---|---|
| `app*` | 外壳与容器（`frame.css` / `common.css` / `composer.css`） | `.appFrame`、`.appStage`、`.appComposerCard`、`.appNavRow` |
| `content*` | 内容条目（`content.css`，与 `components/content/` 一一对应） | `.contentTable`、`.contentRow`、`.contentFill` |
| `dlg*` | 弹窗内容骨架（`modal.css`） | `.dlgPane`、`.dlgInput`、`.dlgActions` |
| `plan*` / `button*` | 确认卡与按钮基元（`cards.css`） | `.planCard`、`.planPreview` |
| `lib*` | 文档页（`library.css`） | `.libFrame`、`.libBrand` |
| `debug*` | 调试页（`debug.css`） | `.debugLink` |

会话流里的原子行、过程行、轮控制行、确认卡、统计底栏与内容条目沿用**共享渲染器的类名**（`.userRow`、`.bubble`、`.processBarTitle`、`.reasoningRow`、`.toolRow`、`.contentTable`…）——组件与样式两边改一处即可，不要为了加前缀而重命名。

### 现状：已知的例外与未做

1. **`tokens.css` 与 `bgm.css` 里留有若干「已删除」的注释块**（底光 `--app-glow-ambient`、上游别名重定向、中性灰阶梯、1500‑token 级别的旧档位）。它们记录的是「这里曾经有什么、为什么删」——**不要照着复活**，要删就把注释一起删干净。
2. **`bgm.css` 的注释里还提到「顶栏」**（表面阶梯那一段，说明哪个表面给哪个区域用），而主界面顶栏已按 C01 删除。这是注释滞后，不是规则冲突；改那一段时顺手更正。
3. **本层没有独立的 lint 或测试**：`styles/` 的正确性靠 `npm run typecheck`（只覆盖 TS）+ `docs/agents/regression/` 的文档化用例 + 与 `web/docs/design/index.html` 样张逐项比对。改样式后至少过一遍主链路。
