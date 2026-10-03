# 外壳与布局用例（`L`）

## 使用说明

### 这份文档是什么

外壳与布局（`L1`–`L10`）的用例：首屏与退出条件、侧栏响应式、连接状态、DOM 与类名契约、宽度轴、品牌外观、引入顺序、可访问性、浮层层级。

前提与判定约定见 [readme.md](readme.md)。这一组是**样式与 DOM 契约**的回归，改类名、层级、样式文件或令牌后必跑。

### 怎么读（用例段 → 场景）

| 用例段 | 什么时候跑 |
|---|---|
| `L1`–`L2`（首屏与退出条件） | 动首屏 hero、`selectHeroPhase` 或输入卡阶段时 |
| `L3`（侧栏折叠与响应式） | 动 `ui.collapsed`、`useResponsiveCollapse` 或侧栏样式时 |
| `L4`（连接状态） | 动 SSE 订阅或连接状态映射时 |
| `L5`–`L6`（DOM 契约与宽度轴） | **改组件结构、类名或层级后必读**（逐项核对骨架与三处宽度轴） |
| `L7`–`L8`（品牌形态与引入顺序） | 动样式文件、令牌或 `main.tsx` 的 import 顺序时 |
| `L9`（焦点环与键盘可达） | 动交互控件、禁用态或浮层时 |
| `L10`（浮层遮挡关系） | 动弹窗 / toast 的层级或 `z-index` 时 |

### 必须遵守的规则

本组通用规则见 [readme.md](readme.md) 的「必须遵守的规则」。本篇专属：

1. **`L5` 必须同时核对层级关系**，只确认节点存在不算通过 —— 违反后果：容器查询与屏外优化静默失效。
2. **`L6` 要在侧栏展开与收起两态各测一次** —— 违反后果：只覆盖一种宽度轴。
3. **`L7` / `L8` 肉眼判定时以"关键形态"为准，并优先怀疑引入顺序** —— 违反后果：把顺序问题误判成样式写错。

## L1 首屏渲染（不需模型）

**前置**：会话为空且空闲（刚新建或刚打开）。

**预期**（逐项存在且内容正确）
- 外壳：`.frame[data-sidebar='collapsed'|'expanded']`、`.sidebar`、`main.conversation`；
- 顶栏：标题「Bangumi 助手」、`会话` 标签、连接状态 chip、设置按钮（`aria-label="设置"`）；
- 首屏：`.hero` → `.heroStack` → `.heroHeadline`（含「Bangumi 助手」与「Web 终端」徽标）→ `.heroHint`；
- 输入区：`.composerSeat` → `.composerCard.composerHero`（首屏态更高）→ `#composer-input`；
- 底栏读数：`.dock`（token 胶囊 + 上下文环）。

**判定**
```js
['.frame', '.sidebar', '.conversation', '.conversationHeader', '.hero', '.heroStack', '.composerSeat', '#composer-input'].every(s => document.querySelector(s))
document.querySelector('.body').dataset.phase === 'hero'
document.querySelector('.frame').dataset.sidebar        // 窗口宽 ≤1024 时为 'collapsed'
```

## L2 首屏退出条件

**步骤**：分别制造下列任一条件，观察是否离开 hero 阶段（`.body[data-phase]` 变 `active`）。

| 条件 | 期望 |
|---|---|
| 出现任何条目（通知/命令回显/助手回答） | 离开 hero |
| 正在流式输出（`busy` 或 `liveText` 非空） | 离开 hero |
| 有乐观回显气泡（`pendingEcho`） | 离开 hero |
| 以上都没有 | 停在 hero |

**判定**：`document.querySelector('.body').dataset.phase`。

## L3 侧栏折叠与响应式

**步骤**
1. 点侧栏顶部的折叠按钮（`aria-label` 为「展开侧栏」/「收起侧栏」）；
2. 把**窗口宽度缩到 ≤1024**，再点按钮展开。

**预期**
- 点击在 `collapsed` / `expanded` 间切换，`.frame[data-sidebar]` 同步变化，侧栏文字显隐正确；
- 缩窄后自动收起；此时**手动展开**，再触发一次 resize（拖动窗口 1px）会**重新收起**——这是既定的强制语义，不是缺陷；
- 折叠状态下「新建会话」按钮仍可见可用。

**判定**
```js
document.querySelector('.frame').dataset.sidebar
document.querySelector('.logoRow .iconButton').getAttribute('aria-label')
```

## L4 连接状态（不需模型）

**步骤**
1. 页面打开且宿主在运行 → 看顶栏 chip；
2. **停掉宿主进程**（`Ctrl+C`）→ 再观察；
3. 重新启动宿主 → 再观察（`EventSource` 自带重连）。

**预期**
- 运行中：chip 文案「已连接」、`data-state="on"`；
- 宿主停止：「连接中断」、`data-state="off"`；
- 宿主重启：自动恢复「已连接」，**无需刷新页面**。

**判定**
```js
const chip = document.querySelector('.conversationHeader .chip');
[chip.textContent.trim(), chip.dataset.state]
```

## L5 DOM 与类名契约（样式依赖的骨架）

**步骤**：在空会话与至少一轮对话两种状态下，逐项核对下列节点**存在且层级正确**。

首屏阶段 `.scrollBody` 直接承载 `.hero`；下表的 `.scroll > .column > .flowItem` 只在活动阶段出现，不能据此判定空会话首屏失败。

| 选择器 | 层级/关系 | 谁依赖 |
|---|---|---|
| `.frame` | 最外层 | 外壳网格 |
| `.conversation` | `.frame` 的第二列 | 会话列 |
| `.body` | `.conversation` 内 | **容器查询参照**（`container-type`） |
| `.scrollBody` | `.body` 内 | 滚动 + 屏外优化 |
| `.scroll > .column` | `.scrollBody` 内 | 内容宽轴（`100cqw`） |
| `.flowItem` | `.column` 的直接子级 | 屏外优化选择器 |
| `.composerSeat` | `.body` 内（输入区座位） | 输入卡宽轴 |
| `.cardSeat` | 接管时替换 `.composerSeat` **内部** | 确认卡宽轴 |

**判定**（层级关系一并校验）
```js
document.querySelector('.body > .scrollBody > .scroll > .column > .flowItem') !== null
document.querySelector('.body .composerSeat') !== null
document.querySelector('.body > .scrollBody > .scroll > .column') !== null
```

> 特别提醒：`ConversationView` 必须包含 `.body` 与 `.scrollBody`，但**不含** `.frame` / `.conversation`（由页面提供）。这条边界改动会导致屏外优化与列宽同时失效。

## L6 宽度轴一致性

**步骤**：同一窗口宽度下，分别在**侧栏展开**与**收起**两态读取三个元素的 `--dsh-chat-content-width`。

**预期**：`.column`、`.composerSeat`、`.cardSeat`（有确认卡时）三处解析到**相同的值**（同源轴：内容宽 + 32px）。

**判定**
```js
const read = sel => getComputedStyle(document.querySelector(sel)).getPropertyValue('--dsh-chat-content-width').trim();
({ column: read('.column'), composer: read('.composerSeat') })   // 两者应相等
```

## L7 品牌外观关键形态

**步骤**：对照下列形态逐项看（不需设备，肉眼判定）。

| 项 | 期望 |
|---|---|
| 主色 | 选中态/强调为粉色（`#f09199` 系） |
| hover | 列表行/按钮 hover 落交互蓝（`#369cf8` 系） |
| 卡片 | 1px 边框 + 10px 圆角，**无投影** |
| 弹窗 | 15px 圆角 + 大扩散柔光；浅色玻璃表面；遮罩很淡 |
| 弹窗标题栏 | 约 40px 高；细线关闭按钮；下方 1px 分隔线 |
| 弹窗按钮 | 主按钮为粉色胶囊；次要按钮为灰胶囊；hover 都变蓝 |
| 连接 chip | 绿底绿字 / 红底红字（不靠小圆点表态） |
| 输入区 | 卡片圆角明显大于内容卡片（28px 量级） |
| 浮层材质 | 命令弹窗与思考菜单有背景模糊，卡片本身只有几何与描边 |

**判定**：肉眼 + 需要时截图对比；错乱优先怀疑 [../styles/readme.md](../styles/readme.md) 里的**引入顺序**。

## L8 样式引入顺序回归

**步骤**：把窗口缩放一次（触发重排）后，抽查三处颜色/形态：侧栏选中行、输入卡边框、弹窗表面。

**预期**：三处都呈品牌值（不是 DSH 默认蓝/白）。若出现"部分生效"，检查 `main.tsx` 的 import 顺序是否为 `tokens → frame → composer → cards → modal → bgm → content`。

**判定**：肉眼；命令行核对顺序：`Select-String -Path web/src/main.tsx -Pattern "styles/"`。

## L9 焦点环与键盘可达

**步骤**：用 Tab 依次走：侧栏折叠按钮 → 新建会话 → 会话行 → 顶栏设置 → 输入框 → 思考标签 → 发送键。

**预期**
- 每个可交互控件都有**可见焦点环**（不依赖 hover 才看得出）；
- 顺序与视觉顺序一致，不跳进隐藏元素；
- Enter/Space 能激活按钮。

**判定**
```js
document.activeElement.tagName + ':' + (document.activeElement.getAttribute('aria-label') ?? document.activeElement.className)
```

## L10 浮层遮挡关系

**步骤**
1. 打开设置弹窗，观察它相对会话区与输入卡的遮挡；
2. 触发一次 toast（如 `/help`），观察它与弹窗的叠放。

**预期**
- 弹窗及其遮罩覆盖整页（含侧栏与输入区）；
- toast 出现在弹窗之上的可见位置（不被遮罩吞掉），且不阻塞点击。

**判定**：肉眼 + 需要时读 `getComputedStyle(el).zIndex`（弹窗层当前为 60 量级）。
