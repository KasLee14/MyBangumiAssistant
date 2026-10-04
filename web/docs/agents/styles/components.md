# 组件样式（`cards.css` / `composer.css` / `modal.css`）

## 使用说明

### 这份文档是什么

三份组件样式（确认卡、输入区与浮层、弹窗）的类名对照与共同约定。

上层：[readme.md](readme.md)。这三份都消费 `--dsw-*` 语义令牌，并被 `bgm.css` 重定向后的品牌令牌影响。

### 怎么读（章节 → 场景）

| 章节 | 什么时候读 |
|---|---|
| §`cards.css` | 改确认卡或卡内提示样式时 |
| §`composer.css` | 改输入区、命令弹窗、思考菜单样式时 |
| §`modal.css` | 改弹窗几何（宽度、头部、字段、选项行）时 |
| §三者共同遵守 | **写这三份样式前必读**（令牌、前缀、材质、可访问性、宽度轴） |

### 必须遵守的规则

本层通用规则见 [readme.md](readme.md) 的「必须遵守的规则」。本篇专属：

1. **浮层材质走子层**（`.xxxMaterial` 承载底色与模糊，卡片只管几何与描边）—— 违反后果：各浮层的透出效果不一致。
2. **品牌形态改动留在 `bgm.css`，几何改动留在本文件** —— 违反后果：两处互相覆盖，难以定位。
3. **宽度轴与 `frame.css` 同源** —— 违反后果：输入卡与正文错位。

## `cards.css`（~270 行）：确认卡与会话内提示

来源：deepseek-harness 的 `ui-approval/ApprovalPanel.module.css`（确认/预览卡：20px 圆角、warn 描边、色条、动作行）与 `ui-conversation/skeleton/InputBar.module.css`（卡外内边距）。

| 类名 | 用途 |
|---|---|
| `.cardSeat` | 确认卡的"座位"：sticky 贴底，重算 `--dsh-chat-content-width`（与 `.column`、`.composerSeat` 三处同源） |
| `.planCard` / `.planStrip` / `.planBody` / `.planNote` / `.planActions` | 确认卡本体：状态条由 `data-state` 着色（`pending` / `accepted` / `rejected` / `expired`） |
| `.planTitle` | 授权标题：正文标题字体，留出状态文案的位置 |
| `.planPreview` | 授权正文：使用 `--dsw-font-s-14` 普通字体，保留换行（宿主操作说明及完整范围原样呈现，前端不截断） |

`.planPreview` 服务授权卡的纯文本 `<div>`，不用代码块或等宽字体；`bgm.css` 只覆盖底色、边框和正文颜色，字号与行高沿用正文令牌。长范围在 `.planBody` 内滚动，按钮始终留在独立的 `.planActions` 中。

## `composer.css`（~615 行）：输入区与浮层

来源：`ui-conversation/skeleton/InputBar.module.css`（卡片 28px 圆角、内边距、发送键 34×34）、`ui-input-trigger/MenuView` + `ui-commands/PopupSelectView`（命令弹窗：锚点、行高 34px、分组标题）、`ui-primitives/Menu.module.css`（MenuSurface 材质：底色与模糊放在子层）、`ui-model-selection/ModelSelect.module.css`（触发器 28px 高）。

| 类名 | 用途 |
|---|---|
| `.composerSeat` | 输入区的座位：宽轴与 `.column` 同源；**接管卡替换的是它内部的内容，容器不动**（否则 textarea 丢焦点与 IME 组合态） |
| `.composerStack` / `.composerCard` / `.composerHero` | 卡片本体；`composerHero` 是首屏阶段的更高最小高度 |
| `.composerScroll` / `.composerInput` / `.composerRow` / `.composerTools` / `.composerTrailing` | 输入框与底栏；`.composerProblem` 是参数错误的一行提示 |
| `.overlayAnchor` / `.composerPopup*` / `.popupItem` / `.popupSection` | 命令候选浮层（锚在卡片顶边向上展开） |
| `.thinkingAnchor` / `.thinkingTrigger` / `.thinkingMenu*` / `.menuItem` / `.menuLabel` | 思考强度菜单（向上展开） |
| `.sendButton`、`.dock`（底栏读数） | 发送/停止键与 `StatsDock` 的读数条 |

浮层材质统一用 `MenuSurface` 的做法：**底色与背景模糊放在子层**（`.composerPopupMaterial` / `.menuMaterial`），卡片本身只管几何与描边。新增浮层请沿用这个结构。

## `modal.css`（~170 行）：弹窗

来源：harness 的 MenuSurface 材质 + elevation 三件套的 prominent 档；形态细节按 bgm.tv 实测值重做（见 [content-and-brand.md](content-and-brand.md)）。

| 类名 | 用途 |
|---|---|
| `.modalOverlay` | 遮罩（`position: fixed` + 压暗） |
| `.modalSurface`（`[data-wide='true']`） | 弹窗表面：宽 660px（wide）/ 520px |
| `.modalHeader` / `.modalEyebrow` / `.modalClose` | 标题栏 40px；`eyebrow` 与标题重复时不渲染（组件侧判断） |
| `.modalBody` / `.modalFooter` / `.modalField` / `.modalInput` | 内容区、底栏、字段与输入框 |
| `.modalCheck`（`[data-disabled='true']`） | 复选/单选行（模型配置的"保存到本机"、代理模式三选一） |
| `.modalHint` / `.modalError` / `.modalStatus` | 说明、错误、进度状态条 |
| `.pickerList` / `.pickerRow` | 选择列表（历史会话弹窗） |
| `.settingsRow` / `.label` / `.value` / `.actions` | 设置主面板的四行布局 |

## 三者共同遵守

1. **只消费语义令牌**（`--dsw-alias-*` 等），不写死颜色；品牌形态由 `bgm.css` 覆盖。
2. **类名不越出各自前缀**：`frame.css` 不得出现 `.modal*`，`modal.css` 不得出现 `.composer*`。
3. **浮层材质走子层**：底色 + 模糊放 `.xxxMaterial`，卡片只管几何与描边——这样背景内容透出来的效果在所有浮层一致。
4. **可访问性**：交互控件保留 `:focus-visible` 焦点环；`data-state` 类的状态不能只靠颜色区分（确认卡同时有文案）。
5. 三处同源宽度轴（`.column` / `.composerSeat` / `.cardSeat` 的 `--dsh-chat-content-width`）**要一起改**，否则输入卡与正文会错位。
