# 内容组件库（`components/content/`）

## 使用说明

### 这份文档是什么

内容组件库的规格：注册表模式与它的五条约束、校验与降级规则、新增一种内容 `kind` 的逐步清单、`markdown.tsx` 的约束。

上层：[readme.md](readme.md)。这一层是"用表代替分支"规格最高的地方——**新增一种内容展示只应该改一张表 + 一份协议类型**。

### 怎么读（章节 → 场景）

| 章节 | 什么时候读 |
|---|---|
| §组成 | 找某个文件或某个 `kind` 的渲染器 |
| §注册表的风格约束 | **改动注册表或新增 `kind` 前必读**（五条约束各含失败模式） |
| §校验与降级 | 遇到降级块、要改校验规则或数组上限时 |
| §新增一种内容 `kind` 的完整清单 | **新增内容展示时逐步照做**（7 步，缺一步会编译失败或静默丢弃） |
| §`markdown.tsx` 的约束 | 改助手文本渲染时 |

### 必须遵守的规则

本层通用规则见 [readme.md](readme.md) 的「必须遵守的规则」。本篇专属：

1. **`kind` 只有一个来源（`registry.tsx`）** —— 违反后果：协议漂移后条目被静默丢弃。
2. **`satisfies` 完整性与 `ContentRegistryCoverage` 断言不得放宽** —— 违反后果：协议新增 kind 时前端静默漏渲染。
3. **取渲染函数必须走 `contentRenderer()`** —— 违反后果：把表项当函数调用，运行时炸掉整棵 React 树。
4. **未知 `kind` 一律丢弃 + 告警，不做降级渲染** —— 违反后果：误导用户以为渲染成功。
5. **`markdown.tsx` 不注入 HTML** —— 违反后果：渲染不可控，且引入注入面。

## 组成

| 文件 | 职责 |
|---|---|
| `registry.tsx` | **注册表本体**：`kind` 清单、`kind → { field, limit, render }` 表、分发入口、覆盖率断言 |
| `index.tsx` | `ContentItem`：接收侧的二次校验 + 分发 + 降级/丢弃 |
| `validate.ts` | 单条条目的载荷校验（零依赖手写守卫），返回 `ok` / `degraded` / `dropped` |
| `ContentFallback.tsx` | 降级块：把问题清单与原始 JSON 呈现给用户 |
| `markdown.tsx` | `Markdown` 渲染器（行内标记 + 表格 + 分隔线），**以 React 节点输出，不注入 HTML** |
| 12 个渲染组件 | `SubjectCards`、`StatsCard`、`ProgressView`、`InfoBox`、`DataTable`、`Timeline`、`TagCloud`、`Gallery`、`CompareTable`、`QuoteBlock`、`Callout`、`LinkList` |

12 个 `kind`：`subjects` / `stats` / `progress` / `infobox` / `table` / `timeline` / `tags` / `gallery` / `compare` / `quote` / `callout` / `links`。

## 注册表的风格约束（重点）

### 1. `kind` 只有一个来源

```ts
export type ContentKind = 'subjects' | … | 'links';   // registry.tsx
```

`ContentItemView` 用 `Extract<TranscriptItemView, { kind: ContentKind }>` **从协议里挑**，不复制类型定义——协议改动会自动传导到前端。

### 2. 表必须完整，且键要对齐协议成员

```ts
export const CONTENT_RENDERERS = { subjects: { field: 'subjects', limit: …, render: item => <SubjectCards view={item.subjects} /> }, … }
  satisfies { [K in ContentKind]: ContentRenderer<K> };
```

`ContentRenderer<K>` 要求三件事，写错任何一件都编译失败：

- `field` 必须是该 kind 载荷的字段名（`ContentPayloadKey<K>`，已排除 `id` / `version` / `kind`）；
- `limit` 可选，给出载荷内数组字段的规模上限；
- `render` 的参数类型精确到该 kind 的协议成员——**载荷字段名拼错会直接编译失败**，这是它替代 `switch` + `never` 穷尽检查的方式。

### 3. 协议新增 kind 但忘了改这里，也要编译失败

```ts
export type ContentRegistryCoverage = AssertNever<
  Exclude<TranscriptItemView['kind'], ContentKind | BaseTranscriptKind>
>;
```

协议加了第 13 个内容 kind 却忘了扩 `ContentKind` 时，这一行会报错。**不要为了让它通过而放宽这个断言**——它正是防止"协议漂移"的闸门。

`BaseTranscriptKind`（`header`/`user`/`assistant`/`notice`/`error`/`activity`/`confirmation`）是有意排除在注册表之外的：这些条目由 `TurnView` 的分支渲染，不走内容组件库。

### 4. 取渲染函数必须走 `contentRenderer()`

```ts
export function contentRenderer(kind: unknown): ((item: ContentItemView) => ReactNode) | undefined
```

不能直接 `CONTENT_RENDERERS[kind](item)`：表项是 `{ field, limit, render }` **对象**，当函数调用会在运行时炸掉整棵 React 树，而类型断言恰好不会报错。收窄只能在这一层做一次（判别式联合无法表达"按 kind 索引的函数表"）。

### 5. 未知 `kind` 一律丢弃，不做降级

`renderContentItem` 对未登记的 kind 返回 `null`。理由：未知类型没有可依据的载荷语义，硬渲染占位比不渲染更容易误导。告警由调用方（`ContentItem` 的 `console.warn`）负责，注册表本身在渲染期不产生副作用。

## 校验与降级（`validate.ts` + `index.tsx`）

三态结果：

| 结果 | 含义 | `ContentItem` 的处理 |
|---|---|---|
| `ok` | 载荷形状合法 | 查表渲染 |
| `degraded` | 形状有出入但可渲染 | 渲染 `ContentFallback`（问题清单 + 折叠的原始 JSON） |
| `dropped` | `kind` 未知 | `console.warn` + 返回 `null` |

**为什么在渲染前再校验一次**：宿主映射、历史回放、手动粘贴的数据都可能与当前协议有出入，接收侧这道检查是唯一能兜住版本漂移的地方。`ContentItem` 用 `memo` 包住，`items` 引用不变时不会重复校验，流式帧（只改标量）没有额外开销。

数值越界**不算非法**（`ratio`、负 `count` 由组件自己夹取）：在这里报错只会把可渲染的数据变成降级提示。

### 数组规模上限

`limit: { field, max }` 声明载荷内数组的软上限，超限截断并在降级块里计数。取值参考一次生成的信息量与流式帧布局成本（例如 `table.rows` 200、`stats.entries` 100、`tags.tags` 50）。

## 新增一种内容 `kind` 的完整清单

按顺序做完这 7 步，缺一步都会有编译错误或运行时静默丢弃：

1. **协议**：在 `bangumi/src/web/protocol.ts` 的 `TranscriptItemView` 联合里加成员（含 `kind` 与载荷字段）；
2. **`registry.tsx` 的 `ContentKind`**：加该 kind；
3. **`registry.tsx` 的 `CONTENT_KINDS`**：按展示顺序加（顺序与 `docs/bgm-design/component-library.html` 章节一致）；
4. **渲染组件**：在 `components/content/` 建 `Xxx.tsx`，接收 `{ view }: { view: XxxView }`（`XxxView` 从协议取）；
5. **`CONTENT_RENDERERS`**：加表项，写 `field` / `limit`（有数组时）/ `render`；
6. **`validate.ts`**：为载荷加守卫（形状、字段类型、规模上限），让非法数据降级而不是崩；
7. **`styles/content.css`**：加样式，类名用 `content` 前缀；只用 `--bgm-*` 令牌，不写裸色值。

然后跑 `npm run typecheck`，并按 [../regression/session-flow.md](../regression/session-flow.md) 里"内容条目渲染"的用例验证降级与截断行为。

## `markdown.tsx` 的约束

- **不注入 HTML**：行内标记（粗体、行内代码、链接）与表格/分隔线都以 React 节点输出，`INLINE` 白名单之外的内容按纯文本渲染。
- 外部链接一律 `target="_blank" rel="noreferrer noopener"`。
- 它被 `MessageParts`（流式正文、历史助手条目）与 `TurnView` 使用；改渲染规则等于改所有助手文本的呈现，回归时至少覆盖一条含表格与链接的回答。
