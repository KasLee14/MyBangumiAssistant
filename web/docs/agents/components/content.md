# 内容组件库（`components/content/`）

## 简介

内容组件库的规格：内容块协议、注册表模式与它的约束、骨架与降级的分界、校验规则、新增一种内容展示的逐步清单、`markdown.tsx` 的约束。

**术语**：本文沿用「`kind`」指内容种类。在协议里它是**内容块的 `type` 字段**，而**取值就是组件名**（`SubjectCards` / `TagCloud` / `DataTable` …，与 `components/content/` 的文件名一致）——因此「这个 kind 该用哪个组件」不需要任何对照表。「条目」指会话流里的一行（`TranscriptItemView`），「块」指助手消息正文里的一项（`MessageBlock`）。下面提到 `kind` 的地方都按这个意思读。

**不覆盖**：内容条目的样式皮肤（见 [../styles/content-and-brand.md](../styles/content-and-brand.md)）、轮次与流式区的装配（见 [main-page.md](main-page.md)）。

上层：[readme.md](readme.md)。这一层是"用表代替分支"规格最高的地方——**新增一种内容展示只应该改一张表 + 一份协议类型**。

## 使用说明

- **改动注册表、校验或新增 `kind` 之前先读 §规则**：注册表约束与「骨架与降级的分界」各含失败模式（静默丢弃、编译失败、运行时炸掉整棵 React 树、把"还在传"显示成"数据有问题"）；违反后果都直接落在界面上。
- **只想查「某个 `kind` 对应哪个渲染器」「某个文件负责什么」**：直接查 §索引 的「组成」（文件表 + 12 个 `kind` 清单），不必通读 §规则。
- **新增一种内容展示**：严格按 §规则 末条「新增一种内容 `kind` 的完整清单」的 7 步做，缺一步会编译失败或静默丢弃；做完再按 [../regression/session-flow.md](../regression/session-flow.md) 里"内容条目渲染"的用例验证降级与截断行为。
- **想给内容条目加动效**：先读 §规则「每个 `kind` 的动效落点」与「行级入场用 CSS keyframes（`contentRowIn`），不用 JS 观察器」——落点表、无落点清单与「不为用而用」的判据都在那两节。
- 理解「为什么要在接收侧再校验一次」看 §规则「校验与降级（`validate.ts` + `index.tsx`）」；改样式前先读 [../styles/content-and-brand.md](../styles/content-and-brand.md)。

## 规则

### `type` 只有一个来源（`registry.tsx`）

```ts
export type ContentKind = 'subjects' | … | 'links';                        // registry.tsx
export type ContentBlockView = Extract<MessageBlock, { type: ContentKind }>;
```

`ContentKind` 是 12 个内容种类的清单；`ContentBlockView` 用 `Extract<MessageBlock, { type: ContentKind }>` **从协议里挑**，不复制类型定义——协议改动会自动传导到前端。

**违反后果**：协议漂移后内容块被静默丢弃。

### `satisfies` 完整性与 `ContentRegistryCoverage` 断言不得放宽

**表必须完整，且键要对齐协议成员**

```ts
export const CONTENT_RENDERERS = { subjects: { limit: …, render: block => <SubjectCards view={block.props} /> }, … }
  satisfies { [K in ContentKind]: ContentRenderer<K> };
```

`ContentRenderer<K>` 要求两件事，写错任何一件都编译失败：

- `limit` 可选，给出载荷内数组字段的规模上限（`limit.field` 是**载荷内部**的字段名，与块上的字段无关）；
- `render` 的参数类型精确到该 kind 的协议成员——`props` 的类型因此不可能写错，这是它替代 `switch` + `never` 穷尽检查的方式。

**协议新增 kind 但忘了改这里，也要编译失败**

```ts
export type ContentRegistryCoverage = AssertNever<
  Exclude<MessageBlock['type'], ContentKind | 'text'>
>;
```

协议加了第 13 个内容 type 却忘了扩 `ContentKind` 时，这一行会报错（`'text'` 是文本块，不属于内容组件库）。**不要为了让它通过而放宽这个断言**——它正是防止"协议漂移"的闸门。

`BaseTranscriptKind`（`header`/`user`/`assistant`/`notice`/`error`/`activity`/`confirmation`）是有意排除在注册表之外的：这些条目由 `Turn.tsx` 的分支渲染，不走内容组件库。

**违反后果**：协议新增 kind 时前端静默漏渲染。

### 取渲染函数必须走 `contentRenderer()`

```ts
export function contentRenderer(type: unknown): ((block: ContentBlockView) => ReactNode) | undefined
```

不能直接 `CONTENT_RENDERERS[type](block)`：表项是 `{ limit, render }` **对象**，当函数调用会在运行时炸掉整棵 React 树，而类型断言恰好不会报错。收窄只能在这一层做一次（判别式联合无法表达"按 type 索引的函数表"）。

**违反后果**：把表项当函数调用，运行时炸掉整棵 React 树。

### 未知 `type` 一律丢弃 + 告警，不做降级渲染

`ContentBlock` 对未登记的 `type` 返回 `null`。理由：未知类型没有可依据的载荷语义，硬渲染占位比不渲染更容易误导。注册表本身在渲染期不产生副作用。

**告警落在 `ContentBlock`**，用 `bangumi/src/web/message-blocks.ts` 的 `warnUnknownBlockType`（模块级去重，同一个 type 只报一次——流式期间同一块会反复重渲染）。块化之前告警在 `Turn.tsx`：那时 `Turn` 先用 `isContentKind` 预判条目，`ContentItem` 的 `dropped` 分支不可达。现在**块是渲染的最小单位**，`ContentBlock` 就是唯一入口，丢弃与告警在同一处完成。

`Turn.tsx` 另保留一条**条目层**的未知 kind 告警（模块级 `warnedKinds`）：协议之外的条目形态（宿主映射写错）不该静默消失。两层告警各管一层，**不要合并**。

判定 base 条目用的是 `registry.tsx` 的 `isBaseTranscriptKind`：base kind 清单（`BASE_KINDS`）定义在那里，`Turn` 与 `validate.ts` 共用一份。

**违反后果**：误导用户以为渲染成功；或把告警留在不可达的分支里，宿主映射写错时界面只是"什么都没有"，永远没人发现。

### 骨架与降级的分界（`validate.ts` + `ContentBlock`）

四种情形，边界必须分清：

| 情形 | 判据 | 处理 |
|---|---|---|
| 载荷还在传 | 块上 `pending === true` | 渲染 `ContentSkeleton`，**不校验** |
| 形状合法 | `validateMessageBlock` 返回 `ok` | 查表渲染 |
| 形状有出入但可渲染 | `degraded` | 渲染 `ContentFallback`（问题清单 + 折叠的原始 JSON） |
| `type` 未登记 | `dropped` | 返回 `null` + `warnUnknownBlockType` 告警一次（见上一条） |

**`pending` 与 `degraded` 不能互相代替**：前者是"还没到"，后者是"到了但不对"。把不完整的载荷交给校验器，它会报一串缺字段，界面就变成"数据有问题"——而真实原因是它还在传。反过来，也**不要**给"上游数据有问题"打上 `pending` 让它一直转圈。这条分界是 `ContentBlock` 的第一个分支。

各 kind 的守卫收到的是载荷**原样值**（`raw.props`），形状由守卫自己收窄：多数 kind 先用 `checkRecord` 要求对象，`TagCloud` 用 `checkArray` 直接要求数组。所以「载荷必须是对象」不是这一层的统一假设。

**为什么在渲染前再校验一次**：宿主映射、历史回放、手动粘贴的数据都可能与当前协议有出入，接收侧这道检查是唯一能兜住版本漂移的地方。`ContentBlock` 用 `memo` 包住，配合 `MessageBlocks` 的块级比较与宿主投影的结构共享，流式帧里文本增长不会带来重复校验。

数值越界**不算非法**（`ratio`、负 `count` 由组件自己夹取）：在这里报错只会把可渲染的数据变成降级提示。

### 数组规模上限

`limit: { field, max }` 声明载荷内数组的软上限，超限截断并在降级块里计数。取值参考一次生成的信息量与流式帧布局成本（例如 `DataTable` 的 `rows` 200、`StatsCard` 的 `entries` 100、`SubjectCards` 的 `items` 50）。载荷本身就是数组的 kind（`TagCloud`）没有「载荷内的数组字段」可取，因此不声明。

### `markdown.tsx` 不注入 HTML

**不注入 HTML**：行内标记（粗体、行内代码、链接）与表格/分隔线都以 React 节点输出，`INLINE` 白名单之外的内容按纯文本渲染。

- 外部链接一律 `target="_blank" rel="noreferrer noopener"`。
- 正文链接的**外观**不在这里决定：统一是「主色深字 + 下划线」（`--bgm-primary-text`，hover 转主色 / 交互蓝），**不使用蓝色链接色**（`--bgm-link` `#0084b4` 是上游遗留），规则落在 `frame.css` 的 `.markdown a`——组件只负责结构与 `target` / `rel`，不写颜色。
- 它只被 `MessageBlocks.tsx` 使用（流式区与历史条目共用同一个正文入口）；改渲染规则等于改所有助手文本的呈现，回归时至少覆盖一条含表格与链接的回答。

**违反后果**：渲染不可控，且引入注入面。

### 内容块的来源：助手消息 `content` 与 custom 消息

浏览器不产生这些块。上游下发有两条通道，最终都投影成**同一个 `MessageBlock`**：

1. **助手消息的 `content` 数组**（主通道）：块出现在 `message_update.assistantMessageEvent.partial.content` 与 `message_end.message.content` 里，形状是 `{ type, pending?, props }`。同一个 `contentIndex` 被多次快照整体替换，`pending` 消失表示这一块传完了。宿主只从快照投影，**不判别 `assistantMessageEvent.type`**。
2. **Pi 的 custom 消息**（扩展注入，`role: "custom"`）：

| 字段 | 作用 |
|---|---|
| `customType` | 块的 `type`，必须是注册表登记的 12 个之一 |
| `details` | 该 type 的**载荷本体**，也就是块的 `props`：多数是对象（如 `{ rows: […] }`），`TagCloud` 是数组本身（协议里 `TagCloud` 成员的类型就是数组）。**不带字段名包装**——旧的 `{ info: {…} }` 写法已废弃 |
| `display` | 为 `true` 才进入会话界面；`false` 的消息只进模型上下文 |

两条通道的映射都在宿主侧 `bangumi/src/web/message-blocks.ts`（`blocksFromContent` / `blocksFromMessage` / `customContentBlocks`）——跨端共享的纯函数，宿主因此**不知道有哪些 kind、也不知道每种 kind 的载荷字段名**，只排除 Pi 的原生块（`thinking` / `toolCall` / `image` / …），其余原样透传。新增第 13 种 kind 时**宿主不需要改动**（见 §规则 末条清单）。custom 消息投影成"只含一个块的助手条目"（`origin: 'extension'`），所以旧会话里已落盘的 `custom_message` 仍能重建。

因此接收侧校验是唯一的形状闸门：载荷层级写错（例如 infobox 直接给 `{ rows: […] }`）会降级成 `ContentFallback`，`type` 写错则整块不渲染并告警一次。

**违反后果**：把 kind 清单搬进宿主，就会与 `registry.tsx` 出现第二份真相，协议漂移重新变得可能。

### 每个 `kind` 的动效落点

ReactBits 组件**按用途落点**（跨层约定见 [AGENTS.md](../../../AGENTS.md) §规则「外观层硬约定」第 6 条）：内容组件库的 12 种条目可以各带一个落点，**不再限定「每个 vendor 组件全局只有一个落点」**。当前有 3 个落点：

| `kind` | 落点组件 | 位置与用法 | 什么时候读 |
|---|---|---|---|
| `StatsCard` | `Counter` | `StatsCard.tsx` 的**主数字**；只在 `headline.value` 是纯数字字符串（`/^-?\d+(\.\d+)?$/`）时启用，带单位或千分位的值仍走静态文本 | 改统计主数字时 |
| `TagCloud` | `GlareHover` | `TagCloud.tsx` 包裹**整个标签云**；`playOnce`（首次悬停只掠光一次），组合类 `.contentTagGlare` | 改标签云掠光时 |
| `Callout` | `StarBorder` | `Callout.tsx`，**仅 `tone === 'progress'`** 时作为装饰层：`animated` + `thickness={0}` + 组合类 `.contentCalloutGlow` + `aria-hidden`，绝对定位铺满、不参与布局、不吃指针事件 | 改「进行中」提示边框时 |

其余 9 个 `kind` 没有 vendor 落点：`SubjectCards` / `ProgressView` / `InfoBox` / `DataTable` / `Timeline` / `Gallery` / `CompareTable` / `QuoteBlock` / `LinkList` 的入场交给下面的 CSS 行级 keyframes。

**原先有落点、按用户选择已移除（vendor 文件仍留在 `motion/vendor/`）**：`SubjectCards` 的 `SpotlightCard`（指针光斑）与 `QuoteBlock` 的 `ShinyText`（常驻闪光）——前者与 `Magnet` 同属被排除的指针效果（用户在 `style-demo-interaction.html` 选的是「A · 只精修状态反馈」，明确排除指针光斑与磁吸）；后者与 `content-v2` 的 V3 把引用块标题退成等宽小字的做法冲突。组合类 `.contentSubjectSpotlight` 已随 `SpotlightCard` 一起从 `content.css` 删除，现存组合类只有 `.contentTagGlare` 与 `.contentCalloutGlow`（口径同 [AGENTS.md](../../../AGENTS.md) §规则「外观层硬约定」第 6 条）。

**已 vendor 但当前无落点，不等于不可用**（理由写在 [readme.md](readme.md) §索引「`motion/vendor/` 的组件与落点」）：`AnimatedList`（只接受 `items: string[]` 并统一渲染 `<p class="item-text">`，承载不了结构化行）、`Stepper`（`<Step>` children 形状的多步向导，与章节网格语义不符）、`LineSidebar`（`items` 是 `string[]` 且不含 `<a>`，承载不了链接列表）、`LogoLoop`（跑马灯会复制 DOM——链接会重复、键盘方向键滚动会失效）、`PixelTransition`（双面切换要把信息藏进 hover，违反内容组件「信息不藏在 hover 里」的既有原则）。**不要为了"用上"而把它们塞进语义不符的位置。**

组件库文档页每个组件页里「参数」块下的那行参考附注写的就是这张表（`reference` 为 `null` 表示没有落点），见 [../page/library.md](../page/library.md) §规则「新增 `kind` 时这一页要跟着加一节」。

**违反后果**：为了用组件而扭曲语义，或把信息藏进 hover——内容条目的可读性优先于动效。

### 行级入场用 CSS keyframes（`contentRowIn`），不用 JS 观察器

`.contentInfoRow` / `.contentTimelineRow` / `.contentSubjectRow` / `.contentLinkRow` 的入场写在 `styles/content.css` 的 `@keyframes contentRowIn`：只动 `opacity` 与 `transform`（`translateY(var(--app-shift-row))` + `scale(.985)` → `none`），按 `:nth-child` 错峰 **`--app-stagger`（55ms）递增**，**第 9 行起封顶**（8 × 55ms = 440ms；与 `.appStagger` 同一张表，4 档封顶时第 5 行起会一次冒出好几行，见 [C04](../../design/decisions/C04-stagger.md)）；时长 `--app-dur-slow`、曲线 `--app-ease-spring`，`@media (prefers-reduced-motion: reduce)` 下 `animation: none`。`ProgressView` 的章节格（`.contentEpGrid > *`）复用同一条 keyframes，但**比别处多一档**：一话一格、网格里同时十几格是常态，第 10 格起沿用第 9 档（见 [C07](../../design/decisions/C07-progress-view.md)）。

**为什么不用 JS / vendor 组件**：逐行动画如果每行挂一个观察器或 motion 组件，流式帧（约 40ms 一帧）里就是 N 个观察器与 N 次内联样式写入；CSS keyframes 由合成器执行、不触发布局，且天然尊重 reduced-motion。同一理由也是 `AnimatedList` 不采用的原因——它只接受 `items: string[]`，承载不了「标签 + 值」这类结构化行。**思路参考 ReactBits Animated List，但没有引入它的源码。**（滚动容器内**整块**的入场是另一条路径：`MessageBlocks` 用 `AnimatedContent` + `motionTokens` 的 `SHIFT.reveal` / `DURATION.reveal`。）

**违反后果**：流式期间每帧写入 N 个节点的样式，滚动与输入开始掉帧（这条是 [AGENTS.md](../../../AGENTS.md) §规则「外观层硬约定」第 3 条在内容条目上的落地）。

### 条形与进度条的长度走 CSS 变量，不写内联 `transform`

`StatsCard` 的条形与 `ProgressView` 的进度条把长度写成 **CSS 变量**（`--content-bar` / `--content-progress`，值域 0–1），组件只负责把这个变量放进 `style`：

```tsx
<span className="contentStatBar" style={{ '--content-bar': ratioOf(entry).toFixed(4) } as CSSProperties} />
<span className="contentProgressBar" style={{ '--content-progress': String(percent / 100) } as CSSProperties} />
```

入场 keyframes 的 `to` 帧要引用这个变量（`@keyframes progBarIn { to { transform: scaleX(var(--content-progress, 1)); } }`）——**内联的 `transform` 会被 keyframes 的 `to` 帧盖掉**，长度只能从变量进。轨道高度 `.contentStatTrack` / `.contentProgressTrack` 都是 **9px**，`.contentStatTrack` 另补 `flex: 1`（它在 flex 行里占剩余宽度）；横向缩放必须配对写 `transform-origin`（见 [AGENTS.md](../../../AGENTS.md) §规则「外观层硬约定」第 3 条）。

**违反后果**：动画一跑长度就跳回默认值，或两种轨道的粗细在同一张卡里不一致。

### 形态要点按 C04–C20 定稿，改这些结构前先读对应决策

第七轮把内容条目按样张逐项对齐，几处**结构**变化容易在后续改动里被改回去：

| 组件 | 结构要点 | 决策 |
|---|---|---|
| `SubjectCards` | 卡片墙的 `.contentSubjectGrid` 是**固定 3 列**（不是 `auto-fill`）；卡片内文字区外面有一层 `.contentSubjectBody` 包裹层承担内距（卡片自己不写内距，否则封面会被一起推进去） | [C05](../../design/decisions/C05-subject-cards.md) |
| `ProgressView` | 条形轨道改成 9px，章节格 `.contentEpGrid` 逐格入场 | [C07](../../design/decisions/C07-progress-view.md) |
| `Timeline` | 行是「时间 \| 正文 \| actor」三列，**actor 是行尾的独立一列、不在 `<p>` 里**（`margin-left: auto` 在 `<p>` 内不生效，会退化成正文前缀）；节点用 `11px` 盒 + `border: 2px solid` 画环（`box-shadow` 画的环落在布局盒之外，节点会与竖轴不同心） | [C10](../../design/decisions/C10-timeline.md) |
| `CompareTable` | `.contentCompareLine` 是**五列** grid，hover 指示条是行上的 `::before` | [C13](../../design/decisions/C13-compare-table.md) |
| `QuoteBlock` | 外框 `0.5px` 描边 + 区块内距归零；标题**独立成条**（淡底 + 下描边 + 等宽字族）；正文左侧留 34px 槽位并画槽线 | [C14](../../design/decisions/C14-quote-block.md) |
| `ContentSkeleton` | 扫光**由 `aria-busy` 开关**：组件无条件带 `aria-busy="true"`，扫光只挂在 `[aria-busy='true'] .contentSkeletonBar::after` 上 | [C17](../../design/decisions/C17-content-skeleton.md) |
| `ContentFallback` | **素面 + 左侧 2px 短条**：语义只由左侧短条与 `△` 标记承担，不做整块彩色横幅 | [C18](../../design/decisions/C18-content-fallback.md) |

### 新增一种内容 `kind` 的完整清单

按顺序做完这 7 步，缺一步都会有编译错误或运行时静默丢弃：

1. **协议**：在 `bangumi/src/web/protocol.ts` 的 `ContentBlockPayload` 联合里加成员（含 `type` 与载荷字段）；
2. **`registry.tsx` 的 `ContentKind`**：加该 kind；
3. **`registry.tsx` 的 `CONTENT_KINDS`**：按展示顺序加（顺序与仓库根 `docs/bgm-design/component-library.html` 的章节一致；该目录未纳入版本控制）；
4. **渲染组件**：在 `components/content/` 建 `Xxx.tsx`，接收 `{ view }: { view: XxxView }`（`XxxView` 从协议取）；
5. **`CONTENT_RENDERERS`**：加表项，写 `limit`（载荷内有数组时，字段名是**载荷内部**的字段）与 `render`（从 `block.props` 取载荷）；
6. **`validate.ts`**：为载荷加守卫（形状、字段类型、规模上限），让非法数据降级而不是崩；载荷不是对象时用 `checkArray` 直接守卫（参考 `validateTags`），并同步 `registry.tsx` 的 `limit`（载荷本身是数组时不声明）；
7. **`styles/content.css`**：加样式，类名用 `content` 前缀；只用 `--bgm-*` 令牌，不写裸色值。**胶囊与正圆要显式 `corner-shape: round`**（超椭圆由 `tokens.css` 下发到所有元素，会把半圆端压成偏方），并把类名登记进文件末尾那张超椭圆例外表——见 [../styles/content-and-brand.md](../styles/content-and-brand.md) §规则「`content.css` 的约定」第 7 条。

然后跑 `npm run typecheck`，并按 [../regression/session-flow.md](../regression/session-flow.md) 里"内容条目渲染"的用例验证降级与截断行为。

第 1–7 步都在浏览器侧；宿主侧不需要跟着改——下发方把新 kind 名写进块的 `type`（助手 `content` 数组）或 custom 消息的 `customType`、把载荷写进同一个块的载荷字段（见 §规则「内容块的来源」）。调试页可以直接粘一条 `message_end`（`content` 里放这个块）或一条 custom 消息，把新组件的皮肤、骨架与降级行为跑出来（见 [../page/debug.md](../page/debug.md) §使用说明）。

另外，组件库文档页要为它**加一节**（`LIBRARY_SECTIONS` 里的主载荷 / 空载荷 / 参数表 / `reference`），见 [../page/library.md](../page/library.md) §规则「新增 `kind` 时这一页要跟着加一节」——只加组件不加这一节，那一页就会从"唯一可信的一屏"退化成过期截图。

## 索引

### 章节 → 场景

| 章节 | 什么时候读 |
|---|---|
| §规则「`kind` 只有一个来源（`registry.tsx`）」 | 想另写一份 kind 清单、怀疑协议漂移时 |
| §规则「`satisfies` 完整性与 `ContentRegistryCoverage` 断言不得放宽」 | 注册表编译报错、想放宽断言时 |
| §规则「取渲染函数必须走 `contentRenderer()`」 | 写分发代码、想直接索引渲染表时 |
| §规则「未知 `type` 一律丢弃 + 告警，不做降级渲染」 | 讨论要不要给未知 type 兜底渲染时；界面上"什么都没有"却找不到告警时（块层告警在 `ContentBlock`，条目层在 `Turn`） |
| §规则「骨架与降级的分界（`validate.ts` + `ContentBlock`）」 | 遇到骨架或降级块、要改校验规则时 |
| §规则「数组规模上限」 | 改数组上限、遇到超长载荷时 |
| §规则「`markdown.tsx` 不注入 HTML」 | 改助手文本渲染时 |
| §规则「内容块的来源：助手消息 `content` 与 custom 消息」 | 问"这些卡片是谁产生的"、想把 kind 知识加进宿主时 |
| §规则「每个 `kind` 的动效落点」 | 想给某个 `kind` 加动效、或问"某个 ReactBits 组件为什么没被用"时 |
| §规则「行级入场用 CSS keyframes（`contentRowIn`），不用 JS 观察器」 | 想给内容行加入场动画、怀疑流式期间掉帧时 |
| §规则「条形与进度条的长度走 CSS 变量，不写内联 `transform`」 | 改统计条形 / 进度条的长度，或动画结束后长度跳回默认值时 |
| §规则「形态要点按 C04–C20 定稿，改这些结构前先读对应决策」 | 改内容条目的结构（网格列数、时间线列、引用块骨架、骨架扫光、降级卡）时 |
| §规则「新增一种内容 `kind` 的完整清单」 | **新增内容展示时逐步照做**（7 步，缺一步会编译失败或静默丢弃） |
| §索引「组成」 | 找某个文件或某个 `kind` 的渲染器 |

### 组成

| 文件 | 职责 |
|---|---|
| `registry.tsx` | **注册表本体**：`kind` 清单、`type → { limit, render }` 表、渲染函数查找、覆盖率断言 |
| `MessageBlocks.tsx` | **助手消息正文的唯一渲染入口**：按块顺序渲染（文本 → `Markdown`、内容块 → `ContentBlock`），块级 `memo`；历史条目的内容块用 `AnimatedContent` 挂滚动入场（`SHIFT.reveal` 18px / `DURATION.reveal` 460ms，C19 定稿，`container="#app-stage-scroll"`） |
| `index.tsx` | `ContentBlock`：`pending` → 骨架；否则接收侧校验 + 分发 + 降级/丢弃 |
| `ContentSkeleton.tsx` | 骨架：载荷还在传时的占位（与 kind 无关）；**扫光的开关就是 `aria-busy` 语义本身**（`aria-busy="true"` + `[aria-busy='true']` 选择器），不在别处再挂一个 `animated` 开关 |
| `validate.ts` | 块的载荷校验（零依赖手写守卫）`validateMessageBlock`，返回 `ok` / `degraded` / `dropped` |
| `ContentFallback.tsx` | 降级块：**素面 + 左侧 2px 短条**（语义只由短条与 `△` 标记承担），把问题清单与折叠的原始 JSON 呈现给用户 |
| `markdown.tsx` | `Markdown` 渲染器（行内标记 + 表格 + 分隔线），**以 React 节点输出，不注入 HTML** |
| 12 个渲染组件 | `SubjectCards`、`StatsCard`、`ProgressView`、`InfoBox`、`DataTable`、`Timeline`、`TagCloud`、`Gallery`、`CompareTable`、`QuoteBlock`、`Callout`、`LinkList` |

12 个 `kind`：`SubjectCards` / `StatsCard` / `ProgressView` / `InfoBox` / `DataTable` / `Timeline` / `TagCloud` / `Gallery` / `CompareTable` / `QuoteBlock` / `Callout` / `LinkList`。
