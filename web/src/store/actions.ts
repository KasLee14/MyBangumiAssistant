import type { CatalogView, MessageBlock, SessionOptionView } from '../../../bangumi/src/web/protocol';
import type { CatalogAction } from './reducers/catalog';
import type { PendingEcho, StreamAction, StreamDeltaFrame, StreamFrame } from './reducers/stream';
import type { SettingsPane, UiAction } from './reducers/ui';

/** 全部 action 由根 reducer 定义；这里转出，调用方从 actions 取即可。 */
export type { AppAction } from './reducers';

/* ---------------------------------------------------------------- 会话流 */

export const frameReceived = (frame: StreamFrame): StreamAction => ({ type: 'stream/frame', frame });
/**
 * 流式增量帧：只带正文与思考的追加部分。
 *
 * 与 `frameReceived` 的分工是「自愈」与「高频」的分离——全量帧负责任何接不上的情况，
 * 增量帧负责流式期的每一帧，见 `protocol.ts` 的 `StreamDeltaView`。
 */
export const deltaReceived = (frame: StreamDeltaFrame): StreamAction => ({ type: 'stream/delta', frame });
/** 摊平显示推进一格；`content` 由 `store/pacing.ts` 按帧算出。 */
export const pacedUpdated = (content: MessageBlock[]): StreamAction => ({ type: 'stream/paced', content });
/** 摊平播完（目标已追上且流式已结束）：清空显示区，屏幕交回历史条目。 */
export const pacedDone = (): StreamAction => ({ type: 'stream/pacedDone' });
export const streamFatal = (message: string): StreamAction => ({ type: 'stream/fatal', message });
export const connectionChanged = (connected: boolean): StreamAction => ({ type: 'stream/connected', connected });
export const pendingEchoSet = (echo: PendingEcho): StreamAction => ({ type: 'stream/pendingEchoSet', echo });
export const pendingEchoCleared = (): StreamAction => ({ type: 'stream/pendingEchoClear' });
/** 某条确认的应答请求已发出；`answerSettled` 与它配对，用于解禁按钮。 */
export const answerStarted = (id: string): StreamAction => ({ type: 'stream/answerStarted', id });
export const answerSettled = (id: string): StreamAction => ({ type: 'stream/answerSettled', id });

/* ---------------------------------------------------------------- 目录 */

export const catalogLoaded = (catalog: CatalogView): CatalogAction => ({ type: 'catalog/loaded', catalog });
export const sessionsUpdated = (sessions: SessionOptionView[]): CatalogAction => ({ type: 'catalog/sessions', sessions });
export const switchingSet = (switching: boolean): UiAction => ({ type: 'ui/switching', switching });
/** 草稿按会话保存：`draftSet` 覆盖，`draftRestored` 只在草稿仍为空时写回（乐观发送的失败回滚）。 */
export const draftSet = (sessionId: string, text: string): UiAction => ({ type: 'ui/draft', sessionId, text });
export const draftRestored = (sessionId: string, text: string): UiAction => ({ type: 'ui/draftRestore', sessionId, text });

/* ---------------------------------------------------------------- 界面 */

export const noticeSet = (message: string | null): UiAction => ({ type: 'ui/notice', message });
export const problemSet = (message: string | null): UiAction => ({ type: 'ui/problem', message });
export const settingsOpened = (pane: SettingsPane | null): UiAction => ({ type: 'ui/settingsOpened', pane });
export const settingsClosed = (): UiAction => ({ type: 'ui/settingsClosed' });
export const sessionsOpened = (): UiAction => ({ type: 'ui/sessionsOpened' });
export const sessionsClosed = (): UiAction => ({ type: 'ui/sessionsClosed' });
export const collapsedSet = (collapsed: boolean): UiAction => ({ type: 'ui/collapsedSet', collapsed });
export const collapsedToggled = (): UiAction => ({ type: 'ui/collapsedToggled' });
/** 置顶 / 取消置顶：状态在 `ui.pinned`，落盘由 store 的订阅负责（纯前端本地状态）。 */
export const pinnedToggled = (sessionId: string): UiAction => ({ type: 'ui/pinnedToggled', sessionId });
export const revealIncremented = (): UiAction => ({ type: 'ui/revealIncremented' });
/**
 * 展开/折叠过程区的一条。
 *
 * 键的形态见 `UiState.processOpen`：`` `${turn}` `` 是整轮过程，`` `${turn}:${step}` `` 是
 * 单个思考行或工具行。
 */
export const processToggled = (key: string, open: boolean): UiAction => ({ type: 'ui/processToggled', key, open });
export const credentialProviderSet = (provider: string): UiAction => ({ type: 'ui/credentialProviderSet', provider });
