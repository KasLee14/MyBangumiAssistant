import type {
  LoginInputPayload,
  ProxyPayload,
  SessionOptionView,
  ThinkingLevelName,
} from '../../../bangumi/src/web/protocol';
import {
  answerConfirmation,
  cancelLogin,
  cancelRound,
  clearCredential as clearCredentialRequest,
  fetchCatalog,
  logout,
  selectModel as selectModelRequest,
  selectSession,
  selectThinkingLevel as selectThinkingLevelRequest,
  startLogin,
  submitCredential,
  submitInput,
  submitLoginInput,
  submitProxy,
  rememberSession,
} from '../utils/api';
import { helpText, type CommandHint } from '../utils/commands';
import {
  catalogLoaded,
  collapsedToggled,
  credentialProviderSet,
  noticeSet,
  pendingEchoSet,
  problemSet,
  revealIncremented,
  sessionsClosed,
  sessionsOpened,
  settingsClosed,
  settingsOpened,
  frameReceived,
  switchingSet,
} from './actions';
import type { AppStore } from './index';
import type { SettingsPane } from './reducers/ui';

const message = (error: unknown): string => (error instanceof Error ? error.message : '请求失败。');

// 不同组件各有动作门面，但目录请求序号必须按同一个store共享。
const catalogRequests = new WeakMap<AppStore, number>();
const selectionRequests = new WeakMap<AppStore, number>();

/**
 * 界面可发起的全部动作。
 *
 * 组件只描述「发生了什么」，请求、错误提示与状态写入都在这里完成：失败要么变成
 * 一条全局提示并抛出（调用方负责回滚本地输入），要么只提示（本地命令类动作）。
 */
export interface Actions {
  /* 目录与会话 */
  loadCatalog(): Promise<void>;
  send(input: string): Promise<void>;
  optimisticSend(input: string): Promise<void>;
  newSession(): Promise<void>;
  resumeSession(session: SessionOptionView): Promise<void>;
  pickSession(session: SessionOptionView): void;

  /* 弹窗与布局 */
  openSettings(pane: SettingsPane | null): Promise<void>;
  openSessions(): Promise<void>;
  openCredentialPane(provider: string): void;
  switchPane(pane: SettingsPane): void;
  closePane(): void;
  closeSettings(): void;
  closeSessions(): void;
  toggleSidebar(): void;

  /* 会话内的本地命令与确认 */
  localCommand(command: CommandHint): void;
  confirm(id: string): void;
  reject(id: string): void;
  stopRound(): void;

  /* 模型、线路与登录 */
  applyCredential(provider: string, key: string, persist: boolean): Promise<void>;
  clearCredential(provider: string): Promise<void>;
  pickModel(provider: string, model: string): Promise<void>;
  pickThinkingLevel(level: ThinkingLevelName, label: string): Promise<void>;
  applyProxy(mode: ProxyPayload['mode'], url?: string): Promise<void>;
  answerLoginInput(payload: LoginInputPayload, done: string): Promise<void>;
  startBangumiLogin(email: string, password: string): Promise<void>;
  cancelBangumiLogin(): void;
  bangumiLogout(): Promise<void>;

  /* 瞬时提示 */
  notice(text: string): void;
  dismissNotice(): void;
  dismissProblem(): void;
}

export function createActions(store: AppStore): Actions {
  const dispatch = store.dispatch;
  const state = () => store.getState();

  /** 提示并抛出：调用方据此回滚本地状态（例如输入框草稿）。 */
  const notifyFailure = (error: unknown): never => {
    dispatch(noticeSet(message(error)));
    throw error;
  };
  /** 只提示不抛：用于「发出即可」的动作，避免无人接管的 rejection。 */
  const notifyOnly = (error: unknown): void => { dispatch(noticeSet(message(error))); };

  const loadCatalog = async (): Promise<void> => {
    const request = (catalogRequests.get(store) ?? 0) + 1;
    catalogRequests.set(store, request);
    const sessionId = state().stream.sessionId;
    const catalog = await fetchCatalog();
    if (catalogRequests.get(store) === request && state().stream.sessionId === sessionId) {
      dispatch(catalogLoaded(catalog));
    }
  };

  /**
   * 提交给宿主。未登记的斜杠命令在这里拦下：输入区不再需要知道命令表。
   */
  const send = (input: string): Promise<void> => {
    if (state().ui.switching || !state().stream.ready) return Promise.reject(new Error('会话正在切换，请稍后发送。'));
    const value = input.trim();
    if (!value) return Promise.resolve();
    if (value.startsWith('/') && !value.includes('\n')) {
      const name = value.split(/\s/, 1)[0]!;
      // 未登记的斜杠命令不拦：宿主可能注册了浏览器还不知道的命令。
      if (state().catalog.commands.some(command => command.value === name) === false) {
        dispatch(problemSet('没有匹配命令，请继续编辑；输入 / 查看命令列表。'));
        return Promise.resolve();
      }
    }
    dispatch(problemSet(null));
    return submitInput(value).catch(notifyFailure);
  };

  /**
   * 乐观回显：先把这条消息挂到界面上，宿主确认（真实的 user 条目出现）后由
   * `stream` reducer 撤下。失败时由输入区回滚草稿。
   */
  const optimisticSend = (input: string): Promise<void> => {
    const text = input.trim();
    if (!text) return Promise.resolve();
    const started = send(input);
    // 斜杠命令不产生对话轮次，回显气泡反而会挡在结果前面。
    if (text.startsWith('/') && !text.includes('\n')) return started;
    dispatch(pendingEchoSet({ text, sessionId: state().stream.sessionId }));
    return started;
  };

  const switchSession = async (session?: SessionOptionView): Promise<void> => {
    const request = (selectionRequests.get(store) ?? 0) + 1;
    selectionRequests.set(store, request);
    dispatch(switchingSet(true));
    dispatch(settingsClosed());
    try {
      const frame = await selectSession(session);
      dispatch(frameReceived(frame));
      rememberSession(state().stream.sessionId);
      await loadCatalog();
    } catch (error) { notifyFailure(error); }
    finally {
      if (selectionRequests.get(store) === request) dispatch(switchingSet(false));
    }
  };
  const newSession = (): Promise<void> => switchSession();
  const resumeSession = (session: SessionOptionView): Promise<void> => switchSession(session);

  const openSettings = async (pane: SettingsPane | null): Promise<void> => {
    // 打开前重取目录，让模型行显示的密钥状态是最新的。
    try { await loadCatalog(); } catch { /* 用已缓存的一份打开，行内值可能略旧。 */ }
    dispatch(settingsOpened(pane));
  };

  const openSessions = async (): Promise<void> => {
    try { await loadCatalog(); } catch { /* 同上。 */ }
    dispatch(sessionsOpened());
  };

  const localCommand = (command: CommandHint): void => {
    switch (command.action) {
      case 'help': dispatch(noticeSet(helpText(state().catalog.commands))); return;
      case 'details': dispatch(revealIncremented()); return;
      case 'exit': dispatch(noticeSet('Web 终端不需要 /exit；直接关闭标签页即可，宿主仍在运行。')); return;
      case 'new': void newSession().catch(() => { /* 失败已提示。 */ }); return;
      case 'model': void openSettings('model'); return;
      case 'sessions': void openSessions(); return;
      default: return;
    }
  };

  return {
    loadCatalog,
    send,
    optimisticSend,
    newSession,
    resumeSession,
    pickSession: session => {
      dispatch(sessionsClosed());
      void resumeSession(session).catch(() => { /* 失败已提示。 */ });
    },

    openSettings,
    openSessions,
    openCredentialPane: provider => {
      dispatch(credentialProviderSet(provider));
      dispatch(settingsOpened('credential'));
    },
    switchPane: pane => { dispatch(settingsOpened(pane)); },
    closePane: () => { dispatch(settingsOpened(null)); },
    closeSettings: () => { dispatch(settingsClosed()); },
    closeSessions: () => { dispatch(sessionsClosed()); },
    toggleSidebar: () => { dispatch(collapsedToggled()); },

    localCommand,
    confirm: id => { void answerConfirmation(id, true).catch(notifyOnly); },
    reject: id => { void answerConfirmation(id, false).catch(notifyOnly); },
    stopRound: () => { void cancelRound().catch(notifyOnly); },

    applyCredential: async (provider, key, persist) => {
      await submitCredential(provider, key, persist);
      dispatch(noticeSet(persist
        ? `已为 ${provider} 保存密钥到本机，重启后仍然生效。`
        : `已为 ${provider} 填入密钥；密钥只用于本次运行。`));
      dispatch(credentialProviderSet(provider));
    },
    clearCredential: async provider => {
      await clearCredentialRequest(provider);
      dispatch(noticeSet(`已清除 ${provider} 保存在本机的密钥。`));
      dispatch(credentialProviderSet(provider));
    },
    pickModel: async (provider, model) => {
      await selectModelRequest(provider, model);
      dispatch(noticeSet(`已切换到 ${provider}/${model}。`));
    },
    pickThinkingLevel: async (level, label) => {
      try {
        await selectThinkingLevelRequest(level);
        dispatch(noticeSet(`思考强度已切换为 ${label}（${level}），并已保存为本机默认。`));
      } catch (error) {
        dispatch(noticeSet(message(error)));
      }
    },
    applyProxy: async (mode, url) => {
      await submitProxy(mode, url);
      dispatch(noticeSet('网络线路已切换，仅本次运行生效。'));
    },
    answerLoginInput: async (payload, done) => {
      await submitLoginInput(payload);
      dispatch(noticeSet(done));
    },
    startBangumiLogin: async (email, password) => {
      await startLogin(email, password);
      dispatch(noticeSet('Bangumi 登录成功。'));
    },
    cancelBangumiLogin: () => { void cancelLogin().catch(() => { /* 已经结束的登录不必再取消。 */ }); },
    bangumiLogout: async () => {
      await logout();
      dispatch(noticeSet('已退出 Bangumi 登录。'));
    },

    notice: text => { dispatch(noticeSet(text)); },
    dismissNotice: () => { dispatch(noticeSet(null)); },
    dismissProblem: () => { dispatch(problemSet(null)); },
  };
}
