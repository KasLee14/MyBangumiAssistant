# 外观版本用例（`V`）

## 使用说明

### 这份文档是什么

v1（旧版）/ v2（新版）两套外观的用例（`V1`–`V10`）：切换与持久化、两版的作用域契约、
「切换不重连宿主」、v1 零改动、v2 的 DOM 契约与动效约束、以及客户端特有的一条
「内容条目不得被动画卡成不可见」。

前提与判定约定见 [readme.md](readme.md)。这一组是**两版共存**的回归，动
`page/mainPage/*`、`components/v2/**`、`components/motion/**`、`styles/v2/**`、
`store/reducers/ui.ts` 的 `variant`、或共享组件（`Modal`、`StatsDock`）时必跑。

### 怎么读（用例段 → 场景）

| 用例段 | 什么时候跑 |
|---|---|
| `V1`–`V2`（切换与持久化） | 动切换按钮、`ui.variant`、持久化键时 |
| `V3`（切换不重连宿主） | 动 `page/mainPage/index.tsx` 的订阅位置或分流时 |
| `V4`（v1 零改动） | **改了任何共享组件后必跑**（`Modal`、`StatsDock`、`MessageParts`、`content/**`） |
| `V5`–`V6`（v2 作用域与 DOM 契约） | 动 v2 的类名、层级、作用域属性时 |
| `V7`（内容条目可见性） | 动 `TurnV2` 的 `AnimatedContent` 用法或滚动容器 id 时（**最容易静默失败的一条**） |
| `V8`–`V9`（动效约束与降级） | 加动效、改令牌、改 `BorderGlow`/`TextType` 参数时 |
| `V10`（两版功能一致） | 大改动后收尾跑一次 |

### 必须遵守的规则

本组通用规则见 [readme.md](readme.md) 的「必须遵守的规则」。本篇专属：

1. **`V3` 必须看 Network 而不只看界面**：切换外观时若重新请求 `./api/events` 或目录，
   即使界面看起来正常也算失败——那是重连宿主，不是换外观。
2. **`V4` 要两版都验**：只测 v2 通过不算通过，「共享组件加可选 prop 不影响 v1」必须
   在 v1 下实测。
3. **`V7` 必须在真实会话里跑**，且要滚动到内容条目所在位置；只在 hero 或纯文本会话里
   跑等于没跑。
4. **`V8` 的「无循环动画」按计算样式判定**，不靠肉眼：常驻动画会让界面持续合成，
   在低配机器上表现为掉帧，肉眼看不出但确实存在。

## V1 切换按钮与两版切换

**前置**：任意版本下打开页面。

**步骤**：点击顶栏的 `旧版` / `新版` 两个按钮。

**预期**
- 两个按钮常驻在顶栏右侧（设置按钮左边），当前项 `data-active="true"`、`aria-pressed="true"`；
- 滑块位置随 `data-variant` 移动（`data-variant="v2"` 时 `translateX(100%)`）；
- 点击后整棵外壳切换，且**没有整页刷新**（`.uiVariantToggle` 节点不被替换成新文档）。

**判定**
```js
const t = document.querySelector('.uiVariantToggle');
({ variant: t.dataset.variant, active: [...t.querySelectorAll('.uiVariantOption')].map(b => b.dataset.active) })
// 切到 v2 后
document.querySelector('.v2Frame') !== null && document.querySelector('.frame') === null
document.documentElement.dataset.ui === 'v2'
```

## V2 选择持久化

**步骤**：切到 `新版` → 刷新页面（F5）。

**预期**：刷新后仍是 v2；`localStorage` 的 `bangumi.uiVariant` 为 `v2`。

**判定**
```js
localStorage.getItem('bangumi.uiVariant')          // 'v2'
document.documentElement.dataset.ui                // 'v2'（首帧就已带上，不闪无样式骨架）
document.querySelector('.v2Frame') !== null
```

**反向（默认值）**：**默认是新版**，因此
- 清掉该键（`localStorage.removeItem('bangumi.uiVariant')`）后刷新 → 应得到 **v2**；
- 把该键改成一个非法值（如 `'v9'`）后刷新 → 同样应回落 **v2**，而不是白屏。

```js
localStorage.removeItem('bangumi.uiVariant'); location.reload();
// reload 后：
document.querySelector('.v2Frame') !== null && localStorage.getItem('bangumi.uiVariant') === null
```

## V3 切换外观不重连宿主（关键）

**步骤**
1. 打开 DevTools 的 Network 面板，过滤 `events`；
2. 在 v1 与 v2 之间来回切 3 次。

**预期**
- **不产生新的 `./api/events` 请求**（SSE 订阅不重建）；
- 不重新请求 `./api/catalog`（目录不重取）；
- 会话区已加载的消息在切换前后**内容一致**（不是重新拉回来的）。

**判定**
```js
// 切换前后各读一次即可，两者必须相等
document.querySelectorAll('.v2Turn').length
document.querySelector('.v2SessionRow[data-current="true"]')?.dataset.current   // v1 用 .sessionRow.selected
```

**为什么**：四个生命周期订阅留在 `page/mainPage/index.tsx`（薄壳）而不是某一版外壳里，
就是为了这条。把它们下移进外壳会让每次换外观都真重连一次宿主。

## V4 v1 零改动（共享组件后必跑）

**步骤**：切到 `旧版`，检查外壳、消息区与一个弹窗（顶栏设置）。

**预期**
- `<html>` 上**没有** `data-ui` 属性；DOM 里**没有**任何 `v2*` 类名，也没有
  `.border-glow-card`、`.text-type`；
- 弹窗的遮罩与表面是**原生 `DIV` / `SECTION`**，`style` 属性为空、`transform: none`；
- 关闭弹窗后 `.modalOverlay` **立即消失**（没有退出过渡延迟）。

**判定**
```js
document.documentElement.dataset.ui === undefined
document.querySelector('[class^="v2"],[class*=" v2"]') === null
// 打开设置弹窗后：
const o = document.querySelector('.modalOverlay'), s = document.querySelector('.modalSurface');
({ overlayTag: o.tagName, overlayStyle: o.getAttribute('style'), surfaceTag: s.tagName, surfaceTransform: getComputedStyle(s).transform })
// → DIV / null / SECTION / none
// 点关闭后立刻（同一帧内）：
document.querySelectorAll('.modalOverlay').length === 0
```

## V5 v2 作用域与切换按钮位置

**步骤**：切到 `新版`。

**预期**
- `document.documentElement.dataset.ui === 'v2'`（**在 `<html>` 上**，不是在子树根节点上——
  统计浮层与弹窗 portal 到 `body`，挂在子树里它们会落在作用域外）；
- 切回 v1 后该属性被**删除**（不是设成空串）。

**判定**
```js
document.documentElement.dataset.ui            // 'v2'
// 展开统计浮层后它也必须落在作用域内：
(() => { document.querySelector('.contextTrigger').click(); return getComputedStyle(document.querySelector('.statsPanel')).backgroundColor; })()
// → rgb(255, 255, 255)（v2 覆写生效）；若为 v1 的材质色说明作用域没覆盖到 portal
```

## V6 v2 会话区 DOM 契约

**前置**：打开一个有消息的会话（非 hero 阶段）。

**预期**（层级必须完整，屏外优化依赖这条链）
```
.v2Stage[data-phase='active'] > .v2StageBody > .v2StageScroll[id='v2-stage-scroll'] > .v2StageFlow > .v2StageColumn > .v2Turn
```
- `.v2Stage` 带 `container-type: inline-size`；
- `.v2StageScroll` 的 `content-visibility` 链命中 `.v2Turn`；
- 输入区在 `.v2Stage` 内、`.v2StageBody` **之后**（`composer` 槽位）。

**判定**
```js
const ok = !!document.querySelector(".v2Stage[data-phase='active'] > .v2StageBody > .v2StageScroll#v2-stage-scroll > .v2StageFlow > .v2StageColumn > .v2Turn");
({ chain: ok, container: getComputedStyle(document.querySelector('.v2Stage')).containerType })
// containerType → 'inline-size'
```

## V7 内容条目不得被入场动画卡成不可见（关键）

**背景**：v2 的内容条目（`.contentBlock`）由 ReactBits 的 `AnimatedContent` 包装，
它的初始内联样式是 `visibility: hidden`，靠 gsap `ScrollTrigger` 进入视口后才改为
`visible`。**一旦 `container` 指向错的滚动容器，元素会永远不可见**——这是这条用例存在
的唯一原因。

**前置**：会话里至少有一条内容条目（条目卡 / 统计 / 进度 / 表格 / 时间线 / 标签云 /
封面墙 / 对比表 / 引用 / 提示条 / 链接列表之一）。

**步骤**
1. 滚动到该条目所在位置；
2. 检查它的**包装元素**（`.contentBlock` 的父元素）的计算样式。

**预期**：进入视口的条目 `visibility: visible`、`opacity` 已到 1、`transform` 无残余位移；
未进入视口的条目可以仍是 `visibility: hidden`（这是正常等待状态）。

**判定**
```js
[...document.querySelectorAll('.contentBlock')].map(b => {
  const w = b.parentElement, cs = getComputedStyle(w), r = w.getBoundingClientRect();
  return {
    inViewport: r.top < innerHeight && r.bottom > 0,
    visibility: cs.visibility,
    opacity: Number(cs.opacity).toFixed(2),
    translateY: cs.transform,
  };
})
// 约束：inViewport === true 的项，visibility 必须是 'visible'
```

## V8 动效存在且无常驻循环动画

**预期**
- 入场类动效只在挂载/进入视口时发生，结束后不残留 `will-change`；
- **没有** `animation-iteration-count: infinite` 的常驻动画，除**流式光标**一处例外
  （它只在流式期间存在，表达「还在写」）；
- `BorderGlow` 的边缘光只在指针附近出现，**不做自动扫光**（`animated={false}`）。

**判定**
```js
// 1) 有没有常驻无限动画
[...document.querySelectorAll('*')].filter(el => {
  const cs = getComputedStyle(el);
  return cs.animationIterationCount.split(',').some(v => v.trim() === 'infinite') && cs.animationName !== 'none';
}).map(el => el.className || el.tagName)
// 期望：空数组；流式进行中最多出现流式光标所在元素
// 2) BorderGlow 不是自动扫光模式
document.querySelector('.border-glow-card').classList.contains('sweep-active') === false
```

## V9 `prefers-reduced-motion` 降级

**步骤**：在系统里开启「减少动态效果」（或 DevTools 的 Rendering 面板模拟
`prefers-reduced-motion: reduce`），刷新后在两版之间切换、展开弹窗。

**预期**
- v1：CSS 过渡与动画被全局禁用（`frame.css` 末尾的 `prefers-reduced-motion` 段）；
- v2：CSS 侧同上；JS 侧由 `ShellV2` 的 `<MotionConfig reducedMotion="user">` 接管，
  位移/缩放类动画退化为仅透明度过渡，**内容仍然全部可见**（不能因为动画被跳过而不显示）。

**判定**
```js
matchMedia('(prefers-reduced-motion: reduce)').matches   // 开启后为 true
// v2 下弹窗仍能正常打开，且表面可见：
getComputedStyle(document.querySelector('.modalSurface')).opacity   // '1'
```

## V10 两版功能一致

**步骤**：在同一会话里，分别用 v1 与 v2 各做一遍下列操作。

| 操作 | 两版都必须 |
|---|---|
| 输入 `/help` 并回车 | 弹出同一条提示（文案一致），输入框清空 |
| 输入文字后按 Esc / ↑↓ / Tab | 命令补全的键盘行为一致（↑↓ 选中、Tab 补全、Esc 关候选） |
| 打开设置 → 切到模型行 → 关闭 | 弹窗内容与动作一致，关闭语义一致 |
| 点顶栏折叠按钮 | 侧栏在两版都收放（v2 是列宽 + 文字透明度过渡） |
| 长会话滚动 | 贴底跟随便新内容；向上滚后不再强制拉回底部；轮次导航高亮随滚动更新（v2 在 `.v2Rail`） |

**判定**：两版逐项对照，结论必须一致；任一版独有的行为差异都算失败。

**提示**：这一条是「功能一致由数据来源保证」的验收——两版共用同一份 store，
所以差异只可能来自外壳实现，而不会来自数据。
