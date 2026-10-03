# 组件层（`web/src/components/`）

## 使用说明

### 这份文档是什么

组件层的分类规则与索引：三类组件的边界判据、两条数据来源规则、文件粒度约定，以及新增组件的检查清单。

**不覆盖**：各组件内部的实现细节（见三个子文档）。上层入口：[AGENTS.md](../../../AGENTS.md)。

### 怎么读（文件 → 场景）

| 文件 | 什么时候读 |
|---|---|
| 本文件 | **加新组件前必读**——先在这里判定放哪个目录、用哪种数据来源 |
| [main-page.md](main-page.md) | 改外壳组件（侧栏 / 顶栏 / 会话视图 / 输入区 / 浮层）、动 `ComposerSlot` 座位分支时 |
| [dialog.md](dialog.md) | 加或改弹窗、调弹窗开合层级与关闭语义时 |
| [content.md](content.md) | 改内容条目渲染；**新增一种内容 `kind` 时必读**（有逐步清单） |

### 必须遵守的规则

1. **展示组件一律 props 驱动**：能独立渲染出意义的那类组件不得 import store。违反后果：无法脱离外壳复用与测试，数据来源出现第二个真相。见 §数据来源（是全局规则「内容组件不读 store」在本层的落地）。
2. **外壳与弹窗直接消费 store，不层层透传**：违反后果：页面变胖、prop 钻透难维护。判据见 §数据来源。
3. **一个组件一个文件，不建 `index` 桶**：违反后果：循环引用，以及"这个符号到底在哪"的追查成本。见 §文件粒度与命名。
4. **不做过度 memo**：只有流式期间会被高频重渲染的行才 `memo`。违反后果：比较开销白付、代码噪音。见 §文件粒度与命名。
5. **新增组件后登记进本文件**：违反后果：下一次对话找不到它（是全局规则「每次开发后更新文档」在本层的落地）。步骤见 §新增组件检查清单。

## 三类的边界

组件层按**用途**分三个目录，判据只有一条：**这个组件服务谁**。

| 目录 | 服务对象 | 判据 | 子文档 |
|---|---|---|---|
| `mainPage/` | 主界面外壳 | 只在会话外壳内部使用；换成别的外壳就不需要它 | [main-page.md](main-page.md) |
| `dialog/` | 弹窗与浮层 | 有遮罩层、独立于会话流、可被多处唤起 | [dialog.md](dialog.md) |
| `content/` | 内容条目渲染 | 输入是协议里的内容 `kind`，可脱离外壳单独渲染 | [content.md](content.md) |

拿不准时按这个顺序问：① 它是内容 `kind` 的渲染器吗 → `content/`；② 它带遮罩、整页浮在会话之上吗 → `dialog/`；③ 否则 → `mainPage/`。

`mainPage/` 下再按**界面区域**分五个子目录：

| 子目录 | 区域 | 文件 |
|---|---|---|
| `sidebar/` | 左栏 | `Sidebar.tsx` |
| `header/` | 顶栏 | `Header.tsx` |
| `conversation/` | 会话正文 | `ConversationView.tsx`、`TurnView.tsx`、`MessageParts.tsx`、`ConfirmationCard.tsx`、`Hero.tsx` |
| `composer/` | 输入区 | `Composer.tsx`、`ComposerSlot.tsx`、`StatsDock.tsx`、`ThinkingPicker.tsx` |
| `overlays/` | 浮层挂载点 | `DialogHost.tsx`、`Toast.tsx` |

## 数据来源：两条规则

**规则 A：展示组件一律 props 驱动。** `conversation/**`、`content/**`、`markdown.tsx`、`StatsDock.tsx` 只接收 props，不 import `store`。理由：它们描述"长什么样"，与"数据从哪来"解耦后可以脱离外壳渲染（历史上存在过的 `?preview=1` 调试面板就是靠这一点复用同一套组件）。

**规则 B：外壳与弹窗可以直接消费 store。** `Sidebar`、`Header`、`Composer`、`ComposerSlot`、`ThinkingPicker`、`DialogHost`、`Toast`、`SettingsDialog` 与全部子弹窗都通过 `useAppSelector` / `useActions` 自己取数据与动作。理由：它们本来就是"外壳的一部分"，强行 props 钻透只会让页面变胖。

判定方法：**如果这个组件能在一张空页面上独立渲染出有意义的东西，它就属于规则 A。**

| 组件 | 规则 | 数据来源 |
|---|---|---|
| `ConversationView` / `TurnView` / `MessageParts` / `ConfirmationCard` / `Hero` | A | props（页面对接 store） |
| `content/**`、`content/markdown.tsx` | A | props（协议条目） |
| `StatsDock` | A | props（由 `Composer` 从 store 读出后传入） |
| `Sidebar` / `Header` / `Composer` / `ComposerSlot` / `ThinkingPicker` | B | store |
| `dialog/**`、`DialogHost` / `Toast` | B | store（弹窗开合状态在 `store/reducers/ui.ts`） |

## 文件粒度与命名

- **一个组件一个文件**，文件名 = 组件名（`Sidebar.tsx`、`MessageParts.tsx`）。没有 `index.ts` 桶文件，导入路径始终指向真实文件，避免循环引用与"这个符号到底在哪"的追查成本。
- 同文件导出的多个小组件必须是同一主题（`MessageParts.tsx` 导出会话流里的原子行：`UserBubble` / `NoticeRow` / `ErrorRow` / `SessionBanner` / `StreamingBlock`）。
- **不做过度 memo**：只有流式期间会被高频重渲染的行才 `memo`（`MessageParts`、`TurnView`、`ContentItem`、`Markdown`），普通组件不加。

## 新增组件检查清单

1. 用上面的判据选目录；
2. 用规则 A/B 定数据来源（选 B 时，状态必须加在 `store/reducers/*`，动作加在 `store/operations.ts`，不要就地 `useState` 存全局数据）；
3. 样式类名沿用既有语汇（见 [../styles/readme.md](../styles/readme.md)），需要新类时按所属样式文件的前缀命名；
4. 在本文件或对应子文档的表格里登记；
5. `npm run typecheck`，并按 [../regression/readme.md](../regression/readme.md) 选相关用例回归。

