# 会话相对时间（`utils/relativeTime.ts`）

## 简介

历史会话右侧那格「最后对话时间」的分档表：为什么单独成文件、六档的边界、与 dsh 的对齐关系，以及改动规则。

同一句话出现在**两个**入口：

- `components/mainPage/shell/Sidebar.tsx`：侧栏常驻的历史会话列表；
- `components/dialog/SessionDialog.tsx`：`/sessions` 弹窗。

放在任一组件里都会让另一处复制一份，措辞随后漂移——与 [`credentialLabel.ts`](credentialLabel.md) 同一个理由。**判据是"功能类别 + 两个调用方"，不是行数。**

对齐的是 **dsh Web 界面的中文词条**（`@deepseek-ai/dsh-client-ui-primitives` 的 `relativeTime(at, now)` 判定 + `time.now` / `time.minutes` … 文案）。本文件把"判定"与"文案"合成一个函数，因为 web 侧没有本地化表。

**不覆盖**：轮次数（`messageCount`）的展示与协议字段（见 §规则「这里只算时间」）。

上层：[readme.md](readme.md)。

## 使用说明

- **改档位边界或措辞前先读 §规则**：分档必须照 dsh 走；自己发明会让同一个会话在 web 终端与 dsh 里显示两套时间。
- **只想查某一档的边界与文案、或函数签名与异常返回值**：直接查 §索引 的六档表与 `BUCKETS`／`relativeTimeLabel`，不必通读本文。
- 想把这点代码合并进组件、或觉得两个入口各写一份也行时：先读 §简介 里「同一句话出现在**两个**入口」那两段。
- 本层通用规则（无组件无 hook、不复制协议类型、错误只抛出、文案集中）见 [readme.md](readme.md) 的 §规则；本篇只写专属规则。

## 规则

### 分档对齐 dsh，不自己发明

改边界前先确认 dsh 那边也改了。

**违反后果**：同一个会话在 web 终端与 dsh 里显示两套时间。

### `limit` 必须递增、末档 `Infinity`

`find` 依赖它必然命中。

### `now` 由调用方注入

调用方在组件体里取一次 `Date.now()` 传给所有行，不在这里取 `Date.now()`。

**违反后果**：同一屏的多行各取一次时钟，相邻两行可能落在不同档上。

### 增删档位只改 `BUCKETS`

新增档位或改单位词都在 `BUCKETS` 里完成，不在组件里写 `if`。判定与文案同表，两个组件的代码都不用动。

### 不要照抄 pi TUI 的 `formatSessionDate()`

（`pi/packages/coding-agent/src/modes/interactive/components/session-selector.ts`）：那是终端里的 `now` / `5m` / `3h` / `2d` / `4mo` / `1y` 简写，与 Web 的「5分钟」「3小时」不是同一套措辞。分档边界两者一致，文案不一致。

### 取整、夹到 0、解析失败返回空串

- 入参 `modified` 是协议 `SessionOptionView.modified`，宿主用 `info.modified.toISOString()` 下发（见 `bangumi/src/web/session.ts`），这里 `Date.parse` 后比差值；
- 数量一律 `Math.floor`（`59分59秒` 显示 `59分钟`）；
- `now - modified` 为负（宿主与浏览器时钟不同步）时夹到 0，即「刚刚」，与 dsh 的 `Math.max(0, …)` 一致；
- 时间串解析不出来时返回空串——那格留空，不伪造「刚刚」。

### 这里只算时间

不读 store、不发请求、不碰轮次数。`messageCount` 不再出现在列表右侧，但仍在侧栏行的悬停提示里（`path · 绝对时间 · N 条消息`），所以协议字段不动。

## 索引

### 六档与对齐

| 距现在（`now - modified`） | 文案 | dsh 的桶 |
|---|---|---|
| < 1 分钟（含未来时间） | `刚刚` | `now` |
| < 1 小时 | `N分钟` | `minutes` |
| < 1 天 | `N小时` | `hours` |
| < 30 天 | `N天` | `days` |
| < 365 天 | `N个月` | `months` |
| 其余 | `N年` | `years` |

### `BUCKETS` 与 `relativeTimeLabel`

```ts
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const BUCKETS: readonly TimeBucket[] = [
  { limit: MINUTE, unit: 0, word: '刚刚' },
  { limit: HOUR, unit: MINUTE, word: '分钟' },
  { limit: DAY, unit: HOUR, word: '小时' },
  { limit: 30 * DAY, unit: DAY, word: '天' },
  { limit: 365 * DAY, unit: 30 * DAY, word: '个月' },
  { limit: Infinity, unit: 365 * DAY, word: '年' },
];

export function relativeTimeLabel(modified: string, now: number): string
```

### 章节 → 场景

| 章节 | 什么时候读 |
|---|---|
| §分档对齐 dsh，不自己发明 | 改档位边界、加语言时 |
| §`limit` 必须递增、末档 `Infinity` | 增删档位时 |
| §`now` 由调用方注入 | 改调用方取时钟的位置时 |
| §增删档位只改 `BUCKETS` | 增删档位、调措辞时 |
| §不要照抄 pi TUI 的 `formatSessionDate()` | 想参考终端版措辞时 |
| §取整、夹到 0、解析失败返回空串 | 看签名、异常返回值与取整方式时 |
| §这里只算时间 | 想在列表里加轮次数或读 store 时 |
| §六档与对齐、§`BUCKETS` 与 `relativeTimeLabel` | 查某一档的边界、文案或 dsh 桶名时 |
