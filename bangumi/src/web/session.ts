import { randomUUID } from "node:crypto";
import { resolve, sep } from "node:path";
import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
  SessionManager,
  type AgentSession,
  type AgentSessionRuntime,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type { InteractionChannel, NoticeType } from "../interaction.js";
import { login, type AccountSessionStore } from "../login/index.js";
import {
  AppError,
  credentialValues,
  redact,
  safeError,
} from "../support/errors.js";
import { policyFor } from "../support/proxy.js";
import { discoverProxy, type ProxyController } from "../support/proxy-controller.js";
import type {
  ActivityItemView,
  CatalogView,
  ChatScalarsView,
  ChatStateView,
  CommandOptionView,
  ConfirmationView,
  ContextUsageView,
  ModelOptionView,
  ProviderOptionView,
  SessionOptionView,
  ThinkingLevelName,
  ThinkingView,
  TokenUsageView,
  TranscriptItemView,
} from "./protocol.js";

/** 单条工具活动与结果细节的最大呈现长度，避免把整份工具输出塞进浏览器。 */
const DETAIL_LIMIT = 4000;

/**
 * 思考强度的中文展示名。
 *
 * 文案在宿主侧生成（浏览器只渲染下发的 label），这样级别名的含义只有一处定义；
 * 浏览器仍会并列显示 Pi 的原始级别名，便于与文档和 `settings.json` 对齐。
 */
const THINKING_LABELS: Record<ThinkingLevelName, string> = {
  off: "关闭",
  minimal: "极简",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最高",
};

/** 把 Pi 的凭据来源归一到协议里的四态；本机存储与 models.json 内联密钥都算 stored。 */
function authSourceOf(status: {
  configured: boolean;
  source?: string;
}): ProviderOptionView["authSource"] {
  if (!status.configured) return "none";
  if (status.source === "runtime") return "runtime";
  if (status.source === "environment") return "environment";
  return "stored";
}

/** 联合类型上逐成员去掉 `version`，让调用点只描述内容，版本由 push 维护。 */
type WithoutVersion<T> = T extends unknown ? Omit<T, "version"> : never;

function messageText(message: AgentMessage): string {
  if (message.role === "user") {
    return typeof message.content === "string"
      ? message.content
      : message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("");
  }
  if (message.role === "assistant") {
    return message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");
  }
  if (message.role === "toolResult") {
    return message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");
  }
  return "";
}

function truncate(text: string): string {
  return text.length > DETAIL_LIMIT
    ? `${text.slice(0, DETAIL_LIMIT)}\n…（已截断）`
    : text;
}

/** 工具结果只在浏览器里作为可折叠细节呈现，这里做保守的文本化。 */
function resultDetail(result: unknown): string {
  if (result === null || result === undefined) return "";
  if (typeof result === "string") return truncate(result);
  if (typeof result === "object") {
    const content = (result as { content?: unknown }).content;
    if (Array.isArray(content)) {
      const text = content
        .map((part) =>
          part &&
          typeof part === "object" &&
          typeof (part as { text?: unknown }).text === "string"
            ? (part as { text: string }).text
            : "",
        )
        .filter(Boolean)
        .join("\n");
      if (text) return truncate(text);
    }
    try {
      return truncate(JSON.stringify(result, null, 2));
    } catch {
      return "";
    }
  }
  return truncate(String(result));
}

/**
 * Web 终端的写入确认与登录输入通道。
 *
 * 先创建通道、再创建 Pi 运行时（扩展需要通道），因此这里用后置绑定：
 * `attach` 之前任何确认请求都应被视为「没有人能回答」。
 */
export class WebInteractionChannel implements InteractionChannel {
  private session: WebSession | undefined;
  private clients = 0;

  attach(session: WebSession): void {
    this.session = session;
  }
  /** 浏览器连接数由服务端维护；没有连接时必须拒绝写入与登录。 */
  setClients(count: number): void {
    this.clients = count;
    this.session?.notifyChannelChange();
  }

  canConfirm(): boolean {
    return this.clients > 0 && this.session !== undefined;
  }
  canLogin(): boolean {
    return this.clients > 0 && this.session !== undefined;
  }

  confirm(
    _ctx: unknown,
    preview: string,
    signal: AbortSignal | undefined,
  ): Promise<boolean> {
    if (!this.session)
      throw new AppError("WEB_UI_UNAVAILABLE", "Web 终端尚未就绪。");
    return this.session.requestConfirmation(preview, signal);
  }

  login(
    _ctx: unknown,
    kind: "email" | "password",
    signal: AbortSignal,
  ): Promise<string> {
    if (!this.session)
      throw new AppError("WEB_UI_UNAVAILABLE", "Web 终端尚未就绪。");
    return this.session.requestLogin(kind, signal);
  }

  notify(_ctx: unknown, message: string, type: NoticeType): void {
    // 协议只有普通提示与错误两种条目，warning 与 error 共用醒目的错误样式。
    this.session?.pushNotice(message, type === "info" ? "notice" : "error");
  }
}

export interface WebSessionOptions {
  runtime: AgentSessionRuntime;
  channel: WebInteractionChannel;
  store: AccountSessionStore;
  cwd: string;
  sessionDir: string;
  /** 运行时代理开关；浏览器可以在本次运行内切换线路。 */
  proxy: ProxyController;
  /** Bangumi 请求超时（毫秒），与终端版登录共用同一个启动参数。 */
  timeoutMs: number;
}

/**
 * 浏览器侧的会话状态。
 *
 * 会话与工具循环完全由 Pi 拥有；这里只做两件事：把 Pi 的事件与消息映射成
 * 浏览器视图，以及把浏览器的命令落到 Pi 的会话 API 上。浏览器从不参与授权
 * 判定，也不接触会话文件与密钥。
 */
export class WebSession {
  private readonly runtime: AgentSessionRuntime;
  private readonly channel: WebInteractionChannel;
  private readonly store: AccountSessionStore;
  private readonly cwd: string;
  private readonly sessionDir: string;
  private readonly proxy: ProxyController;
  private readonly timeoutMs: number;

  private items: TranscriptItemView[] = [];
  private nextItemId = 1;
  /** 进行中的工具活动条目：结束时原地更新同一个对象并递增版本。 */
  private readonly activities = new Map<string, TranscriptItemView>();
  private readonly listeners = new Set<() => void>();
  private unsubscribe: (() => void) | undefined;

  private busy = false;
  private cancelling = false;
  private startedAt = 0;
  private status = "";
  private liveText = "";
  private liveThinking = "";
  private loginText = "Bangumi 登录状态未知。";
  private loginState: "signed-in" | "signed-out" = "signed-out";
  private loginUsername = "";
  /** 显式登录（设置弹窗）的进度：只在状态帧里下发，不产生会话条目。 */
  private loginBusy = false;
  private loginStatus = "";
  private loginAbort: AbortController | null = null;
  /**
   * `login()` 会按 email → password 顺序各要一次输入；这里在第一次提示时就要到
   * 两个值并缓存，第二次直接复用，浏览器因此只看到一个凭据弹窗。
   */
  private loginDraft: { email: string; password: string } | null = null;
  private proxyLabel: string;
  /**
   * 本会话累计 token 消耗与当前上下文占用的缓存。
   *
   * `getSessionStats()` 与 `getContextUsage()` 都要遍历会话条目并构建一次投影，
   * 而状态帧按帧下发、流式期间非常频繁，因此只在会话绑定与轮次结束时重算，其余
   * 时候沿用上一次的结果：流式过程中的数字停在上一轮结束时的值。
   */
  private tokenUsage: TokenUsageView | null = null;
  private contextUsage: ContextUsageView | null = null;

  private pending: {
    view: ConfirmationView;
    settle: (accepted: boolean) => void;
  } | null = null;
  private login: {
    id: number;
    settle: (credentials: { email: string; password: string } | undefined) => void;
    fail: (error: unknown) => void;
  } | null = null;
  private nextLoginId = 1;
  /** 本轮输入是否已经回显，用于避免真实 user 消息重复出现。 */
  private echoPending = false;

  constructor(options: WebSessionOptions) {
    this.runtime = options.runtime;
    this.channel = options.channel;
    this.store = options.store;
    this.cwd = options.cwd;
    this.sessionDir = options.sessionDir;
    this.proxy = options.proxy;
    this.timeoutMs = options.timeoutMs;
    this.proxyLabel = options.proxy.summary;
  }

  /** 绑定扩展交互、订阅事件并载入当前会话的历史。 */
  async start(): Promise<void> {
    this.runtime.setRebindSession(async () => {
      this.bind();
    });
    this.bind();
    await this.refreshLogin();
  }

  /**
   * 切换会话后 Pi 会重建 AgentSession，事件订阅必须跟着换。
   *
   * 这里不重绑扩展的 `uiContext`：本应用的写入确认与登录输入走自己的
   * `InteractionChannel`，扩展命令的全部提示也经通道下发，因此 Pi 默认的
   * 无界面绑定已经足够，浏览器不需要伪造一个终端主题。
   */
  private bind(): void {
    this.unsubscribe?.();
    this.unsubscribe = this.runtime.session.subscribe(this.handleEvent);
    this.activities.clear();
    this.liveText = "";
    this.liveThinking = "";
    this.echoPending = false;
    this.settlePending(false);
    this.rebuild();
    // 切换会话后重新取一次累计：新会话自己的历史也算进来，不残留上一个会话的数字。
    this.recomputeTokenUsage();
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  notifyChannelChange(): void {
    if (!this.channel.canConfirm() && this.pending) this.settlePending(false);
    if (!this.channel.canLogin() && this.login) {
      const request = this.login;
      this.login = null;
      request.fail(new AppError("CANCELLED", "登录已取消：浏览器已断开。"));
      this.emit();
    }
  }

  snapshot(): ChatStateView {
    return { ...this.scalars(), items: [...this.items] };
  }

  private scalars(): ChatScalarsView {
    const session = this.runtime.session;
    const model = session.model;
    return {
      ready: true,
      busy: this.busy,
      cancelling: this.cancelling,
      startedAt: this.startedAt,
      status: this.status,
      modelLabel: model ? `${model.provider}/${model.id}` : "",
      sessionId: session.sessionId,
      sessionName: session.sessionName ?? "",
      thinking: this.thinking(session),
      loginText: this.loginText,
      loginState: this.loginState,
      loginUsername: this.loginUsername,
      proxyLabel: this.proxyLabel,
      proxyMode: this.proxy.mode,
      proxyAddress: this.proxy.addresses,
      tokenUsage: this.tokenUsage,
      contextUsage: this.contextUsage,
      liveText: this.liveText,
      liveThinking: this.liveThinking,
      pending: this.pending?.view ?? null,
      loginPrompt: this.login ? { id: this.login.id } : null,
      loginBusy: this.loginBusy,
      loginStatus: this.loginStatus,
    };
  }

  /**
   * 思考强度视图。
   *
   * 级别清单与「是否支持思考」都问 Pi，浏览器不维护副本：非推理模型只支持
   * `off`，`xhigh`/`max` 还要模型显式声明映射。未选择模型时给空值，浏览器据此
   * 置灰入口，而不是让人点开一个没有意义的菜单。
   *
   * 还没有可用模型（没配凭据）时，Pi 会挂一个 provider/id 都是 `unknown` 的占位
   * 模型；那不算「选了模型」，否则界面会把它说成「当前模型不支持思考」，而真正
   * 的原因是凭据还没配置。
   */
  private thinking(session: AgentSession): ThinkingView {
    const label = (level: ThinkingLevel): string => THINKING_LABELS[level as ThinkingLevelName];
    const model = session.model;
    const placeholder = model !== undefined && model.provider === "unknown" && model.id === "unknown";
    if (model === undefined || placeholder)
      return { current: "", currentLabel: "", available: [], supported: false };
    const current = session.thinkingLevel;
    return {
      current,
      currentLabel: label(current),
      available: session.getAvailableThinkingLevels().map((level) => ({
        level: level as ThinkingLevelName,
        label: label(level),
      })),
      supported: session.supportsThinking(),
    };
  }

  /**
   * 重新读取本会话的累计 token 消耗与当前上下文占用。
   *
   * 数字全部来自 Pi：累计值取 `getSessionStats()`（按会话条目聚合，包含已经被
   * 压缩掉的历史与全部工具轮次），上下文占用取 `getContextUsage()`。缓存命中率
   * 沿用 Pi 自己终端底栏的口径 `cacheRead / (input + cacheRead + cacheWrite)`，
   * 累计全会话；成本收成六位小数，避免浮点累加出来一串尾数。
   */
  private recomputeTokenUsage(): void {
    try {
      const stats = this.runtime.session.getSessionStats();
      // 没有任何消耗时下发 null：底栏据此不渲染胶囊，而不是显示一个「0 tok」。
      if (stats.tokens.total === 0 && stats.cost === 0) {
        this.tokenUsage = null;
      } else {
        const promptTokens = stats.tokens.input + stats.tokens.cacheRead + stats.tokens.cacheWrite;
        this.tokenUsage = {
          input: stats.tokens.input,
          output: stats.tokens.output,
          cacheRead: stats.tokens.cacheRead,
          cacheWrite: stats.tokens.cacheWrite,
          total: stats.tokens.total,
          cost: Number(stats.cost.toFixed(6)),
          cacheHitPercent:
            promptTokens > 0
              ? Number(((stats.tokens.cacheRead / promptTokens) * 100).toFixed(1))
              : null,
        };
      }
      // 上下文占用是另一个数：压缩后会变小，压缩后到下次响应之间 Pi 给不出值。
      const context = this.runtime.session.getContextUsage();
      this.contextUsage =
        context === undefined || context.tokens === null || context.percent === null
          ? null
          : {
              tokens: context.tokens,
              contextWindow: context.contextWindow,
              percent: Number(context.percent.toFixed(1)),
            };
    } catch {
      // 统计失败不该影响对话本身：保持上一次的数字，浏览器只在流式期间短暂看到旧值。
    }
  }

  /** 追加条目并补上初始版本号；`version` 只由这里与原地更新处维护。 */
  private push(item: WithoutVersion<TranscriptItemView>): TranscriptItemView {
    const stored = { ...item, version: 1 } as TranscriptItemView;
    this.items.push(stored);
    return stored;
  }

  /** 追加一条面向用户的提示并立即推送：扩展命令的结果全靠这条路径回到浏览器。 */
  pushNotice(text: string, kind: "notice" | "error" = "notice"): void {
    this.push({ id: this.nextItemId++, kind, text });
    this.emit();
  }

  /**
   * 会话切换后按当前分支的有效上下文重建条目，浏览器不需要理解 Pi 的存储格式。
   *
   * 条目编号保持全局递增：切换会话后首条编号必然变化，服务端据此判定需要
   * 整体下发，浏览器不会把两个会话的条目拼在一起。
   */
  private rebuild(): void {
    this.items = [];
    for (const entry of this.runtime.session.sessionManager.buildContextEntries()) {
      if (entry.type !== "message") continue;
      const message = entry.message;
      if (message.role === "user") {
        const text = messageText(message);
        if (text.trim())
          this.push({ id: this.nextItemId++, kind: "user", text });
      } else if (message.role === "assistant") {
        const text = messageText(message);
        if (text.trim())
          this.push({ id: this.nextItemId++, kind: "assistant", text });
        if (message.stopReason === "error" && message.errorMessage) {
          // 这里拿到的是字符串而非 Error；safeError 会把它压成通用文案，模型错误
          // （401、模型不存在、余额不足）就看不到原因了，只做凭据脱敏即可。
          this.push({
            id: this.nextItemId++,
            kind: "error",
            text: redact(message.errorMessage, credentialValues()),
          });
        }
      }
    }
  }

  private handleEvent = (event: AgentSessionEvent): void => {
    switch (event.type) {
      case "agent_start":
        this.busy = true;
        this.cancelling = false;
        this.startedAt = Date.now();
        this.status = "正在处理";
        break;
      case "message_start": {
        const message = event.message;
        if (message.role === "user") {
          // 提交时已经回显过本轮输入；扩展命令不会产生 user 消息，所以这里才需要去重。
          if (this.echoPending) {
            this.echoPending = false;
            break;
          }
          const text = messageText(message);
          if (text.trim())
            this.push({ id: this.nextItemId++, kind: "user", text });
        }
        break;
      }
      case "message_update": {
        const update = event.assistantMessageEvent;
        if (update.type === "text_delta") this.liveText += update.delta;
        else if (update.type === "thinking_delta")
          this.liveThinking += update.delta;
        break;
      }
      case "message_end": {
        const message = event.message;
        if (message.role === "assistant") {
          const text = messageText(message);
          if (text.trim())
            this.push({ id: this.nextItemId++, kind: "assistant", text });
          this.liveText = "";
          this.liveThinking = "";
          if (message.stopReason === "error") {
            this.push({
              id: this.nextItemId++,
              kind: "error",
              text: redact(
                message.errorMessage ?? "模型请求失败。",
                credentialValues(),
              ),
            });
          } else if (message.stopReason === "aborted") {
            this.push({
              id: this.nextItemId++,
              kind: "notice",
              text: "本轮已停止；已发送的变更以回读结果及操作记录为准。",
            });
          }
        }
        break;
      }
      case "tool_execution_start": {
        this.activities.set(
          event.toolCallId,
          this.push({
            id: this.nextItemId++,
            kind: "activity",
            label: event.toolName,
            state: "running",
            detail: "",
          }),
        );
        break;
      }
      case "tool_execution_end": {
        const item = this.activities.get(event.toolCallId);
        if (item?.kind === "activity") {
          item.state = event.isError ? "error" : "ok";
          item.detail = resultDetail(event.result);
          // 原地更新必须递增版本，否则增量帧不会再下发这一条，界面会停在「进行中」。
          item.version++;
        }
        this.activities.delete(event.toolCallId);
        break;
      }
      case "agent_end":
        this.busy = false;
        this.status = "";
        // 本轮的 token 用量此时已经写入会话条目，重算一次让顶栏跟着增长。
        this.recomputeTokenUsage();
        break;
      case "agent_settled":
        this.busy = false;
        this.cancelling = false;
        this.startedAt = 0;
        this.status = "";
        // 本轮可能执行过 /bangumi-login 或 /bangumi-logout，结束后刷新本机登录元数据。
        void this.refreshLogin();
        break;
      case "compaction_start":
        this.pushNotice(
          event.reason === "manual"
            ? "正在压缩会话上下文…"
            : "上下文接近上限，正在自动压缩…",
        );
        break;
      case "compaction_end":
        if (event.errorMessage)
          this.pushNotice(
            `会话压缩失败：${safeError(event.errorMessage).message}`,
            "error",
          );
        else if (event.aborted) this.pushNotice("会话压缩已停止。");
        else this.pushNotice("会话上下文已压缩。");
        break;
      case "auto_retry_start":
        this.pushNotice(
          `请求失败，正在重试（第 ${event.attempt}/${event.maxAttempts} 次）…`,
        );
        break;
      case "auto_retry_end":
        this.pushNotice(
          event.success
            ? "重试成功。"
            : `重试失败：${event.finalError ?? "未提供原因"}`,
          event.success ? "notice" : "error",
        );
        break;
      case "session_info_changed":
        break;
      default:
        break;
    }
    this.emit();
  };

  /** 一次完整的写入预览确认；返回 false 表示用户拒绝、取消或没有可用确认方。 */
  requestConfirmation(
    preview: string,
    signal: AbortSignal | undefined,
  ): Promise<boolean> {
    if (this.pending)
      throw new AppError(
        "CONFIRMATION_PENDING",
        "已有待确认的写入预览，请先在浏览器中处理。",
      );
    const id = randomUUID();
    const view: ConfirmationView = {
      id,
      title: "Bangumi 修改预览",
      preview,
      state: "pending",
      hint: "确认后才会提交；提交前会重新核对账户与网站现状。",
    };
    const item = this.push({
      id: this.nextItemId++,
      kind: "confirmation",
      confirmation: view,
    });
    return new Promise<boolean>((resolve, reject) => {
      const settle = (accepted: boolean): void => {
        if (this.pending?.view.id !== id) return;
        this.pending = null;
        view.state = accepted ? "accepted" : "rejected";
        // 结论写在同一条目上，靠版本递增让浏览器替换掉「待确认」那张卡。
        if (item.kind === "confirmation") item.version++;
        this.pushNotice(
          accepted
            ? "已确认，正在提交并独立回读。"
            : "已取消本次修改，未提交。",
        );
        this.emit();
        resolve(accepted);
      };
      const onAbort = (): void => settle(false);
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending = {
        view,
        settle: (accepted) => {
          signal?.removeEventListener("abort", onAbort);
          settle(accepted);
        },
      };
      if (signal?.aborted) {
        this.settlePending(false);
        reject(new AppError("CANCELLED", "操作已取消。"));
        return;
      }
      this.emit();
    });
  }

  /** 浏览器对写入预览的回应；未匹配的 id 被忽略，避免旧页面误确认新预览。 */
  resolveConfirmation(id: string, accepted: boolean): void {
    if (this.pending?.view.id !== id)
      throw new AppError(
        "CONFIRMATION_NOT_FOUND",
        "该预览已失效，请重新发起修改。",
      );
    this.pending.settle(accepted);
  }

  private settlePending(accepted: boolean): void {
    if (this.pending) this.pending.settle(accepted);
  }

  /**
   * 浏览器要一次交出邮箱与密码。
   *
   * `login()` 内部按 email → password 顺序各要一次输入；这里第一次提示就同时
   * 拿到两个值并缓存，第二次直接复用，界面因此只有一个凭据弹窗。
   */
  requestLogin(
    kind: "email" | "password",
    signal: AbortSignal,
  ): Promise<string> {
    if (this.loginDraft) {
      const draft = this.loginDraft;
      this.loginDraft = null;
      return Promise.resolve(kind === "email" ? draft.email : draft.password);
    }
    if (!this.channel.canLogin())
      throw new AppError(
        "BGM_LOGIN_UI_REQUIRED",
        "登录需要已连接的 Web 终端或本地交互终端。",
      );
    if (this.login)
      throw new AppError("LOGIN_PENDING", "已有待输入的登录凭据。");
    const id = this.nextLoginId++;
    return new Promise<string>((resolve, reject) => {
      const onAbort = (): void => {
        this.finishLogin(undefined);
        reject(new AppError("CANCELLED", "登录已取消。"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.login = {
        id,
        settle: (credentials) => {
          signal.removeEventListener("abort", onAbort);
          this.login = null;
          this.emit();
          if (credentials === undefined)
            reject(new AppError("CANCELLED", "登录已取消。"));
          else {
            this.loginDraft = credentials;
            resolve(kind === "email" ? credentials.email : credentials.password);
          }
        },
        fail: (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      };
      if (signal.aborted) {
        this.finishLogin(undefined);
        return;
      }
      this.emit();
    });
  }

  private finishLogin(
    credentials: { email: string; password: string } | undefined,
  ): void {
    this.login?.settle(credentials);
  }

  /** 浏览器提交的登录凭据；`undefined` 表示用户取消。 */
  resolveLogin(
    id: number,
    credentials: { email: string; password: string } | undefined,
  ): void {
    if (!this.login || this.login.id !== id)
      throw new AppError(
        "LOGIN_NOT_FOUND",
        "该登录输入已失效，请重新发起登录。",
      );
    this.finishLogin(credentials);
  }

  /**
   * 设置弹窗里的显式登录：邮箱与密码由浏览器一次提交，宿主直接执行登录流程
   * （人机验证仍在系统默认浏览器里完成）。
   *
   * 进度只写进 `loginStatus` 随状态帧下发，不产生会话条目；无论成败都会重读本机
   * 登录元数据，设置行因此立刻反映结果——这正是原来漏掉的一步：登录命令不产生
   * agent 轮次，只在 `agent_settled` 里刷新就永远等不到。
   */
  async startLogin(email: string, password: string): Promise<void> {
    if (this.loginBusy)
      throw new AppError("LOGIN_PENDING", "已有一次登录正在进行。");
    const controller = new AbortController();
    this.loginAbort = controller;
    this.loginBusy = true;
    this.loginStatus = "正在准备登录…";
    this.emit();
    try {
      await login(this.store, {
        signal: controller.signal,
        // 取当前线路：运行中换过代理后，登录也跟着走新线路。
        proxy: this.proxy.current,
        requestTimeoutMs: this.timeoutMs,
        prompt: async (kind) => (kind === "email" ? email : password),
        notice: (message) => {
          this.loginStatus = message;
          this.emit();
        },
      });
      this.loginStatus = "登录成功，正在保存本机会话…";
      await this.refreshLogin();
    } finally {
      this.loginAbort = null;
      this.loginBusy = false;
      this.loginStatus = "";
      this.emit();
    }
  }

  /** 中止设置弹窗里进行中的登录；命令路径的登录由它自己的 signal 控制。 */
  cancelLogin(): void {
    this.loginAbort?.abort();
  }

  /**
   * 设置弹窗里的显式登出：只清除本应用保存的会话，不影响 Bangumi 网站上的登录
   * 状态；结果只反映在登录元数据里，不产生会话条目。
   */
  async logout(): Promise<void> {
    await this.store.clear();
    await this.refreshLogin();
  }

  async submit(input: string): Promise<void> {
    const text = input.trim();
    if (!text) throw new AppError("INVALID_INPUT", "输入不能为空。");
    if (this.pending)
      throw new AppError(
        "CONFIRMATION_PENDING",
        "请先在浏览器中处理待确认的修改预览。",
      );
    const session = this.runtime.session;
    // 先回显本轮输入：扩展命令（例如 /bangumi-login-status）不产生 user 消息，
    // 若不回显，浏览器会一直停在首屏，命令结果也无处显示。
    this.echoPending = true;
    this.push({ id: this.nextItemId++, kind: "user", text });
    this.emit();
    const options = session.isStreaming
      ? { streamingBehavior: "followUp" as const }
      : {};
    void session
      .prompt(text, options)
      .catch((error) => {
        this.pushNotice(`请求失败：${safeError(error).message}`, "error");
      })
      // 本轮结束后复位：user 消息一定在本轮内出现，残留标记会影响下一轮。
      .finally(() => {
        this.echoPending = false;
      });
  }

  async cancel(): Promise<void> {
    if (!this.runtime.session.isStreaming) return;
    this.cancelling = true;
    this.emit();
    try {
      await this.runtime.session.abort();
    } finally {
      this.cancelling = false;
      this.emit();
    }
  }

  async setModel(provider: string, model: string): Promise<void> {
    const found = this.runtime.session.modelRuntime
      .getAvailableSnapshot()
      .find(
        (candidate) =>
          candidate.provider === provider && candidate.id === model,
      );
    if (!found)
      throw new AppError("MODEL_NOT_FOUND", "该模型不在当前可用列表中。");
    await this.runtime.session.setModel(found);
    this.emit();
  }

  /**
   * 切换思考强度，并把它写成本机 Pi 的默认值。
   *
   * 级别必须来自当前模型的可用列表：`persist` 写进 `settings.json` 的是请求值，而
   * 不是 Pi 收敛后的生效值，先在这里挡住，免得把当前模型不支持的级别写成默认。
   * 写入的是隔离 Pi 目录（`<agentDir>/settings.json`）里的 `defaultThinkingLevel`：
   * 重启后新会话直接生效，恢复旧会话时以该会话内的级别变更条目为准。切换只影响
   * 之后的请求，已经发出的那一轮参数不变。
   */
  setThinkingLevel(level: ThinkingLevel): void {
    const session = this.runtime.session;
    const available = session.getAvailableThinkingLevels();
    const describe = (candidate: ThinkingLevel): string =>
      `${THINKING_LABELS[candidate as ThinkingLevelName]}（${candidate}）`;
    if (!available.includes(level))
      throw new AppError(
        "INVALID_INPUT",
        available.length === 0
          ? "尚未选择模型，无法设置思考强度。"
          : `思考强度只能是 ${available.map(describe).join("、")}。`,
      );
    const previous = session.thinkingLevel;
    session.setThinkingLevel(level, { persist: true });
    const applied = session.thinkingLevel;
    this.pushNotice(
      previous === applied
        ? `思考强度已是 ${describe(applied)}，已保存为本机默认；重启后保留。`
        : `思考强度已切换为 ${describe(applied)}，并已保存为本机默认；重启后保留。`,
    );
    this.emit();
  }

  async newSession(): Promise<void> {
    await this.runtime.newSession();
    this.emit();
  }

  async resumeSession(path: string): Promise<void> {
    // 浏览器只能恢复本会话目录里的会话：路径直接来自请求体，不能让它指向任意文件。
    const root = resolve(this.sessionDir);
    const target = resolve(path);
    if (target !== root && !target.startsWith(root + sep))
      throw new AppError(
        "INVALID_INPUT",
        "只能恢复本工作目录会话列表中的会话。",
      );
    await this.runtime.switchSession(target);
    this.emit();
  }

  /** 登录状态只来自本应用保存的会话元数据；不代表在线核实结果。 */
  async refreshLogin(): Promise<void> {
    try {
      const saved = await this.store.load();
      this.loginState = saved ? "signed-in" : "signed-out";
      this.loginUsername = saved?.username ?? "";
      this.loginText = saved
        ? `Bangumi 账户：${saved.username}（#${saved.accountId}）；${saved.expiresAt > Date.now() ? "本地会话未过期" : "本地会话已过期"}，尚未在线核实。`
        : "Bangumi 未登录；查询公开资料不需要登录。";
    } catch (error) {
      this.loginState = "signed-out";
      this.loginUsername = "";
      this.loginText = `Bangumi 登录状态读取失败：${safeError(error).message}`;
    }
    this.emit();
  }

  async catalog(): Promise<CatalogView> {
    const session = this.runtime.session;
    const current = session.model;
    const models: ModelOptionView[] = session.modelRuntime
      .getAvailableSnapshot()
      .map((candidate) => ({
        provider: candidate.provider,
        model: candidate.id,
        label: `${candidate.provider}/${candidate.id}`,
        current:
          current !== undefined &&
          current.provider === candidate.provider &&
          current.id === candidate.id,
      }));
    const infos = await SessionManager.list(this.cwd, this.sessionDir).catch(
      () => [],
    );
    const sessionFile = session.sessionFile;
    const sessions: SessionOptionView[] = infos.map((info) => ({
      id: info.id,
      path: info.path,
      name: info.name ?? "",
      modified: info.modified.toISOString(),
      messageCount: info.messageCount,
      current: sessionFile !== undefined && info.path === sessionFile,
    }));
    const commands: CommandOptionView[] = session.extensionRunner
      .getRegisteredCommands()
      .map((command) => ({
        name: command.invocationName,
        description: command.description ?? "",
        source: "extension",
      }));
    // 可填入密钥的提供方：来自 Pi 自己的模型目录与 models.json 覆盖。
    const modelRuntime = session.modelRuntime;
    const providers: ProviderOptionView[] = modelRuntime
      .getProviders()
      .map((provider) => {
        const status = modelRuntime.getProviderAuthStatus(provider.id);
        return {
          id: provider.id,
          label: provider.id,
          authSource: authSourceOf(status),
          modelCount: modelRuntime.getModels(provider.id).length,
          current: current !== undefined && current.provider === provider.id,
        };
      })
      .sort((left, right) => left.id.localeCompare(right.id));
    return {
      models,
      sessions,
      commands,
      providers,
      canPersistCredentials: false,
    };
  }


  /**
   * 在本次运行内为某个提供方注入模型密钥。
   *
   * 走 Pi 的运行时凭据（`setRuntimeApiKey`）：只重新组装该提供方并刷新可用模型
   * 快照，**不写入任何文件**，进程重启后必须重新填写。密钥不进入会话条目、不进入
   * 日志，回执里也只出现提供方名称。
   */
  async setCredential(provider: string, key: string): Promise<void> {
    const modelRuntime = this.runtime.session.modelRuntime;
    if (!modelRuntime.getProviders().some((candidate) => candidate.id === provider)) {
      throw new AppError("PROVIDER_NOT_FOUND", "该提供方不在 Pi 的模型目录中。");
    }
    await modelRuntime.setRuntimeApiKey(provider, key);
    // 填完密钥后若当前模型仍不可用（例如启动时根本没有可用模型），自动切到第一个
    // 可用模型，否则界面会继续停在 unknown/unknown 上，让人以为密钥没生效。
    const available = modelRuntime.getAvailableSnapshot();
    const current = this.runtime.session.model;
    const usable =
      current !== undefined &&
      available.some(
        (candidate) =>
          candidate.provider === current.provider && candidate.id === current.id,
      );
    let switched = "";
    if (!usable && available[0] !== undefined) {
      const first = available[0];
      try {
        await this.runtime.session.setModel(first);
        switched = `，已切换到 ${first.provider}/${first.id}`;
      } catch {
        // 切换失败不影响密钥已经生效；浏览器仍可在模型菜单里手动选择。
      }
    }
    this.pushNotice(
      `已为 ${provider} 填入密钥，仅本次运行生效${switched}；重启后需要重新填写。`,
    );
    this.emit();
  }

  /**
   * 切换本机网络线路，只在本次运行内生效。
   *
   * `auto` 重新走一遍自动发现（应用环境变量 → 标准环境变量 → Windows 系统代理 →
   * 直连），`direct` 强制直连，`manual` 用给定地址。切换由 ProxyController 广播给
   * 所有消费者：Pi 的模型请求换 dispatcher、本地 MCP 子进程重启（线路写在子进程
   * 环境变量里，改不了已启动的进程）、下次登录走新线路。
   */
  async setProxy(mode: "auto" | "direct" | "manual", url?: string): Promise<void> {
    const address = (url ?? "").trim();
    if (mode === "manual" && address === "") throw new AppError("INVALID_INPUT", "请填写代理地址，例如 http://127.0.0.1:7890。");
    const policy =
      mode === "direct" ? policyFor(null, "config")
        : mode === "manual" ? policyFor(address, "config")
          : await discoverProxy();
    await this.proxy.set(policy, mode);
    this.proxyLabel = this.proxy.summary;
    this.pushNotice(`网络线路已切换为${this.proxyLabel}，仅本次运行生效。`);
    this.emit();
  }

  async dispose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    // 摘掉换会话钩子，避免运行结束后仍指向已释放的会话。
    this.runtime.setRebindSession(undefined);
    this.settlePending(false);
    this.finishLogin(undefined);
    this.activities.clear();
    this.busy = false;
    this.cancelling = false;
    this.listeners.clear();
  }
}
