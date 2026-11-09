# utils：文档页逻辑

> 覆盖 `web/src/page/library/utils/` ｜ 核对 2026-10-11

## 功能介绍

`web/src/page/library/utils/` 是文档页专有的逻辑：示例载荷的转换、搜索过滤、视口入场观察、显示名解析。四个文件都是纯函数或独立观察器，不含界面状态。

## 索引

按场景找：示例生成看 `items.ts`，搜索口径看 `search.ts`，入场观察看 `revealOnScroll.ts`，显示名看 `title.ts`（见 [index.md](index.md) 的「按场景分流」）。

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `items.ts` | 示例载荷 → 块 / event / frame 的转换：页面上的 UI 预览与两份 JSON 都由**同一份载荷**现场生成 | `web/src/page/library/utils/items.ts` | 改预览或代码块的生成方式 |
| `search.ts` | 顶部搜索框的过滤逻辑：命中口径覆盖四类——kind 名、中文标题、参数表里的字段名与枚举值、以及示例数据本身 | `web/src/page/library/utils/search.ts` | 改搜索命中口径 |
| `revealOnScroll.ts` | 视口驱动入场：按**滚动容器**缓存 `IntersectionObserver`，全站同一个容器只有一个实例；元素进入视口后立刻 `unobserve`（入场只播一次），配合 `.appReveal` / `.appReveal.in` 使用 | `web/src/page/library/utils/revealOnScroll.ts` | 改入场触发条件；给新列表接入入场 |
| `title.ts` | 一个 kind 在导航里的显示名：取 `LIBRARY_SECTIONS` 的 `title`，查不到时回落成 kind 本身 | `web/src/page/library/utils/title.ts` | 改显示名来源 |

## 规则

### 单一真相源

**1. UI 预览与两份 JSON 由同一份载荷现场生成。**

- **规则**：详情页的第 1 块（UI 预览）与第 3、4 块（event / frame JSON）都从 [constants.md](constants.md) 的同一份 `payload` 现场生成，页面里不存在手抄的第二份示例数据。
- **为什么**：三块要表达的正是「预览所见 = 粘进调试页所得」；只要有一块是手写的，三者就会各自漂移。
- **后果**：预览与 JSON 说的不是同一件事，而两者看起来都正常——照着 JSON 粘进调试页会得到与预览不同的结果。

### 失败与降级

**2. 显示名查不到时回落成 kind 本身。**

- **规则**：`title.ts` 取不到 section 时返回 kind 字符串，不返回空串或抛错。
- **为什么**：这样「新增了 kind 但忘了写 section」在界面上是可读的一行（显示 `dataTable` 这样的原始 kind），而不是一行空白。
- **后果**：返回空值会让导航出现无法归因的空行；抛错则会把一处数据遗漏升级成整页白屏。
