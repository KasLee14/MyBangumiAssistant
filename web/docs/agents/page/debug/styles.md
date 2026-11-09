# styles：调试页皮肤

> 覆盖 `web/src/page/debug/styles/` ｜ 核对 2026-10-11

## 功能介绍

`web/src/page/debug/styles/debug.css` 是调试页专有的皮肤：只新增 `debug` 前缀的类，不覆写任何既有组件的类（前缀分区见 [../../styles.md](../../styles.md) 规则 3）；令牌取自 `web/src/styles/base/`；引入顺序由 `web/src/main.tsx` 决定，排在 `content.css` 之后（顺序契约见 [../../styles.md](../../styles.md) 规则 6）。

## 索引

本目录只有调试页皮肤一处（见 [index.md](index.md) 的「按场景分流」）。

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `debug.css` | 调试页皮肤：三行骨架与左侧输入区的形态；作用域挂在 `.appFrame[data-mode='debug']` 上 | `web/src/page/debug/styles/debug.css` | 改调试页布局或输入区形态 |

## 规则

### 单一真相源

**1. 复用同一套骨架，靠标记位切换形态。**

- **规则**：调试页不另建页面骨架——`.appFrame` 网格与共享原语照旧，形态差异通过根节点上的 `.appFrame[data-mode='debug']` 收窄；本文件里不出现「调试页专属的整套骨架」。
- **为什么**：三个页面共用同一套网格与表面语言（见 [../../styles.md](../../styles.md) 规则 1），标记位只是给同一套骨架换装；另建一套后，任何骨架调整都要改两处并逐渐漂移。
- **后果**：调试页与主界面的骨架开始分叉，改共享网格时调试页静默错位，而且只在同时打开两个页面时看得出来。
