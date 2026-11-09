# types：调试页类型

> 覆盖 `web/src/page/debug/types/` ｜ 核对 2026-10-11

## 功能介绍

`web/src/page/debug/types/` 放调试页专有的形状：模拟帧与 event 载荷。帧类型**不在这里定义**，而是从宿主协议里取。

## 索引

本目录只有模拟帧与 event 载荷一处（见 [index.md](index.md) 的「按场景分流」）。

| 文件 | 含义 | 路径 | 场景 |
|---|---|---|---|
| `simulator.ts` | `SimFrame`（`Extract<ServerEvent, { type: 'state' }>`，与宿主 `bangumi/src/web/server.ts` 发出的帧、`web/src/store/reducers/stream.ts` 的 `StreamFrame` 同形）与 event 载荷类型（按 `handleEvent` 用到的字段声明，不引入 Pi 的完整类型） | `web/src/page/debug/types/simulator.ts` | 改模拟帧或 event 载荷的形状 |

## 规则

### 单一真相源

**1. 帧类型从宿主协议取，不另立一份。**

- **规则**：`SimFrame` 用 `Extract<ServerEvent, { type: 'state' }>` 从 [../../types.md](../../types.md) 的协议转发里取，不在本目录手写帧的字段；event 载荷只声明 `handleEvent` 实际用到的字段。
- **为什么**：模拟帧的全部意义是「与真实帧同形」。照抄一份字段后，协议变更时这里不会报错，模拟出的帧却已与真实帧错位。
- **后果**：调试页照常能跑，但它验证的对象已经不是真实帧的形状，据此得出的结论不可信。
