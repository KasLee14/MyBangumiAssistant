import type { CatalogView } from '../../../bangumi/src/web/protocol';
import type { CatalogAction } from './reducers/catalog';
import type { PendingEcho, StreamAction, StreamFrame } from './reducers/stream';
import type { SettingsPane, UiAction } from './reducers/ui';

/** 全部 action 由根 reducer 定义；这里转出，调用方从 actions 取即可。 */
export type { AppAction } from './reducers';

/* ---------------------------------------------------------------- 会话流 */

export const frameReceived = (frame: StreamFrame): StreamAction => ({ type: 'stream/frame', frame });
export const streamFatal = (message: string): StreamAction => ({ type: 'stream/fatal', message });
export const connectionChanged = (connected: boolean): StreamAction => ({ type: 'stream/connected', connected });
export const pendingEchoSet = (echo: PendingEcho): StreamAction => ({ type: 'stream/pendingEchoSet', echo });
export const pendingEchoCleared = (): StreamAction => ({ type: 'stream/pendingEchoClear' });
/** 某条确认的应答请求已发出；`answerSettled` 与它配对，用于解禁按钮。 */
export const answerStarted = (id: string): StreamAction => ({ type: 'stream/answerStarted', id });
export const answerSettled = (id: string): StreamAction => ({ type: 'stream/answerSettled', id });

/* ---------------------------------------------------------------- 目录 */

export const catalogLoaded = (catalog: CatalogView): CatalogAction => ({ type: 'catalog/loaded', catalog });

/* ---------------------------------------------------------------- 界面 */

export const noticeSet = (message: string | null): UiAction => ({ type: 'ui/notice', message });
export const problemSet = (message: string | null): UiAction => ({ type: 'ui/problem', message });
export const settingsOpened = (pane: SettingsPane | null): UiAction => ({ type: 'ui/settingsOpened', pane });
export const settingsClosed = (): UiAction => ({ type: 'ui/settingsClosed' });
export const sessionsOpened = (): UiAction => ({ type: 'ui/sessionsOpened' });
export const sessionsClosed = (): UiAction => ({ type: 'ui/sessionsClosed' });
export const collapsedSet = (collapsed: boolean): UiAction => ({ type: 'ui/collapsedSet', collapsed });
export const collapsedToggled = (): UiAction => ({ type: 'ui/collapsedToggled' });
export const revealIncremented = (): UiAction => ({ type: 'ui/revealIncremented' });
export const credentialProviderSet = (provider: string): UiAction => ({ type: 'ui/credentialProviderSet', provider });
