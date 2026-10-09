import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { SessionManager, type AgentSessionRuntime } from '@earendil-works/pi-coding-agent';
import { AppError } from '../support/errors.js';
import type { CatalogView, SessionOptionView } from './protocol.js';
import { WebInteractionChannel, WebSession, type WebSessionOptions } from './session.js';

interface SessionRecord {
  runtime: AgentSessionRuntime;
  channel: WebInteractionChannel;
  web: WebSession;
  unsubscribe: () => void;
}

function inside(root: string, path: string): boolean {
  const child = relative(root, path);
  return child !== '' && child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child);
}

export interface WebSessionManagerOptions extends Omit<WebSessionOptions, 'runtime' | 'channel'> {
  initial: { runtime: AgentSessionRuntime; channel: WebInteractionChannel };
  createRuntime(sessionManager: SessionManager, channel: WebInteractionChannel): Promise<AgentSessionRuntime>;
}

/** 执行生命周期属于会话，浏览器仅选择查看对象；同一会话始终复用一个运行时。 */
export class WebSessionManager {
  private readonly records = new Map<string, SessionRecord>();
  private readonly opening = new Map<string, Promise<WebSession>>();
  private readonly creating = new Set<Promise<WebSession>>();
  private readonly views = new Map<string, string>();
  private readonly selections = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private readonly initialId: string;
  private clients = 0;
  private closing = false;
  private disposal: Promise<void> | undefined;
  private _revision = 0;

  constructor(private readonly options: WebSessionManagerOptions) {
    this.initialId = options.initial.runtime.session.sessionId;
  }

  async start(): Promise<void> {
    await this.add(this.options.initial.runtime, this.options.initial.channel);
  }

  get revision(): number { return this._revision; }
  private emit(): void { this._revision++; for (const listener of this.listeners) listener(); }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private async add(runtime: AgentSessionRuntime, channel: WebInteractionChannel): Promise<WebSession> {
    const web = new WebSession({ ...this.options, runtime, channel });
    channel.attach(web);
    try {
      await web.start();
      if (this.closing) throw new AppError('WEB_CLOSED', 'Web 服务正在关闭。');
    } catch (error) {
      await web.dispose();
      await runtime.dispose();
      throw error;
    }
    const record = { runtime, channel, web, unsubscribe: web.subscribe(() => this.emit()) };
    this.records.set(web.id, record);
    channel.setClients(this.clients);
    this.emit();
    return web;
  }

  get(id: string): WebSession {
    const record = this.records.get(id);
    if (!record) throw new AppError('SESSION_NOT_FOUND', '该会话尚未打开或已失效，请重新选择会话。');
    return record.web;
  }

  selected(clientId: string): WebSession { return this.get(this.views.get(clientId) ?? this.initialId); }
  hasView(clientId: string): boolean { return this.views.has(clientId); }

  setClients(count: number): void {
    this.clients = count;
    // 后台确认仍可由已连接的浏览器处理；切换视图不会关闭交互通道。
    for (const record of this.records.values()) record.channel.setClients(count);
  }

  forgetClient(clientId: string): void {
    this.views.delete(clientId);
    this.selections.delete(clientId);
  }

  sessions(clientId: string, selectedId = this.selected(clientId).id): SessionOptionView[] {
    return [...this.records.values()].map(({ web }) => ({ ...web.summary(), current: web.id === selectedId }));
  }

  async catalog(clientId: string, id?: string): Promise<CatalogView> {
    const selected = id ? this.get(id) : this.selected(clientId);
    const catalog = await selected.catalog();
    const sessions = new Map(catalog.sessions.map(session => [session.id, { ...session, current: session.id === selected.id }]));
    for (const live of this.sessions(clientId, selected.id)) sessions.set(live.id, { ...sessions.get(live.id), ...live });
    return { ...catalog, sessions: [...sessions.values()] };
  }

  /** 连续点击只让最后一次选择生效，加载中的会话也不会被重复创建。 */
  async select(clientId: string, action: 'new' | 'resume', target?: { id?: string; path?: string }): Promise<void> {
    if (this.closing) throw new AppError('WEB_CLOSED', 'Web 服务正在关闭。');
    const selection = (this.selections.get(clientId) ?? 0) + 1;
    this.selections.set(clientId, selection);
    let web: WebSession;
    if (action === 'new') {
      const sessionManager = this.options.initial.runtime.session.sessionManager.isPersisted()
        ? SessionManager.create(this.options.cwd, this.options.sessionDir)
        : SessionManager.inMemory(this.options.cwd);
      const channel = new WebInteractionChannel();
      web = await this.create(sessionManager, channel);
    } else if (target?.id && this.records.has(target.id)) {
      web = this.get(target.id);
    } else {
      if (!target?.path) throw new AppError('SESSION_NOT_FOUND', '请选择有效的历史会话。');
      const root = resolve(this.options.sessionDir);
      const path = resolve(target.path);
      if (!inside(root, path)) throw new AppError('INVALID_INPUT', '只能打开本工作目录的会话。');
      const active = [...this.records.values()].find(record => record.web.file && relative(record.web.file, path) === '');
      if (active) web = active.web;
      else {
        let pending = this.opening.get(path);
        if (!pending) {
          pending = this.open(path, root);
          this.opening.set(path, pending);
          void pending.finally(() => { this.opening.delete(path); }).catch(() => {});
        }
        web = await pending;
      }
    }
    if (this.selections.get(clientId) === selection && !this.closing) {
      this.views.set(clientId, web.id);
      this.emit();
    }
  }

  private async open(path: string, root: string): Promise<WebSession> {
    const canonicalRoot = await realpath(root);
    const canonicalPath = await realpath(path);
    if (!inside(canonicalRoot, canonicalPath)) throw new AppError('INVALID_INPUT', '只能打开本工作目录的会话。');
    const sessionManager = SessionManager.open(canonicalPath, this.options.sessionDir);
    if (relative(sessionManager.getCwd(), this.options.cwd) !== '') throw new AppError('INVALID_INPUT', '只能打开本工作目录的会话。');
    const existing = this.records.get(sessionManager.getSessionId());
    if (existing) return existing.web;
    // 以文件中的稳定身份去重，Windows 大小写或别名路径不能创建第二个写入方。
    const key = sessionManager.getSessionId();
    const pending = this.opening.get(key);
    if (pending) return pending;
    const channel = new WebInteractionChannel();
    const created = this.create(sessionManager, channel);
    this.opening.set(key, created);
    void created.finally(() => { this.opening.delete(key); }).catch(() => {});
    return created;
  }

  private create(sessionManager: SessionManager, channel: WebInteractionChannel): Promise<WebSession> {
    const pending = this.options.createRuntime(sessionManager, channel).then(runtime => this.add(runtime, channel));
    this.creating.add(pending);
    void pending.finally(() => { this.creating.delete(pending); }).catch(() => {});
    return pending;
  }

  notifySettingsChange(): void {
    for (const record of this.records.values()) record.web.notifySettingsChange();
  }

  async refreshLogin(): Promise<void> {
    await Promise.all([...this.records.values()].map(record => record.web.refreshLogin()));
  }

  dispose(): Promise<void> {
    this.disposal ??= this.close();
    return this.disposal;
  }

  private async close(): Promise<void> {
    this.closing = true;
    this.setClients(0);
    await Promise.allSettled([...this.opening.values(), ...this.creating]);
    const results = await Promise.allSettled([...this.records.values()].map(async record => {
      record.unsubscribe();
      await record.web.dispose();
      await record.runtime.session.abort();
      await record.runtime.dispose();
    }));
    this.records.clear();
    this.views.clear();
    this.listeners.clear();
    const failed = results.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }
}
