# 调试页皮肤（`styles/debug.css`）

## 简介

调试页（`web/src/page/debug/`）的皮肤：`<html data-debug="on">` 作用域下的侧栏加宽、左侧输入区（`.debugPane` / `.debugTextarea` / `.debugButton` …）、预览条（`.debugPreviewBar`）与空态（`.debugHero`）。

**不覆盖**：外壳与会话区的既有形态（见 [frame.md](frame.md)）、令牌定义（见 [tokens.md](tokens.md) 与 [content-and-brand.md](content-and-brand.md)）；调试页的装配与行为见 [../page/debug.md](../page/debug.md)。

上层：[readme.md](readme.md)。相关：[../page/debug.md](../page/debug.md)、[../utils/debugMode.md](../utils/debugMode.md)。

### 它在这一层的位置

`styles/` 的第 8 个文件，按"作用对象"分文件的又一份实例：作用对象是**调试页**。它只消费 `--bgm-*` / `--app-*`，不参与 `--dsw-*` 别名重定向，因此在引入链里排在最后（见 §索引「引入位置」）。

## 使用说明

- **改这个文件之前先读 §规则**：前缀与作用域、不得覆写既有组件的类、宽度只改一条都在那里；违反的后果分别是样式互相污染、改一处不生效，以及主界面的侧栏宽度被调试页的规则波及。
- **只想查某个类负责什么、引入在哪**：直接查 §索引 的两张表（类 → 作用、引入位置）。
- **想知道样式该不该写在这个文件**：先看它是不是只服务调试页；不是就回到 [readme.md](readme.md) §规则「新增样式的步骤」。

## 规则

### 只新增 `debug*` 前缀的类

`debug.css` 里新增的类一律以 `debug` 开头：`.debugPane`、`.debugSection*`、`.debugTextarea`、`.debugButton`、`.debugLink`、`.debugSamples`、`.debugActions`、`.debugStatus`、`.debugError`、`.debugNote`、`.debugPreviewBar`、`.debugBadge`、`.debugHero`、`.debugHeroTitle`。

作用在**类内部**的元素级规则（`.debugStatus b`、`.debugPreviewBar .debugBadge`、`.debugHero code`）允许，但必须挂在 `debug*` 祖先之下——它就是这一层「前缀隔离」约定（[readme.md](readme.md) §规则「隔离规则」）在调试页上的落地。

**违反后果**：样式互相污染，出问题难以定位来源。

### `html[data-debug='on']` 是唯一的作用域

调试页的外观靠 `<html>` 上的 `data-debug` 属性圈定，该属性由 `main.tsx` 的 `Root` 维护（`'on'` / `'off'`，见 [../page/main-page.md](../page/main-page.md)）。

**为什么需要它**：调试页复用了 `.appFrame` / `.appSidebar` / `.appConversation` 这些**主界面也在用**的类（预览必须走真实渲染链路，见 [../page/debug.md](../page/debug.md)），所以"只在调试页生效"这件事不能靠类名区分，只能靠作用域属性。

**违反后果**：改成无条件选择器后，主界面会跟着被改动。

### 不得覆写既有组件的类

`.appFrame` / `.appSidebar` / `.appStage*` 等既有类的形态规则属于 `frame.css`；这个文件里**不得**为它们再声明形态属性（颜色、尺寸、间距、边框…）。同一元素同一属性只有一个来源，见 [readme.md](readme.md) §规则「同一元素同一属性只有一个来源」。

需要例外时的写法是**作用域 + 数据属性**，而不是在 `frame.css` 之外重写一遍同一条属性。

**违反后果**：改一处不生效（值由引入顺序与特异性决定，而不是由语义决定）。

### 宽度覆盖只改 `--app-sidebar-width` 这一条

调试页的输入区更宽，实现方式只有一条规则：

```css
html[data-debug='on'] .appFrame {
  --app-sidebar-width: 436px;
}
```

它只提高 `.appFrame` 上那一条自定义属性的特异性，不动 `grid-template-columns`、不动折叠态、不动 `.appSidebar` 的内边距。加宽再需要变化时，仍然只改这一个数值。

**违反后果**：主界面的侧栏布局被连带动到，折叠与响应式宽度规则互相打架。

### 品牌区用组合类 `appBrandAction`，不碰 `.appBrand`

品牌区（双击进/出调试页的落点）的可点暗示写在**新增的**组合类上，由 `SidebarBrand.tsx` 挂在同一元素上（`className="appBrand appBrandAction"`）：

```css
.appBrandAction { cursor: pointer; user-select: none; border-radius: var(--app-radius-control); }
.appBrandAction:hover { color: var(--bgm-primary); }
.appBrandAction:focus-visible { outline: 2px solid var(--bgm-primary); outline-offset: 2px; }
```

**为什么不用 `.appBrand[data-debug-toggle='true']`**：那等于在 `frame.css` 之外为既有组件类新增属性，品牌区的交互暗示就出现了第二个来源——改 `frame.css` 的 `.appBrand` 时容易漏掉这一处。上一节「不得覆写既有组件的类」正是为这条兜底。

**违反后果**：品牌区样式出现第二个来源，`frame.css` 与 `debug.css` 互相不知道对方改了同一个元素。

### 顶栏「组件库」链接用组合类 `debugLink`，不碰 `.debugButton`

调试页顶栏的「组件库」入口是 `<a className="debugButton debugLink" …>`（`DebugInputPanel.tsx`，见 [../page/debug.md](../page/debug.md) §规则「顶栏的「组件库」入口是新标签 `<a>`，用组合类 `.debugLink`」）：形态复用 `.debugButton`，新增的那一条属性只写在组合类上：

```css
.debugLink,
.debugLink:hover {
  text-decoration: none;
}
```

规则块把 `.debugLink` 与 `.debugLink:hover` 合在一起声明，两种状态下都没有下划线。

**为什么 hover 也要一起写**：链接的下划线来自元素默认样式与**将来可能出现的 `a:hover`** 这类规则。`.debugLink`（0,1,0）挡不住 `a:hover`（0,1,1——元素类型 + 伪类的特异性高于单个类），所以 hover 态必须显式再声明一次；这也是这一条唯一"同一属性写两处"的正当理由。

**为什么**：`.debugButton` 是调试页的按钮基元，被多个按钮共用；`text-decoration` 只服务"这一个链接"，属于给既有组件类加属性，按本层惯例要起组合类（同上一节 `.appBrandAction` 的理由）。

**违反后果**：按钮基元上多出一条只服务链接的属性，改 `.debugButton` 时无法判断它会不会波及顶栏入口。

### 颜色与尺寸一律走令牌

颜色只用 `--bgm-*`（含 `--bgm-danger`），圆角、表面与描边只用 `--app-radius-*` / `--app-surface` / `--app-hairline`，字号字体用 `--bgm-font`。不写裸十六进制——唯一的例外是 `.debugButton[data-primary='true']` 的 `color: #fff`（主按钮上的白字）与 `.debugButton[data-primary='true']:hover` 的 `filter: brightness(.96)`。

**违反后果**：换令牌时调试页不跟随，两处观感漂移。

## 索引

### 类 → 作用

| 选择器 | 作用 | 什么时候读 |
|---|---|---|
| `html[data-debug='on'] .appFrame` | 把 `--app-sidebar-width` 提到 436px | 调调试页输入区宽度时 |
| `.appBrandAction` | 品牌区的可点暗示与焦点环（与 `.appBrand` 组合使用，见 §规则「品牌区用组合类」） | 改品牌区交互提示时 |
| `.debugLink` | 顶栏「组件库」链接（与 `.debugButton` 组合使用）：`text-decoration: none`，`:hover` 一并归零 | 改顶栏入口、或看到链接带下划线时 |
| `.debugPane` / `.debugSection` / `.debugSectionHead` / `.debugSectionTitle` / `.debugSectionHint` | 左侧输入区的纵向排布与分节标题 | 改输入区结构时 |
| `.debugTextarea`（含 `[data-auto='true']`） | 两个 JSON 输入框；`frameAuto` 时用更沉的底色区分"会被覆盖" | 改输入框外观、或区分自动生成内容时 |
| `.debugSamples` / `.debugActions` / `.debugButton`（含 `[data-primary]` / `[data-compact]` / `:disabled`） | 用例胶囊、按钮行与按钮基元 | 加按钮、调用例外观时 |
| `.debugStatus` / `.debugError` / `.debugNote` | 状态栏、输入校验错误条、分节说明 | 改状态栏或错误提示外观时 |
| `.debugPreviewBar` / `.debugBadge` | 预览区顶部的依据提示条与「event 通道 / frame 通道」胶囊 | 改预览条内容与观感时 |
| `.debugHero` / `.debugHeroTitle` / `.debugHero code` | 空态提示（无条目且无流式文本时） | 改空态文案排版时 |

### 引入位置

`main.tsx` 的引入链现在是：

```ts
tokens → frame → composer → cards → modal → bgm → content → debug
```

`debug.css` 排在最后：它只消费令牌，不参与 `--dsw-*` / `--dsh-*` 的重定向，所以位置不影响 `bgm.css` 的"后定义覆盖先定义"。改这一条链时同步 [readme.md](readme.md) §规则「引入顺序是契约（`main.tsx`）」与 [../page/main-page.md](../page/main-page.md) §规则「样式引入顺序在 `main.tsx` 固定」。

### 章节 → 场景

| 章节 | 什么时候读 |
|---|---|
| §规则「只新增 `debug*` 前缀的类」 | 加调试页的样式类时 |
| §规则「`html[data-debug='on']` 是唯一的作用域」 | 想让某条规则只在调试页生效时 |
| §规则「不得覆写既有组件的类」 | 想改 `.appFrame` / `.appStage*` 等既有类时 |
| §规则「品牌区用组合类 `appBrandAction`」 | 改品牌区样式、或想给既有组件类加属性时 |
| §规则「顶栏「组件库」链接用组合类 `debugLink`」 | 改顶栏入口、或疑惑链接为什么复用 `.debugButton` 时 |
| §规则「宽度覆盖只改 `--app-sidebar-width` 这一条」 | 调侧栏宽度、遇到折叠态异常时 |
| §规则「颜色与尺寸一律走令牌」 | 需要新颜色或尺寸时 |
| §索引「引入位置」 | 加样式文件、调换引入顺序时 |
