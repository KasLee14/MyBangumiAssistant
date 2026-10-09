import { randomUUID } from "node:crypto";
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { assistantErrorDiagnostic, isErrorDiagnostic } from '../support/error-diagnostic.js';
import { isPresentationSource, PRESENTATION_ENTRY_TYPE, type PresentationSnapshot } from '../output/reply-assembler.js';
import type {
  AgentMessage,
  ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import {
  SessionManager,
  type AgentSession,
  type AgentSessionRuntime,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type { InteractionChannel, NoticeType } from "../interaction.js";
import type { WriteConfirmOptions } from "../mcp/confirm.js";
import { login, type AccountSessionStore } from "../login/index.js";
import {
  AppError,
  credentialValues,
  redact,
  safeError,
} from "../support/errors.js";
import { policyFor } from "../support/proxy.js";
import {
  discoverProxy,
  type ProxyController,
} from "../support/proxy-controller.js";
import { sessionDisplayName } from "../session-title.js";
import { exceptionErrorView } from './error-view.js';
import {
  blocksFromContent,
  blocksFromMessage,
  customContentBlocks,
  hasRenderableBlock,
  reasoningTextFrom,
  toolCallsFrom,
} from "./message-blocks.js";
import { toolAccess, toolArgsText, toolFamily, toolOutcome, toolSummary, toolTitle } from "./tool-view.js";
import type { TaskQueue } from "../support/task-queue.js";
import type {
  AssistantTimingView,
  CatalogView,
  ChatScalarsView,
  ChatStateView,
  CommandOptionView,
  ConfirmationView,
  ContextUsageView,
  MessageBlock,
  ModelOptionView,
  ProviderOptionView,
  ReasoningItemView,
  SessionOptionView,
  ThinkingLevelName,
  ThinkingView,
  TokenUsageView,
  ToolItemView,
  ToolResultView,
  ToolState,
  TranscriptItemView,
  TurnItemView,
  TurnUsageView,
} from "./protocol.js";

/**
 * Pi 会话事件的类型标识，取自 `AgentSessionEvent` 的判别字段 `type`。
 *
 * 取值由 Pi 定义，必须与 `AgentSessionEvent["type"]` 逐字一致；收成枚举只是为了让
 * `handleEvent` 的 `switch` 有一个可读、可跳转的名字，并给每个事件记一句「本会话
 * 拿它做什么」。枚举成员与字面量联合可以直接比较，因此 `switch` 的收窄不受影响。
 *
 * 这里只列出本会话真正关心的事件。Pi 还会发出 `turn_start`、`turn_end`、
 * `queue_update`、`entry_appended`、`thinking_level_changed`、
 * `summarization_retry_*` 等事件，它们不影响浏览器视图，统一落到 `switch` 的
 * `default` 分支被忽略。
 */
enum AgentSessionEventType {
  /** 一轮 agent 循环开始：置忙、复位取消标记并记录开始时间。 */
  AgentStart = "agent_start",
  /**
   * 子轮（一次模型响应 + 它触发的工具调用）开始。
   *
   * 它是**步序号**的来源：一个用户回合里模型可能因为工具结果而多次响应，前端据此把同一
   * 回合内的多段过程与正文排到正确位置（`step`）。`turn_end` 不参与视图——工具结果已经由
   * `tool_execution_end` 落到条目上，重复处理只会多出一个真相，因此这里不列它。
   */
  TurnStart = "turn_start",
  /** 新消息写入会话：本轮输入已回显时跳过 user 消息，避免出现重复条目。 */
  MessageStart = "message_start",
  /** 助手消息的流式增量：从 `partial.content` 投影出流式内容块，不产生会话条目。 */
  MessageUpdate = "message_update",
  /** 一条消息结束：助手消息在此把内容块落成条目，并处理 error / aborted 两种停止原因。 */
  MessageEnd = "message_end",
  /** 工具开始执行：新建一条「进行中」的活动条目，并按 toolCallId 登记。 */
  ToolExecutionStart = "tool_execution_start",
  /** 工具执行中的中间结果：原地更新活动条目并递增版本，让浏览器看到进度。 */
  ToolExecutionUpdate = "tool_execution_update",
  /** 工具执行结束：补齐最终状态与细节，随后从活动表中移除。 */
  ToolExecutionEnd = "tool_execution_end",
  /** 一轮 agent 结束：解除忙碌状态并重算 token 用量。 */
  AgentEnd = "agent_end",
  /** 会话彻底静默（重试与压缩都已结束）：复位状态并刷新本机登录元数据。 */
  AgentSettled = "agent_settled",
  /** 开始压缩上下文：手动压缩与自动压缩给出不同提示。 */
  CompactionStart = "compaction_start",
  /** 压缩结束：按失败、中止、成功三种结果分别提示。 */
  CompactionEnd = "compaction_end",
  /** 自动重试开始：提示当前是第几次重试。 */
  AutoRetryStart = "auto_retry_start",
  /** 自动重试结束：按成败给出对应提示。 */
  AutoRetryEnd = "auto_retry_end",
  /** 会话名称等元信息变化：条目里已经带上名称，这里无需额外处理。 */
  SessionInfoChanged = "session_info_changed",
}

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

/** 空用量：回合开始时复位，随后累加各步的 `usage`。 */
function emptyUsage(): TurnUsageView {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0 };
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * 把一步的用量累加到回合合计上。
 *
 * Pi 的 `Usage` 按**步**（一次模型响应）上报，而界面要的是「这一轮用了多少」——一个用户
 * 回合可能包含多次模型响应，所以必须累加而不是取最后一个。口径与 `TokenUsageView` 保持一致：
 * `total` 取提供方的 `totalTokens`，`cost` 取价目表算出的总额，`reasoning` 只在提供方
 * 报告时累加（它是 `output` 的子集，因此不并入 `total`）。
 */
function addUsage(target: TurnUsageView, usage: unknown): void {
  if (usage === null || typeof usage !== "object") return;
  const value = usage as Record<string, unknown>;
  target.input += finite(value["input"]);
  target.output += finite(value["output"]);
  target.cacheRead += finite(value["cacheRead"]);
  target.cacheWrite += finite(value["cacheWrite"]);
  target.total += finite(value["totalTokens"]);
  const cost = value["cost"];
  target.cost += finite(
    cost !== null && typeof cost === "object"
      ? (cost as Record<string, unknown>)["total"]
      : undefined,
  );
  const reasoning = finite(value["reasoning"]);
  if (reasoning > 0) target.reasoning = (target.reasoning ?? 0) + reasoning;
}

/** 单步用量视图；提供方没给用量（或全为 0）时返回 undefined，浏览器据此不显示这一项。 */
function usageView(usage: unknown): TurnUsageView | undefined {
  if (usage === null || typeof usage !== "object") return undefined;
  const target = emptyUsage();
  addUsage(target, usage);
  return target.total > 0 ? target : undefined;
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
    options?: WriteConfirmOptions,
  ): Promise<boolean> {
    if (!this.session)
      throw new AppError("WEB_UI_UNAVAILABLE", "Web 终端尚未就绪。");
    return this.session.requestConfirmation(preview, signal, options);
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
  accountQueue?: TaskQueue;
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
  private readonly accountQueue: TaskQueue | undefined;

  private items: TranscriptItemView[] = [];
  private nextItemId = 1;
  private readonly recoveryReplies = new Map<string, { replyId?: number; errorId?: number }>();
  private readonly hostDiagnosticIds = new Set<string>();
  private terminalReported = false;
  /** 进行中的工具条目：结束时原地更新同一个对象并递增版本。 */
  private readonly activities = new Map<string, ToolItemView>();
  /**
   * 轮次与步序号。
   *
   * `currentTurn` 是**用户回合**（一次提交，对应前端的一个轮次分组）；`currentStep` 是该回合内
   * 第几次模型响应（由 Pi 的 `turn_start` 驱动）。浏览器只读这两个数，不再按 user 条目猜轮次。
   */
  private currentTurn = 0;
  private currentStep = 0;
  /** 已发出的轮次条目，按回合号索引；回合结束时原地补齐状态、计数与用量。 */
  private readonly turnItems = new Map<number, TurnItemView>();
  /** 当前回合的用量累计：Pi 的 `usage` 按步上报，回合级要自己加。 */
  private turnUsage: TurnUsageView = emptyUsage();
  /** 当前回合的终态；`message_end` 的停止原因会把它改成 aborted / error。 */
  private turnStatus: TurnItemView['status'] = 'completed';
  /** 当前步的时序：用于首 token 延迟与解码耗时。 */
  private stepStartedAt = 0;
  private firstTokenTime = 0;
  /** 当前思考段落的开始时间（`thinking_delta` 首次到达时记录）。 */
  private thinkingStartedAt = 0;
  private readonly listeners = new Set<() => void>();
  private unsubscribe: (() => void) | undefined;

  private busy = false;
  private recoveryPending = false;
  private cancelling = false;
  private startedAt = 0;
  private status = "";
  private liveBlocks: MessageBlock[] = [];
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
    settle: (
      credentials: { email: string; password: string } | undefined,
    ) => void;
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
    this.accountQueue = options.accountQueue;
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
    this.turnItems.clear();
    this.liveBlocks = [];
    this.liveThinking = "";
    this.currentTurn = 0;
    this.currentStep = 0;
    this.stepStartedAt = 0;
    this.firstTokenTime = 0;
    this.thinkingStartedAt = 0;
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
    if (!this.channel.canLogin()) {
      this.loginDraft = null;
      this.cancelLogin();
    }
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

  get id(): string {
    return this.runtime.session.sessionId;
  }
  get file(): string | undefined {
    return this.runtime.session.sessionFile;
  }

  /** 列表摘要不复制正在增长的会话正文。 */
  summary(): SessionOptionView {
    const session = this.runtime.session;
    const firstUser = this.items.find((item) => item.kind === "user");
    return {
      id: this.id,
      path: this.file ?? "",
      name: sessionDisplayName(
        session.sessionName,
        firstUser?.kind === "user" ? firstUser.text : "",
      ),
      modified: new Date(
        this.startedAt ||
          session.sessionManager.getLeafEntry()?.timestamp ||
          session.sessionManager.getHeader()?.timestamp ||
          Date.now(),
      ).toISOString(),
      messageCount: session.messages.filter(
        (message) => message.role === "user" || message.role === "assistant",
      ).length,
      current: false,
      busy: this.busy,
      awaitingConfirmation: this.pending !== null,
      awaitingLogin: this.login !== null || this.loginBusy,
    };
  }

  notifySettingsChange(): void {
    this.emit();
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
      proxyLabel: this.proxy.summary,
      proxyMode: this.proxy.mode,
      proxyAddress: this.proxy.addresses,
      tokenUsage: this.tokenUsage,
      contextUsage: this.contextUsage,
      liveContent: this.liveBlocks,
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
    const label = (level: ThinkingLevel): string =>
      THINKING_LABELS[level as ThinkingLevelName];
    const model = session.model;
    const placeholder =
      model !== undefined &&
      model.provider === "unknown" &&
      model.id === "unknown";
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
        const promptTokens =
          stats.tokens.input + stats.tokens.cacheRead + stats.tokens.cacheWrite;
        this.tokenUsage = {
          input: stats.tokens.input,
          output: stats.tokens.output,
          cacheRead: stats.tokens.cacheRead,
          cacheWrite: stats.tokens.cacheWrite,
          total: stats.tokens.total,
          cost: Number(stats.cost.toFixed(6)),
          cacheHitPercent:
            promptTokens > 0
              ? Number(
                  ((stats.tokens.cacheRead / promptTokens) * 100).toFixed(1),
                )
              : null,
        };
      }
      // 上下文占用是另一个数：压缩后会变小，压缩后到下次响应之间 Pi 给不出值。
      const context = this.runtime.session.getContextUsage();
      this.contextUsage =
        context === undefined ||
        context.tokens === null ||
        context.percent === null
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

  /**
   * 开一个用户回合：递增回合号、复位步序号与用量，并发出轮次条目。
   *
   * 轮次条目本身不承载内容，它是**边界标记**——浏览器按它切分轮次，并从它取耗时与计数，
   * 于是前端不再需要「按 user 条目猜轮次」这条规则。
   */
  private openTurn(startedAt = Date.now()): void {
    this.currentTurn += 1;
    this.currentStep = 0;
    this.turnUsage = emptyUsage();
    this.turnStatus = 'completed';
    this.terminalReported = false;
    this.stepStartedAt = 0;
    this.firstTokenTime = 0;
    this.thinkingStartedAt = 0;
    const item = this.push({
      id: this.nextItemId++,
      kind: 'turn',
      turn: this.currentTurn,
      startedAt,
      endedAt: 0,
      status: 'open',
      messageCount: 0,
      toolCallCount: 0,
    }) as TurnItemView;
    this.turnItems.set(this.currentTurn, item);
  }

  /** 关一个用户回合：补齐结束时间、终态与累计用量。 */
  private closeTurn(status: TurnItemView['status'], endedAt = Date.now()): void {
    const item = this.turnItems.get(this.currentTurn);
    if (item === undefined) return;
    item.endedAt = endedAt;
    item.status = status;
    item.usage = { ...this.turnUsage };
    item.version += 1;
  }

  /**
   * 把当前这段思考落成条目。
   *
   * 流式期思考走标量 `liveThinking`（不进条目：它每帧都在长，落条目只会让增量帧与条目
   * 同时承载同一事实）；一条助手消息结束时它不再是「正在长的那一份」，此时才落条目——
   * 于是历史里也有思考，而不只是产生它的那一轮能看到。
   */
  private flushReasoning(endedAt: number): void {
    const text = this.liveThinking.trim();
    const startedAt = this.thinkingStartedAt;
    this.liveThinking = "";
    this.thinkingStartedAt = 0;
    if (!text) return;
    this.push({
      id: this.nextItemId++,
      kind: 'reasoning',
      turn: this.currentTurn,
      step: this.currentStep || 1,
      text,
      state: 'done',
      startedAt: startedAt || endedAt,
      endedAt,
    });
  }

  /** 记一次助手消息（步）与一次工具调用，用于轮控制行的计数。 */
  private noteAssistantStep(): void {
    const item = this.turnItems.get(this.currentTurn);
    if (item === undefined) return;
    item.messageCount += 1;
    item.version += 1;
  }

  private noteToolCall(): void {
    const item = this.turnItems.get(this.currentTurn);
    if (item === undefined) return;
    item.toolCallCount += 1;
    item.version += 1;
  }

  private accumulateUsage(usage: unknown): void {
    addUsage(this.turnUsage, usage);
  }

  /** 结果文本一律过一遍凭据脱敏：工具输出可能回显请求里带的密钥。 */
  private sanitizeResult(view: ToolResultView): ToolResultView {
    const secrets = credentialValues();
    return {
      blocks: view.blocks,
      isError: view.isError,
      ...(view.text === undefined ? {} : { text: redact(view.text, secrets) }),
      ...(view.errorText === undefined ? {} : { errorText: redact(view.errorText, secrets) }),
      ...(view.truncated === undefined ? {} : { truncated: view.truncated }),
    };
  }

  /** 追加一条面向用户的提示并立即推送：扩展命令的结果全靠这条路径回到浏览器。 */
  pushNotice(text: string, kind: "notice" | "error" = "notice"): void {
    this.push({ id: this.nextItemId++, kind, text });
    this.emit();
  }

  /**
   * 会话切换后按当前分支的有效上下文重建条目，浏览器不需要理解 Pi 的存储格式。
   *
   * 条目编号在本运行时内递增；服务端按会话 ID 判定切换并整体下发。
   */
  private rebuild(): void {
    this.items = [];
    this.presentationReplies.clear();
    this.recoveryReplies.clear();
    this.hostDiagnosticIds.clear();
    this.turnItems.clear();
    this.currentTurn = 0;
    this.currentStep = 0;
    this.turnUsage = emptyUsage();
    this.turnStatus = "completed";
    this.liveThinking = "";
    this.thinkingStartedAt = 0;
    /**
     * 工具调用头（`callId` → 条目），供随后的 `toolResult` 消息配对补齐。
     *
     * 历史里调用头在 assistant 消息的 `toolCall` 块上、结果在独立的 `toolResult` 消息上，
     * 两者靠 `toolCallId` 配对——这是重建过程区的唯一依据。
     */
    const calls = new Map<string, ToolItemView>();
    /** 关掉当前回合：历史里没有回合结束事件，用「下一条消息的时间」当结束时间。 */
    const close = (endedAt: number, status: TurnItemView["status"] = this.turnStatus): void => {
      if (this.currentTurn === 0) return;
      this.closeTurn(status, endedAt);
    };
    const stamp = (value: unknown): number => {
      const time = typeof value === "string" ? Date.parse(value) : NaN;
      return Number.isFinite(time) ? time : Date.now();
    };
    /**
     * 已知的最后一条消息时间。
     *
     * 历史里没有回合结束事件，所以**最后一轮**的结束时间只能取这个值——不能用 `Date.now()`：
     * 会话可能是几天前产生的，那样算出来的「用时」会是几十小时（实测 3 天前的会话显示
     * 「用时 86 小时 36 分」）。中间那些轮次用「下一条消息的时间」封口，不受影响。
     */
    let lastTimestamp = 0;

    for (const entry of this.runtime.session.sessionManager.buildContextEntries()) {
      const at = stamp(entry.timestamp);
      if (at > lastTimestamp) lastTimestamp = at;
      if (entry.type === 'custom' && entry.customType === PRESENTATION_ENTRY_TYPE) {
        this.updatePresentationReply(entry.data, at, true); continue;
      }
      if (entry.type === 'custom' && entry.customType === 'bangumi/recovery') {
        const data = entry.data as { diagnostic?: unknown } | undefined;
        if (isErrorDiagnostic(data?.diagnostic)) this.noteHostDiagnostic(data.diagnostic, at);
        continue;
      }
      // 扩展注入的结构化内容落盘为 `custom_message` 条目（而不是 `message` 条目），走同一份
      // 映射：会话切换或重启后这些卡片能从历史重建，而不是只在产生它的那一轮可见。
      // 它现在投影成"只含一个块的助手条目"——旧的顶层内容条目已经退场，但这条通道仍然
      // 必要，因为落盘格式由 Pi 决定，重建时必须认得出来。
      if (entry.type === "custom_message") {
        const turn = this.currentTurn;
        const step = this.currentStep || 1;
        if (entry.customType === 'bangumi/recovery-result' && typeof entry.content === 'string') {
          this.applyRecoveryResult(entry.content);
          continue;
        }
        const blocks = customContentBlocks(entry);
        if (blocks)
          this.push({
            id: this.nextItemId++,
            kind: "assistant",
            content: blocks,
            origin: "extension",
            turn,
            step,
          });
        continue;
      }
      if (entry.type !== "message") continue;
      const message = entry.message;
      if (message.role === "user") {
        const text = messageText(message);
        if (!text.trim()) continue;
        // 落盘条目没有轮次字段（`SessionEntryBase` 只有 id/parentId/timestamp），所以历史
        // 轮次只能**推导**：一条 user 消息开启一个用户回合。规则与实时路径（Pi 的
        // `agent_start`）一致，于是新旧轮次在界面上同构。
        close(at);
        this.openTurn(at);
        this.push({ id: this.nextItemId++, kind: "user", text });
        continue;
      }
      if (message.role === "assistant") {
        // 历史里没有 `turn_start`，步序号按「该回合内第几条 assistant 消息」推导。
        this.currentStep += 1;
        const reasoning = reasoningTextFrom(message.content);
        if (reasoning)
          this.push({
            id: this.nextItemId++,
            kind: "reasoning",
            turn: this.currentTurn,
            step: this.currentStep,
            text: reasoning,
            state: "done",
            startedAt: at,
            endedAt: at,
          });
        for (const call of toolCallsFrom(message.content)) {
          const argsText = toolArgsText(call.args);
          calls.set(
            call.callId,
            this.push({
              id: this.nextItemId++,
              kind: "tool",
              turn: this.currentTurn,
              step: this.currentStep,
              callId: call.callId,
              name: call.name,
              title: toolTitle(call.name),
              family: toolFamily(call.name),
              summary: toolSummary(call.name, call.args),
              ...(argsText === undefined ? {} : { argsText }),
              // 结果还没配上：先标成「进行中」，配对成功或被判定为缺口时才改。
              state: "running",
              access: toolAccess(call.name),
              startedAt: at,
              endedAt: 0,
              durationMs: 0,
            }) as ToolItemView,
          );
          this.noteToolCall();
        }
        const blocks = isPresentationSource(message) ? [] : blocksFromMessage(message);
        const usage = usageView(message.usage);
        this.accumulateUsage(message.usage);
        const recovered = this.updateRecoveryReply(message, blocks, true);
        if (!recovered && hasRenderableBlock(blocks))
          this.push({
            id: this.nextItemId++,
            kind: "assistant",
            content: blocks,
            turn: this.currentTurn,
            step: this.currentStep,
            // 历史没有逐 chunk 时间戳，三步时间都取这条消息的时间：TTFT 在历史轮次里无意义，
            // 但「这一步何时结束」是可用的。
            timing: { stepStartTime: at, firstTokenTime: at, completedTime: at },
            ...(usage === undefined ? {} : { usage }),
          });
        this.noteAssistantStep();
        if (message.stopReason === "error") {
          this.turnStatus = "error";
          this.noteHostFailure(message, at);
        } else if (message.stopReason === "aborted") this.turnStatus = "aborted";
        else if (this.recoveryChain(message)) this.turnStatus = this.recoveryStatus(message) === 'reported' ? 'error' : 'completed';
        continue;
      }
      if (message.role === "toolResult") {
        const at2 = typeof message.timestamp === "number" ? message.timestamp : at;
        const outcome = toolOutcome(
          message.toolName,
          { content: message.content, ...(message.details === undefined ? {} : { details: message.details }) },
          message.isError === true,
        );
        const item = calls.get(message.toolCallId);
        if (item !== undefined) {
          item.state = outcome.state ?? (message.isError ? "error" : "ok");
          item.result = this.sanitizeResult(outcome.result);
          if (outcome.showDetail !== undefined) item.showDetail = outcome.showDetail;
          item.endedAt = at2;
          item.durationMs = Math.max(0, at2 - item.startedAt);
          item.version += 1;
          calls.delete(message.toolCallId);
        } else {
          // 调用头被压缩裁剪掉了，结果还在。不能把结果丢掉：单独立一条工具条目，
          // 摘要留空（浏览器会显示调用 ID），这是可用信息与"假装完整"之间的取舍。
          this.push({
            id: this.nextItemId++,
            kind: "tool",
            turn: this.currentTurn,
            step: this.currentStep || 1,
            callId: message.toolCallId,
            name: message.toolName,
            title: toolTitle(message.toolName),
            family: toolFamily(message.toolName),
            summary: "",
            state: outcome.state ?? (message.isError ? "error" : "ok"),
            access: toolAccess(message.toolName),
            startedAt: at2,
            endedAt: at2,
            durationMs: 0,
            result: this.sanitizeResult(outcome.result),
            ...(outcome.showDetail === undefined ? {} : { showDetail: outcome.showDetail }),
          } as ToolItemView);
        }
        continue;
      }
      // 其余 role（例如 Pi 的 `bashExecution`）在浏览器侧没有对应视图，明确忽略而不是猜形态。
    }
    // 一直没有配上结果的调用（中断、或结果落在窗口之外）：标成「结果待核实」，
    // 而不是让历史里的工具行永远停在「进行中」。
    for (const item of calls.values()) {
      item.state = "unknown";
      item.version += 1;
    }
    // 最后一轮的结束时间：取已知的最后一条消息时间（见 `lastTimestamp` 的说明）。
    // 会话仍在运行时保持「进行中」，否则按已收敛的状态封口。
    close(lastTimestamp || Date.now(), this.busy ? "open" : this.turnStatus);
  }

  private handleEvent = (event: AgentSessionEvent): void => {
    // 只记非流式事件的类型。`message_update` 每个 delta 触发一次，而 `event.message` 是
    // **全量** partial 快照，逐条 `JSON.stringify` 会在一次长回答里写出 MB 级日志（实测
    // 单轮 0.7～9.8MB）——那是在 event loop 上按 delta 执行的 O(n²) 开销。诊断见
    // `artifacts/web-streaming-diagnosis-and-plan.md`。
    if (event.type !== AgentSessionEventType.MessageUpdate) console.log("event", event.type);

    switch (event.type) {
      case 'entry_appended': {
        if (event.entry.type === 'custom' && event.entry.customType === PRESENTATION_ENTRY_TYPE) {
          this.updatePresentationReply(event.entry.data); break;
        }
        if (event.entry.type === 'custom' && event.entry.customType === 'bangumi/recovery') {
          const data = event.entry.data as { stage?: string; attempt?: number; maxAttempts?: number } | undefined;
          if (data && ['scheduled', 'running'].includes(data.stage ?? '')) {
            this.recoveryPending = true; this.busy = true; this.status = `正在定向恢复（${data.attempt}/${data.maxAttempts}）`;
          } else if (data && ['stopped', 'cancelled', 'recovered', 'reported', 'checkpoint_conflict', 'tool_recovery_stopped'].includes(data.stage ?? '')) {
            this.recoveryPending = false;
            if (['stopped', 'reported', 'checkpoint_conflict', 'tool_recovery_stopped'].includes(data.stage ?? '')) this.turnStatus = 'error';
            else if (data.stage === 'recovered') this.turnStatus = 'completed';
          }
        }
        break;
      }
      case AgentSessionEventType.AgentStart:
        this.busy = true;
        this.cancelling = false;
        this.startedAt = Date.now();
        this.status = "正在处理";
        // 一次提交 = 一个用户回合；浏览器按这个回合切分轮次，不再按 user 条目猜。
        if (!this.recoveryPending) this.openTurn();
        break;
      case AgentSessionEventType.TurnStart:
        // 一次模型响应开始：步序号递增，并记下本步起点（首 token 延迟的基准）。
        this.currentStep += 1;
        this.stepStartedAt = Date.now();
        this.firstTokenTime = 0;
        break;
      case AgentSessionEventType.MessageStart: {
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
        } else if (message.role === "assistant" && this.currentStep === 0) {
          // `turn_start` 缺失时的兜底：步序号至少为 1，否则条目会落到「第 0 步」。
          this.currentStep = 1;
          this.stepStartedAt = Date.now();
        }
        break;
      }
      case AgentSessionEventType.MessageUpdate: {
        const update = event.assistantMessageEvent;
        // 内容块：不判别 `update.type`（快照是唯一入口），只把 `partial.content` 重新投影。
        // `text` 也不再靠 delta 累加——快照里的文本是全量，累加只会多出一个真相。
        // `partial` 缺失或 `content` 不是数组时什么都不做：真实 Pi 事件一定有 partial，
        // 这道判断只兜住手写样例与将来的形状漂移，**不做 delta 回退**。（联合里的
        // `done` 成员没有 partial，所以按可选字段取。）
        const partial = (update as { partial?: { content?: unknown } }).partial;
        if (partial !== undefined && Array.isArray(partial.content) && !(event.message.role === 'assistant' && isPresentationSource(event.message))) {
          const blocks = blocksFromContent(partial.content, this.liveBlocks);
          if (event.message.role === 'assistant' && this.updateRecoveryReply(event.message, blocks)) this.liveBlocks = [];
          else this.liveBlocks = blocks;
        }
        // 思考不在块序列里（过程区的一条独立行），仍按增量累加；同时记下首 token 与这段思考
        // 的起点——前者算 TTFT，后者算思考条目的起止时间。
        if (this.firstTokenTime === 0) this.firstTokenTime = Date.now();
        if (update.type === "thinking_delta") {
          if (this.thinkingStartedAt === 0) this.thinkingStartedAt = Date.now();
          this.liveThinking += update.delta;
        }
        break;
      }
      case AgentSessionEventType.MessageEnd: {
        const message = event.message;
        // 扩展注入的结构化内容：`customType` 是块 type、`details` 是载荷，宿主原样透传，
        // 由接收侧决定渲染还是丢弃（见 message-blocks.ts）。Pi 对 custom 消息是
        // `message_start` / `message_end` 连发，所以只在 end 处落条目，start 处不处理。
        if (message.role === "custom") {
          if (message.customType === 'bangumi/recovery-result' && typeof message.content === 'string') {
            this.applyRecoveryResult(message.content); break;
          }
          const blocks = customContentBlocks(message);
          if (blocks)
            this.push({
              id: this.nextItemId++,
              kind: "assistant",
              content: blocks,
              origin: "extension",
              turn: this.currentTurn,
              step: this.currentStep || 1,
            });
          break;
        }
        if (message.role === "assistant") {
          const blocks = isPresentationSource(message) ? [] : blocksFromMessage(message);
          const recovered = this.updateRecoveryReply(message, blocks, true);
          const completedTime = Date.now();
          // 思考先落条目：这一帧之后 `liveThinking` 就被清空，不落条目它便只存在于流式期。
          this.flushReasoning(completedTime);
          const timing: AssistantTimingView = {
            stepStartTime: this.stepStartedAt || completedTime,
            firstTokenTime: this.firstTokenTime || completedTime,
            completedTime,
          };
          const usage = usageView(message.usage);
          this.accumulateUsage(message.usage);
          if (!recovered && hasRenderableBlock(blocks))
            this.push({
              id: this.nextItemId++,
              kind: "assistant",
              content: blocks,
              turn: this.currentTurn,
              step: this.currentStep || 1,
              timing,
              ...(usage === undefined ? {} : { usage }),
            });
          this.noteAssistantStep();
          if (!isPresentationSource(message)) this.liveBlocks = [];
          this.liveThinking = "";
          if (message.stopReason === "error") {
            this.turnStatus = "error";
            this.noteHostFailure(message, completedTime);
          } else if (this.recoveryChain(message) && message.stopReason === 'stop') {
            this.turnStatus = this.recoveryStatus(message) === 'reported' ? 'error' : 'completed';
          } else if (message.stopReason === "aborted") {
            this.turnStatus = "aborted";
            this.push({
              id: this.nextItemId++,
              kind: "notice",
              text: "本轮已停止；已发送的变更以回读结果及操作记录为准。",
            });
          }
        }
        break;
      }
      case AgentSessionEventType.ToolExecutionStart: {
        const argsText = toolArgsText(event.args);
        const item = this.push({
          id: this.nextItemId++,
          kind: "tool",
          turn: this.currentTurn,
          step: this.currentStep || 1,
          callId: event.toolCallId,
          name: event.toolName,
          title: toolTitle(event.toolName),
          family: toolFamily(event.toolName),
          summary: toolSummary(event.toolName, event.args),
          ...(argsText === undefined ? {} : { argsText }),
          state: "running",
          access: toolAccess(event.toolName),
          startedAt: Date.now(),
          endedAt: 0,
          durationMs: 0,
        }) as ToolItemView;
        this.activities.set(event.toolCallId, item);
        this.noteToolCall();
        break;
      }
      case AgentSessionEventType.ToolExecutionUpdate: {
        const item = this.activities.get(event.toolCallId);
        if (item === undefined) break;
        // 只有批量写入的中间回执带可用的业务进展（批次计数、额度等待）；其它工具的
        // `partialResult` 形状由各工具自己定义，浏览器没有可依据的通用语义，因此沿用最终结果。
        if (event.toolName !== "execute_write_batch") break;
        const outcome = toolOutcome(event.toolName, event.partialResult, false, false);
        if (outcome.state !== undefined) item.state = outcome.state;
        item.result = this.sanitizeResult(outcome.result);
        if (outcome.showDetail !== undefined) item.showDetail = outcome.showDetail;
        // 原地更新必须递增版本，否则增量帧不会再下发这一条，界面会停在「进行中」。
        item.version += 1;
        this.status =
          outcome.state === "waiting"
            ? "正在等待写入额度"
            : "正在执行修改计划";
        break;
      }
      case AgentSessionEventType.ToolExecutionEnd: {
        const item = this.activities.get(event.toolCallId);
        if (item !== undefined) {
          const outcome = toolOutcome(event.toolName, event.result, event.isError);
          item.state = outcome.state ?? (event.isError ? "error" : "ok");
          item.result = this.sanitizeResult(outcome.result);
          if (outcome.showDetail !== undefined) item.showDetail = outcome.showDetail;
          item.endedAt = Date.now();
          item.durationMs = Math.max(0, item.endedAt - item.startedAt);
          this.status = "正在处理";
          item.version += 1;
        }
        this.activities.delete(event.toolCallId);
        break;
      }
      case AgentSessionEventType.AgentEnd:
        this.busy = this.recoveryPending;
        if (!this.recoveryPending) this.status = "";
        // 定向恢复尚未结束时不关回合：它会继续跑，提前关掉会让后续条目落到「第 0 回合」。
        if (!this.recoveryPending) this.closeTurn(this.turnStatus);
        // 本轮的 token 用量此时已经写入会话条目，重算一次让顶栏跟着增长。
        this.recomputeTokenUsage();
        break;
      case AgentSessionEventType.AgentSettled:
        this.recoveryPending = false;
        this.busy = false;
        this.cancelling = false;
        this.startedAt = 0;
        this.status = "";
        if (this.turnStatus === 'error' && !this.terminalReported) this.finishIncomplete();
        this.closeTurn(this.turnStatus);
        // 本轮可能执行过 /bangumi-login 或 /bangumi-logout，结束后刷新本机登录元数据。
        void this.refreshLogin();
        break;
      case AgentSessionEventType.CompactionStart:
        this.hostProcess(
          event.reason === "manual"
            ? "正在压缩会话上下文…"
            : "上下文接近上限，正在自动压缩…",
        );
        break;
      case AgentSessionEventType.CompactionEnd:
        if (event.errorMessage)
          this.hostProcess('会话上下文整理未完成，宿主保留已有内容。');
        else if (event.aborted) this.hostProcess("会话上下文整理已停止。");
        else this.hostProcess("会话上下文已整理。");
        break;
      case AgentSessionEventType.AutoRetryStart:
        this.hostProcess(`请求未完成，正在内部重试（${event.attempt}/${event.maxAttempts}）。`);
        break;
      case AgentSessionEventType.AutoRetryEnd:
        this.hostProcess(event.success ? '内部重试已完成。' : '内部重试仍未完成。');
        break;
      case AgentSessionEventType.SessionInfoChanged:
        break;
      default:
        break;
    }
    this.emit();
  };

  private recoveryChain(message: AssistantMessage): string | undefined {
    const value = message.diagnostics?.findLast(item => item.type === 'application_recovery')?.details?.chainId;
    return typeof value === 'string' ? value : undefined;
  }
  private presentationReplies = new Map<string, number>();
  /** 内部宿主记录投影为既有正文条目；实时和历史使用同一个完整快照。 */
  private updatePresentationReply(data: unknown, at = Date.now(), history = false): void {
    if (!data || typeof data !== 'object') return;
    const snapshot = data as PresentationSnapshot;
    if (snapshot.version !== 1 || typeof snapshot.replyId !== 'string' || !Array.isArray(snapshot.content)) return;
    const blocks = blocksFromContent(snapshot.content);
    if (snapshot.status === 'open' && !history) { this.liveBlocks = blocks; return; }
    const id = this.presentationReplies.get(snapshot.replyId);
    const item = id === undefined ? undefined : this.items.find(value => value.id === id);
    if (item?.kind === 'assistant') {
      const extendsPrefix = blocks.length >= item.content.length && item.content.every((value, index) => JSON.stringify(value) === JSON.stringify(blocks[index]));
      if (extendsPrefix && JSON.stringify(item.content) !== JSON.stringify(blocks)) { item.content = blocks; item.version++; }
    } else if (hasRenderableBlock(blocks)) {
      this.presentationReplies.set(snapshot.replyId, this.push({ id: this.nextItemId++, kind: 'assistant', content: blocks,
        turn: this.currentTurn, step: this.currentStep || 1,
        timing: { stepStartTime: this.stepStartedAt || at, firstTokenTime: this.firstTokenTime || at, completedTime: at },
      }).id);
    }
    if (snapshot.status !== 'open') { this.liveBlocks = []; this.turnStatus = snapshot.status === 'completed' ? 'completed' : snapshot.status; this.terminalReported = true; }
  }
  private recoveryStatus(message: AssistantMessage): string | undefined {
    const value = message.diagnostics?.findLast(item => item.type === 'application_recovery')?.details?.status;
    return typeof value === 'string' ? value : undefined;
  }
  private hostProcess(text: string, at = Date.now()): void {
    this.push({ id: this.nextItemId++, kind: 'reasoning', source: 'host', label: '宿主校验过程',
      turn: this.currentTurn, step: this.currentStep || 1, text: `【宿主校验过程】${text}`,
      state: 'done', startedAt: at, endedAt: at });
  }
  private noteHostFailure(message: AssistantMessage, at: number): void {
    const diagnostic = assistantErrorDiagnostic(message);
    if (diagnostic) this.noteHostDiagnostic(diagnostic, at);
    else this.hostProcess('当前响应未完成；已完成部分保留。', at);
  }
  private noteHostDiagnostic(diagnostic: import('../support/error-diagnostic.js').ErrorDiagnostic, at = Date.now()): void {
    if (this.hostDiagnosticIds.has(diagnostic.errorId)) return;
    this.hostDiagnosticIds.add(diagnostic.errorId);
    this.hostProcess(`${diagnostic.code}：当前响应未通过内部校验；已完成部分保留。${diagnostic.issues.map(issue => `${issue.path}：${issue.message}`).join('；')}`, at);
  }
  private finishIncomplete(chainId?: string, content?: MessageBlock[]): void {
    this.turnStatus = 'error'; this.terminalReported = true;
    const suffix: MessageBlock = { type: 'text', text: '本次回答未能完整生成，已完成的内容保留。' };
    const state = chainId ? this.recoveryReplies.get(chainId) : [...this.recoveryReplies.values()].at(-1);
    const reply = state?.replyId === undefined ? undefined : this.items.find(item => item.id === state.replyId);
    if (reply?.kind === 'assistant') {
      const prefix = content && content.length >= reply.content.length ? content : reply.content;
      reply.content = [...prefix, suffix]; reply.version++;
    } else {
      const item = this.push({ id: this.nextItemId++, kind: 'assistant', content: [...(content ?? []), suffix], turn: this.currentTurn, step: this.currentStep || 1 });
      if (chainId) this.recoveryReplies.set(chainId, { replyId: item.id });
    }
  }
  private applyRecoveryResult(text: string): void {
    try {
      const summary = JSON.parse(text) as { completedContent?: unknown; error?: unknown; chainId?: string };
      if (isErrorDiagnostic(summary.error) && !this.hostDiagnosticIds.has(summary.error.errorId)) {
        this.noteHostDiagnostic(summary.error);
      }
      this.finishIncomplete(summary.chainId, blocksFromContent(summary.completedContent));
    } catch { this.hostProcess('历史恢复结果无法读取，无法确认回答完整性。'); }
  }
  /** 宿主用既有条目ID/version更新同一回答，SSE消费者无需新增前端逻辑。 */
  private updateRecoveryReply(message: AssistantMessage, blocks: MessageBlock[], final = false): boolean {
    const chain = this.recoveryChain(message); if (!chain) return false;
    const state = this.recoveryReplies.get(chain) ?? {}; this.recoveryReplies.set(chain, state);
    const reply = state.replyId === undefined ? undefined : this.items.find(item => item.id === state.replyId);
    if (reply?.kind === 'assistant') {
      // 只有扩展既有完成前缀的快照才进入用户正文，起始/工具帧不能回退已交付内容。
      const advances = blocks.length >= reply.content.length && reply.content.every((part, index) => JSON.stringify(part) === JSON.stringify(blocks[index]));
      if (advances && JSON.stringify(reply.content) !== JSON.stringify(blocks)) { reply.content = blocks; reply.version++; }
    }
    else if (hasRenderableBlock(blocks)) state.replyId = this.push({
      id: this.nextItemId++, kind: 'assistant', content: blocks,
      turn: this.currentTurn, step: this.currentStep || 1,
    }).id;
    if (final && this.recoveryStatus(message) === 'reported') this.terminalReported = true;
    return true;
  }

  /** 一次完整的写入预览确认；返回 false 表示用户拒绝、取消或没有可用确认方。 */
  requestConfirmation(
    preview: string,
    signal: AbortSignal | undefined,
    options: WriteConfirmOptions = {},
  ): Promise<boolean> {
    if (!this.channel.canConfirm())
      throw new AppError(
        "AUTHORIZATION_REQUIRED",
        "没有已连接的Web终端，未提交修改。",
      );
    if (this.pending)
      throw new AppError(
        "CONFIRMATION_PENDING",
        "已有待确认的写入预览，请先在浏览器中处理。",
      );
    const id = randomUUID();
    const view: ConfirmationView = {
      id,
      title: options.title ?? "操作授权",
      confirmLabel: options.confirmLabel ?? "确认授权",
      preview,
      state: "pending",
      hint: "授权仅用于本次列出的操作。",
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
          accepted ? "已授权，正在执行本次操作。" : "已取消本次修改，未提交。",
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
            resolve(
              kind === "email" ? credentials.email : credentials.password,
            );
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
    if (credentials === undefined) this.loginDraft = null;
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
    if (!this.channel.canLogin())
      throw new AppError("BGM_LOGIN_UI_REQUIRED", "登录需要已连接的Web终端。");
    if (this.loginBusy)
      throw new AppError("LOGIN_PENDING", "已有一次登录正在进行。");
    const controller = new AbortController();
    this.loginAbort = controller;
    this.loginBusy = true;
    this.loginStatus = "正在准备登录…";
    this.emit();
    try {
      const performLogin = () =>
        login(this.store, {
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
      if (this.accountQueue)
        await this.accountQueue.run(performLogin, controller.signal);
      else await performLogin();
      this.loginStatus = "登录成功，正在保存本机会话…";
      await this.refreshLogin();
    } finally {
      email = "";
      password = "";
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
    if (this.accountQueue)
      await this.accountQueue.run(() => this.store.clear());
    else await this.store.clear();
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
        this.hostProcess(exceptionErrorView(error).text);
        if (!this.terminalReported) this.finishIncomplete();
        this.closeTurn('error');
        this.emit();
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

  /**
   * 切换当前模型，并写成本机 Pi 的默认模型。
   *
   * `settings.json` 里的 `defaultProvider`/`defaultModel` 让重启后沿用这次选择；恢复
   * 旧会话时仍以会话内的模型变更条目为准，这里不改变那条语义。
   */
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
    this.runtime.services.settingsManager.setDefaultModelAndProvider(
      provider,
      model,
    );
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
      name: sessionDisplayName(info.name, info.firstMessage),
      modified: info.modified.toISOString(),
      messageCount: info.messageCount,
      current: sessionFile !== undefined && info.path === sessionFile,
    }));
    // 首条消息尚未落盘时也展示当前会话；命名事件随后驱动浏览器刷新列表。
    if (sessionFile && !sessions.some((info) => info.current)) {
      sessions.unshift({
        id: session.sessionId,
        path: sessionFile,
        name: sessionDisplayName(session.sessionName, ""),
        modified: new Date().toISOString(),
        messageCount: 0,
        current: true,
      });
    }
    const commands: CommandOptionView[] = session.extensionRunner
      .getRegisteredCommands()
      .map((command) => ({
        name: command.invocationName,
        description: command.description ?? "",
        source: "extension",
      }));
    for (const skill of this.runtime.services.resourceLoader.getSkills()
      .skills) {
      commands.push({
        name: `skill:${skill.name}`,
        description: skill.description,
        source: "skill",
      });
    }
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
      canPersistCredentials: true,
    };
  }

  /**
   * 为某个提供方注入模型密钥。
   *
   * `persist` 为 true 时走 Pi 的凭据登录流程写入本机 `auth.json`（该流程只向交互层
   * 索要一次密钥，这里直接返回浏览器提交的值），重启后仍然生效；为 false 时维持原有
   * 语义，只注入本次运行的运行时凭据。两种方式都不进入会话条目、不进入日志，回执里
   * 也只出现提供方名称。
   */
  async setCredential(
    provider: string,
    key: string,
    persist: boolean = false,
  ): Promise<void> {
    const modelRuntime = this.runtime.session.modelRuntime;
    if (
      !modelRuntime
        .getProviders()
        .some((candidate) => candidate.id === provider)
    ) {
      throw new AppError(
        "PROVIDER_NOT_FOUND",
        "该提供方不在 Pi 的模型目录中。",
      );
    }
    if (persist) {
      try {
        await modelRuntime.login(provider, "api_key", {
          prompt: async () => key,
          notify: () => {},
        });
      } catch (error) {
        // OAuth-only 提供方没有 api-key 登录方法，Pi 会直接拒绝保存。
        throw new AppError(
          "CREDENTIAL_PERSIST_FAILED",
          `无法把密钥保存到本机：${safeError(error).message}；可以改用「仅本次运行」。`,
        );
      }
      // 落盘后撤掉本次运行的临时覆盖，否则凭据来源会一直显示成「本次运行已填入」。
      await modelRuntime.removeRuntimeApiKey(provider);
    } else {
      await modelRuntime.setRuntimeApiKey(provider, key);
    }
    // 填完密钥后若当前模型仍不可用（例如启动时根本没有可用模型），自动切到第一个
    // 可用模型，否则界面会继续停在 unknown/unknown 上，让人以为密钥没生效。
    const available = modelRuntime.getAvailableSnapshot();
    const current = this.runtime.session.model;
    const usable =
      current !== undefined &&
      available.some(
        (candidate) =>
          candidate.provider === current.provider &&
          candidate.id === current.id,
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
      persist
        ? `已为 ${provider} 保存密钥到本机，重启后仍然生效${switched}。`
        : `已为 ${provider} 填入密钥，仅本次运行生效${switched}；重启后需要重新填写。`,
    );
    this.emit();
  }

  /**
   * 清除某个提供方保存在本机的密钥。
   *
   * 只删除 Pi 凭据存储（`auth.json`）里的条目：环境变量与 `models.json` 内联密钥都
   * 不受影响，清除后该提供方可能仍然可用，只是换回了另一个来源。
   */
  async clearCredential(provider: string): Promise<void> {
    const modelRuntime = this.runtime.session.modelRuntime;
    if (
      !modelRuntime
        .getProviders()
        .some((candidate) => candidate.id === provider)
    ) {
      throw new AppError(
        "PROVIDER_NOT_FOUND",
        "该提供方不在 Pi 的模型目录中。",
      );
    }
    await modelRuntime.logout(provider);
    this.pushNotice(`已清除 ${provider} 保存在本机的密钥。`);
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
  async setProxy(
    mode: "auto" | "direct" | "manual",
    url?: string,
  ): Promise<void> {
    const address = (url ?? "").trim();
    if (mode === "manual" && address === "")
      throw new AppError(
        "INVALID_INPUT",
        "请填写代理地址，例如 http://127.0.0.1:7890。",
      );
    const policy =
      mode === "direct"
        ? policyFor(null, "config")
        : mode === "manual"
          ? policyFor(address, "config")
          : await discoverProxy();
    await this.proxy.set(policy, mode);
    this.pushNotice(`网络线路已切换为${this.proxy.summary}，仅本次运行生效。`);
    this.emit();
  }

  async dispose(): Promise<void> {
    this.cancelLogin();
    this.loginDraft = null;
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
