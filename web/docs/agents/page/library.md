# 内容组件库文档页（`web/src/page/library/`）

## 简介

组件库文档页：**形态对齐 ant.design 文档站（一组件一页 + 总览页），骨架用 antd 搭，但 12 种内容条目一律由项目自己的 `ContentItem` 真实渲染，并把可直接粘进调试页的 event / frame JSON 现场生成出来的开发期页面**。它不连宿主、不发请求，页面上的每个预览都是 `ContentItem` 的真实输出。

**不覆盖**：内容条目的渲染与校验（见 [../components/content.md](../components/content.md)）、条目皮肤（见 [../styles/content-and-brand.md](../styles/content-and-brand.md)）、这一页的布局与排版（见 [../../../src/styles/library.css](../../../src/styles/library.css)）、antd 的例外边界（见 [AGENTS.md](../../../AGENTS.md) §规则「技术栈约束」）、调试页本体（见 [debug.md](debug.md)）、主界面装配（见 [main-page.md](main-page.md)）。

上层：[readme.md](readme.md)；跨层规则：[AGENTS.md](../../../AGENTS.md)。

### 与主界面、调试页的关系

主界面与调试页由 `web/src/main.tsx` 的 `Root` 按 hash **互斥挂载**（见 [readme.md](readme.md) §规则「新增一个页面时」）。文档页不走这条路：它是**另一个 HTML 文档**，由 [web/library.html](../../../library.html)（脚本指向 `/src/library.tsx`）单独加载，因此在 `main.tsx` 的 `Root` 里没有分支、也**不参与 `Root` 的 hash 分流**（它有自己的 hash 路由，见下节）。

[web/src/library.tsx](../../../src/library.tsx) 只做两件事：先引入 `antd/dist/reset.css`（antd 的全局重置，**放在所有样式之前**），再按与 `main.tsx` **相同的顺序**引入样式（`tokens → frame → composer → cards → modal → bgm → content`，末位追加 `styles/library.css`；不引入 `debug.css`），然后渲染 `LibraryPage`。它不建 store、不包 `<Provider>`、不 import `store/**`、不发任何请求。

**antd 只服务这一个入口**：构建产物里主入口 `index-*.js` 仍是 209.31 kB（引入 antd 前 209.26 kB），antd 全部落在 `library-*.js`（722.53 kB / gzip 231.99 kB）。这条"不许扩散到主界面与调试页"的边界写在 [AGENTS.md](../../../AGENTS.md) §规则「技术栈约束」。

### 路由与搜索

| hash | 落到哪 |
|---|---|
| `library.html`（空 hash）、`#/components/`、`#/components/overview` | 总览页（12 张卡，点卡进详情页） |
| `#/components/<kind>` | 该 `kind` 的详情页（`kind` 必须是 `registry.tsx` 的 12 个之一） |
| 其它 hash | 「没有这个组件」+ 回总览页的链接 |

路由是 `router.ts` 手写的十几行（`parseRoute` + `hashchange` 订阅），**没有引路由库**——两个页面形态用十几行就够，不值得为静态文档页加依赖。切页写 `location.hash`（进历史，前进后退可用、URL 可直连），让"当前在哪一页"只有一处来源。

顶部搜索是**真实过滤**（`search.ts`）：输入即过滤左侧导航，命中 kind 名（`subjects`）、中文标题、summary、参数表的字段 / 取值 / 类型 / 说明，以及**示例数据本身**（搜「轻音」能定位到 `subjects`，因为界面上就是那几个字）；回车跳到第一个匹配项，清空后恢复 13 项（12 个组件 + 组件总览）。

### 九个文件的分工

| 文件 | 职责 |
|---|---|
| `App.tsx` | 骨架：`ConfigProvider` + antd `Layout`（Header / Content / Sider）、左侧两层分组 `Menu`、顶部 `Input.Search`、右侧自绘 `PageToc`；按路由渲染总览页 / 详情页 / 「没有这个组件」 |
| `router.ts` | 极简 hash 路由：`parseRoute` / `useRoute` / `navigate` 与两个 href 构造器 |
| `search.ts` | 顶部搜索的过滤口径（`filterSections`） |
| `Overview.tsx` | 总览页：12 张卡，每张是「kind 名 + 中文名 + 一句话 + 一张真实小预览」 |
| `ComponentPage.tsx` | 详情页：严格五块（UI 预览 / customType / 参数 / event 输入 / frame 输入）+ 参数表五列 + 参数块下的一行参考附注；`PAGE_ANCHORS` 是这五块的锚点清单（`ui-preview` / `custom-type` / `params` / `event` / `frame`） |
| `items.ts` | 载荷 → 条目 / event / frame 文本；frame 里的固定模拟标量 `FRAME_STATE` |
| `samples.ts` | 数据源两张表：`LIBRARY_SECTIONS`（12 个 `kind` 的标题、简介、主载荷、空载荷、参数表、`reference`）与 `LIBRARY_GROUPS`（左侧导航的分组与组内顺序） |
| `theme.ts` | antd 主题：把 token 映射到 `--bgm-*` 的**当前色值** |
| `index.tsx` | 只做一件事：`export { LibraryPage } from './App'` |

页外还有三处：`web/library.html`（构建入口的 HTML）、[web/src/library.tsx](../../../src/library.tsx)（入口：样式引入顺序 + `createRoot`）、`web/src/styles/library.css`（这一页的布局与排版，骨架由 antd 提供）。

## 使用说明

- **改这一页之前先读 §规则**：骨架归 antd、内容归 `ContentItem`、详情页只有五块、两个 JSON 由同一份载荷生成、`theme.ts` 要跟着令牌改，都在那里。
- **只想查「某个 `kind` 的载荷怎么写」「某个字段是什么意思」**：直接读那一页的 event 块与参数表（它们就是契约的抄本），或查 §索引 的「符号一览」。
- **只想改外观**：骨架形态（顶栏 / 导航 / 搜索的观感）在 `page/library/theme.ts` 的 antd token 与 `web/src/styles/library.css`；**条目本身**的外观不在这里，去 [../styles/content-and-brand.md](../styles/content-and-brand.md)。
- **新增一种内容 `kind`**：先按 [../components/content.md](../components/content.md) §规则 的 7 步清单做，再回来按 §规则「新增 `kind` 时这一页要跟着加一节」改那几处。
- **开发期打开这一页**：dev server 按路径服务 `web/` 下的 HTML，直接访问 `/library.html`（端口由 `npm run dev:web` 打印）。构建产物那一份是 `dist/web/library.html`（`npm run build:web` 两个入口都会产出）。

## 规则

### 骨架用 antd，内容一律走真实 `ContentItem`

骨架（`Layout` / `Menu` / `Input.Search` / `Card` / `Table` / `Typography` / `Divider` / `Button` / `Tag` / `Tooltip` / `ConfigProvider`）由 antd 提供，**但 12 种内容条目的渲染一律走项目自己的 `<ContentItem item={…} />`，antd 不参与内容渲染**。详情页的 UI 预览是 `itemOf(section.kind, section.payload, 1)` 造出的 `ContentItemView` 交给 `<ContentItem>` 的——与真实会话走**同一个组件、同一套接收侧校验与降级**；总览页的小预览同样是真实渲染，不是缩略图。

**为什么**：和调试页同一条理由（见 [debug.md](debug.md) §规则「预览必须复用 `<Stage>`，不得另写一套渲染」）。手抄一份 markup、或用 antd 组件重搭一个"长得像"的预览，第一处协议或皮肤漂移之后预览就不再等于会话所见；而这一页存在的唯一价值就是让"组件库长什么样"有唯一可信的一屏。

**违反后果**：文档页展示的形态与会话里真实的形态出现第二套，改动据此判断会改错。

### 详情页严格五块，不许加第六块

固定顺序与 id 都是契约（`ComponentPage.tsx` 的 `PAGE_ANCHORS`，右侧目录按它生成）：

1. **UI 预览**（`id="ui-preview"`）：主载荷 + 一张 `空数据` 变体，两张 antd `Card`；
2. **customType**（`id="custom-type"`）：`customType: "<kind>"` 一行 + 「载荷放在事件的 `details` 里，本条约目的载荷字段是 `xxx`」一句；
3. **参数**（`id="params"`）：参数表（antd `Table`，五列：字段 / 类型 / 必填 / 取值 / 说明），**下方一行参考附注**；
4. **调试页 event 输入**（`id="event"`）：可复制的 JSON 块；
5. **调试页 frame 输入**（`id="frame"`）：同上。

**customType 与参数是分开的两块**：前者只回答「这个 kind 叫什么、载荷挂在事件的哪个字段上」，后者只回答「字段怎么写」。此前这两件事合在 `id="api"` 的一块里，`api` 这个 id 现在**已不存在**；拆开之后右侧目录是五项。

**参考只能作为参数块下的一行附注**（`ReferenceLine`），不得升级成独立的一块——这是产品明确划的边界。同理，再塞第六类内容（另一套 demo、用法教程、截图、变更日志）之后，没人能一眼分辨哪一块是契约。

**为什么**：五块正好覆盖三件事——长什么样、字段怎么写、怎么在调试页复现。

**违反后果**：契约与说明混在一起，改协议时不知道该同步哪一块。

### event 与 frame 由同一份载荷现场生成（所见即所粘）

`eventText(section)` 与 `frameText(section)` 都只读 `section.payload`：event 是 `message_end` + `role: "custom"` + `customType: kind` + `details: payload`；frame 是 `type: "state"`、`instanceId: "debug-instance"`、`revision: 1`、`full: true`，条目为一条 user 条目 + `itemOf(kind, payload, 2)`。

- `itemOf()` 补信封字段（`id` / `version` / `kind`）后把载荷**原样**带上，与宿主 `customContentDraft()` 的展开方式一致；
- frame 的信封取值与调试页首帧的要求对齐（`instanceId` / `revision` / `full` 三者的理由见 [debug.md](debug.md) §规则「首帧 `instanceId` 必须是 `DEBUG_INSTANCE_ID`，重置时 `revision` 必须接上」）——frame 代码块的提示语里那句「先把 event 框清空」就是因为调试页以 event 优先（`parseInputs`）。

**为什么**：一份数据两处输出，粘进调试页的结果必然与预览同源；另写一份 JSON 就会出现"预览是这个载荷、粘进去是那个载荷"的错配。

**违反后果**：文档页给的示例与调试页实际渲染的条目不是同一份数据，示例失去意义。

### 参数表必须与 `protocol.ts` 及 `validate.ts` 对齐

`samples.ts` 的 `params`（`ParamRow`：`field` / `type` / `required` / `values` / `note`）是协议契约的**抄本**：字段名与 `bangumi/src/web/protocol.ts` 的视图类型一一对应，取值枚举（`layout`、`mode`、`tone`、`kind`、`state`…）与前端校验器 `web/src/components/content/validate.ts` 的守卫一致。

**改协议或改校验就要同步改 `samples.ts`**（文件头注释写的就是这条），否则这一页会当着所有人的面说谎。`ComponentPage.tsx` 的 `payloadFieldOf(kind)` 里的「载荷字段名与 `registry.tsx` 的 `field` 一致、只有 `infobox` 是 `info`」属于同一类抄本——它是**已知的一处小重复**，协议加 kind 时要一起核。

**违反后果**：参数表比源码旧，按它写的 `details` 会在接收侧降级或直接丢弃。

### 配色映射的唯一代价：`theme.ts` 是 `--bgm-*` 的第二处抄本

antd 的配色通过 `ConfigProvider` 的 `theme.token` 映射，值写在 `page/library/theme.ts` 的 `LIBRARY_THEME` 里，**逐条注释了它对应哪个 `--bgm-*` 令牌**（主色 `#f09199`、链接 `#0084b4`、交互 `#369cf8`、文字 `#444` / `#666` / `#999` / `#333`、白面 `#fff`、底色 `#f5f5f5`、描边 `#ddd` / `#eee`、主色软底 `#fdf0f1` 与主色文字 `#a8575f`、圆角 10 / 5 等）。

**为什么不能写 `var(--bgm-primary)`**：antd 的 token 要参与颜色推导（hover / active / 边框的色阶由 `@ant-design/colors` 从主色算出），传一个 `var(...)` 字符串它算不出去、组件会**退回默认蓝**。所以这里只能写真实色值。

**这就是引入 antd 的唯一代价：改 `--bgm-*` 令牌时必须同步改 `theme.ts`。** 改令牌的人若漏了这一步，文档页会与站点其它页配色分叉，而且不会有任何编译期或运行时报错。

**违反后果**：换品牌色后文档页仍是旧色（或 antd 回退到默认蓝），两个页面看起来像两个产品。

### 文档页不守项目外观约定，但颜色必须走令牌

`web/src/styles/library.css` 大幅缩减：三栏骨架交给 antd，它只负责**三栏粘性布局、顶栏内元素间距、右侧自绘目录、内容区（预览卡 / 代码块 / 参数表 / 参考行）的少量排版与窄屏适配**，只声明 `lib*` 前缀的类，**不覆写 antd 或内容组件的既有类**。唯一的例外是三条**只在本页类名上下文里**给 antd 元素让位的排版规则（`.libPreviewCard .ant-card-body`、`.libCodeCard .ant-card-body`、`.libParamTable .ant-table`）——它们命中的都是本页自己渲染出来的那一个 antd 元素，不会波及其它页面。

- 这一页**不守**本项目其它外观约定（间距、阴影尺度自己定）——产品明确要求它对齐 ant.design 文档站的形态，这是允许的例外；
- 但**所有颜色仍走 `--bgm-*` / `--app-*`**（需要透明度时 `color-mix()` 就地派生），不写裸色值；
- **要给内容组件加属性时不要在这里改 `.content*`**——按跨层约定用组合类，或在 [../styles/content-and-brand.md](../styles/content-and-brand.md) 改那一条唯一来源。

**违反后果**：同一元素同一属性出现第二个来源，改 `content.css` 看不到效果（[AGENTS.md](../../../AGENTS.md) §规则「外观层硬约定」第 1 条）。

### 三栏统一白底，靠 1px hairline 分区

`library.css` 里 `.libFrame` / `.libBody` / `.libContent` 的 `background` 都是 `var(--bgm-surface)`（白 `#fff`），三栏因此是**同一片白底**，区隔只靠 `.libSider` 的 `border-right`、顶栏的 `border-bottom` 这类 1px hairline；此前是灰底（`var(--bgm-bg)` `#f5f5f5`）配白卡。实测 `.libFrame` / `.libContent` 的计算值都是 `rgb(255, 255, 255)`。

**为什么**：本页的形态基准是 ant.design 文档站（见本节第一条「骨架用 antd」），它本身就是白底 + hairline 分区，卡片只用来标记"内容块"。

**颜色仍然全部走令牌**：这一页的间距与阴影尺度可以自定，但底色不许写裸色值——白底也必须写 `var(--bgm-surface)`。

**违反后果**：底色比基准站多一层，卡片与分区线的作用互相打架；写死白值则换令牌时不跟随。

### 右侧页内目录自绘，不用 antd 的 `Anchor`

`PageToc`（在 `App.tsx` 里）是自绘的 `<ul>` + `IntersectionObserver`（`rootMargin: '-72px 0px -70% 0px'`）高亮，**没有用 antd 的 `Anchor`**。

**为什么**：`Anchor` 的锚点实现依赖写 `location.hash`，而本页的「一组件一页」路由也占着 hash（`#/components/<kind>`），两者会互相覆盖——点一下目录就会把整页路由改掉。保路由（前进后退、可直连 URL 是确认过的形态）优先，目录改成自绘；右侧目录只在详情页出现（总览页没有五块可导航，留一列空白反而像坏了）。

**违反后果**：点右侧目录会跳错页或丢掉当前路由。

### 搜索过滤口径只写在 `search.ts`

`filterSections(query)` 是搜索的唯一实现：页面只把它的结果喂给左侧导航与总览页。加一类命中（例如新加一个字段）改这里一处即可，不要在组件里再过滤一遍。

**违反后果**：导航过滤与总览页过滤出现两套口径，同一关键词在两个地方给出不同结果。

### 新增 `kind` 时这一页要跟着加一节

**两张表都在 `samples.ts`**，`App.tsx` 与 `Overview.tsx` **不硬编码任何 kind**——左侧导航、总览卡数量、文案里的计数全部从表派生：

1. 在 `LIBRARY_SECTIONS` 里加一项（`kind` / `title` / `summary` / `payload` / `empty` / `params` / `reference`）；
2. 在 `LIBRARY_GROUPS` 的某一组 `kinds` 里加上它（条目与集合 / 数据与统计 / 文本与提示）——**漏了这一步它只会出现在总览页、左侧导航里找不到**；
3. 两项的顺序与 `registry.tsx` 的 `CONTENT_KINDS` 对齐；
- `empty` 必须给：页面给每个 `kind` 都渲染一个「空数据」变体，空态是这一页的一半价值（12 个 `kind` 里 10 个用 `.contentEmpty`，`table` 的文案是「没有可展示的列。」，`quote` 与 `callout` 没有空态块）；
- `reference` 为 `null` 时页面显示「未使用 ReactBits 组件。」。当前只有 4 节写真实落点（`subjects` / `stats` / `tags` / `quote`），`infobox` / `table` / `timeline` 写的是「Animated List（只参考节奏，未引入源码）」，其余 5 节（`progress` / `gallery` / `compare` / `callout` / `links`）是 `null`。**`reference` 只写真的落在该组件上的动效**：没有落点就写 `null`，"不为了用而用"（见 [../components/content.md](../components/content.md) §规则「每个 `kind` 的动效落点」）。

**违反后果**：协议多了第 13 种 `kind`，组件库这一页却没有它（或只在总览页有、导航里找不到）——文档页从"唯一可信的一屏"退化成过期截图。

### 这一页不连宿主

不 import `store/**`、不建 `<Provider>`、不发请求。frame 里的标量用固定的 `FRAME_STATE` 模拟值（`modelLabel: 'debug/mock-model'`、`sessionId: 'library-preview'`、`loginText: '未登录（组件库不访问账户）'` 等）。

**为什么**：与调试页隔离主 store 同一条理由——文档页全程是静态示例，任何一次请求都会让它依赖宿主的运行状态，从而失去"随时可打开的一屏契约"这个用途。

**违反后果**：文档页在宿主未启动时打不开或报错。

## 索引

### 符号一览

| 符号 | 位置 | 作用 | 什么时候读 |
|---|---|---|---|
| `LibraryPage` | `App.tsx` | 骨架本体：`ConfigProvider` + `Layout`（Header / Content / Sider）+ 左侧 `Menu` + `Input.Search`；按路由渲染总览 / 详情 / 未知页 | 改骨架、导航、搜索接线时 |
| `LIBRARY_GROUPS` | `samples.ts` | 左侧导航的分组表：条目与集合（`subjects` / `gallery` / `tags` / `links`）、数据与统计（`stats` / `progress` / `table` / `compare` / `timeline`）、文本与提示（`infobox` / `quote` / `callout`）；`App.tsx` 从它派生 `Menu` 的 items | 调整导航分组、新增 kind 时 |
| `PageToc` | `App.tsx` | 右侧页内目录：自绘 + `IntersectionObserver` 高亮（不用 antd `Anchor`，理由见 §规则） | 改目录高亮、疑惑为什么不用 `Anchor` 时 |
| `useRoute` / `parseRoute` | `router.ts` | hash → 路由（`overview` / `component` / `unknown`），并订阅 `hashchange` | 加页面形态、改 URL 契约时 |
| `navigate` / `OVERVIEW_HREF` / `componentHref` | `router.ts` | 写 hash 切页（进历史）+ 内容区滚回顶部；两个 href 构造器 | 加跳转入口、排查"后退没用"时 |
| `filterSections` | `search.ts` | 顶部搜索的过滤口径（kind 名 / 标题 / summary / 载荷 JSON / 参数表四列） | 改搜索命中范围时 |
| `Overview` | `Overview.tsx` | 总览页：每个 kind 一张卡（数量与文案都取自 `LIBRARY_SECTIONS`，不写死数字），卡里是真实 `ContentItem` 小预览，点卡进详情页 | 改总览页、新增 kind 时 |
| `ComponentPage` | `ComponentPage.tsx` | 详情页本体：严格五块 + 参数表 + 参考附注 | 改详情页结构时 |
| `PAGE_ANCHORS` | `ComponentPage.tsx` | 五块的锚点 id 与标题（`ui-preview` / `custom-type` / `params` / `event` / `frame`）；`PageToc` 按它生成 | **改五块标题或 id 时**（id 是契约） |
| `PARAM_COLUMNS` | `ComponentPage.tsx` | 参数表五列：字段 / 类型 / 必填 / 取值 / 说明 | 改参数表列时 |
| `CodeBlock` | `ComponentPage.tsx` | 可复制的 JSON 块（antd `Card` + 复制按钮）；复制后 1.6s 内显示「已复制」，剪贴板不可用时**静默返回、不谎报成功** | 改复制交互、怀疑"复制没反应"时 |
| `ReferenceLine` | `ComponentPage.tsx` | 参数块下方的**一行**参考附注（`reference` 为 `null` 时显示「未使用 ReactBits 组件。」） | 改参考文案、想把参考升级成一块时 |
| `payloadFieldOf(kind)` | `ComponentPage.tsx` | `customType` 块那句提示里的载荷字段名（与 `registry.tsx` 的 `field` 一致，`infobox` → `info`） | 改提示文案、协议加 kind 时 |
| `itemOf(kind, payload, id)` | `items.ts` | 把载荷包成 `ContentItemView`（补 `id` / `version` / `kind`），交给真实 `ContentItem` | 改预览载荷构造、排查预览与调试页不一致时 |
| `eventText` / `frameText` | `items.ts` | 由同一份载荷现场生成 event / frame JSON | 改「所见即所粘」时 |
| `FRAME_STATE` | `items.ts` | frame 示例里的固定标量（组件库不连宿主，全部是模拟值） | 改 frame 示例时 |
| `LIBRARY_SECTIONS` | `samples.ts` | 12 节的**唯一来源**：`kind` / `title` / `summary` / `payload` / `empty` / `params` / `reference` | 加节、改示例载荷、改参数表时 |
| `LibrarySection` / `ParamRow` / `Reference` | `samples.ts` | 一节的类型、参数表行、ReactBits 参考（`reference` 可为 `null`） | 改数据结构时 |
| `SUBJECT_ITEM` | `samples.ts` | `subjects` 的条目卡公共参数行（`gallery` 的 item 是另一套字段，**不能共用这张表**） | 改条目卡参数时 |
| `LIBRARY_THEME` | `theme.ts` | antd 主题 token：配色抄自 `bgm.css` 的 `--bgm-*` 当前色值，逐条注释 | **改站点令牌后必读** |

### 文件 → 场景

| 文件 | 什么时候读 |
|---|---|
| 本文件 | 改组件库文档页任何一处之前；想知道"预览为什么等于会话所见"时 |
| `web/library.html` | 改入口 HTML、加第三个构建入口时 |
| `web/src/library.tsx` | 改样式引入顺序（`antd/dist/reset.css` 在最前）、入口装配时 |
| `web/src/page/library/App.tsx` | 改骨架、左侧导航分组、顶部搜索接线、右侧目录时 |
| `web/src/page/library/router.ts` | 改 hash 契约、切页行为时 |
| `web/src/page/library/search.ts` | 改搜索过滤口径时 |
| `web/src/page/library/Overview.tsx` | 改总览页的卡片形态时 |
| `web/src/page/library/ComponentPage.tsx` | **改详情页五块结构、参数表、两个 JSON 块时必读** |
| `web/src/page/library/items.ts` | 改 event / frame 的生成方式、frame 的模拟标量时 |
| `web/src/page/library/samples.ts` | 加节、改示例载荷与参数表时（**协议改动后必读**） |
| `web/src/page/library/theme.ts` | 改 antd 主题、或站点 `--bgm-*` 令牌变动后同步时（**改令牌后必读**） |
| `web/src/page/library/index.tsx` | 改导出面时（当前只有一行 re-export） |
| `web/src/styles/library.css` | 改这一页的排版、底色（三栏统一白底）与窄屏适配时 |
| [bangumi/vite.config.ts](../../../../bangumi/vite.config.ts) | 改构建入口（`build.rollupOptions.input`）或 antd 的 `resolve.alias` 时 |
| [web/tsconfig.json](../../../tsconfig.json) | 改 antd 的 `paths` 时 |
| [../components/content.md](../components/content.md) | 改条目渲染、校验、新增 `kind` 时 |
| [debug.md](debug.md) | 核对 event / frame 示例的语义与首帧要求时 |

### 章节 → 场景

| 章节 | 什么时候读 |
|---|---|
| §简介「与主界面、调试页的关系」 | 疑惑这一页为什么不参与 `Root` 的 hash 分流、为什么不需要 store、antd 为什么没进主入口时 |
| §简介「路由与搜索」 | 改 URL 契约、或想知道搜索命中哪些字段时 |
| §简介「九个文件的分工」 | 找某个改动该落在哪个文件时 |
| §规则「骨架用 antd，内容一律走真实 `ContentItem`」 | 想给预览写"更好看"的静态示例时 |
| §规则「详情页严格五块，不许加第六块」 | 想给某一页加内容块、或想把参考写成一块时 |
| §规则「event 与 frame 由同一份载荷现场生成（所见即所粘）」 | 示例与调试页渲染结果不一致时 |
| §规则「参数表必须与 `protocol.ts` 及 `validate.ts` 对齐」 | **改协议、改校验后必读** |
| §规则「配色映射的唯一代价：`theme.ts` 是 `--bgm-*` 的第二处抄本」 | **改 `--bgm-*` 令牌后必读**；文档页配色和站点不一致、或出现默认蓝时 |
| §规则「文档页不守项目外观约定，但颜色必须走令牌」 | 改这一页样式、想覆写 `.content*` 时 |
| §规则「三栏统一白底，靠 1px hairline 分区」 | 改这一页底色、或问"为什么卡片没有灰底衬托"时 |
| §规则「右侧页内目录自绘，不用 antd 的 `Anchor`」 | 想把目录换成 antd `Anchor`、或点目录跳错页时 |
| §规则「搜索过滤口径只写在 `search.ts`」 | 想加一类搜索命中时 |
| §规则「新增 `kind` 时这一页要跟着加一节」 | **新增内容展示时逐步照做** |
| §规则「这一页不连宿主」 | 想在这里加请求或读 store 时 |
