# constants：跨页面常量层

> 覆盖 `web/src/constants/` ｜ 核对 2026-10-11

## 功能介绍

`web/src/constants/` 是**跨页面常量**层，零依赖的叶子层：只导出常量表，不 import 任何模块（`web/src/constants/paths.ts` 连一条 import 都没有），因此谁都可以引用而不成环。三个文件分别管地址、工具行的视觉表、JS 侧动效令牌。

判据是「谁消费它」：页面专有的常量在 `web/src/page/<页面>/constants/`；**判定函数与派生逻辑不放这里**，它们属于 `web/src/utils/`。

## 索引

按功能模块分组。

### 地址常量

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `paths.ts` | `PATH`（`home` / `lab` / `library`）与 `LIBRARY_COMPONENT_PATTERN`（给 `useMatch` 用的带 `:kind` 模式）；**零 import 的叶子模块**——它被 router / page / components 三层消费，所以从 `web/src/router/` 提到 `web/src/constants/`，依赖环随之消失；路径**拼接函数**在 `web/src/utils/paths.ts` | `web/src/constants/paths.ts` | 加 / 改页面地址，或文档页详情的匹配模式 |

### 工具行视觉表

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `tools.ts` | `TOOL_STATE`：六种工具状态的记号与标签（`running ·` / `waiting …` / `ok ✓` / `partial !` / `unknown ?` / `error ×`），类型是 `Readonly<Record<ToolState, …>>`，穷尽性由类型保证 | `web/src/constants/tools.ts` | 改工具行的状态记号与文案；查「某个工具状态该显示什么」 |

### JS 侧动效令牌

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `motion.ts` | `EASE_OUT` / `EASE_IN_OUT` / `EASE_SPRING` / `EASE_SPRING_SOFT`、`DURATION`（`instant` / `fast` / `base` / `slow` / `reveal` / `slower`）、`SHIFT`（`row` / `panel` / `reveal`）、`STAGGER`；与 `web/src/styles/base/motion/motion.css` 一一对应 | `web/src/constants/motion.ts` | 改 JS 侧动效时长、缓动、入场位移、错峰间隔（必须与 CSS 侧同步） |

## 规则

### 引用方向

**1. `paths.ts` 不 import 任何东西。**

- **规则**：这个文件只导出字符串常量，不引用路由模块、不引用页面或组件。
- **为什么**：它被 router / page / components 三层消费，是唯一能同时服务三层的叶子模块（组件里要知道「卡片实验室在哪」，而组件不能引路由）。
- **后果**：一旦它依赖路由模块，`router → page → components → constants → router` 的环立刻成立，模块初始化顺序问题会变成随机崩溃。

### 模块边界

**2. 常量表是零依赖纯数据，判定与派生放 `web/src/utils/`。**

- **规则**：本层只放表与取值；`toolBodyKind` / `toolExpandable` 这类函数放 `web/src/utils/toolViews.ts`。
- **为什么**：表可以被任何环境直接读；函数属于工具层，需要逻辑与测试。
- **后果**：混在一起后常量文件不再零依赖，测试或脚本想复用这张表会连带拉进 React 与 store。

### 改动联动

**3. JS 与 CSS 的动效令牌一一对应。**

- **规则**：`web/src/constants/motion.ts` 与 `web/src/styles/base/motion/motion.css` 是同一套刻度，改一处必须同时改另一处；只有 JS 侧消费的档位（`DURATION.reveal`、`SHIFT.reveal`）不建同名 CSS 令牌。
- **为什么**：同一个过渡出现两条曲线就会有两种节奏。
- **后果**：只改一边会让 CSS 过渡与 motion 动画速度不一致，观感是「卡一下」。

### 穷尽性守卫

**4. 表项保持 `Record<联合类型, …>` 的穷尽写法。**

- **规则**：新增一种工具状态、一档时长时，用映射类型而不是 `Partial` 或索引签名。
- **为什么**：漏登记会**编译失败**，这是有意的守卫。
- **后果**：改成宽松类型后漏登记静默通过，界面上表现为记号空白、状态看起来「卡住」。
