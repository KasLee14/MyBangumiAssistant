# utils：主界面逻辑

> 覆盖 `web/src/page/mainPage/utils/` ｜ 核对 2026-10-11

## 功能介绍

`web/src/page/mainPage/utils/` 是主界面**页面专有**的逻辑，与 `web/src/utils/`（跨页面通用工具，见 [../../utils.md](../../utils.md)）的分工是「谁消费它」：只被主界面消费的放这里。

两个文件都只输出**展示用文案或分档**，且都被同一件事的多个入口共用：目录里没有请求、没有持久化，是纯函数。

## 索引

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `relativeTime.ts` | `relativeTimeLabel(modified, now)` 与 `sessionDayGroup(modified, now)`：会话的相对时间文案与日历日分档（<1 分钟「刚刚」、<1 小时「N分钟」、<1 天「N小时」、<30 天「N天」、<365 天「N个月」，更久「N年」） | `web/src/page/mainPage/utils/relativeTime.ts` | 改时间分档或文案 |
| `credentialLabel.ts` | `AUTH_LABEL`：提供方凭据来源（`runtime` / `environment` / `stored` / `none`）到中文说明的唯一映射，类型为 `Record<ProviderOptionView['authSource'], string>` | `web/src/page/mainPage/utils/credentialLabel.ts` | 改「已保存在本机」这类措辞 |

## 规则

### 单一真相源

**1. 展示文案只有一处判定。**

- **规则**：`relativeTimeLabel` / `sessionDayGroup` 同时服务侧栏常驻列表与 `/sessions` 弹窗，`AUTH_LABEL` 同时服务模型弹窗与设置弹窗；调用方只把结果放进对应元素（如 `<span className="appNavMeta">`），不在组件内重写判定或文案。
- **为什么**：同一件事的两个入口显示同一句话。抄成两份后，「刚刚」与「1 分钟」的界线、以及「已保存在本机」这类措辞迟早分叉。
- **后果**：用户在两个入口看到不同的时间档或说法，会据此以为其中一处是过期状态。

### 副作用位置

**2. 时刻由调用方取一次传进来。**

- **规则**：两个函数都接收 `now` 参数，自己不调 `Date.now()`；调用方在一屏内只取**一个**时刻，传给该屏所有行。
- **为什么**：相邻两行各取一次时刻，页面渲染耗时会把它们推进不同的时间档，「刚刚」与「1 分钟」会在同一屏里同时出现。
- **后果**：列表刷新时出现两行时间互相矛盾，且只在渲染慢的机器上偶发，很难复现。
