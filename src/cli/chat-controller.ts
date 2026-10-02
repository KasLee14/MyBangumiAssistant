import type { AppConfig, AppPaths } from '../config/config.js';
import { policyFor } from '../config/proxy.js';
import type { LanguageModel, Message } from '../core/types.js';
import type { AgentEvent } from '../core/events.js';
import { CandidateState, type CandidateSet } from '../core/candidates.js';
import type { OperationPlan } from '../core/operations.js';
import { OperationCoordinator } from '../core/operations.js';
import { ReadAgent } from '../core/agent.js';
import { ScopedConversation } from '../core/scoped-conversation.js';
import { SessionLog } from '../storage/session.js';
import { OperationJournal } from '../storage/operations.js';
import { DialogueTools } from '../tools/dialogue-tools.js';
import { DialogueCommands, selectionDisplay } from './dialogue.js';
import type { BangumiWriteClient } from '../adapters/bgm-cli/write-client.js';
import { BgmOperationExecutor } from '../adapters/bgm-cli/executor.js';
import { McpOperationExecutor } from '../adapters/mcp/operation-executor.js';
import type { McpCallClient } from '../adapters/mcp/client.js';
import { AppError, safeError } from '../domain/errors.js';
import { displayText, toolLabel } from './ui/format.js';
import type { LoginPrompt } from '../adapters/bangumi-login/login.js';

export type LoginState =
  | { kind: 'checking' }
  | { kind: 'signed-in'; accountId: number; username: string }
  | { kind: 'signed-out' }
  | { kind: 'unverified'; accountId?: number; username?: string; message: string };
export function loginText(login: LoginState): string {
  if (login.kind === 'signed-in') return `当前Bangumi用户：${displayText(login.username).replace(/\s+/g, ' ')}`;
  if (login.kind === 'signed-out') return '当前未登录Bangumi账号';
  if (login.kind === 'checking') return '正在检查Bangumi登录状态';
  return login.username ? `当前Bangumi用户：${displayText(login.username).replace(/\s+/g, ' ')}（登录状态待核实）` : 'Bangumi登录状态待核实';
}
export interface HeaderInfo { modelName: string; modelLabel: string; sessionId: string; login: LoginState }
export type TranscriptItem =
  | { id: number; kind: 'header'; header: HeaderInfo; compact?: boolean }
  | { id: number; kind: 'user' | 'assistant' | 'notice' | 'error'; text: string }
  | { id: number; kind: 'activity'; name: string; ok: boolean; detail: string }
  | { id: number; kind: 'candidates'; set: CandidateSet }
  | { id: number; kind: 'plan'; plan: OperationPlan };
export interface ChatState extends HeaderInfo {
  credentialPrompt: { id: number; kind: 'email' | 'password' } | null;
  ready: boolean; busy: boolean; cancelling: boolean; startedAt: number; status: string;
  items: readonly TranscriptItem[]; liveText: string; candidates: CandidateSet | null;
  selectionQuestion: { setId: string; text: string } | null;
  pending: OperationPlan | null; previewAcknowledged: boolean; focus: string | null; unknownOperations: number;
}
interface ClosableModel extends LanguageModel { close?(): Promise<void> }
export interface ChatDependencies {
  config: AppConfig; paths: AppPaths; client: BangumiWriteClient;
  mcp?: McpCallClient;
  createModel(name: string): ClosableModel;
  /** 仅交给界面账户 ID 和用户名，不交给界面组件 Token 或保护后的凭据。 */
  loadLogin(): Promise<{ accountId: number; username: string } | null>;
  /** 登录输入不走对话；保存会话后仅返回账户 ID 和用户名。 */
  login(signal: AbortSignal, notice: (message: string) => void, prompt: LoginPrompt, manual: boolean): Promise<{ id: number; username: string }>;
  signal: AbortSignal;
}
export const CHAT_HELP = `可以直接输入作品名称、“第一项”“确认执行”或“取消”。
/help       查看帮助
/login      本地邮箱、隐藏密码与浏览器人机验证
/login --manual  使用本地验证码辅助页，不经上游托管服务
/status     查看 Bangumi 登录状态、当前模型、代理信息和会话ID
/model      打开模型菜单；/model 名称 切换配置
/sessions   打开历史会话菜单
/resume ID  恢复已完成对话，旧预览和授权失效
/new        新建会话
/details    显示/收起本轮工具与计划标识
/select 完整条目名     选择作品（也支持 [清单ID] 编号）
/confirm 预览ID        确认当前已展示的具体变更
/reject 预览ID         拒绝变更
/exit       退出
Enter 发送，Ctrl+J 换行；支持的终端也可用 Shift+Enter。
运行时 Esc / Ctrl+C 停止本轮；空闲时两次 Ctrl+C 退出。
明确单项直接执行，复杂项先具体预览确认；未知结果先核对网站。`;

/** 界面编排仅连接现有宿主交互，不把按键或模型文本变成额外授权。 */
export class ChatController {
  private state: ChatState;
  private readonly listeners = new Set<() => void>();
  private sequence = 0;
  private history: Message[] = [];
  private log!: SessionLog;
  private tools!: DialogueTools;
  private commands!: DialogueCommands;
  private conversation!: ScopedConversation;
  private model: ClosableModel | undefined;
  private round: AbortController | undefined;
  private active: Promise<void> | undefined;
  private textTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly countedUnknown = new Set<string>();
  private readonly lifetime = new AbortController();
  private closed = false;
  private inputSequence = 0;
  private loginInput: { id:number; resolve:(value:string)=>void } | undefined;
  private loginPromptHandler: LoginPrompt | undefined;

  constructor(private readonly deps: ChatDependencies, name: string, private readonly resumeId?: string) {
    if (!Object.hasOwn(deps.config.models, name)) throw new AppError('INVALID_INPUT', '指定的模型配置不存在。');
    this.state = { ready: false, modelName: name, modelLabel: deps.config.models[name]!.model, sessionId: '', login: { kind: 'checking' },
      busy: false, cancelling: false, startedAt: 0, status: '正在准备会话', items: [], liveText: '', candidates: null,
      pending: null, previewAcknowledged: false, focus: null, unknownOperations: 0, credentialPrompt: null, selectionQuestion: null };
  }
  setLoginPrompt(handler:LoginPrompt):void { this.loginPromptHandler = handler; }
  submitLoginInput(id:number,value:string):void {
    if(this.loginInput?.id !== id)return;
    const request=this.loginInput;this.loginInput=undefined;request.resolve(value);
  }
  private requestLoginInput:LoginPrompt = async (kind,signal)=>{
    signal.throwIfAborted();const id=++this.inputSequence;
    this.update({credentialPrompt:{id,kind},status:kind === 'email' ? '请输入 Bangumi 登录邮箱' : '请输入 Bangumi 密码（隐藏输入）'});
    try {
      if(this.loginPromptHandler)return await this.loginPromptHandler(kind,signal);
      return await new Promise<string>((resolve,reject)=>{
        const abort=()=>{this.loginInput=undefined;reject(new AppError('CANCELLED','登录已取消。'));};
        this.loginInput={id,resolve:value=>{signal.removeEventListener('abort',abort);resolve(value);}};
        signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
      });
    } finally {this.loginInput=undefined;this.update({credentialPrompt:null});}
  };
  snapshot = (): ChatState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<ChatState>): void { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  private add(item: TranscriptItem extends infer T ? T extends TranscriptItem ? Omit<T, 'id'> : never : never): void {
    this.update({ items: [...this.state.items, { ...item, id: ++this.sequence } as TranscriptItem] });
  }
  notify(text: string): void { this.add({ kind: 'notice', text: displayText(text) }); }
  private header(): HeaderInfo {
    return { modelName: this.state.modelName, modelLabel: this.state.modelLabel, sessionId: this.state.sessionId, login: this.state.login };
  }
  async initialize(): Promise<void> {
    await this.replaceSession(this.resumeId);
    await this.refreshLogin(AbortSignal.any([this.deps.signal,this.lifetime.signal]));
    this.add({ kind: 'header', header: this.header() });
    if (this.resumeId) this.restoreTranscript();
    this.update({ ready: true, status: this.state.selectionQuestion ? '等待选择作品' : '就绪' });
  }
  private async replaceSession(id?: string): Promise<void> {
    const log = new SessionLog(this.deps.paths.sessions, id);
    const history = id ? await log.messages() : [];
    const journal = new OperationJournal(this.deps.paths.sessions, log.id);
    const recovery = id ? await journal.states() : new Map();
    const unknown = [...recovery.values()].filter(state => state === 'started' || state === 'unknown').length;
    this.commands?.resetRequests();
    this.log = log; this.history = history;
    const phase = (phase: 'writing' | 'verifying', subjectId: number) => this.update({ status:
      `${phase === 'writing' ? '正在提交变更' : '正在回读验证'} #${subjectId}${this.state.cancelling ? '（停止后核查）' : ''}` });
    const fallback = new BgmOperationExecutor(this.deps.client, 350, phase);
    this.tools = new DialogueTools(this.deps.client, new OperationCoordinator(journal,
      this.deps.mcp ? new McpOperationExecutor(this.deps.client, this.deps.mcp, fallback, phase) : fallback), {
      candidates: set => { this.flushText(); this.add({ kind: 'candidates', set }); this.update({ candidates: set }); },
      plan: plan => this.receivePlan(plan),
    }, this.deps.mcp);
    this.commands = new DialogueCommands(this.tools, log);
    this.tools.hydrate(history);
    this.attachModel(this.state.modelName);
    this.countedUnknown.clear();
    this.update({ sessionId: log.id, liveText: '', pending: null, previewAcknowledged: false,
      candidates: this.tools.candidates.snapshot().sets.at(-1) ?? null,
      selectionQuestion: this.tools.awaitingSelection(),
      focus: this.tools.candidates.current()?.title ?? null, unknownOperations: unknown });
    if (id) this.notify(`恢复仅采用已完成对话；旧预览和授权已失效。历史未知操作：${unknown}，不会自动重试。`);
  }
  private attachModel(name: string): void {
    this.model ??= this.deps.createModel(name);
    this.conversation = new ScopedConversation(this.model, new ReadAgent(this.model, this.tools, this.log, this.deps.config.maxSteps),
      this.tools, this.commands, this.log);
  }
  private restoreTranscript(): void {
    for (let index = 0; index < this.history.length; index++) {
      const message = this.history[index]!;
      if ((message.role === 'user' || message.role === 'assistant') && message.content) {
        const candidates = new CandidateState(); candidates.restore(this.history.slice(0,index));
        this.add({ kind: message.role, text: displayText(message.role === 'user' ? selectionDisplay(message.content,candidates) : message.content) });
      }
    }
  }
  selectCandidate(selection: { setId: string; subjectId: number }): Promise<void> {
    const set = this.tools.candidates.snapshot().sets.at(-1);
    const index = set?.items.findIndex(item => item.id === selection.subjectId) ?? -1;
    if (!set || set.id !== selection.setId || index < 0) { this.notify('选择已过期，请使用当前候选清单。'); return Promise.resolve(); }
    return this.submit(`/select ${set.id} ${index+1}`);
  }
  async refreshLogin(signal: AbortSignal): Promise<void> {
    this.update({ login: { kind: 'checking' } });
    let saved: { accountId: number; username: string } | null;
    try { saved = await this.deps.loadLogin(); }
    catch (error) {
      const info = safeError(error);
      this.update({ login: info.code === 'BGM_AUTH_INVALID' ? { kind: 'signed-out' } : { kind: 'unverified', message: info.message } }); return;
    }
    if (!saved) { this.update({ login: { kind: 'signed-out' } }); return; }
    try {
      const user = await this.deps.client.currentUser(AbortSignal.any([signal, AbortSignal.timeout(8000)]));
      if (user.id !== saved.accountId) throw new AppError('ACCOUNT_CHANGED', '本机登录和网站账户不一致，请重新登录。');
      this.update({ login: { kind: 'signed-in', accountId: user.id, username: user.username } });
    } catch (error) {
      const info = safeError(error);
      this.update({ login: /^(BGM_AUTH|BGM_HTTP_401)/.test(info.code)
        ? { kind: 'signed-out' } : { kind: 'unverified', accountId: saved.accountId, username: saved.username, message: info.message } });
    }
  }
  private receivePlan(plan: OperationPlan): void {
    this.flushText(); this.add({ kind: 'plan', plan });
    if (plan.state === 'pending') this.update({ pending: plan, previewAcknowledged: false });
    else this.update({ pending: null, previewAcknowledged: false });
    if (plan.results && !this.countedUnknown.has(plan.id)) {
      this.countedUnknown.add(plan.id);
      this.update({ unknownOperations: this.state.unknownOperations + plan.results.filter(result => result.state === 'unknown').length });
    }
  }
  /** Renderer 在完整预览写入终端之后调用；仅此处登记本次实际展示。 */
  acknowledgePlan(id: string, digest: string): void {
    const plan = this.state.pending;
    if (!plan || plan.id !== id || plan.digest !== digest) return;
    if (this.tools.operations.get(id).state !== 'pending') return;
    this.commands.presented(plan); this.update({ previewAcknowledged: true });
  }
  private onEvent = (event: AgentEvent): void => {
    if (event.type === 'model/start') this.update({ status: event.stage === 'scope' ? '正在判断任务范围' : '正在生成回答' });
    else if (event.type === 'tool/start') { this.flushText(); this.update({ status: toolLabel(event.name) }); }
    else {
      this.add({ kind: 'activity', name: event.name, ok: event.ok, detail: event.error?.message ?? '完成' });
      if (event.error && /^(BGM_AUTH|BGM_HTTP_401)/.test(event.error.code)) this.update({ login: { kind: 'signed-out' } });
    }
  };
  private appendText = (text: string): void => {
    this.state = { ...this.state, liveText: this.state.liveText + text };
    if (!this.textTimer) this.textTimer = setTimeout(() => { this.textTimer = undefined; this.update({}); }, 40);
  };
  private flushText(): void {
    if (this.textTimer) { clearTimeout(this.textTimer); this.textTimer = undefined; }
    const text = displayText(this.state.liveText);
    this.update({ liveText: '' });
    if (text.trim()) this.add({ kind: 'assistant', text });
  }
  submit(input: string): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (!this.state.ready || this.state.busy) { this.notify('当前操作尚未结束，请保留草稿，结束后再发送。'); return Promise.resolve(); }
    if (!input.trim()) return Promise.resolve();
    if (input.length > 8000) { this.notify('输入最多8000字，请缩短后发送。'); return Promise.resolve(); }
    if (/^(?:\/confirm\b|确认|确认执行|执行吧|可以执行)/.test(input.trim()) && this.state.pending && !this.state.previewAcknowledged) {
      this.notify('具体预览还在展示，请待完整展示后再确认。'); return Promise.resolve();
    }
    this.round = new AbortController();
    this.update({ busy: true, cancelling: false, startedAt: Date.now(), status: '正在处理', liveText: '' });
    this.active = this.perform(displayText(input), AbortSignal.any([this.deps.signal, this.round.signal,this.lifetime.signal]));
    return this.active;
  }
  private async perform(input: string, signal: AbortSignal): Promise<void> {
    try {
      if (await this.localCommand(input.trim(), signal)) return;
      try {
        const saved = await this.deps.loadLogin();
        if (!saved) this.update({login:{kind:'signed-out'}});
        else if (this.state.login.kind === 'signed-out' || 'accountId' in this.state.login && this.state.login.accountId !== saved.accountId) await this.refreshLogin(signal);
      } catch(error) {
        const info=safeError(error); this.update({login:info.code === 'BGM_AUTH_INVALID' ? {kind:'signed-out'} : {kind:'unverified',message:info.message}});
      }
      signal.throwIfAborted();
      this.add({ kind: 'user', text: displayText(selectionDisplay(input,this.tools.candidates)) });
      // 新轮次的界面不继续显示旧确认选项；宿主自行判断确认或重新规划。
      this.update({ pending: null, previewAcknowledged: false, candidates: null, selectionQuestion: null });
      const result = await this.conversation.run(input, this.history, { signal, onText: this.appendText, onEvent: this.onEvent });
      this.history = result.messages;
      this.flushText();
      const pending = this.state.pending;
      if (pending && this.tools.operations.get(pending.id).state !== 'pending') this.update({ pending: null, previewAcknowledged: false });
      this.update({ focus: this.tools.candidates.current()?.title ?? null, candidates: this.tools.candidates.snapshot().sets.at(-1) ?? null });
    } catch (error) {
      this.flushText(); const info = safeError(error);
      this.add({ kind: signal.aborted ? 'notice' : 'error', text: signal.aborted ? '本轮已停止；已发送的变更以回读结果及操作记录为准。' : `[${info.code}] ${info.message}` });
      this.commands.resetRequests(); this.update({ pending: null, previewAcknowledged: false });
      this.update({candidates:this.tools.candidates.snapshot().sets.at(-1) ?? null,focus:this.tools.candidates.current()?.title ?? null});
    } finally {
      this.flushText();
      if (signal.aborted) { this.commands.resetRequests(); this.update({ pending: null, previewAcknowledged: false }); }
      this.round = undefined;
      const selectionQuestion = this.tools.awaitingSelection();
      this.update({ busy: false, cancelling: false, selectionQuestion, status: this.state.pending ? '等待确认'
        : selectionQuestion ? '等待选择作品' : '就绪' });
    }
  }
  private async localCommand(input: string, signal: AbortSignal): Promise<boolean> {
    if (input === '/help') { this.notify(CHAT_HELP); return true; }
    if (input === '/login' || input === '/login --manual') {
      this.commands.resetRequests();
      this.update({ pending: null, previewAcknowledged: false, status: '正在准备 Bangumi 邮箱登录' });
      this.notify('接下来输入登录邮箱与隐藏密码，再在浏览器完成人机验证。登录输入不进入聊天或模型；旧预览和未完成修改已失效。Esc / Ctrl+C 取消。');
      try {
        const user = await this.deps.login(signal, message => {
          this.update({ status: message }); this.notify(message);
        }, this.requestLoginInput, input.endsWith('--manual'));
        this.update({ login: { kind: 'signed-in', accountId: user.id, username: user.username } });
        this.notify(`Bangumi 登录成功，当前用户：${user.id}。API 账户已核实，本机登录已加密保存。`);
        this.add({ kind: 'header', header: this.header(), compact: true });
      } catch (error) {
        const info = safeError(error);
        this.notify(signal.aborted || info.code === 'WEB_LOGIN_CANCELLED' || info.code === 'CANCELLED'
          ? '登录已取消，原有本机登录保留；可以继续聊天。'
          : `登录未完成：[${info.code}] ${info.message} 原有本机登录保留，可用 /login 重试。`);
      }
      return true;
    }
    if (input === '/status') {
      this.update({ status: '正在核实 Bangumi 登录状态' });
      await this.refreshLogin(signal);
      const { login } = this.state;
      const proxy = policyFor(this.deps.config.proxyPolicy ?? this.deps.config.proxy);
      const account = login.kind === 'signed-in' ? `已登录（用户 ID：${login.accountId}；本次 API 会话核实通过）`
        : login.kind === 'signed-out' ? '未登录或登录已失效；输入 /login 登录'
          : login.kind === 'unverified' ? `待核实${login.accountId ? `（本机保存的用户 ID：${login.accountId}）` : ''}；${login.message}`
            : '正在核实';
      this.notify([
        '当前状态（/status）',
        `Bangumi 登录：${account}`,
        `当前模型：${this.state.modelLabel}`,
        `代理信息：${proxy.https ?? proxy.http ?? '直连'}`,
        `完整会话 ID：${this.state.sessionId}（/resume ID 恢复）`,
      ].join('\n')); return true;
    }
    if (input === '/sessions') { this.notify((await this.sessions()).map(id => `${id}${id === this.state.sessionId ? '（当前）' : ''}`).join('\n') || '暂无历史会话。'); return true; }
    if (input === '/model') { this.notify(Object.entries(this.deps.config.models).map(([name, model]) => `${name} → ${model.model}`).join('\n')); return true; }
    const model = /^\/model\s+(\S+)$/.exec(input);
    if (model) {
      const name = model[1]!;
      if (!Object.hasOwn(this.deps.config.models, name)) throw new AppError('INVALID_INPUT', '指定的模型配置不存在。');
      const next = this.deps.createModel(name);
      await this.model?.close?.(); this.model = next; this.commands.resetRequests();
      this.update({ modelName: name, modelLabel: this.deps.config.models[name]!.model, pending: null, previewAcknowledged: false });
      this.attachModel(name); this.add({ kind: 'header', header: this.header(), compact: true }); return true;
    }
    const resume = /^\/resume\s+(\S+)$/.exec(input);
    if (input === '/new' || resume) {
      await this.replaceSession(resume?.[1]); this.add({ kind: 'header', header: this.header(), compact: true });
      if (resume) this.restoreTranscript(); return true;
    }
    return false;
  }
  async sessions(): Promise<string[]> { return SessionLog.list(this.deps.paths.sessions); }
  models(): { name: string; label: string }[] { return Object.entries(this.deps.config.models).map(([name, model]) => ({ name, label: model.model })); }
  cancel(): void {
    if (!this.round || this.state.cancelling) return;
    this.update({ cancelling: true, status: '正在停止；已发出的变更会先核查结果' }); this.round.abort();
  }
  async close(): Promise<void> {
    if (this.closed) { await this.active; return; }
    this.closed = true; this.cancel(); this.lifetime.abort(); await this.active;
    if (this.textTimer) clearTimeout(this.textTimer); await this.model?.close?.();
  }
}
