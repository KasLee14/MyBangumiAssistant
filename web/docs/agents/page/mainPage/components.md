# components：主界面可视组件

> 覆盖 `web/src/page/mainPage/components/` ｜ 核对 2026-10-11

## 功能介绍

`web/src/page/mainPage/components/` 是主界面**页面专有**的可视组件，按功能模块分五个子目录：`shell/`（外壳）、`composer/`（输入区）、`dialog/`（弹窗）、`overlays/`（浮层挂载）、`hero/`（首屏）。

判据是「只被主界面消费」——被两个及以上页面消费的组件在 `web/src/components/`（见 [../../components.md](../../components.md)）。本页的容器组件从 store 取数，展示组件 props 驱动（见 [index.md](index.md) 规则 1）。

## 索引

按场景找：改哪一块就只读该子目录的表（见 [index.md](index.md) 的「按场景分流」）。

### shell/ —— 外壳

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `Shell.tsx` | 主界面外壳：**唯一的装配点**；只做两件事——从 store 取数、按槽位交给组件，业务逻辑一律不在这里（唯一例外是首屏两枚入口的回调注入） | `web/src/page/mainPage/components/shell/Shell.tsx` | 改两列骨架的槽位组合；加一个新的界面区域 |
| `Sidebar.tsx` | 侧栏：品牌（双击进调试页）· 连接状态点 · 折叠钮 / 开启新对话 / 分组会话列表 / 用户行与设置入口；会话行尾「···」是侧栏里唯一的菜单 | `web/src/page/mainPage/components/shell/Sidebar.tsx` | 改侧栏任一行、会话分组渲染或行内菜单 |
| `CollapseBubbles.tsx` | 收起态左上角的两个入口气泡；绝对定位在 `.appFrame` 上（不参与 grid），只在收起态可见 | `web/src/page/mainPage/components/shell/CollapseBubbles.tsx` | 改收起态入口 |
| `Stagger.tsx` | 逐项错峰入场容器（短列表用）；参数全部来自令牌，不写死数值 | `web/src/page/mainPage/components/shell/Stagger.tsx` | 改列表入场节奏 |
| `icons.tsx` | 外壳图标（侧栏与收起态气泡共用）：16×16、`currentColor`、屏幕折算 1.4px | `web/src/page/mainPage/components/shell/icons.tsx` | 改外壳图标；加一枚新图标 |

### composer/ —— 输入区

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `Composer.tsx` | 输入卡 + 命令候选：卡片由 `BorderGlow` 提供底色与聚焦边缘光；草稿在 store 中按会话保存，提交标记与补全状态留在组件内 | `web/src/page/mainPage/components/composer/Composer.tsx` | 改输入、发送、停止、命令补全 |
| `ComposerSeat.tsx` | 输入区座位：决定「此刻输入位置该放什么」（输入卡 / 接管卡）；输入卡挂载在唯一位置 `.appSeat`，按 `sessionId` 重建 | `web/src/page/mainPage/components/composer/ComposerSeat.tsx` | 加一种接管形态（如新的确认卡） |
| `StatsDock.tsx` | 输入卡底栏：token 胶囊与上下文占用环；浮层 portal 到 body 并 fixed 定位，同时只允许一个浮层展开 | `web/src/page/mainPage/components/composer/StatsDock.tsx` | 改读数胶囊、占用环或它的浮层 |
| `ThinkingPicker.tsx` | 输入卡右侧的思考强度入口：常驻标签显示当前级别，点开就地选择；级别清单来自宿主，切换会写成本机默认 | `web/src/page/mainPage/components/composer/ThinkingPicker.tsx` | 改思考强度入口 |

### dialog/ —— 弹窗

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `Modal.tsx` | 居中弹窗的共享表面：遮罩 + 玻璃表面 + 内容骨架（标题 / 副标题 / 内容 / 动作行）；进出场由 CSS 驱动，另提供「留场」context | `web/src/page/mainPage/components/dialog/Modal.tsx` | 改所有弹窗共用的表面、骨架或进出场 |
| `SettingsDialog.tsx` | 设置弹窗：四格 `BentoGrid` 状态总览（模型配置 / 模型选择 / 代理端口 / 登录状态），整格可点、无动作条 | `web/src/page/mainPage/components/dialog/SettingsDialog.tsx` | 改设置总览的四格或入口 |
| `ModelDialog.tsx` | 「模型配置」弹窗：为某个提供方填入或清除 API Key；「保存到本机」决定写 `auth.json` 还是只注入本次运行 | `web/src/page/mainPage/components/dialog/ModelDialog.tsx` | 改密钥填写、保存方式或提供方下拉 |
| `ModelPickerDialog.tsx` | 「模型选择」弹窗：从宿主报告的可用模型里挑一个，底部「使用」才是提交点 | `web/src/page/mainPage/components/dialog/ModelPickerDialog.tsx` | 改模型列表或选择流程 |
| `ProxyDialog.tsx` | 网络线路弹窗：配置项 + 代理地址；只影响本次运行，不提供「保存到本机」 | `web/src/page/mainPage/components/dialog/ProxyDialog.tsx` | 改线路配置 |
| `LoginDialog.tsx` | `/bangumi-login` 命令路径的凭据弹窗：邮箱与密码一次提交，输入只发往本机宿主 | `web/src/page/mainPage/components/dialog/LoginDialog.tsx` | 改命令路径的登录弹窗 |
| `BangumiLoginDialog.tsx` | 设置里的登录弹窗：与命令路径的区别是不经过会话输入，会话流里不出现命令回显 | `web/src/page/mainPage/components/dialog/BangumiLoginDialog.tsx` | 改设置路径的登录弹窗 |
| `BangumiLogoutDialog.tsx` | 退出登录的确认弹窗：确认后直接调用宿主接口清除本机保存的会话 | `web/src/page/mainPage/components/dialog/BangumiLogoutDialog.tsx` | 改退出确认 |
| `SessionDialog.tsx` | `/sessions` 的居中选择弹窗；左侧栏的历史会话列表是同一件事的常驻入口，底部「切换」才是提交点 | `web/src/page/mainPage/components/dialog/SessionDialog.tsx` | 改会话选择弹窗 |

### overlays/ —— 浮层挂载

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `DialogStage.tsx` | 三个弹窗（login / settings / sessions）的挂载点与「留场」管理：按 `DIALOG_IDS` 固定顺序生成 key，退场播完才卸载 | `web/src/page/mainPage/components/overlays/DialogStage.tsx` | 加第 4 个弹窗；改弹窗挂载或退场时机 |
| `Toast.tsx` | 一次性提示（toast）：内容来自 store，出现即计时（4 秒），过期由 store 的动作清除 | `web/src/page/mainPage/components/overlays/Toast.tsx` | 改提示形态或停留时间 |

### hero/ —— 首屏

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `Hero.tsx` | 首屏引导（空会话）：标题（`BlurText` 逐词亮相）+ 一句能力说明 + 三枚玻璃示例 + 「设置 · 模型 / 代理 / 登录」入口；示例点击由调用方注入 `onPick` | `web/src/page/mainPage/components/hero/Hero.tsx` | 改空会话首屏 |

## 规则

### 技术边界

**1. 滚动容器里的浮层不用卡内绝对定位。**

- **规则**：父级是滚动容器时，浮层只有两条出路——**就地展开**（`Sidebar.tsx` 的会话行菜单挂在行内，不脱离文档流）或 **portal 到 body 再 fixed 定位**（`StatsDock.tsx` 的读数浮层）。两种都不用「留在卡内 + 绝对定位」。
- **为什么**：输入卡位于 `.scrollBody`（`overflow-y: auto`）内、会话列表在 `.appSidebarScroll`（同样 `overflow-y: auto`）内，卡内绝对定位的浮层会被滚动容器裁掉——列表第一行与最后一行最明显。
- **后果**：浮层被裁掉一半且只在特定滚动位置复现；若改用 JS 算坐标，滚动、窗口缩放、字体加载都要各补一次重算。

### 单一真相源

**2. 外壳图标规格只有一处。**

- **规则**：外壳图标统一在 `icons.tsx` 定义（16×16 显示、`fill="none"`、`currentColor`、描边屏幕折算 1.4px）；侧栏与收起态气泡共用它，不各画一套，也不在别处混用 1.2 / 1.3 / 1.5 的线宽。
- **为什么**：同一个外壳里的图标规格只有一处，改一次全体生效。
- **后果**：混用线宽会让图标看起来「有的粗有的细」，而且调整规格时必然漏改其中一处。

### 归位与命名

**3. 收起态入口挂在侧栏之外。**

- **规则**：`.appFrame` 上绝对定位的两个气泡（`CollapseBubbles.tsx`）不属于侧栏，也不参与 grid；展开态与收起态各有一份入口，两者永不同时出现。
- **为什么**：抽屉式收起后侧栏宽度归零，挂在侧栏里的入口会随之外滑出窗口，品牌、折叠钮与「开启新对话」都够不着。
- **后果**：收起侧栏后入口不可达，用户只能靠刷新或清空本地状态回到展开态。
