import type { RootState } from './reducers';

/* ---------------------------------------------------------------- 会话流 */

export const selectStream = (state: RootState) => state.stream;
export const selectItems = (state: RootState) => state.stream.items;
/**
 * 屏幕上的流式正文。
 *
 * 读的是**显示投影**而不是权威值：上游以突发批次下发，权威值一帧就能长出十几个字，
 * 摊平由 `store/pacing.ts` 负责（理由与代价见该文件）。`selectHeroPhase` 仍看权威值——
 * 「这一轮还没结束」由宿主的事实决定，与显示进度无关。
 */
export const selectDisplayedContent = (state: RootState) => state.stream.displayedContent;

/**
 * 是否处于**收尾播放**：流式已经结束，但屏幕上的字还没播完。
 *
 * 此时历史条目里已经有同一段回答，必须让流式区独占显示，否则屏幕上会同时出现两份
 * （见 `Stage` 的 `pacedTail`）。
 */
export const selectPacedTail = (state: RootState): boolean =>
  state.stream.liveContent.length === 0 && state.stream.displayedContent.length > 0;
export const selectLiveThinking = (state: RootState) => state.stream.liveThinking;
export const selectBusy = (state: RootState) => state.stream.busy;
export const selectPending = (state: RootState) => state.stream.pending;
export const selectPendingEcho = (state: RootState) => state.stream.pendingEcho;

/* ---------------------------------------------------------------- 目录 */

export const selectModels = (state: RootState) => state.catalog.models;
export const selectSessions = (state: RootState) => state.catalog.sessions;
export const selectProviders = (state: RootState) => state.catalog.providers;
export const selectCommands = (state: RootState) => state.catalog.commands;
export const selectCanPersistCredentials = (state: RootState) => state.catalog.canPersistCredentials;

/* ---------------------------------------------------------------- 界面 */

export const selectSettingsOpen = (state: RootState) => state.ui.settingsOpen;
export const selectSettingsPane = (state: RootState) => state.ui.settingsPane;
/** 设置弹窗此刻该渲染哪一屏——退场动画期间仍指向最后显示过的那一屏（见 `reducers/ui.ts`）。 */
export const selectLastSettingsPane = (state: RootState) => state.ui.lastSettingsPane;
export const selectSessionsOpen = (state: RootState) => state.ui.sessionsOpen;
export const selectCollapsed = (state: RootState) => state.ui.collapsed;
export const selectReveal = (state: RootState) => state.ui.reveal;
export const selectNotice = (state: RootState) => state.ui.notice;
export const selectProblem = (state: RootState) => state.ui.problem;

/**
 * 首屏引导：完全空且空闲时才显示。
 *
 * 只要已有条目（含通知、命令回显）或正在流式输出，就必须进入会话视图，否则
 * 扩展命令结果与系统提示会被首屏遮住。
 */
export const selectHeroPhase = (state: RootState): boolean =>
  state.stream.items.length === 0
  && !state.stream.busy
  && state.stream.liveContent.length === 0
  && !state.stream.liveThinking
  && state.stream.pendingEcho === null;

/** 设置行显示的提供方：没有显式选择时回落到目录里的当前提供方。 */
export const selectCredentialProvider = (state: RootState): string =>
  state.ui.credentialProvider
  ?? state.catalog.providers.find(provider => provider.current)?.id
  ?? state.catalog.providers[0]?.id
  ?? '';
