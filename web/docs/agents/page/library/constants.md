# constants：文档页常量

> 覆盖 `web/src/page/library/constants/` ｜ 核对 2026-10-11

## 功能介绍

`web/src/page/library/constants/sections.ts` 是文档页的**示例数据表**：每个 section 描述一个 kind，含一份主载荷、若干形态变体（可选）、一份空载荷、参数表与参考组件。形状类型在 [types.md](types.md)。

页面据此渲染真实预览，并现场生成「可直接粘进卡片实验室」的载荷 JSON（同一份数据，保证所见即所粘）。

## 索引

本目录只有示例数据表一处（见 [index.md](index.md) 的「按场景分流」）。

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `sections.ts` | 12 种 kind 的示例数据与参数表：`LIBRARY_SECTIONS`（分区清单，每条自带 `group: 'entries' \| 'data' \| 'text'`）与**由它派生**的 `LIBRARY_GROUPS`（导航分组）；参数表写的是协议契约 | `web/src/page/library/constants/sections.ts` | 加 / 改示例数据、参数表；新增内容块时在 section 里写 `group`（分组表本身不用改） |

## 规则

### 改动联动

**0. 分组写在 section 里，不再有第二张分组表。**

- **规则**：`group` 是 `LibrarySection` 的必填字段（`'entries' | 'data' | 'text'`，见 `web/src/page/library/types/sections.ts`），`LIBRARY_GROUPS` 由 `GROUP_LABELS` 的键序 + 各 section 的 `group` 派生出 `kinds`。新增组件只改自己的 section；新增**分组**才动 `LibraryGroupKey` 与 `GROUP_LABELS`（前者加成员后，后者缺键会编译失败）。
- **为什么**：改造前是「section 加一项 + 分组表加进某一组」两处手写，两者之间没有编译期约束，漏改导航只会静默少一项。
- **后果（已知差异）**：组内顺序从「分组表里手写的顺序」变成「`LIBRARY_SECTIONS` 的出现顺序」，因此 `entries` 组里 `TagCloud` 与 `Gallery` 互换、`data` 组里 `Timeline` 与 `CompareTable` 互换；`text` 组不变。

**1. 参数表跟着协议与校验器一起改。**

- **规则**：`params` 里的字段名与 `bangumi/src/web/protocol.ts` 一一对应，取值枚举与各组件自己的 `readXxx`（`web/src/components/content/`）一致；改协议或改某个组件的判定规则时，这一份表要在同一次改动里跟上。
- **为什么**：这张表是文档页对外的**唯一说明**，读它的人（和使用它的 AI）会当作契约；它落后于代码时，文档页会开始说谎，而页面本身看起来完全正常。
- **后果**：字段名或枚举与实现不符，用户照着参数表粘 JSON 会被校验器打回，或写出协议里不存在的字段而无人发现。
