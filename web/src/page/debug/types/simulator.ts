import type { ServerEvent } from '../../../types/protocol';

/** 与宿主 `server.ts` 发出的帧、`store/reducers/stream.ts` 的 `StreamFrame` 同形。 */
export type SimFrame = Extract<ServerEvent, { type: 'state' }>;

/** event 载荷：按 `handleEvent` 用到的字段声明，不引入 Pi 的完整类型。 */
export type SimEvent = Record<string, unknown> & { type: string };
