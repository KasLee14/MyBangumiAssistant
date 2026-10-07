# 内容组件库文档页（`web/src/page/library/`）

## 简介

组件库文档页：**形态对齐文档站（一组件一页 + 总览页），骨架（顶栏 / 左导航 / 内容区 / 右侧目录）全部自绘，与主界面、调试页共用 `components/common/` 与同一套令牌；12 种内容块一律由项目自己的 `ContentBlock` 真实渲染，并把可直接粘进调试页的 event / frame JSON 现场生成出来的开发期页面**。它不连宿主、不发请求，页面上的每个预览都是 `ContentBlock` 的真实输出。

**不覆盖**：内容条目的渲染与校验（见 [../components/content.md](../components/content.md)）、条目皮肤（见 [../styles/content-and-brand.md](../styles/content-and-brand.md)）、这一页的布局与排版（见 [../../../src/styles/library.css](../../../src/styles/library.css)）、UI 框架的边界（见 [AGENTS.md](../../../AGENTS.md) §规则「技术栈约束」第 6 条「UI 框架：none」）、调试页本体（见 [debug.md](debug.md)）、主界面装配（见 [main-page.md](main-page.md)）。

上层：[readme.md](readme.md)；跨层规则：[AGENTS.md](../../../AGENTS.md)。

### 与主界面、调试页的关系

主界面与调试页由 `web/src/main.tsx` 的 `Root` 按 hash **互斥挂载**（见 [readme.md](readme.md) §规则「新增一个页面时」）。文档页不走这条路：它是**另一个 HTML 文档**，由 [web/library.html](../../../library.html)（脚本指向 `/src/library.tsx`）单独加载，因此在 `main.tsx` 的 `Root` 里没有分支、也**不参与 `Root` 的 hash 分流**（它有自己的 hash 路由，见下节）。

[web/src/library.tsx](../../../src/library.tsx) 只做两件事：先按与 `main.tsx` **相同的顺序**引入样式（`tokens → common → frame → composer → cards → modal → bgm → content`，末位追加 `styles/library.css`；不引入 `debug.css`），再 `createRoot` 渲染 `LibraryPage`。**没有任何前置 reset**——UI 框架已移除，它的全局重置也一并删除。它不建 store、不 import `store/**`、不发任何请求。

**这一页不再引入任何 UI 框架**：重构后 antd 全量移除——`page/library/theme.ts`、`library.tsx` 里的 `antd/dist/reset.css`、`bangumi/vite.config.ts` 的 antd alias、`web/tsconfig.json` 的 antd paths、`bangumi/package.json` 的 antd 依赖一并删除，`library-*.js` 不再背一份只服务单一页面的框架。实机探针：文档页的 `[class*="ant-"]` 计数为 **0**。这条边界写在 [AGENTS.md](../../../AGENTS.md) §规则「技术栈约束」第 6 条「UI 框架：none」。

### 路由与搜索

| hash | 落到哪 |
|---|---|
| `library.html`（空 hash）、`#/components/`、`#/components/overview` | 总览页（12 张卡，点卡进详情页） |
| `#/components/<kind>` | 该 `kind` 的详情页（`kind` 必须是 `registry.tsx` 的 12 个之一） |
| 其它 hash | 「没有这个组件」+ 回总览页的链接 |

路由是 `router.ts` 手写的十几行（`parseRoute` + `hashchange` 订阅），**没有引路由库**——两个页面形态用十几行就够，不值得为静态文档页加依赖。切页写 `location.hash`（进历史，前进后退可用、URL 可直连），让"当前在哪一页"只有一处来源。

顶部搜索是**真实过滤**（`search.ts`）：输入即过滤左侧导航，命中 kind 名（`SubjectCards`）、中文标题、summary、参数表的字段 / 取值 / 类型 / 说明，以及**示例数据本身**（搜「轻音」能定位到 `SubjectCards`，因为界面上就是那几个字）；回车跳到第一个匹配项，清空后恢复 13 项（12 个组件 + 组件总览）。

### 八个文件的分工

| 文件 | 职责 |
|---|---|
| `App.tsx` | 骨架（**自绘**）：顶栏交给共享组件 `AppTopBar`（品牌「Bangumi 内容组件库」+ 栏目「组件」+ 搜索框 + 主界面 / 调试页链接 + 版本 `<Pill>`）、左侧两层分组导航（行用共享基类 `.appNavRow`）、内容区、右侧自绘 `PageToc`；按路由渲染总览页 / 详情页 / 「没有这个组件」 |
| `router.ts` | 极简 hash 路由：`parseRoute` / `useRoute` / `navigate` 与两个 href 构造器 |
| `search.ts` | 顶部搜索的过滤口径（`filterSections`） |
| `Overview.tsx` | 总览页：12 张自绘可点卡（`button`，键盘可达；CSS Grid 排布），每张是「中文名 + kind 胶囊 + 一句话 + 一张真实小预览」 |
| `ComponentPage.tsx` | 详情页：严格四块（UI 预览 / 参数 / event 输入 / frame 输入）+ 参数表五列 + 参数块下的一行参考附注；全部自绘，参数表**复用 `.contentTable` 皮肤** + 组合类 `.libParamTable`；`PAGE_ANCHORS` 是这四块的锚点清单（`ui-preview` / `params` / `event` / `frame`） |
| `items.ts` | 载荷 → 条目 / event / frame 文本；frame 里的固定模拟标量 `FRAME_STATE` |
| `samples.ts` | 数据源两张表：`LIBRARY_SECTIONS`（12 个 `kind` 的标题、简介、主载荷、空载荷、参数表、`reference`）与 `LIBRARY_GROUPS`（左侧导航的分组与组内顺序） |
| `index.tsx` | 只做一件事：`export { LibraryPage } from './App'` |

页外还有四处：`web/library.html`（构建入口的 HTML）、[web/src/library.tsx](../../../src/library.tsx)（入口：样式引入顺序 + `createRoot`）、`web/src/styles/library.css`（这一页的骨架与内容区排版，只声明 `lib*` 前缀）、`web/src/styles/common.css` 与 `web/src/components/common/`（共享表面原语：导航行、空态、胶囊等三个入口共用，顶栏 `AppTopBar` 由调试页与文档页共用——主界面已无顶栏，见 [readme.md](readme.md)）。

## 使用说明

- **改这一页之前先读 §规则**：骨架自绘（与主界面、调试页共用 `components/common/`）、内容归 `ContentBlock`、详情页只有四块、两个 JSON 由同一份载荷生成，都在那里。
- **只想查「某个 `kind` 的载荷怎么写」「某个字段是什么意思」**：直接读那一页的 event 块与参数表（它们就是契约的抄本），或查 §索引 的「符号一览」。
- **只想改外观**：顶栏形态在 `web/src/styles/common.css` 的共享类与 `web/src/components/common/AppTopBar.tsx`；本页自己的骨架与内容区排版在 `web/src/styles/library.css`；**条目本身**的外观不在这里，去 [../styles/content-and-brand.md](../styles/content-and-brand.md)。
- **新增一种内容 `kind`**：先按 [../components/content.md](../components/content.md) §规则 的 7 步清单做，再回来按 §规则「新增 `kind` 时这一页要跟着加一节」改那几处。
- **开发期打开这一页**：dev server 按路径服务 `web/` 下的 HTML，直接访问 `/library.html`（端口由 `npm run dev:web` 打印）。构建产物那一份是 `dist/web/library.html`（`npm run build:web` 两个入口都会产出）。

## 规则

### 骨架自绘并复用共享层，内容一律走真实 `ContentBlock`

骨架（顶栏 / 左侧导航 / 搜索框 / 卡片 / 参数表）**全部自绘**：顶栏用共享组件 `components/common/AppTopBar`（+ `AppTopBarTab`），导航行用共享基类 `.appNavRow`，标签与版本号用 `<Pill>`，空态用 `.appEmpty`——与主界面、调试页是**同一批组件、同一套令牌**，不再有「工具页另有一套外观」的例外。**但 12 种内容块的渲染一律走项目自己的 `<ContentBlock block={…} />`，骨架不参与内容渲染**。详情页的 UI 预览是 `blockOf(section.kind, section.payload)` 造出的内容块交给 `<ContentBlock>` 的——与真实会话走**同一个组件、同一套接收侧校验与降级**；总览页的小预览同样是真实渲染，不是缩略图。

**为什么**：和调试页同一条理由（见 [debug.md](debug.md) §规则「预览必须复用 `<Stage>`，不得另写一套渲染」）。手抄一份 markup、或用另一套组件重搭一个"长得像"的预览，第一处协议或皮肤漂移之后预览就不再等于会话所见；而这一页存在的唯一价值就是让"组件库长什么样"有唯一可信的一屏。

**违反后果**：文档页展示的形态与会话里真实的形态出现第二套，改动据此判断会改错。

### 详情页严格四块，不许加第五块

固定顺序与 id 都是契约（`ComponentPage.tsx` 的 `PAGE_ANCHORS`，右侧目录按它生成）：

1. **UI 预览**（`id="ui-preview"`）：主载荷 + 若干**形态变体**（`section.variants`，可空）+ 一张 `空数据` 变体，都是同构的自绘 `.libCard` 预览卡；
2. **参数**（`id="params"`）：参数表（**复用内容条目的 `.contentTable` 皮肤** + 组合类 `.libParamTable`，五列：字段 / 类型 / 必填 / 取值 / 说明），**下方一行参考附注**；
3. **调试页 event 输入**（`id="event"`）：可复制的 JSON 块；
4. **调试页 frame 输入**（`id="frame"`）：同上。

**曾经有过第 5 块「customType」**（`id="custom-type"`，写 `customType: "<kind>"` 与载荷字段名）：块的形状统一为 `{ type, pending?, props }`、且 `type` 的取值就是组件名之后，这一块不再回答任何问题——没有随 kind 变化的字段名可讲，`type` 本身在 UI 预览的 event JSON 里已经看得见。因此删除，**id `custom-type` 已不存在**，右侧目录是四项。

**参考只能作为参数块下的一行附注**（`ReferenceLine`），不得升级成独立的一块——这是产品明确划的边界。同理，再塞第五类内容（另一套 demo、用法教程、截图、变更日志）之后，没人能一眼分辨哪一块是契约。

**形态变体（`section.variants`）不属于这一类**：它是**同一个 `kind` 的另一种排布/模式**（`SubjectCards` 的 `layout: 'list'`、`StatsCard` 的 `mode`、`ProgressView` 的数值/章节网格），仍在第 1 块内部、与主载荷走**同一条渲染路径**（`blockOf` + `ContentBlock` + `eventTextOf`），只是让「这一类组件一共有几种长相」在同一页可见。判据是「换的是载荷里的判别字段，还是另一件事」——后者才算第五类内容。

**为什么**：四块正好覆盖三件事——长什么样、字段怎么写、怎么在调试页复现。

**违反后果**：契约与说明混在一起，改协议时不知道该同步哪一块。

### event 与 frame 由同一份载荷现场生成（所见即所粘）

`eventText(section)` 与 `frameText(section)` 都只读 `section.payload`：event 是 `message_end` + `role: "assistant"` + `content: [block]`；frame 是 `type: "state"`、`instanceId: "debug-instance"`、`revision: 1`、`full: true`，条目为一条 user 条目 + 一条 `kind: "assistant"` 条目（`content: [block]`）。

- `blockOf()` 把载荷**原样**放进 `props`（`{ type: kind, props: payload }`），与宿主 `message-blocks.ts` 的投影方式一致；
- frame 的信封取值与调试页首帧的要求对齐（`instanceId` / `revision` / `full` 三者的理由见 [debug.md](debug.md) §规则「首帧 `instanceId` 必须是 `DEBUG_INSTANCE_ID`，重置时 `revision` 必须接上」）——frame 代码块的提示语里那句「先把 event 框清空」就是因为调试页以 event 优先（`parseInputs`）。

**为什么**：一份数据两处输出，粘进调试页的结果必然与预览同源；另写一份 JSON 就会出现"预览是这个载荷、粘进去是那个载荷"的错配。

**违反后果**：文档页给的示例与调试页实际渲染的条目不是同一份数据，示例失去意义。

### 参数表必须与 `protocol.ts` 及 `validate.ts` 对齐

`samples.ts` 的 `params`（`ParamRow`：`field` / `type` / `required` / `values` / `note`）是协议契约的**抄本**：字段名与 `bangumi/src/web/protocol.ts` 的视图类型一一对应，取值枚举（`layout`、`mode`、`tone`、`kind`、`state`…）与前端校验器 `web/src/components/content/validate.ts` 的守卫一致。

**改协议或改校验就要同步改 `samples.ts`**（文件头注释写的就是这条），否则这一页会当着所有人的面说谎。块的形状统一为 `{ type, pending?, props }` 之后，这一页不再需要「kind → 载荷字段名」的对照表——`samples.ts` 的 `params` 是仅剩的一处协议抄本。

**违反后果**：参数表比源码旧，按它写的载荷字段会在接收侧降级或直接丢弃。

### 配色只有令牌一处来源，文档页不再有第二处抄本

文档页的配色**直接消费 `--bgm-*` / `--app-*` 令牌**（需要透明度时 `color-mix()` 就地派生），与主界面、调试页同源：改令牌，这一页跟着变，**不再有 `theme.ts` 那种需要逐条重算的配色映射表**。

**曾经的代价已经消失**：骨架用 antd 时，antd 的 token 要参与颜色推导（hover / active / 边框色阶由 `@ant-design/colors` 从主色算出），传一个 `var(--bgm-primary)` 字符串它算不出去、组件会**退回默认蓝**，所以只能在 `page/library/theme.ts` 的 `LIBRARY_THEME` 里写一份 `color-mix()` 派生结果的**实色抄本**，改令牌时必须逐条按注释重算——那份抄本与 `theme.ts` 已随自绘骨架一并删除。

**还剩的实色抄本只有 HTML 里的预涂底色**：[web/index.html](../../../index.html) 与 [web/library.html](../../../library.html) 的 `background` 与 `theme-color`（样式表加载前 CSS 变量还不存在，只能写 `--bgm-bg` 的实色值）。改令牌时同步这两处，别的地方都不用动。

**违反后果**：漏改预涂底色，首屏会先闪一下旧色，再被样式表纠正过来。

### 文档页不再有外观例外：与主界面同一套表面语言

`web/src/styles/library.css` 只负责**本页独有的那部分**：左侧导航与内容区的分区、放进顶栏的元素（品牌、搜索框、入口链接）、右侧自绘目录、内容区（预览卡 / 代码块 / 参数表补充 / 参考行）的排版与窄屏适配。它**只声明 `lib*` 前缀的类**，不覆写共享类（`.appTopBar*` / `.appNavRow` / `.appGlass` / `.appEmpty`）与内容组件的既有类，**也没有任何 `.ant-*` 规则**——骨架自绘之后，不再有需要让位的框架元素。

参数表是唯一有组合类的地方：它**复用内容条目的 `.contentTable` 皮肤**，`.libParamTable` 只补两处真实差异——表头没有排序按钮所以要自己给内边距、必填列走危险色。

- 这一页与主界面、调试页**共用同一套表面语言**（导航行 `.appNavRow`、玻璃 `.appGlass`、空态 `.appEmpty`、胶囊、圆角四档、间距刻度都来自 `components/common/` 与 `--app-*` 令牌；顶栏 `AppTopBar` 由调试页与文档页共用，主界面已无顶栏）——形态基准仍是「一组件一页 + 总览页」的文档站，但骨架不再由框架提供，也不许为它另起一套外观；
- **所有颜色仍走 `--bgm-*` / `--app-*`**（需要透明度时 `color-mix()` 就地派生），不写裸色值；页面里的链接也遵守全站口径：`.libInlineLink` 与 `.libReferenceLine a` 都是**主色深字 + 下划线**（后者原先一条样式都没有、直接吃浏览器默认蓝 `rgb(0,0,238)`），**不出现蓝色链接色**（见 [../styles/readme.md](../styles/readme.md) §规则 第 10 条）；
- **要给内容组件加属性时不要在这里改 `.content*`**——按跨层约定用组合类，或在 [../styles/content-and-brand.md](../styles/content-and-brand.md) 改那一条唯一来源。

**违反后果**：同一元素同一属性出现第二个来源，改 `content.css` 看不到效果（[AGENTS.md](../../../AGENTS.md) §规则「外观层硬约定」第 1 条）。

### 左导航取粉底、内容区取白面，靠 1px hairline 分区

`library.css` 里 `.libNav` 的 `background` 是 `var(--app-surface-sunken)`（即 `--bgm-bg`，主色 13% + 白），共享顶栏 `.appTopBar` 也是同一个粉底（它自己的规则在 `common.css`，本页不覆写）；`.libFrame` / `.libContent` 是 `var(--bgm-surface)`（白 `#fff`）——与主界面「侧栏 | 对话区」是**同一套分区语言**：粉底留给导航与顶栏，白面留给要读的内容。区隔另外靠 `.libNav` 的 `border-right`、`.libTocSider` 的 `border-left` 这类 1px hairline。此前是「三栏统一白底」，导航与内容靠分区线区分。

**为什么**：配色口径明确不使用中性灰表面，粉底与白面的分界同时说明了「哪里是入口、哪里是正文」。

**颜色仍然全部走令牌**：这一页的间距与阴影尺度可以自定，但底色不许写裸色值——白底也必须写 `var(--bgm-surface)`。

**违反后果**：底色比基准多一层，卡片与分区线的作用互相打架；写死白值则换令牌时不跟随。

### 右侧页内目录自绘，不写 `location.hash`

`PageToc`（在 `App.tsx` 里）是自绘的 `<ul>` + `<button>` + `IntersectionObserver`（`rootMargin: '-72px 0px -70% 0px'`）高亮，点击走 `scrollIntoView({ behavior: 'smooth' })`——**没有任何一处写 `location.hash`**。

**为什么**：本页的「一组件一页」路由占着 hash（`#/components/<kind>`），目录项若也写 hash，两者会互相覆盖——点一下目录就会把整页路由改掉。保路由（前进后退、可直连 URL 是确认过的形态）优先，所以选了一个不碰 hash 的自绘目录（antd 的 `Anchor` 正是靠写 hash 实现的，因此当时就没用它）。右侧目录只在详情页出现（总览页没有四块可导航，留一列空白反而像坏了）。

**违反后果**：点右侧目录会跳错页或丢掉当前路由。

### 搜索过滤口径只写在 `search.ts`

`filterSections(query)` 是搜索的唯一实现：页面只把它的结果喂给左侧导航与总览页。加一类命中（例如新加一个字段）改这里一处即可，不要在组件里再过滤一遍。

**违反后果**：导航过滤与总览页过滤出现两套口径，同一关键词在两个地方给出不同结果。

### 新增 `kind` 时这一页要跟着加一节

**两张表都在 `samples.ts`**，`App.tsx` 与 `Overview.tsx` **不硬编码任何 kind**——左侧导航、总览卡数量、文案里的计数全部从表派生：

1. 在 `LIBRARY_SECTIONS` 里加一项（`kind` / `title` / `summary` / `payload` / `variants?` / `empty` / `params` / `reference`）；
2. 在 `LIBRARY_GROUPS` 的某一组 `kinds` 里加上它（条目与集合 / 数据与统计 / 文本与提示）——**漏了这一步它只会出现在总览页、左侧导航里找不到**；
3. 两项的顺序与 `registry.tsx` 的 `CONTENT_KINDS` 对齐；
- `empty` 必须给：页面给每个 `kind` 都渲染一个「空数据」变体，空态是这一页的一半价值（12 个 `kind` 里 10 个用 `.contentEmpty`，`DataTable` 的文案是「没有可展示的列。」，`QuoteBlock` 与 `Callout` 没有空态块）；
- `reference` 为 `null` 时页面显示「未使用 ReactBits 组件。」。**真实落点只有 3 节**（`StatsCard` → `Counter`、`TagCloud` → `GlareHover`、`Callout` → `StarBorder`，仅 `tone === 'progress'`），`InfoBox` / `DataTable` / `Timeline` 写的是「Animated List（只参考节奏，未引入源码）」，其余 6 节（`SubjectCards` / `ProgressView` / `QuoteBlock` / `Gallery` / `CompareTable` / `LinkList`）应是 `null`。**`reference` 只写真的落在该组件上的动效**：没有落点就写 `null`，"不为了用而用"（见 [../components/content.md](../components/content.md) §规则「每个 `kind` 的动效落点」）。**注意（`samples.ts` 待同步，本文不改源码）**：该表目前仍是旧值——`SubjectCards` 写着 `Spotlight Card`、`QuoteBlock` 写着 `Shiny Text`、`Callout` 是 `null`，三处都要按上面这行改。

**违反后果**：协议多了第 13 种 `kind`，组件库这一页却没有它（或只在总览页有、导航里找不到）——文档页从"唯一可信的一屏"退化成过期截图。

### 这一页不连宿主

不 import `store/**`、不建 `<Provider>`、不发请求。frame 里的标量用固定的 `FRAME_STATE` 模拟值（`modelLabel: 'debug/mock-model'`、`sessionId: 'library-preview'`、`loginText: '未登录（组件库不访问账户）'` 等）。

**为什么**：与调试页隔离主 store 同一条理由——文档页全程是静态示例，任何一次请求都会让它依赖宿主的运行状态，从而失去"随时可打开的一屏契约"这个用途。

**违反后果**：文档页在宿主未启动时打不开或报错。

## 索引

### 符号一览

| 符号 | 位置 | 作用 | 什么时候读 |
|---|---|---|---|
| `LibraryPage` | `App.tsx` | 骨架本体（**自绘**）：`AppTopBar`（品牌 + 栏目 + 搜索 + 两个入口链接 + 版本胶囊）+ 左侧 `.appNavRow` 导航 + 内容区 + 右侧 `PageToc`；按路由渲染总览 / 详情 / 未知页 | 改骨架、导航、搜索接线时 |
| `AppTopBar` / `AppTopBarTab` | `components/common/AppTopBar.tsx` | 顶栏骨架（`.appTopBar*`），**只服务调试页与文档页**（主界面已按 C01 删除顶栏）；文档页通过 `brand` / `tabs` / `actions` 三个槽位放自己的东西 | 改顶栏形态、想给文档页另写顶栏时 |
| `Pill` | `components/common/Pill.tsx` | 带底与描边的胶囊容器（`.appPill`）：用于 kind 标签与版本号（文字样式用 `MicroLabel`） | 想加标签、读数胶囊时 |
| `LIBRARY_GROUPS` | `samples.ts` | 左侧导航的分组表：条目与集合（`SubjectCards` / `Gallery` / `TagCloud` / `LinkList`）、数据与统计（`StatsCard` / `ProgressView` / `DataTable` / `CompareTable` / `Timeline`）、文本与提示（`InfoBox` / `QuoteBlock` / `Callout`）；`App.tsx` 从它派生导航里的行 | 调整导航分组、新增 kind 时 |
| `PageToc` | `App.tsx` | 右侧页内目录：自绘 `<ul>` + `<button>` + `IntersectionObserver` 高亮，点击走 `scrollIntoView`（不写 hash，理由见 §规则） | 改目录高亮、疑惑为什么不用会写 hash 的目录实现时 |
| `useRoute` / `parseRoute` | `router.ts` | hash → 路由（`overview` / `component` / `unknown`），并订阅 `hashchange` | 加页面形态、改 URL 契约时 |
| `navigate` / `OVERVIEW_HREF` / `componentHref` | `router.ts` | 写 hash 切页（进历史）+ 内容区滚回顶部；两个 href 构造器 | 加跳转入口、排查"后退没用"时 |
| `filterSections` | `search.ts` | 顶部搜索的过滤口径（kind 名 / 标题 / summary / 载荷 JSON / 参数表四列） | 改搜索命中范围时 |
| `Overview` | `Overview.tsx` | 总览页：每个 kind 一张自绘可点卡（`button`，数量与文案都取自 `LIBRARY_SECTIONS`，不写死数字），卡里是真实 `ContentBlock` 小预览，点卡进详情页 | 改总览页、新增 kind 时 |
| `ComponentPage` | `ComponentPage.tsx` | 详情页本体（**自绘**）：严格四块（第 1 块里含主载荷 / 形态变体 / 空数据三色预览卡）+ 参数表（复用 `.contentTable` 皮肤）+ 参考附注 | 改详情页结构时 |
| `PAGE_ANCHORS` | `ComponentPage.tsx` | 四块的锚点 id 与标题（`ui-preview` / `params` / `event` / `frame`）；`PageToc` 按它生成 | **改四块标题或 id 时**（id 是契约） |
| `PARAM_COLUMNS` | `ComponentPage.tsx` | 参数表五列：字段 / 类型 / 必填 / 取值 / 说明 | 改参数表列时 |
| `CodeBlock` | `ComponentPage.tsx` | 可复制的 JSON 块（自绘 `.libCard` + 复制按钮）；复制后 1.6s 内显示「已复制」，剪贴板不可用时**静默返回、不谎报成功** | 改复制交互、怀疑"复制没反应"时 |
| `ReferenceLine` | `ComponentPage.tsx` | 参数块下方的**一行**参考附注（`reference` 为 `null` 时显示「未使用 ReactBits 组件。」） | 改参考文案、想把参考升级成一块时 |
| `blockOf(kind, payload)` | `items.ts` | 把载荷包成内容块（`{ type, props: payload }`），交给真实 `ContentBlock` | 改预览载荷构造、排查预览与调试页不一致时 |
| `eventTextOf` / `eventText` / `frameText` | `items.ts` | 由同一份载荷现场生成 event / frame JSON；`eventTextOf(kind, payload)` 是主载荷与形态变体共用的入口（变体卡上的「复制 event」也走它） | 改「所见即所粘」时 |
| `FRAME_STATE` | `items.ts` | frame 示例里的固定标量（组件库不连宿主，全部是模拟值） | 改 frame 示例时 |
| `LIBRARY_SECTIONS` | `samples.ts` | 12 节的**唯一来源**：`kind` / `title` / `summary` / `payload` / `variants` / `empty` / `params` / `reference` | 加节、改示例载荷、改参数表时 |
| `LibrarySection` / `LibraryVariant` / `ParamRow` / `Reference` | `samples.ts` | 一节的类型、形态变体、参数表行、ReactBits 参考（`reference` 可为 `null`） | 改数据结构时 |
| `SUBJECT_ITEM` | `samples.ts` | `SubjectCards` 的条目卡公共参数行（`Gallery` 的 item 是另一套字段，**不能共用这张表**） | 改条目卡参数时 |

### 文件 → 场景

| 文件 | 什么时候读 |
|---|---|
| 本文件 | 改组件库文档页任何一处之前；想知道"预览为什么等于会话所见"时 |
| `web/library.html` | 改入口 HTML、加第三个构建入口时 |
| `web/src/library.tsx` | 改样式引入顺序（`tokens → common → … → library.css`）、入口装配时 |
| `web/src/page/library/App.tsx` | 改骨架、左侧导航分组、顶部搜索接线、右侧目录时 |
| `web/src/page/library/router.ts` | 改 hash 契约、切页行为时 |
| `web/src/page/library/search.ts` | 改搜索过滤口径时 |
| `web/src/page/library/Overview.tsx` | 改总览页的卡片形态时 |
| `web/src/page/library/ComponentPage.tsx` | **改详情页四块结构、参数表、两个 JSON 块时必读** |
| `web/src/page/library/items.ts` | 改 event / frame 的生成方式、frame 的模拟标量时 |
| `web/src/page/library/samples.ts` | 加节、改示例载荷与参数表时（**协议改动后必读**） |
| `web/src/page/library/index.tsx` | 改导出面时（当前只有一行 re-export） |
| `web/src/styles/library.css` | 改这一页的骨架、内容区排版、底色（左导航粉底 + 内容区白面）与窄屏适配时 |
| `web/src/styles/common.css` | 改顶栏骨架（调试页 / 文档页）、导航行、玻璃、空态、胶囊等**跨入口共用**的表面原语时 |
| `web/src/components/common/AppTopBar.tsx` | 改顶栏的槽位（品牌 / 栏目 / 动作区）时 |
| [bangumi/vite.config.ts](../../../../bangumi/vite.config.ts) | 改构建入口（`build.rollupOptions.input`）时 |
| [../components/content.md](../components/content.md) | 改条目渲染、校验、新增 `kind` 时 |
| [debug.md](debug.md) | 核对 event / frame 示例的语义与首帧要求时 |

### 章节 → 场景

| 章节 | 什么时候读 |
|---|---|
| §简介「与主界面、调试页的关系」 | 疑惑这一页为什么不参与 `Root` 的 hash 分流、为什么不需要 store、为什么不再引入 UI 框架时 |
| §简介「路由与搜索」 | 改 URL 契约、或想知道搜索命中哪些字段时 |
| §简介「八个文件的分工」 | 找某个改动该落在哪个文件时 |
| §规则「骨架自绘并复用共享层，内容一律走真实 `ContentBlock`」 | 想给预览写"更好看"的静态示例、或想给文档页另起一套外观时 |
| §规则「详情页严格四块，不许加第五块」 | 想给某一页加内容块、或想把参考写成一块时 |
| §规则「event 与 frame 由同一份载荷现场生成（所见即所粘）」 | 示例与调试页渲染结果不一致时 |
| §规则「参数表必须与 `protocol.ts` 及 `validate.ts` 对齐」 | **改协议、改校验后必读** |
| §规则「配色只有令牌一处来源，文档页不再有第二处抄本」 | **改 `--bgm-*` 令牌后必读**；文档页配色和站点不一致时 |
| §规则「文档页不再有外观例外：与主界面同一套表面语言」 | 改这一页样式、想覆写 `.content*` 或共享类时 |
| §规则「左导航取粉底、内容区取白面，靠 1px hairline 分区」 | 改这一页底色、或问"为什么导航有底色而内容区没有"时 |
| §规则「右侧页内目录自绘，不写 `location.hash`」 | 想把目录换成会写 hash 的实现、或点目录跳错页时 |
| §规则「搜索过滤口径只写在 `search.ts`」 | 想加一类搜索命中时 |
| §规则「新增 `kind` 时这一页要跟着加一节」 | **新增内容展示时逐步照做** |
| §规则「这一页不连宿主」 | 想在这里加请求或读 store 时 |
