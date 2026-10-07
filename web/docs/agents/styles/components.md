# 跨入口共享的表面原语（`common.css`）

## 使用说明

### 这份文档是什么

`common.css` 的收件标准与全部类清单。它是**跨入口共享**的表面原语（主界面 / 调试页 / 组件库文档页），因此单独成文件——`frame.css` 只服务前两者的外壳，`library.css` 只服务文档页。

**不覆盖**：外壳与会话区（见 [frame.md](frame.md)）、输入区与弹窗（见 [composer-cards-modal.md](composer-cards-modal.md)）、组件实现（见 [../components/readme.md](../components/readme.md)）。上层入口：[../readme.md](../readme.md)。

### 怎么读

| 你要做的事 | 读哪一节 |
|---|---|
| 往 `components/common/` 加一个原语 | §规则「收件标准」 |
| 改顶栏骨架（调试页与文档页共用） | §索引 |
| 改玻璃浮起层 | §索引「玻璃」——**它的消费点最多，动之前先看清单** |
| 改导航行 / 胶囊 / 微标签 / 空态 | §索引 |
| 加一条逐项入场或视口入场 | §索引「入场」+ [content-and-brand.md](content-and-brand.md) §三条入场路径 |

### 必须遵守的规则

1. **收件标准只有一条**：去掉主界面之后，调试页与文档页还需要它吗？答案为否就不进这里。违反后果：共享层变成单页专用件的杂物间，三个入口的外观各自漂移。
2. **`common.css` 里的类不 import 上层组件**：它承载的是表面原语，消费方是 `components/common/`（`AppTopBar` / `Pill` / `Stagger`）与各页面的 DOM。
3. **`.appGlass` 是浮起层的唯一材质来源**：输入卡、命令候选、思考菜单、统计浮层、弹窗、Toast 都引它，不各写一份 `rgba` + `backdrop-filter`。**同时出现的模糊层 ≤ 3**。违反后果：玻璃参数出现多份来源，模糊层叠超过 3 个后性能与观感同时崩。
4. **`.appTopBar*` 只服务调试页与文档页**：**主界面没有顶栏**（设计决策 C01 已删除，功能全在侧栏），`debug.css` 只在 `[data-mode='debug']` 上把三段式网格恢复回来。违反后果：给主界面加回顶栏，或为某一个入口另写顶栏。
5. **入场令牌只有一批**：`.appStagger` 的延迟表（8 档封顶）与 `.appReveal` 都要走 `--app-stagger` / `--app-dur-*` / `--app-ease-*`，不写裸值。违反后果：三条入场路径的节奏分叉。见 [tokens.md](tokens.md) §规则。
6. **`common.css` 排在 `tokens.css` 之后、`frame.css` 之前**：它只消费令牌，但要给外壳留出覆盖共享骨架的机会。违反后果：调试页顶栏被共享骨架规则压住。

## 索引

### 顶栏骨架（只服务调试页与文档页）

| 类 | 作用 |
|---|---|
| `.appTopBar` | 46px 高、`--app-surface-sunken` 底、底部 hairline |
| `.appTopBarBrand` | 品牌字（14px/700 + `--app-tracking-title`） |
| `.appTopBarTab` / `[data-current='true']` | 栏目切换；当前项在粉底上另补 1px 描边保证可辨性（焦点环换成主色环后的配套） |
| `.appTopBarActions` | 右侧动作区（调试页的「组件库」「返回主界面」、文档页的三个入口互链） |
| `.appBrandAction` | **组合类**：只补「这里是可点的调试入口」这一件事，不改顶栏骨架。它服务两个入口（主界面侧栏顶部品牌行 + 调试页顶栏品牌），所以放在这里而不是 `debug.css` |

### 玻璃与共享表面

| 类 | 作用 |
|---|---|
| `.appGlass` | 浮起层材质：`--app-glass-fill` / `-stroke` / `-blur` + 浮层圆角 + 通过 `--glass-shadow` 钩子接受阴影档（默认档，弹窗另按决策保持共享档） |
| `.visuallyHidden` | 视觉隐藏但保留给读屏器（表格 `caption` 等用同一手法） |
| `.appEmpty` / `.appEmptyTitle` / `.appEmptyHint` | 空态三件套 |
| `.appMicroLabel` | 微标签（`--app-font-tiny` 档） |
| `.appPill` | 胶囊（`corner-shape: round` 退出超椭圆） |

`.appGlass` 的消费点（改它之前逐一看过去）：`common.css`（自身）、`composer.css`（输入卡、命令候选、思考菜单、统计浮层）、`frame.css`（轮尾用量面板、Toast 等）、`modal.css`（弹窗表面）。

### 可选中行与入场

| 类 | 作用 |
|---|---|
| `.appNavRow` / `:hover` / `[data-current='true']` / `:focus-visible` | 可选中行基类（侧栏会话行、文档页左导航共用）；当前项粉底 + 左侧主色条；粉底上补 1px 描边保证焦点环可辨 |
| `.appNavMeta` | 行内的次级信息（时间 / 状态） |
| `.appStagger` / `> *` / `nth-child(1..8)` / `nth-child(n+9)` | 挂载即入场的错峰表：**8 档封顶**（第 9 项起沿用第 8 档）。4 档封顶会让第 5 行起同时出现，短列表尾部一次冒出好几行 |
| `.appReveal` / `.in` | 滚进视口才浮现的类；由 `../utils/revealOnScroll.ts` 的**共享** `IntersectionObserver` 加 `.in`（全站只有那一个模块建观察器） |

## 规则

### 收件标准

往这里加东西之前依次问：

1. 它是 ≥ 2 个入口共用的表面原语吗？不是 → 放对应入口的文件（`frame.css` / `debug.css` / `library.css`）。
2. 它是 `components/common/` 里的组件需要的类吗？不是 → 也许它属于某个具体页面。
3. 它只是给某个既有类补一个属性吗？是 → 起**组合类**放在这里（范例 `.appBrandAction`），不要改那个既有类。

### 组合类 vs 改既有类

- **组合类**：只补一件事，名字能读出「补的是什么」（`.appBrandAction`、`.debugLink`）。
- **改既有类**：只有当那个类的**所有**消费方都该跟着变时才做，而且要回到它原本所在的文件改。

违反这条会直接造成「同一元素同一属性两个来源」，也就是 [../readme.md](../readme.md) §规则第 1 条禁止的情形。

## 现状：已删除的形态

| 已删除 | 原因 |
|---|---|
| `.appSessionHead*`（会话头骨架） | 粘性会话头已在设计决策 C34 中删除，规则保留在文件里作注释 |
| `GlassSurface` / `MicroLabel` 两个组件 | 已并入本文件的类，不再各占一个文件——`Modal` 与 `Toast` 是 motion 元素，包成组件反而要处理 `as` 的类型 |
| 上游 `--dsw-*` 语义别名 | 第七轮整体删除，消费点改指 `--app-*` / `--bgm-*`（见 [tokens.md](tokens.md) §现状） |
