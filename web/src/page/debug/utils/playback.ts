import { DEBUG_INSTANCE_ID } from '../constants/simulator';
import type { SimEvent, SimFrame } from '../types/simulator';

/**
 * 调试页的输入解析与播放参数。
 *
 * 两件事放同一个文件，是因为它们是一次预览的前后两端：`parseInputs` 把两个输入框收敛成
 * 「一条 event 批次」或「一帧」，随后的节奏常量决定这一帧怎么演出来。播放动作本身
 * （定时器、在途令牌、setState）留在壳组件里——它要持有播放中的状态，不是纯逻辑。
 */

/** 每个动画片段提交的字符数与间隔：对应宿主 40ms 一帧的观感。 */
export const CHARS_PER_TICK = 1;
export const TICK_MS = 24;
/** 一次播放的片段预算：整段控制在约 1.4 秒，长文本自动加大每片段的字符数。 */
export const PLAY_BUDGET_TICKS = 60;

export interface ParsedInput {
  /** 一个 flush 窗口内的若干 event：单个对象也归一成一项数组。 */
  events?: SimEvent[];
  frame?: SimFrame;
  error: string | null;
}

/**
 * 解析两个输入框；event 非空时忽略 frame（已确认：以 event 为准）。
 *
 * event 框接受两种写法，对应宿主的两种观察口径：
 * - **单个对象**：一条 `AgentSessionEvent`；
 * - **数组**：一个 flush 窗口内的若干事件（宿主 `server.ts` 每 40ms 把窗口内的改动合并成
 *   一帧下发），预览时按批次合并成一帧，见 `simulator.ts` 的 `applyEvents`。
 *
 * 数组必须非空，且逐项是带非空 `type` 的对象；报错指明是第几项，免得在一长串 JSON 里找。
 */
export function parseInputs(eventText: string, frameText: string): ParsedInput {
  const eventRaw = eventText.trim();
  const frameRaw = frameText.trim();

  if (eventRaw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(eventRaw);
    } catch (cause) {
      return { error: `event 不是合法 JSON：${cause instanceof Error ? cause.message : String(cause)}` };
    }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    if (list.length === 0) return { error: 'event 数组不能为空。' };
    const events: SimEvent[] = [];
    for (const [index, item] of list.entries()) {
      const where = Array.isArray(parsed) ? `event 数组第 ${index + 1} 项` : 'event';
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        return { error: `${where}必须是一个 JSON 对象。` };
      }
      const type = (item as { type?: unknown }).type;
      if (typeof type !== 'string' || !type) return { error: `${where}缺少 type 字段。` };
      events.push(item as SimEvent);
    }
    return { events, error: null };
  }

  if (frameRaw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(frameRaw);
    } catch (cause) {
      return { error: `frame 不是合法 JSON：${cause instanceof Error ? cause.message : String(cause)}` };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { error: 'frame 必须是一个 JSON 对象。' };
    }
    const frame = parsed as Partial<SimFrame>;
    if (frame.type !== 'state') return { error: 'frame 的 type 必须是 "state"。' };
    if (!Array.isArray(frame.items)) return { error: 'frame 缺少 items 数组。' };
    if (!frame.state || typeof frame.state !== 'object') return { error: 'frame 缺少 state 标量对象。' };
    return {
      frame: {
        type: 'state',
        instanceId: frame.instanceId ?? DEBUG_INSTANCE_ID,
        revision: frame.revision ?? 0,
        full: frame.full ?? true,
        items: frame.items,
        state: frame.state,
      },
      error: null,
    };
  }

  return { error: '请先填入 event 或 frame。' };
}
