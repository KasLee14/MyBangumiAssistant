import type { MessageBlock } from "./protocol.js";

/**
 * 消息内容块的投影：把上游下发的 `content` 快照映射成协议里的 `MessageBlock[]`。
 *
 * 为什么单独成模块：宿主 `session.ts` 的 `handleEvent` / `rebuild` 与浏览器侧的调试
 * 模拟器（`web/src/page/debug/simulator.ts`）必须做**同一件事**——它是 `handleEvent`
 * 的复刻，两边一旦各写一份就会漂移。本模块是纯函数 + 纯数据，只 `import type`，
 * 因此宿主（NodeNext 解析 `./protocol.js`）与浏览器（Vite 打包）可以共用同一份源码。
 *
 * 三条设计原则：
 *
 * 1. **宿主不持有 kind 清单。** 这里只排除 Pi 的原生块（`thinking` / `toolCall` / …），
 *    其余带 `type` 的对象块**原样透传**——宿主既不知道 12 种内容 kind 的名字，也不知道
 *    它们的载荷字段名。形状是否合法由接收侧（`web/src/components/content/validate.ts`）
 *    判定，未知 type 在那里丢弃并告警。好处与 `custom-content.ts` 时代一致：协议将来加
 *    第 13 种块时，宿主侧一个字节都不用改。
 * 2. **块的"出现 / 成长 / 完成"全部由快照表达。** 调用方不需要判别
 *    `assistantMessageEvent.type`（那是上游的事），只要有快照就能投影。
 * 3. **骨架由块自己的 `pending === true` 判定**，没有"缺省即 pending"这回事：
 *    缺省表示"已完成"。否则"上游一次性下发完整块、从不发 pending"会永远停在骨架上，
 *    而这是界面上发现不了的故障。
 */

/**
 * 只描述本模块用到的三个字段。
 *
 * 事件里的 custom 消息与落盘重建时的 `custom_message` 条目都能满足（后者少了 `role`，
 * 所以这里不看 role）。
 */
export interface CustomContentSource {
  readonly customType?: unknown;
  readonly display?: unknown;
  readonly details?: unknown;
}

/**
 * Pi 的原生块类型：它们有各自的承载通道，不进内容块序列。
 *
 * - `thinking` → 流式思考区（`liveThinking`）；
 * - `toolCall` → 工具活动条目（`activity`）；
 * - `image` / `redacted_thinking` / `fallback` → 当前没有展示需求。
 */
const NATIVE_BLOCK_TYPES: ReadonlySet<string> = new Set([
  "thinking",
  "toolCall",
  "image",
  "redacted_thinking",
  "fallback",
]);

/** 已经告警过的未知 type：一轮投影里同一种只报一次，避免刷屏。 */
const warnedTypes = new Set<string>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 投影单个块；不是可渲染的块时返回 undefined（静默丢弃）。
 *
 * `previous` 是**上一帧投影结果的同下标块**，用于结构共享：`partial` 每帧都重新解析，
 * 载荷对象引用必然变，若不做这层复用，文本块每增长一个字都会让所有内容块重新校验、
 * 重新渲染。复用的依据是「`pending` 消失后载荷不再变」这条契约——所以只复用已完成
 * （不带 `pending`）且 `type` 相同的块。
 */
function blockFrom(raw: unknown, previous: MessageBlock | undefined): MessageBlock | undefined {
  if (!isRecord(raw)) return undefined;
  const type = raw["type"];
  if (typeof type !== "string" || type.length === 0) return undefined;
  if (NATIVE_BLOCK_TYPES.has(type)) return undefined;

  if (type === "text") {
    const text = raw["text"];
    if (typeof text !== "string") return undefined;
    if (previous !== undefined && previous.type === "text" && previous.text === text) return previous;
    return { type: "text", text };
  }

  const pending = raw["pending"] === true;
  // 文本块没有 `pending`，所以先把它摘掉再读完成态。
  const previousSettled = previous !== undefined && previous.type !== "text"
    && previous.pending !== true;
  if (previous !== undefined && previous.type === type && previousSettled && !pending) {
    return previous;
  }
  // 原样透传（含 pending 字段本身）。这里的断言是刻意的协议外解析边界：`content` 的
  // 形状来自运行时（上游下发），编译期无从证明；形状合法性由接收侧校验兜住。
  // `type` 放在展开之后，确保它不会被载荷里的同名字段改写。
  return { ...raw, type } as unknown as MessageBlock;
}

/**
 * 从 `content` 快照投影出块数组；不是数组时返回空数组。
 *
 * 被忽略的块（Pi 原生类型、形状不对的项）不占输出下标，因此 `previous` 按**输出下标**
 * 比对——前提是前后两帧的忽略模式一致；不一致时最多退化成重建对象（多渲染一次），
 * 不会错误复用：`blockFrom` 还会比对 `type` 与完成态。
 */
export function blocksFromContent(
  content: unknown,
  previous?: readonly MessageBlock[],
): MessageBlock[] {
  if (!Array.isArray(content)) return [];
  const blocks: MessageBlock[] = [];
  for (const raw of content) {
    const block = blockFrom(raw, previous?.[blocks.length]);
    if (block !== undefined) blocks.push(block);
  }
  return blocks;
}

/**
 * 终态投影：`message_end` 的 assistant 消息。
 *
 * 不做结构共享——流式已经结束，这一次性构造的对象接下来就是历史条目的一部分。
 */
export function blocksFromMessage(message: unknown): MessageBlock[] {
  if (!isRecord(message)) return [];
  return blocksFromContent(message["content"]);
}

/**
 * custom 消息（扩展 `ctx.sendMessage`）→ 单块。
 *
 * 旧通道（顶层内容条目）已经退场，但**这条映射仍然必要**：Pi 把扩展注入的内容落盘为
 * `custom_message` 条目，会话切换或重启后重建历史时要靠它。判定条件只有三条，且都不
 * 涉及具体 kind：`display` 为 true、`customType` 是非空字符串、`details` 是对象；
 * 文本与 Pi 原生块不属于这条通道。
 */
export function customContentBlocks(source: CustomContentSource): MessageBlock[] | undefined {
  if (source.display !== true) return undefined;
  const type = source.customType;
  if (typeof type !== "string" || type.length === 0) return undefined;
  if (type === "text" || NATIVE_BLOCK_TYPES.has(type)) return undefined;
  const details = source.details;
  if (!isRecord(details)) return undefined;
  // 定制组件的块形状统一为 `{ type, pending?, props }`：`details` 就是 `props` 的内容
  // （裸载荷，不再带 `{ info: {…} }` 那样的字段名包装），因此宿主依旧不需要知道任何
  // kind 或字段名。
  return [{ type, props: details } as unknown as MessageBlock];
}

/**
 * 这一批块里有没有值得落条目的内容。
 *
 * 纯空白文本块不算（避免空气泡），内容块一律算——它在 `pending` 期就是一个骨架，
 * 本身就是"这里会有东西"的信号。
 */
export function hasRenderableBlock(blocks: readonly MessageBlock[]): boolean {
  return blocks.some((block) => (block.type === "text" ? block.text.trim().length > 0 : true));
}

/** 开发期告警：把一个未知块 type 报一次（供接收侧调用，宿主投影不报）。 */
export function warnUnknownBlockType(type: string): void {
  if (warnedTypes.has(type)) return;
  warnedTypes.add(type);
  console.warn(`[content] 未登记的内容块 type「${type}」，该块已丢弃。`);
}
