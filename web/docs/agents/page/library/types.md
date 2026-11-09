# types：文档页类型

> 覆盖 `web/src/page/library/types/` ｜ 核对 2026-10-11

## 功能介绍

`web/src/page/library/types/` 放文档页的**形状类型**（`ParamRow` / `Reference` / `LibraryVariant` / `LibrarySection` / `LibraryOutletContext`），它们是这个页面模块的公开契约。

数据（12 种 kind 的示例载荷与参数表）在 [constants.md](constants.md) 的 `sections.ts`——形状与数据分开放，是因为形状要跨出本页被路由消费，而数据只有本页与宿主测试 fixture 用。

## 索引

本目录只有页面公开契约的形状一处（见 [index.md](index.md) 的「按场景分流」）。

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `sections.ts` | `LibrarySection`（一个 kind 的完整描述：`kind` / `title` / `summary` / `payload` / `variants?` / `empty` / `params` / `reference`）、`LibraryVariant`（主载荷之外的另一种形态）、`ParamRow`（参数表一行）、`Reference`（参考的 ReactBits 组件）、`LibraryOutletContext`（骨架经 `<Outlet context>` 下发给子路由的数据） | `web/src/page/library/types/sections.ts` | 改 section、variant 或参数行的形状 |

## 规则

### 归位与命名

**1. 形状类型留在这里，数据留在 `constants/`。**

- **规则**：类型定义在本目录，示例数据在 [constants.md](constants.md) 的 `sections.ts`；`LibraryOutletContext` 这类要跨出本页的类型也留在这里，不搬进骨架文件。
- **为什么**：`router/routes.tsx` 的两个子路由都要标注这些类型，而 `router → page` 是允许的方向——类型属于页面模块的公开契约；数据则只有本页与宿主测试 fixture 消费，跟着数据走更合适。
- **后果**：把类型塞进骨架文件后，路由要 import 页面组件实现才能拿到类型；把数据提到类型目录则会让类型模块带上业务数据，两边都不再单一职责。
