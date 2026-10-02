import type { OperationExecutor, ExecutionOutcome } from '../../core/operations.js';
import type { PlannedAction } from '../../domain/permissions.js';
import type { Collection, Episode } from '../../domain/bangumi.js';
import type { BangumiWriteClient } from './write-client.js';
import { AppError } from '../../domain/errors.js';
import { setTimeout as delay } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';

function equal(a: unknown, b: unknown): boolean { return isDeepStrictEqual(a, b); }
function episodeState(episodes: Episode[]) { return episodes.map(ep => [ep.id, ep.number, ep.type, ep.status]).sort((a,b) => Number(a[0]) - Number(b[0])); }
export class BgmOperationExecutor implements OperationExecutor {
  constructor(private readonly client: BangumiWriteClient, private readonly verifyDelayMs = 350,
    private readonly onPhase?: (phase: 'writing' | 'verifying', subjectId: number) => void) {}
  async matchesCurrent(accountId: number, action: PlannedAction, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    if (action.kind === 'delete') throw new AppError('UNSUPPORTED_OPERATION', '条目取消收藏暂未开放。');
    if (!action.baseline || (await this.client.currentUser(signal)).id !== accountId) return false;
    const subject = await this.client.subject(action.subjectId, signal);
    if (subject.id !== action.subjectId || subject.type !== action.baseline.type) return false;
    if (!equal(await this.client.collectionSnapshot(action.subjectId, signal), action.baseline.collection)) return false;
    if (action.baseline.episodes && !equal(episodeState((await this.client.progressEpisodes(action.subjectId, accountId, signal)).data), episodeState(action.baseline.episodes))) return false;
    return (await this.client.currentUser(signal)).id === accountId;
  }
  async execute(accountId: number, action: PlannedAction, signal: AbortSignal): Promise<'success' | 'failed' | 'unknown' | ExecutionOutcome> {
    if (action.kind === 'delete') throw new AppError('UNSUPPORTED_OPERATION', '条目取消收藏暂未开放。');
    if (!action.baseline) throw new AppError('UNSUPPORTED_OPERATION', '此写入缺少必要现状或不受支持。');
    // journal.started 后再核查一次，避免批量等待或记录写入期间现状改变。
    if (!await this.matchesCurrent(accountId, action, signal)) return 'failed';
    const expected: Collection = structuredClone(action.baseline.collection ?? { subjectId: action.subjectId, status: null, rate: 0, tags: [], comment: '', private: false, chapters: 0, volumes: 0 });
    const expectedEpisodes = structuredClone(action.baseline.episodes);
    for (const change of [...action.changes, ...action.effects]) {
      if (change.field.startsWith('episode:')) {
        const ep = expectedEpisodes?.find(ep => ep.id === Number(change.field.slice(8)));
        if (!ep || typeof change.after !== 'number') throw new AppError('INVALID_INPUT', '章节计划无效。');
        ep.status = change.after;
      } else (expected as unknown as Record<string, unknown>)[change.field] = change.after;
    }
    let submissionFailed = false; let definitivelyRejected = false; let submitted = 0;
    this.onPhase?.('writing', action.subjectId);
    try {
      if (action.kind === 'collection') {
        const { status, rate, tags, comment, private: privacy } = expected;
        await this.client.mutate(action.subjectId, accountId, { kind: 'collection', patch: { status, rate, tags, comment, private: privacy } }, signal);
      } else if (action.baseline.type === 'book') {
        const patch = Object.fromEntries(action.changes.map(change => [change.field === 'chapters' ? 'epStatus' : 'volStatus', change.after]));
        await this.client.mutate(action.subjectId, accountId, { kind: 'book', patch }, signal);
      } else {
        for (const change of action.changes) {
          signal.throwIfAborted();
          if ((await this.client.currentUser(signal)).id !== accountId) throw new AppError('ACCOUNT_CHANGED', '进度更新期间账户改变。');
          await this.client.mutate(Number(change.field.slice(8)), accountId, { kind: 'episode', subjectId: action.subjectId, status: change.after, expectedStatus: change.before }, signal);
          submitted++;
        }
      }
    } catch (error) {
      submissionFailed = true;
      definitivelyRejected = submitted === 0 && error instanceof AppError && /^BGM_HTTP_(400|401|403|404|429)$/.test(error.code);
    }
    // 超时/取消后的核查用独立 signal：只回读，不重复发送；最多三轮，有界等待。
    const verification = AbortSignal.timeout(30000);
    this.onPhase?.('verifying', action.subjectId);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if ((await this.client.currentUser(verification)).id !== accountId) return 'unknown';
        const actual = await this.client.collectionSnapshot(action.subjectId, verification);
        if (!actual) return 'unknown';
        let match: boolean;
        let actualEpisodes: Episode[] | undefined;
        if (expectedEpisodes) {
          actualEpisodes = (await this.client.progressEpisodes(action.subjectId, accountId, verification)).data;
          // 章节计数由网站自动维护；收藏状态和用户字段必须仍与原值一致。
          const fields = ['status','rate','tags','comment','private','volumes'] as const;
          match = fields.every(field => equal(actual[field], expected[field])) && equal(episodeState(actualEpisodes), episodeState(expectedEpisodes));
        } else match = equal(actual, expected);
        if ((await this.client.currentUser(verification)).id !== accountId) return 'unknown';
        const fields = action.changes.map(change => ({ field: change.field, state: (equal(change.field.startsWith('episode:')
          ? actualEpisodes?.find(ep => ep.id === Number(change.field.slice(8)))?.status : actual[change.field as keyof Collection], change.after) ? 'success' : 'failed') as 'success' | 'failed' }));
        if (match) return { state: 'success', fields };
        if (attempt === 2) return { state: submissionFailed && !definitivelyRejected ? 'unknown' : 'failed', fields };
      } catch { if (attempt === 2) return 'unknown'; }
      try { await delay(this.verifyDelayMs, undefined, { signal: verification }); } catch { return 'unknown'; }
    }
    return 'unknown';
  }
}
