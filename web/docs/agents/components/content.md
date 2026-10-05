# 内容组件库（`components/content/`）

## 简介

内容组件库的规格：注册表模式与它的五条约束、校验与降级规则、新增一种内容 `kind` 的逐步清单、`markdown.tsx` 的约束。

**不覆盖**：内容条目的样式皮肤（见 [../styles/content-and-brand.md](../styles/content-and-brand.md)）、轮次与流式区的装配（见 [main-page.md](main-page.md)）。

上层：[readme.md](readme.md)。这一层是"用表代替分支"规格最高的地方——**新增一种内容展示只应该改一张表 + 一份协议类型**。

## 使用说明

- **改动注册表、校验或新增 `kind` 之前先读 §规则**：五条约束与校验规则各含失败模式（静默丢弃、编译失败、运行时炸掉整棵 React 树）；违反后果都直接落在界面上。
- **只想查「某个 `kind` 对应哪个渲染器」「某个文件负责什么」**：直接查 §索引 的「组成」（文件表 + 12 个 `kind` 清单），不必通读 §规则。
- **新增一种内容展示**：严格按 §规则 末条「新增一种内容 `kind` 的完整清单」的 7 步做，缺一步会编译失败或静默丢弃；做完再按 [../regression/session-flow.md](../regression/session-flow.md) 里"内容条目渲染"的用例验证降级与截断行为。
- **想给内容条目加动效**：先读 §规则「每个 `kind` 的动效落点」与「行级入场用 CSS keyframes（`contentRowIn`），不用 JS 观察器」——落点表、无落点清单与「不为用而用」的判据都在那两节。
- 理解「为什么要在接收侧再校验一次」看 §规则「校验与降级（`validate.ts` + `index.tsx`）」；改样式前先读 [../styles/content-and-brand.md](../styles/content-and-brand.md)。

## 规则

### `kind` 只有一个来源（`registry.tsx`）

```ts
export type ContentKind = 'subjects' | … | 'links';   // registry.tsx
```

`ContentItemView` 用 `Extract<TranscriptItemView, { kind: ContentKind }>` **从协议里挑**，不复制类型定义——协议改动会自动传导到前端。

**违反后果**：协议漂移后条目被静默丢弃。

### `satisfies` 完整性与 `ContentRegistryCoverage` 断言不得放宽

**表必须完整，且键要对齐协议成员**

```ts
export const CONTENT_RENDERERS = { subjects: { field: 'subjects', limit: …, render: item => <SubjectCards view={item.subjects} /> }, … }
  satisfies { [K in ContentKind]: ContentRenderer<K> };
```

`ContentRenderer<K>` 要求三件事，写错任何一件都编译失败：

- `field` 必须是该 kind 载荷的字段名（`ContentPayloadKey<K>`，已排除 `id` / `version` / `kind`）；
- `limit` 可选，给出载荷内数组字段的规模上限；
- `render` 的参数类型精确到该 kind 的协议成员——**载荷字段名拼错会直接编译失败**，这是它替代 `switch` + `never` 穷尽检查的方式。

**协议新增 kind 但忘了改这里，也要编译失败**

```ts
export type ContentRegistryCoverage = AssertNever<
  Exclude<TranscriptItemView['kind'], ContentKind | BaseTranscriptKind>
>;
```

协议加了第 13 个内容 kind 却忘了扩 `ContentKind` 时，这一行会报错。**不要为了让它通过而放宽这个断言**——它正是防止"协议漂移"的闸门。

`BaseTranscriptKind`（`header`/`user`/`assistant`/`notice`/`error`/`activity`/`confirmation`）是有意排除在注册表之外的：这些条目由 `Turn.tsx` 的分支渲染，不走内容组件库。

**违反后果**：协议新增 kind 时前端静默漏渲染。

### 取渲染函数必须走 `contentRenderer()`

```ts
export function contentRenderer(kind: unknown): ((item: ContentItemView) => ReactNode) | undefined
```

不能直接 `CONTENT_RENDERERS[kind](item)`：表项是 `{ field, limit, render }` **对象**，当函数调用会在运行时炸掉整棵 React 树，而类型断言恰好不会报错。收窄只能在这一层做一次（判别式联合无法表达"按 kind 索引的函数表"）。

**违反后果**：把表项当函数调用，运行时炸掉整棵 React 树。

### 未知 `kind` 一律丢弃 + 告警，不做降级渲染

`renderContentItem` 对未登记的 kind 返回 `null`。理由：未知类型没有可依据的载荷语义，硬渲染占位比不渲染更容易误导。注册表本身在渲染期不产生副作用。

**告警落在 `Turn.tsx`，不在 `ContentItem`**：`Turn.BodyItem` 先用 `isContentKind` 预判，非内容 kind 根本不会渲染 `ContentItem`，所以 `ContentItem` 的 `dropped` 分支（连同它那句 `console.warn`）在当前调用结构下**不可达**。丢弃与告警因此都在 `Turn` 最后那个 `return null` 之前完成，并用模块级 `warnedKinds` 去重——同一个未知 kind 只报一次（流式期间同一轮次会反复重渲染）。

判定「既不是 base 条目、也不是登记的内容条目」用的是 `registry.tsx` 的 `isBaseTranscriptKind`：base kind 清单（`BASE_KINDS`）定义在那里，接收侧校验与 `Turn` 共用一份。

**违反后果**：误导用户以为渲染成功；或把告警留在不可达的分支里，宿主映射写错时界面只是"什么都没有"，永远没人发现。

### 校验与降级（`validate.ts` + `index.tsx`）

三态结果：

| 结果 | 含义 | `ContentItem` 的处理 |
|---|---|---|
| `ok` | 载荷形状合法 | 查表渲染 |
| `degraded` | 形状有出入但可渲染 | 渲染 `ContentFallback`（问题清单 + 折叠的原始 JSON） |
| `dropped` | `kind` 未知 | 返回 `null`；**实际调用结构下 `ContentItem` 收不到未知 kind**，丢弃与告警在 `Turn.tsx`（见上一条） |

各 kind 的守卫收到的是载荷**原样值**（`raw[field]`），形状由守卫自己收窄：多数 kind 先用 `checkRecord` 要求对象，`tags` 用 `checkArray` 直接要求数组。所以「载荷必须是对象」不是这一层的统一假设。

**为什么在渲染前再校验一次**：宿主映射、历史回放、手动粘贴的数据都可能与当前协议有出入，接收侧这道检查是唯一能兜住版本漂移的地方。`ContentItem` 用 `memo` 包住，`items` 引用不变时不会重复校验，流式帧（只改标量）没有额外开销。

数值越界**不算非法**（`ratio`、负 `count` 由组件自己夹取）：在这里报错只会把可渲染的数据变成降级提示。

### 数组规模上限

`limit: { field, max }` 声明载荷内数组的软上限，超限截断并在降级块里计数。取值参考一次生成的信息量与流式帧布局成本（例如 `table.rows` 200、`stats.entries` 100、`subjects.items` 50）。载荷本身就是数组的 kind（`tags`）没有「载荷内的数组字段」可取，因此不声明。

### `markdown.tsx` 不注入 HTML

**不注入 HTML**：行内标记（粗体、行内代码、链接）与表格/分隔线都以 React 节点输出，`INLINE` 白名单之外的内容按纯文本渲染。

- 外部链接一律 `target="_blank" rel="noreferrer noopener"`。
- 它被 `Turn.tsx`（历史助手条目）与 `Streaming.tsx`（流式正文）使用；改渲染规则等于改所有助手文本的呈现，回归时至少覆盖一条含表格与链接的回答。

**违反后果**：渲染不可控，且引入注入面。

### 内容条目的宿主来源：custom 消息通道

浏览器不产生这些条目，它们来自 Pi 的 custom 消息（`role: "custom"`）：

| 字段 | 作用 |
|---|---|
| `customType` | 条目 `kind`，必须是注册表登记的 12 个之一 |
| `details` | 该 kind 的**载荷本体**：多数 kind 是带字段名的对象（如 `{ info: {…} }`），`tags` 是数组本身（`{ tags: […] }`——协议里 `tags` 成员的类型就是数组） |
| `display` | 为 `true` 才进入会话界面；`false` 的消息只进模型上下文 |

映射是宿主侧 `bangumi/src/web/custom-content.ts` 的 `customContentDraft()`——一个跨端共享的纯函数，宿主因此**不知道有哪些 kind、也不知道每种 kind 的载荷字段名**。这意味着新增第 13 种 kind 时**宿主不需要改动**（见 §规则 末条清单）。

因此接收侧校验是唯一的形状闸门：载荷层级写错（例如 infobox 直接给 `{ rows: […] }`）会降级成 `ContentFallback`，`customType` 写错则整条不渲染。

**违反后果**：把 kind 清单或载荷字段名表搬进宿主，就会与 `registry.tsx` 出现第二份真相，协议漂移重新变得可能。

### 每个 `kind` 的动效落点

ReactBits 组件**按用途落点**（跨层约定见 [AGENTS.md](../../../AGENTS.md) §规则「外观层硬约定」第 6 条）：内容组件库的 12 种条目可以各带一个落点，**不再限定「每个 vendor 组件全局只有一个落点」**。当前有 5 个落点：

| `kind` | 落点组件 | 位置与用法 | 什么时候读 |
|---|---|---|---|
| `subjects` | `SpotlightCard` | `SubjectCards.tsx` 的**网格卡**（`GridCard`）；组合类 `.contentSubjectSpotlight` 把组件自带的白面与内边距归零，外观仍由 `.contentSubjectCard` 决定 | 改条目卡光斑时 |
| `stats` | `Counter` | `StatsCard.tsx` 的**主数字**；只在 `headline.value` 是纯数字字符串（`/^-?\d+(\.\d+)?$/`）时启用，带单位或千分位的值仍走静态文本 | 改统计主数字时 |
| `tags` | `GlareHover` | `TagCloud.tsx` 包裹**整个标签云**；`playOnce`（首次悬停只掠光一次），组合类 `.contentTagGlare` | 改标签云掠光时 |
| `quote` | `ShinyText` | `QuoteBlock.tsx` 的**标题**（`shimmer` 未开、只扫一次；正文一个字都不动） | 改引用块标题时 |
| `callout` | `StarBorder` | `Callout.tsx`，**仅 `tone === 'progress'`** 时作为装饰层：`animated` + `thickness={0}` + 组合类 `.contentCalloutGlow` + `aria-hidden`，绝对定位铺满、不参与布局、不吃指针事件 | 改「进行中」提示边框时 |

其余 7 个 `kind` 没有 vendor 落点：`progress` / `infobox` / `table` / `timeline` / `gallery` / `compare` / `links` 的入场交给下面的 CSS 行级 keyframes。

**已 vendor 但当前无落点，不等于不可用**（理由写在 [readme.md](readme.md) §索引「`motion/vendor/` 的组件与落点」）：`AnimatedList`（只接受 `items: string[]` 并统一渲染 `<p class="item-text">`，承载不了结构化行）、`Stepper`（`<Step>` children 形状的多步向导，与章节网格语义不符）、`LineSidebar`（`items` 是 `string[]` 且不含 `<a>`，承载不了链接列表）、`LogoLoop`（跑马灯会复制 DOM——链接会重复、键盘方向键滚动会失效）、`PixelTransition`（双面切换要把信息藏进 hover，违反内容组件「信息不藏在 hover 里」的既有原则）。**不要为了"用上"而把它们塞进语义不符的位置。**

组件库文档页每个组件页里「参数」块下的那行参考附注写的就是这张表（`reference` 为 `null` 表示没有落点），见 [../page/library.md](../page/library.md) §规则「新增 `kind` 时这一页要跟着加一节」。

**违反后果**：为了用组件而扭曲语义，或把信息藏进 hover——内容条目的可读性优先于动效。

### 行级入场用 CSS keyframes（`contentRowIn`），不用 JS 观察器

`.contentInfoRow` / `.contentTimelineRow` / `.contentSubjectRow` / `.contentLinkRow` 的入场写在 `styles/content.css` 的 `@keyframes contentRowIn`：只动 `opacity` 与 `transform`（`translateY(4px)` → `none`），前 5 行按 `:nth-child` **错峰 30ms 递增**（第 5 行起封顶 120ms），`@media (prefers-reduced-motion: reduce)` 下 `animation: none`。

**为什么不用 JS / vendor 组件**：逐行动画如果每行挂一个观察器或 motion 组件，流式帧（约 40ms 一帧）里就是 N 个观察器与 N 次内联样式写入；CSS keyframes 由合成器执行、不触发布局，且天然尊重 reduced-motion。同一理由也是 `AnimatedList` 不采用的原因——它只接受 `items: string[]`，承载不了「标签 + 值」这类结构化行。**思路参考 ReactBits Animated List，但没有引入它的源码。**

**违反后果**：流式期间每帧写入 N 个节点的样式，滚动与输入开始掉帧（这条是 [AGENTS.md](../../../AGENTS.md) §规则「外观层硬约定」第 3 条在内容条目上的落地）。

### 新增一种内容 `kind` 的完整清单

按顺序做完这 7 步，缺一步都会有编译错误或运行时静默丢弃：

1. **协议**：在 `bangumi/src/web/protocol.ts` 的 `TranscriptItemView` 联合里加成员（含 `kind` 与载荷字段）；
2. **`registry.tsx` 的 `ContentKind`**：加该 kind；
3. **`registry.tsx` 的 `CONTENT_KINDS`**：按展示顺序加（顺序与仓库根 `docs/bgm-design/component-library.html` 的章节一致；该目录未纳入版本控制）；
4. **渲染组件**：在 `components/content/` 建 `Xxx.tsx`，接收 `{ view }: { view: XxxView }`（`XxxView` 从协议取）；
5. **`CONTENT_RENDERERS`**：加表项，写 `field` / `limit`（有数组时）/ `render`；
6. **`validate.ts`**：为载荷加守卫（形状、字段类型、规模上限），让非法数据降级而不是崩；载荷不是对象时用 `checkArray` 直接守卫（参考 `validateTags`），并同步 `registry.tsx` 的 `limit`（载荷本身是数组时不声明）；
7. **`styles/content.css`**：加样式，类名用 `content` 前缀；只用 `--bgm-*` 令牌，不写裸色值。

然后跑 `npm run typecheck`，并按 [../regression/session-flow.md](../regression/session-flow.md) 里"内容条目渲染"的用例验证降级与截断行为。

第 1–7 步都在浏览器侧；宿主侧不需要跟着改——下发方把新 kind 名写进 `customType`、把载荷写进 `details` 即可（见 §规则「内容条目的宿主来源：custom 消息通道」）。调试页可以直接粘一条 custom 事件把新组件的皮肤与降级行为跑出来（见 [../page/debug.md](../page/debug.md) §使用说明）。

另外，组件库文档页要为它**加一节**（`LIBRARY_SECTIONS` 里的主载荷 / 空载荷 / 参数表 / `reference`），见 [../page/library.md](../page/library.md) §规则「新增 `kind` 时这一页要跟着加一节」——只加组件不加这一节，那一页就会从"唯一可信的一屏"退化成过期截图。

## 索引

### 章节 → 场景

| 章节 | 什么时候读 |
|---|---|
| §规则「`kind` 只有一个来源（`registry.tsx`）」 | 想另写一份 kind 清单、怀疑协议漂移时 |
| §规则「`satisfies` 完整性与 `ContentRegistryCoverage` 断言不得放宽」 | 注册表编译报错、想放宽断言时 |
| §规则「取渲染函数必须走 `contentRenderer()`」 | 写分发代码、想直接索引渲染表时 |
| §规则「未知 `kind` 一律丢弃 + 告警，不做降级渲染」 | 讨论要不要给未知 kind 兜底渲染时；界面上"什么都没有"却找不到告警时（告警在 `Turn.tsx`） |
| §规则「校验与降级（`validate.ts` + `index.tsx`）」 | 遇到降级块、要改校验规则时 |
| §规则「数组规模上限」 | 改数组上限、遇到超长载荷时 |
| §规则「`markdown.tsx` 不注入 HTML」 | 改助手文本渲染时 |
| §规则「内容条目的宿主来源：custom 消息通道」 | 问"这些卡片是谁产生的"、想把 kind 知识加进宿主时 |
| §规则「每个 `kind` 的动效落点」 | 想给某个 `kind` 加动效、或问"某个 ReactBits 组件为什么没被用"时 |
| §规则「行级入场用 CSS keyframes（`contentRowIn`），不用 JS 观察器」 | 想给内容行加入场动画、怀疑流式期间掉帧时 |
| §规则「新增一种内容 `kind` 的完整清单」 | **新增内容展示时逐步照做**（7 步，缺一步会编译失败或静默丢弃） |
| §索引「组成」 | 找某个文件或某个 `kind` 的渲染器 |

### 组成

| 文件 | 职责 |
|---|---|
| `registry.tsx` | **注册表本体**：`kind` 清单、`kind → { field, limit, render }` 表、分发入口、覆盖率断言 |
| `index.tsx` | `ContentItem`：接收侧的二次校验 + 分发 + 降级/丢弃 |
| `validate.ts` | 单条条目的载荷校验（零依赖手写守卫），返回 `ok` / `degraded` / `dropped` |
| `ContentFallback.tsx` | 降级块：把问题清单与原始 JSON 呈现给用户 |
| `markdown.tsx` | `Markdown` 渲染器（行内标记 + 表格 + 分隔线），**以 React 节点输出，不注入 HTML** |
| 12 个渲染组件 | `SubjectCards`、`StatsCard`、`ProgressView`、`InfoBox`、`DataTable`、`Timeline`、`TagCloud`、`Gallery`、`CompareTable`、`QuoteBlock`、`Callout`、`LinkList` |

12 个 `kind`：`subjects` / `stats` / `progress` / `infobox` / `table` / `timeline` / `tags` / `gallery` / `compare` / `quote` / `callout` / `links`。
