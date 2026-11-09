# styles：主界面皮肤

> 覆盖 `web/src/page/mainPage/styles/` ｜ 核对 2026-10-11

## 功能介绍

`web/src/page/mainPage/styles/` 是主界面专有的四件皮肤，由 `web/src/main.tsx` 在令牌层之后、`content.css` 之前按固定顺序引入（顺序契约见 [../../styles.md](../../styles.md) 规则 6）。

四件都只新增 `.app*` 类，不覆写共享原语（前缀分区见 [../../styles.md](../../styles.md) 规则 3）；令牌一律取自 `web/src/styles/base/`。

## 索引

按场景找：骨架与会话流看 `frame.css`，输入区看 `composer.css`，确认卡看 `cards.css`，弹窗看 `modal.css`（见 [index.md](index.md) 的「按场景分流」）。

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `frame.css` | 页面框架与会话区：`.appFrame` 网格与两列骨架、侧栏各行、会话头与滚动体、轮次与气泡、过程折叠块、turn 导轨、空会话首屏；末尾含 `prefers-reduced-motion` 降级段 | `web/src/page/mainPage/styles/frame.css` | 改两列骨架、侧栏、会话流或首屏形态 |
| `composer.css` | 输入区与浮层：输入卡与 `.appGlow` 玻璃填充、发送键、命令弹窗、思考强度菜单、读数浮层 | `web/src/page/mainPage/styles/composer.css` | 改输入卡形态或它的浮层 |
| `cards.css` | 接管输入区的确认卡与会话内提示 | `web/src/page/mainPage/styles/cards.css` | 改确认卡或提示行形态 |
| `modal.css` | 弹窗：`.modalOverlay` + `.modalSurface` 共享表面、`modalIn` / `modalOut` 进出场、`.dlg*` 内容骨架 | `web/src/page/mainPage/styles/modal.css` | 改弹窗表面、进出场或表单骨架 |

## 规则

### 单一真相源

**1. 玻璃材质只有一处。**

- **规则**：浮起层的材质（底色 + 模糊）由 `.appGlass`（`web/src/styles/common.css`）一处提供；本页的 `.modalSurface`（弹窗表面）与收起态气泡只管几何、描边与定位，不再自己写底色或模糊。材质需要放在子层时，也只在 `.appGlass` 那一层调整。
- **为什么**：四个弹窗与两个气泡共用同一份材质，改材质不必翻多个文件，也不会漏。
- **后果**：在 `.modalSurface` 里再写一遍底色或模糊，会与 `.appGlass` 双重叠加（表现为比设计更暗、模糊更重），且下次改材质时这一处必然被漏掉。
