import type { TranscriptItemView } from "./protocol.js";

/**
 * custom 消息（Pi 的 `role: "custom"`）到会话内容条目的通用映射。
 *
 * 为什么需要它：Pi 已有把结构化内容注入会话的公开通道——扩展调用
 * `ctx.sendMessage({ customType, content, display, details })`，coding-agent 把它落成
 * `CustomMessageEntry`，并连发一对 `message_start` / `message_end`。本模块只做一件事：
 * 把 `customType` 当作条目 kind、`details` 当作载荷原样透传，**不持有任何 kind 清单，
 * 也不知道每种 kind 的载荷字段名**。宿主因此不必随注册表增长而改动，而
 * `session.ts` 的两条路径（事件与重建）与浏览器侧调试模拟器
 * （`web/src/page/debug/simulator.ts`）共用同一份映射，不会各自漂移。
 *
 * 三条约定（由下发方遵守，宿主不校验）：
 * 1. `customType` 是前端注册表登记的 kind 名（如 `infobox`）；
 * 2. `details` 是**带载荷字段名的包装**，例如 `{ info: { rows: [...] } }`——字段名由协议定义
 *    （见 `protocol.ts` 与前端 `registry.tsx` 的 `field`），所以宿主不需要那张表；
 * 3. `display` 为 true 才进入会话界面；false 的消息只走模型上下文（Pi 的既有语义）。
 *
 * Pi 的既有行为：`content` 会被 `convertToLlm` 转成 user 消息进入模型上下文，`details`
 * 不会。因此结构化数据一律走 `details`，`content` 只放一句人类可读的摘要。
 *
 * 本模块只允许 `import type`（编译与打包后不产生任何运行时依赖）：宿主用 NodeNext
 * 解析 `./protocol.js`，浏览器侧的 Vite 打包根本看不到这条 import。
 */

/** 逐成员去掉字段：普通 `Omit` 会把联合类型塌缩成一个只含公共属性的对象。 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** 条目草稿：`id` 由调用方分配、`version` 由 `push` 维护，这里只描述内容。 */
export type ContentItemDraft = DistributiveOmit<TranscriptItemView, "id" | "version">;

/**
 * 映射只需要这三个字段。
 *
 * 两处调用点都能满足：事件里的 custom 消息有 `customType` / `display` / `details`，
 * 落盘重建时的 `custom_message` 条目有同样的三个字段（少了 `role`，所以这里不看 role）。
 */
export interface CustomContentSource {
  readonly customType?: unknown;
  readonly display?: unknown;
  readonly details?: unknown;
}

/**
 * 把一条 custom 消息（或重建时的 `custom_message` 条目）映射成内容条目草稿；
 * 不属于「要展示的结构化内容」时返回 undefined。
 *
 * 判定条件刻意只有三条，且都不涉及具体 kind：`display` 为 true、`customType` 是非空字符串、
 * `details` 是对象。载荷形状是否合法交给前端接收侧校验（`web/src/components/content/validate.ts`）
 * ——那里是唯一知道每种 kind 形状的地方，宿主提前判一遍只会多出第二份真相。
 */
export function customContentDraft(
  source: CustomContentSource,
): ContentItemDraft | undefined {
  if (source.display !== true) return undefined;
  const kind = source.customType;
  if (typeof kind !== "string" || kind.length === 0) return undefined;
  const details = source.details;
  if (typeof details !== "object" || details === null || Array.isArray(details))
    return undefined;
  // 这里的断言与前端 `registry.tsx` 的 `rendererOf` 同性质：判别式联合无法表达「按 kind
  // 索引的形状」，而 `details` 的内容来自运行时（扩展下发），编译期无从证明。安全性由
  // 接收侧校验兜住。`kind` 放在展开之后，确保它不会被 details 里的同名字段改写。
  return { ...details, kind } as ContentItemDraft;
}
