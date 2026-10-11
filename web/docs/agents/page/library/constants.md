# constants：文档页常量

> 覆盖 `web/src/page/library/constants/` ｜ 核对 2026-10-11

## 功能介绍

`web/src/page/library/constants/sections.ts` 是文档页的**示例数据表**：每个 section 描述一个 kind，含一份主载荷、若干形态变体（可选）、一份空载荷、参数表与参考组件。形状类型在 [types.md](types.md)。

页面据此渲染真实预览，并现场生成「可直接粘进调试页」的 event 与 frame JSON（同一份数据，保证所见即所粘）。

## 索引

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `sections.ts` | 12 种 kind 的示例数据与参数表：`LIBRARY_SECTIONS`（分区清单）与 `LIBRARY_GROUPS`（导航分组）；参数表写的是协议契约 | `web/src/page/library/constants/sections.ts` | 加 / 改示例数据、参数表或导航分组 |

## 规则

### 改动联动

**1. 参数表跟着协议与校验器一起改。**

- **规则**：`params` 里的字段名与 `bangumi/src/web/protocol.ts` 一一对应，取值枚举与 `web/src/components/content/validate.ts` 一致；改协议或改校验规则时，这一份表要在同一次改动里跟上。
- **为什么**：这张表是文档页对外的**唯一说明**，读它的人（和使用它的 AI）会当作契约；它落后于代码时，文档页会开始说谎，而页面本身看起来完全正常。
- **后果**：字段名或枚举与实现不符，用户照着参数表粘 JSON 会被校验器打回，或写出协议里不存在的字段而无人发现。
