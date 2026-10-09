import { AppError } from '../support/errors.js';
import { writeFactIdentity } from './write-recovery.js';

export type WriteRateAction = 'Subject' | 'Character' | 'Person' | 'Index' | 'IndexEdit' | 'Episode';
export interface WriteRateRule { readonly limit: number; readonly windowMs: number }
/** 上游固定规则：https://github.com/bangumi/server-private/blob/1103c280c6e256db6ce4a28f2a7b16774d907a13/lib/utils/rate-limit/index.ts */
export const WRITE_RATE_RULES: Readonly<Record<WriteRateAction, WriteRateRule>> = Object.freeze({
  Subject: Object.freeze({ limit: 15, windowMs: 300_000 }),
  Character: Object.freeze({ limit: 15, windowMs: 300_000 }),
  Person: Object.freeze({ limit: 15, windowMs: 300_000 }),
  Index: Object.freeze({ limit: 10, windowMs: 300_000 }),
  IndexEdit: Object.freeze({ limit: 15, windowMs: 300_000 }),
  Episode: Object.freeze({ limit: 10, windowMs: 300_000 }),
});
export interface WriteRateRequest { action: WriteRateAction; count: number }
export interface WriteRateWait extends WriteRateRequest { accountId: number; nextAllowedAt: number }
export interface WriteRateReservation {
  readonly action: WriteRateAction;
  readonly count: number;
  /** RPC 返回后记录实际尝试数；限流拒绝和投递未知也消耗额度。 */
  dispatched(count?: number): void;
  /** 只有回执明确未发送的阶段才能退还；已 dispatched 的额度不可退还。 */
  refundUndispatched(count?: number): void;
}

/** 计数对应真实 HTTP 阶段；宿主须将超过窗口容量的复合操作拆成独立阶段再调度。 */
export function writeRateRequests(name: string, args: Record<string, unknown>): WriteRateRequest[] {
  if (name === 'update_subject_collection') {
    const fields = ['collection_type', 'rating', 'comment', 'tags', 'private'].some(key => Object.hasOwn(args, key));
    const progress = ['ep_status', 'vol_status'].some(key => Object.hasOwn(args, key));
    // 书籍进度 PATCH 与收藏 PUT 在上游共用 Subject，不能只按逻辑项算一次。
    const count = Number(fields) + Number(progress);
    if (!count) throw new AppError('INVALID_INPUT', '收藏写入没有实际网络阶段。');
    return [{ action: 'Subject', count }];
  }
  if (name === 'update_episode_collection') {
    if (!Array.isArray(args.episode_ids) || !args.episode_ids.length) throw new AppError('INVALID_INPUT', '章节写入没有实际网络阶段。');
    return [{ action: 'Episode', count: args.episode_ids.length }];
  }
  if (name === 'update_single_episode_collection') return [{ action: 'Episode', count: 1 }];
  if (name === 'collect_character' || name === 'uncollect_character') return [{ action: 'Character', count: 1 }];
  if (name === 'collect_person' || name === 'uncollect_person') return [{ action: 'Person', count: 1 }];
  if (name === 'collect_index' || name === 'uncollect_index') return [{ action: 'Index', count: 1 }];
  if (['create_index', 'update_index', 'add_subject_to_index', 'update_index_subject', 'remove_subject_from_index'].includes(name)) return [{ action: 'IndexEdit', count: 1 }];
  throw new AppError('UNKNOWN_TOOL', '写入工具没有登记上游限流规则，未发送请求。');
}

/** 启动时重建额度一次；提交回执覆盖同阶段 started，未发出的阶段不消耗额度。 */
export function restoreWriteRateLimits(limiter: WriteRateLimiter, facts: readonly Record<string, unknown>[]): void {
  const stages = new Map<string, { started?: Record<string, unknown>; submission?: Record<string, unknown> }>();
  const modernOperations = new Set<string>();
  const plain = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  const restoreCooldown = (fact: Record<string, unknown>, accountId: number, action: WriteRateAction, at: number) => {
    const error = plain(fact.submissionError) ?? plain(fact.error);
    if (!['BGM_HTTP_429', 'BGM_RATE_LIMIT_REJECTED'].includes(String(error?.code))) return;
    const retryAfterMs = plain(error?.rejection)?.retryAfterMs;
    const delayMs = typeof retryAfterMs === 'number' && Number.isSafeInteger(retryAfterMs) && retryAfterMs > 0 && retryAfterMs <= 86_400_000
      ? Math.max(WRITE_RATE_RULES[action].windowMs, retryAfterMs) : WRITE_RATE_RULES[action].windowMs;
    limiter.limited(accountId, action, at + delayMs + 1_000);
  };
  for (const fact of facts) {
    if (fact.kind !== 'bangumi-write' || (fact.phase !== 'started' && fact.phase !== 'submission') || typeof fact.stageId !== 'string' || !fact.stageId) continue;
    if (typeof fact.operationId === 'string') modernOperations.add(fact.operationId);
    const stage = stages.get(fact.stageId) ?? {};
    if (fact.phase === 'submission') stage.submission = fact;
    else stage.started = fact;
    stages.set(fact.stageId, stage);
  }
  for (const stage of stages.values()) {
    const fact = stage.submission ?? stage.started!;
    if (stage.submission && (fact.stageWriteNetworkAttempted ?? fact.writeNetworkAttempted) !== true) continue;
    // 旧事实未登记额度字段时不猜测；其他新事实字段错误则明确阻塞启动。
    if (fact.rateAction === undefined && fact.rateCount === undefined) continue;
    const accountId = fact.accountId;
    const action = fact.rateAction;
    const count = fact.rateCount;
    const at = typeof fact.attemptedAt === 'string' ? Date.parse(fact.attemptedAt) : typeof fact.recordedAt === 'string' ? Date.parse(fact.recordedAt) : Number.NaN;
    if (typeof accountId !== 'number' || !Number.isSafeInteger(accountId) || accountId < 1 || typeof action !== 'string' || !Object.hasOwn(WRITE_RATE_RULES, action)
      || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1 || count > 200 || !Number.isFinite(at)) throw new AppError('WRITE_RATE_FACT_INVALID', '写入事实的账户、动作、阶段计数或时间无效，不能重置未决额度。');
    limiter.rememberDispatched(accountId, action as WriteRateAction, count, at);
    restoreCooldown(fact, accountId, action as WriteRateAction, at);
  }
  // 旧版本未分阶段记录时，按同一操作最新事实保守重建；不叠加现代操作的逻辑摘要。
  const legacy = new Map<string, Record<string, unknown>>();
  for (const fact of facts) {
    if (fact.kind !== 'bangumi-write' || fact.stageId !== undefined || fact.rateAction !== undefined || typeof fact.tool !== 'string'
      || typeof fact.operationId === 'string' && modernOperations.has(fact.operationId)) continue;
    const key = writeFactIdentity(fact);
    legacy.set(key, fact);
  }
  for (const fact of legacy.values()) {
    if (!(fact.writeNetworkAttempted === true || fact.writeNetworkAttempted === undefined && fact.networkAttempted === true)) continue;
    const accountId = fact.accountId;
    const at = typeof fact.attemptedAt === 'string' ? Date.parse(fact.attemptedAt) : typeof fact.recordedAt === 'string' ? Date.parse(fact.recordedAt) : Number.NaN;
    if (typeof accountId !== 'number' || !Number.isSafeInteger(accountId) || accountId < 1 || !Number.isFinite(at)) continue;
    const args = plain(fact.args) ?? {};
    const receiptItems = plain(fact.submission)?.items;
    const receiptCount = Array.isArray(receiptItems) && receiptItems.length <= 201 && receiptItems.every(item => ['acknowledged', 'unknown', 'rejected', 'not_attempted'].includes(String(plain(item)?.submissionState)))
      ? receiptItems.filter(item => plain(item)?.submissionState !== 'not_attempted').length : undefined;
    for (const request of writeRateRequests(String(fact.tool), args)) {
      limiter.rememberDispatched(accountId, request.action, receiptCount ?? request.count, at);
      restoreCooldown(fact, accountId, request.action, at);
    }
  }
}

interface Unit { expiresAt: number | null }
interface Bucket { units: Set<Unit>; changed: Set<() => void>; blockedUntil: number }
interface LimiterOptions {
  /** 离线测试可注入时钟与等待，生产使用真实时钟。 */
  now?: () => number;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  safetyMarginMs?: number;
}
function cancelled(signal?: AbortSignal): void { if (signal?.aborted) throw new AppError('CANCELLED', '额度等待已取消，未发送请求。'); }
function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new AppError('CANCELLED', '额度等待已取消，未发送请求。')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

/**
 * 启动器创建一个实例供全部会话共享。等待发生在宿主发起 MCP RPC 之前，
 * 不占用 MCP 的单次请求超时。保守滑动窗口兼容上游固定窗口，并覆盖响应延迟。
 */
export class WriteRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly now: () => number;
  private readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  private readonly safetyMarginMs: number;
  constructor(options: LimiterOptions = {}) {
    this.now = options.now ?? Date.now;
    this.wait = options.wait ?? delay;
    this.safetyMarginMs = options.safetyMarginMs ?? 1_000;
    if (!Number.isFinite(this.safetyMarginMs) || this.safetyMarginMs < 0) throw new AppError('INVALID_INPUT', '额度时钟余量无效。');
  }
  private bucket(accountId: number, action: WriteRateAction): Bucket {
    if (!Number.isSafeInteger(accountId) || accountId <= 0 || !Object.hasOwn(WRITE_RATE_RULES, action)) throw new AppError('INVALID_INPUT', '额度账户或动作无效。');
    const key = `${accountId}:${action}`;
    let value = this.buckets.get(key);
    if (!value) { value = { units: new Set(), changed: new Set(), blockedUntil: 0 }; this.buckets.set(key, value); }
    for (const unit of value.units) if (unit.expiresAt !== null && unit.expiresAt <= this.now()) value.units.delete(unit);
    return value;
  }
  private changed(bucket: Bucket): void { for (const listener of [...bucket.changed]) listener(); }
  /** 网站其他客户端也可能消耗共享额度；遇到明确 429 后关闭这一动作的窗口。 */
  limited(accountId: number, action: WriteRateAction, nextAllowedAt?: number): void {
    const bucket = this.bucket(accountId, action);
    const until = nextAllowedAt ?? this.now() + WRITE_RATE_RULES[action].windowMs + this.safetyMarginMs;
    if (!Number.isFinite(until)) throw new AppError('INVALID_INPUT', '额度恢复时间无效。');
    bucket.blockedUntil = Math.max(bucket.blockedUntil, until);
    this.changed(bucket);
  }
  /** 从宿主持久记录恢复已尝试阶段，不把重启误当成全新额度窗口。 */
  rememberDispatched(accountId: number, action: WriteRateAction, count: number, completedAt: number): void {
    if (!Number.isSafeInteger(count) || count < 0 || !Number.isFinite(completedAt)) throw new AppError('INVALID_INPUT', '历史额度事实无效。');
    const bucket = this.bucket(accountId, action);
    const expiresAt = completedAt + WRITE_RATE_RULES[action].windowMs + this.safetyMarginMs;
    if (expiresAt > this.now()) for (let index = 0; index < count; index++) bucket.units.add({ expiresAt });
    this.changed(bucket);
  }
  async reserve(accountId: number, action: WriteRateAction, count = 1, options: { signal?: AbortSignal; onWait?: (event: WriteRateWait) => void } = {}): Promise<WriteRateReservation> {
    const rule = WRITE_RATE_RULES[action];
    if (!rule || !Number.isSafeInteger(count) || count < 1 || count > rule.limit) throw new AppError('INVALID_INPUT', '单次网络阶段额度无效，请先拆分复合写操作。');
    for (;;) {
      cancelled(options.signal);
      const bucket = this.bucket(accountId, action);
      const now = this.now(); const free = rule.limit - bucket.units.size;
      if (free >= count && bucket.blockedUntil <= now) {
        const units = Array.from({ length: count }, () => ({ expiresAt: null } as Unit));
        for (const unit of units) bucket.units.add(unit);
        const take = (amount: number | undefined): Unit[] => {
          const available = units.filter(unit => unit.expiresAt === null && bucket.units.has(unit));
          const size = amount ?? available.length;
          if (!Number.isSafeInteger(size) || size < 0 || size > available.length) throw new AppError('INVALID_INPUT', '额度结案数超过尚未提交阶段。');
          return available.slice(0, size);
        };
        return { action, count,
          dispatched: amount => { for (const unit of take(amount)) unit.expiresAt = this.now() + rule.windowMs + this.safetyMarginMs; this.changed(bucket); },
          refundUndispatched: amount => { for (const unit of take(amount)) bucket.units.delete(unit); this.changed(bucket); },
        };
      }
      const expiry = [...bucket.units].map(unit => unit.expiresAt ?? now + rule.windowMs + this.safetyMarginMs).sort((a, b) => a - b);
      const nextAllowedAt = Math.max(bucket.blockedUntil, free < count ? expiry[count - free - 1]! : now);
      try { options.onWait?.({ accountId, action, count, nextAllowedAt }); } catch { /* 状态展示不能改变提交。 */ }
      await this.waitForChange(bucket, Math.max(1, Math.min(60_000, nextAllowedAt - now)), options.signal);
    }
  }
  private async waitForChange(bucket: Bucket, milliseconds: number, signal?: AbortSignal): Promise<void> {
    cancelled(signal);
    const controller = new AbortController();
    let wake!: () => void;
    const changed = new Promise<void>(resolve => { wake = resolve; bucket.changed.add(wake); });
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    try { await Promise.race([changed, this.wait(milliseconds, controller.signal)]); }
    finally { bucket.changed.delete(wake); signal?.removeEventListener('abort', abort); controller.abort(); }
    cancelled(signal);
  }
}
