import { randomBytes } from 'node:crypto';
import { AppError } from '../support/errors.js';
import { normalizeSubject } from './account-read.js';
import type { AccessContext } from './access-context.js';
import type { McpRequestOptions, McpTransport } from './transport.js';
import { entitySummary } from './resource-output.js';

type Data = Record<string, unknown>;
export type AppearanceMeaning = 'main' | 'supporting' | 'guest' | 'unknown';
export type SubjectForm = 'tv' | 'ova' | 'movie' | 'web' | 'other';
export interface AppearanceRole { code: number | null; meaning: AppearanceMeaning; label: string | null }
export interface PersonCharactersReadOptions {
  /** 仅宿主候选适配请求额外资格缺口；原生输出与筛选保持不变。 */
  candidateMode?: boolean;
  /** 宿主绑定本机登录会话版本；模型不能指定。 */
  scopeKey: string;
  readAccount: (path: string, options: McpRequestOptions) => Promise<unknown>;
  verifyScope?: () => Promise<void>;
  /** 仅发现R18匹配边时由宿主懒核权限；模型不能提供。 */
  resolveNsfw?: () => Promise<boolean>;
}
type BoundReadOptions = PersonCharactersReadOptions & { assertCurrent: () => void };
export interface AppearanceCoverage {
  complete: boolean; sourceComplete: boolean; sourceTotal: number; sourceReturnedCount: number;
  sourceUnit: 'character' | 'appearance'; relationTotal: number; matchedRelationTotal: number;
  matchedSubjectTotal: number; unknownSubjectFormIds: number[]; unavailableSubjectIds: number[];
  unavailableCollectionSubjectIds: number[];
}
interface SubjectFacts { airDate: string | null; platform: string | null; form: SubjectForm | null; score: number | null; ratingCount: number | null }
interface OwnCollection { state: 'collected' | 'not_collected' | 'unavailable'; collectionStatus: number | null; chapters: number | null; volumes: number | null }
interface Edge { character: Data; subject: Data; staff: string | null; appearanceRole: AppearanceRole; sourceTypeCode: number | null }
interface SubjectRead { subject: Data; facts: SubjectFacts; collection: OwnCollection | undefined; unavailable: boolean }
export interface AppearanceCandidateEvidence { unknownRoleSubjectIds: number[] }
interface Snapshot { key: string; rows: Data[]; coverage: AppearanceCoverage; candidateEvidence?: AppearanceCandidateEvidence; expires: number; enhanced: boolean; readAt: string; account: AccessContext['account']; size: number }
interface FailureMemo { error: AppError; expires: number }

const TTL_MS = 10 * 60_000;
const MAX_SNAPSHOTS = 8;
const MAX_SNAPSHOT_BYTES = 8_000_000;
const MAX_SOURCE_ROWS = 10_000;
const PAGE_SIZE = 100;
const meanings: AppearanceMeaning[] = ['unknown', 'main', 'supporting', 'guest'];
const labels = ['其他', '主角', '配角', '客串'];
const record = (value: unknown, path: string): Data => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(path, '对象');
  return value as Data;
};
function invalid(path: string, expected: string): never {
  throw new AppError('INVALID_RESPONSE', `人物出演响应字段 ${path} 应为${expected}；改变分页大小不能修复该契约错误。`);
}
function id(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) invalid(path, '正安全整数');
  return value;
}
const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const text = (value: unknown): string | null => typeof value === 'string' ? value : null;
const subjectType = (value: unknown): number | null => typeof value === 'number' && [1, 2, 3, 4, 6].includes(value) ? value : null;
function roleFromCode(value: unknown, path: string): AppearanceRole {
  const code = count(value); if (code === null) invalid(path, '非负安全整数出演关系码');
  return { code, meaning: meanings[code] ?? 'unknown', label: labels[code] ?? null };
}
function roleFromText(value: unknown): AppearanceRole {
  if (value !== undefined && value !== null && typeof value !== 'string') invalid('/staff', '字符串或空值');
  const label = text(value), code = label === null ? -1 : labels.indexOf(label.trim());
  return { code: code >= 0 ? code : null, meaning: code >= 0 ? meanings[code]! : 'unknown', label };
}
function character(value: unknown, path: string): Data {
  const raw = record(value, path); const result = { id: raw.id, name: raw.name, type: raw.type ?? raw.role, name_cn: raw.name_cn ?? raw.nameCN ?? raw.nameCn, nsfw: raw.nsfw };
  // 实体类型单独核实，不用出演关系覆盖角色实体的 type/role。
  entitySummary(result, 'character');
  return result;
}
function subject(value: unknown, path: string): Data {
  const raw = record(value, path); id(raw.id, `${path}/id`);
  if (raw.type !== undefined && raw.type !== null && subjectType(raw.type) === null) invalid(`${path}/type`, '有效作品类型或空值');
  if (raw.nsfw !== undefined && raw.nsfw !== null && typeof raw.nsfw !== 'boolean') invalid(`${path}/nsfw`, '布尔值或未知');
  const normalized = normalizeSubject(raw);
  return { id: normalized.id, name: normalized.name, name_cn: normalized.name_cn, type: normalized.type,
    date: normalized.date, platform: normalized.platform, meta_tags: normalized.meta_tags,
    rating: normalized.rating, score: normalized.score, ratingCount: normalized.ratingCount, nsfw: normalized.nsfw };
}
function subjectReference(raw: Data): Data { return { id: raw.id, name: raw.name, name_cn: raw.name_cn, type: raw.type, nsfw: raw.nsfw }; }
function edgeKey(edge: Edge): string { return JSON.stringify([edge.character.id, edge.subject.id, edge.appearanceRole.code, edge.staff]); }
function enhanced(args: Data): boolean {
  return ['subject_type', 'appearance_role', 'subject_form', 'include', 'snapshot_ref'].some(key => Object.hasOwn(args, key));
}
function binding(args: Data, context: AccessContext, scope: string): string {
  return JSON.stringify([context.source === 'p1' ? scope : 'public', context.source,
    context.source === 'p1' ? context.account?.id ?? null : null,
    context.source === 'p1' ? context.account?.username ?? null : null,
    args.person_id,
    args.subject_type ?? null, args.appearance_role ?? null, args.subject_form ?? null,
    [...(Array.isArray(args.include) ? args.include as string[] : [])].sort()]);
}
function formLabel(value: string): SubjectForm | null {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (['tv', 'tv动画', 'tv動畫', '电视动画', '電視動畫', 'tv series'].includes(normalized)) return 'tv';
  if (['ova', 'oad', 'ova/oad'].includes(normalized)) return 'ova';
  if (['movie', '映画', '剧场版', '劇場版', '电影', '電影', 'theatrical'].includes(normalized)) return 'movie';
  if (['web', 'ona', 'web动画', 'web動畫', '网络动画', '網絡動畫', '网络放送', '網路動畫'].includes(normalized)) return 'web';
  if (['other', '其他', '其它', 'mv', 'cm', 'sp', 'tv sp', 'special', '短片'].includes(normalized)) return 'other';
  return null;
}
/** 只采用明确的平台/元标签形式，普通用户标签、名称和简介不能证明 TV。 */
function subjectForm(raw: Data): SubjectForm | null {
  const values: string[] = [];
  if (typeof raw.platform === 'string') values.push(raw.platform);
  else if (raw.platform !== undefined && raw.platform !== null) {
    const platform = record(raw.platform, '/subject/platform');
    for (const field of ['nameCN', 'nameCn', 'name', 'alias']) if (typeof platform[field] === 'string') values.push(platform[field] as string);
  }
  const tags = raw.meta_tags ?? raw.metaTags;
  if (tags !== undefined && tags !== null) {
    if (!Array.isArray(tags) || tags.some(value => typeof value !== 'string')) invalid('/subject/metaTags', '文本数组或空值');
    values.push(...tags as string[]);
  }
  const forms = new Set(values.map(formLabel).filter((value): value is SubjectForm => value !== null));
  return forms.size === 1 ? [...forms][0]! : null;
}
function facts(raw: Data): SubjectFacts {
  const normalized = normalizeSubject(raw); const rating = raw.rating == null ? {} : record(raw.rating, '/subject/rating');
  const score = rating.score ?? raw.score; const total = rating.total ?? raw.ratingCount;
  return { airDate: text(normalized.date), platform: text(normalized.platform), form: subjectForm(raw),
    score: typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 10 ? score : null,
    ratingCount: count(total) };
}
/** 与既有本人未收藏基线一致：只有完整认证 p1 详情可证明省略 interest 是未收藏。 */
function completeUncollected(raw: Data): boolean {
  const isObject = (value: unknown) => value !== null && typeof value === 'object' && !Array.isArray(value);
  return subjectType(raw.type) !== null && ['name', 'nameCN', 'summary', 'info'].every(key => typeof raw[key] === 'string') && Boolean(String(raw.name).trim())
    && ['eps', 'volumes', 'redirect', 'seriesEntry'].every(key => count(raw[key]) !== null)
    && ['locked', 'nsfw', 'series'].every(key => typeof raw[key] === 'boolean')
    && ['airtime', 'collection', 'platform', 'rating'].every(key => isObject(raw[key]))
    && ['infobox', 'metaTags', 'tags'].every(key => Array.isArray(raw[key]));
}
function ownCollection(raw: Data): OwnCollection {
  const unavailable: OwnCollection = { state: 'unavailable', collectionStatus: null, chapters: null, volumes: null };
  if (raw.interest === undefined || raw.interest === null) return completeUncollected(raw)
    ? { state: 'not_collected', collectionStatus: null, chapters: null, volumes: null } : unavailable;
  if (typeof raw.interest !== 'object' || Array.isArray(raw.interest)) return unavailable;
  const interest = raw.interest as Data;
  if (typeof interest.type !== 'number' || ![1, 2, 3, 4, 5].includes(interest.type)) return unavailable;
  return { state: 'collected', collectionStatus: interest.type,
    chapters: count(interest.epStatus ?? interest.ep_status), volumes: count(interest.volStatus ?? interest.vol_status) };
}

/** 人物→角色→作品固定关系联接；快照仅在本连接、查询、会话及权限绑定内续读。 */
export class PersonCharactersQuery {
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly failures = new Map<string, FailureMemo>();
  private snapshotBytes = 0;
  private generation = 0;
  constructor(private readonly transport: McpTransport) {}
  clear(): void { this.generation++; this.snapshots.clear(); this.failures.clear(); this.snapshotBytes = 0; }
  private removeSnapshot(ref: string): void {
    const snapshot = this.snapshots.get(ref); if (!snapshot) return;
    this.snapshotBytes -= snapshot.size; this.snapshots.delete(ref);
  }
  private prune(): void {
    const now = Date.now();
    for (const [ref, snapshot] of this.snapshots) if (snapshot.expires <= now) this.removeSnapshot(ref);
    for (const [key, entry] of this.failures) if (entry.expires <= now) this.failures.delete(key);
  }
  private page(snapshot: Snapshot, ref: string, args: Data): Data {
    const limit = Number(args.limit), offset = Number(args.offset), data = snapshot.rows.slice(offset, offset + limit);
    return { data: structuredClone(data), total: snapshot.rows.length, limit, offset, readAt: snapshot.readAt,
      nextOffset: offset + data.length < snapshot.rows.length ? offset + data.length : null,
      complete: offset === 0 && data.length === snapshot.rows.length,
      ...(snapshot.account ? { account: structuredClone(snapshot.account) } : {}),
      ...(enhanced(args) ? { snapshotRef: ref, coverage: structuredClone(snapshot.coverage) } : {}) };
  }
  async call(args: Data, context: AccessContext, signal: AbortSignal | undefined, options: PersonCharactersReadOptions): Promise<Data> {
    signal?.throwIfAborted(); this.prune();
    const generation = this.generation;
    const assertCurrent = () => {
      signal?.throwIfAborted();
      if (generation !== this.generation) throw new AppError('SNAPSHOT_EXPIRED', '人物出演查询范围已失效，未继续读取或发布过期快照；请从 offset=0 重新查询。');
    };
    const boundOptions: BoundReadOptions = { ...options, assertCurrent, readAccount: async (path, requestOptions) => {
      assertCurrent(); const value = await options.readAccount(path, requestOptions); assertCurrent(); return value;
    } };
    const verifyScope = async () => { assertCurrent(); await options.verifyScope?.(); assertCurrent(); };
    const include = Array.isArray(args.include) ? args.include as string[] : [];
    if (include.includes('own_collection') && !context.account) throw new AppError('BGM_AUTH_REQUIRED', '读取本人收藏状态须先登录；未使用匿名收藏推断未收藏。');
    if (args.subject_form !== undefined && args.subject_type !== 2) throw new AppError('INVALID_INPUT', 'subject_form 仅适用于 subject_type=2 的动画查询。');
    if (include.includes('own_collection')) context.source = 'p1';
    context.nsfwApplied = context.source === 'p1' && context.nsfw.allowed === true && context.nsfw.preference !== false;
    const key = JSON.stringify([binding(args, context, options.scopeKey), options.candidateMode === true]), wantsEnhanced = enhanced(args);
    if (args.snapshot_ref !== undefined) {
      const ref = String(args.snapshot_ref), snapshot = this.snapshots.get(ref);
      if (!snapshot) throw new AppError('SNAPSHOT_EXPIRED', '人物出演查询快照已过期或不属于当前连接，请从 offset=0 重新查询。');
      if (snapshot.key !== key) throw new AppError('SNAPSHOT_SCOPE_MISMATCH', '快照与当前人物、筛选、字段组、会话、账户或权限不一致。');
      await verifyScope(); return { ...this.page(snapshot, ref, args), ...(options.candidateMode ? { candidateEvidence: structuredClone(snapshot.candidateEvidence) } : {}) };
    }
    if (wantsEnhanced && Number(args.offset) > 0) throw new AppError('INVALID_INPUT', '筛选后分页必须携带首个结果的 snapshot_ref，避免重新扫描或混用不同快照。');
    // 旧参数续页兼容，但只能复用同一宿主绑定下已完整成功的关系快照。
    if (!wantsEnhanced && Number(args.offset) > 0) {
      const prior = [...this.snapshots].reverse().find(([, snapshot]) => snapshot.key === key && !snapshot.enhanced);
      if (prior) { await verifyScope(); return this.page(prior[1], prior[0], args); }
    }
    const failed = this.failures.get(key); if (failed) throw failed.error;
    try {
      const result = await this.read(args, context, signal, boundOptions);
      const restricted = (row: Data) => row.nsfw === true || (row.subject as Data).nsfw === true;
      if (result.rows.some(restricted)) {
        assertCurrent();
        const allowed = context.account !== null && (context.nsfw.allowed === true && context.nsfw.preference !== false
          || await options.resolveNsfw?.() === true);
        assertCurrent();
        if (!allowed) {
          const blocked = result.rows.filter(restricted).map(row => Number((row.subject as Data).id));
          result.rows = result.rows.filter(row => !restricted(row));
          result.coverage = { ...result.coverage, complete: false, matchedRelationTotal: result.rows.length,
            matchedSubjectTotal: new Set(result.rows.map(row => (row.subject as Data).id)).size,
            unavailableSubjectIds: [...new Set([...result.coverage.unavailableSubjectIds, ...blocked])].sort((a, b) => a - b) };
        }
      }
      await verifyScope();
      const ref = randomBytes(16).toString('hex');
      const size = Buffer.byteLength(JSON.stringify(result), 'utf8');
      if (size > MAX_SNAPSHOT_BYTES) throw new AppError('FIELD_LIMIT', '人物出演完整快照超过内存范围，未截断关系或覆盖缺口。');
      while (this.snapshots.size >= MAX_SNAPSHOTS || this.snapshotBytes + size > MAX_SNAPSHOT_BYTES) this.removeSnapshot(this.snapshots.keys().next().value!);
      const snapshot: Snapshot = { key, ...result, expires: Date.now() + TTL_MS, enhanced: wantsEnhanced,
        readAt: new Date().toISOString(), account: include.includes('own_collection') ? structuredClone(context.account) : null, size };
      assertCurrent();
      this.snapshots.set(ref, snapshot); this.snapshotBytes += size;
      return { ...this.page(snapshot, ref, args), ...(options.candidateMode ? { candidateEvidence: structuredClone(snapshot.candidateEvidence) } : {}) };
    } catch (error) {
      if (generation !== this.generation) assertCurrent();
      if (generation === this.generation && error instanceof AppError && error.code === 'INVALID_RESPONSE') {
        if (error.recovery === undefined) Object.defineProperty(error, 'recovery', { value: { stage: 'response_contract', retryable: false }, enumerable: true });
        this.failures.set(key, { error, expires: Date.now() + TTL_MS });
        while (this.failures.size > MAX_SNAPSHOTS) this.failures.delete(this.failures.keys().next().value!);
      }
      throw error;
    }
  }
  private async source(args: Data, context: AccessContext, signal: AbortSignal | undefined, options: BoundReadOptions): Promise<{ edges: Edge[]; sourceTotal: number; sourceReturnedCount: number; sourceUnit: 'character' | 'appearance' }> {
    const personId = Number(args.person_id), edges: Edge[] = [], seen = new Set<string>();
    let sourceBytes = 0;
    const append = (edge: Edge) => {
      const key = edgeKey(edge); if (seen.has(key)) invalid('/relations', '无重复的角色、作品及出演关系组合');
      sourceBytes += Buffer.byteLength(JSON.stringify(edge), 'utf8');
      if (sourceBytes > MAX_SNAPSHOT_BYTES) throw new AppError('FIELD_LIMIT', '人物出演关系展开超过内存范围，未截断角色组或作品关系。');
      seen.add(key); edges.push(edge);
    };
    if (context.source !== 'p1') {
      options.assertCurrent();
      const raw = await this.transport.public(`/v0/persons/${personId}/characters`, {}, signal); options.assertCurrent();
      if (!Array.isArray(raw)) invalid('/data', '公共出演关系数组');
      if (raw.length > MAX_SOURCE_ROWS) throw new AppError('INCOMPLETE_DATA', '公共出演关系超过完整读取上限，未截断结果。');
      raw.forEach((value, index) => {
        const row = record(value, `/data/${index}`), nested = row.subject === undefined ? {
          id: row.subject_id, name: row.subject_name, name_cn: row.subject_name_cn, type: row.subject_type,
        } : row.subject;
        const related = subject(nested, `/data/${index}/subject`);
        if (row.subject !== undefined) {
          for (const [flat, normalized] of [['subject_id', 'id'], ['subject_type', 'type'], ['subject_name', 'name'], ['subject_name_cn', 'name_cn']] as const) {
            if (Object.hasOwn(row, flat) && row[flat] !== related[normalized]) invalid(`/data/${index}/${flat}`, '与嵌套作品字段一致的值');
          }
        }
        append({ character: character(row, `/data/${index}`), subject: related,
          staff: text(row.staff), appearanceRole: roleFromText(row.staff), sourceTypeCode: count(row.type) });
      });
      return { edges, sourceTotal: raw.length, sourceReturnedCount: raw.length, sourceUnit: 'appearance' };
    }
    if (!context.account) throw new AppError('BGM_AUTH_REQUIRED', '账户出演源需要已核实身份。');
    const characterIds = new Set<number>(); let total: number | undefined, returned = 0;
    const role = args.appearance_role as AppearanceMeaning | undefined;
    const roleCode = options.candidateMode || role === undefined || role === 'unknown' ? undefined : meanings.indexOf(role);
    for (let offset = 0; offset < MAX_SOURCE_ROWS; offset += PAGE_SIZE) {
      options.assertCurrent();
      const page = record(await options.readAccount(`/p1/persons/${personId}/casts`, { expectedAccountId: context.account.id,
        query: { limit: PAGE_SIZE, offset, ...(args.subject_type === undefined ? {} : { subjectType: args.subject_type }), ...(roleCode === undefined ? {} : { type: roleCode }) } }), '/page');
      options.assertCurrent(); const nextTotal = count(page.total);
      if (!Array.isArray(page.data)) invalid('/page/data', '角色组数组');
      if (nextTotal === null) invalid('/page/total', '非负安全整数角色组总数');
      if (nextTotal > MAX_SOURCE_ROWS || total !== undefined && nextTotal !== total
        || page.limit !== undefined && page.limit !== PAGE_SIZE || page.offset !== undefined && page.offset !== offset
        || page.data.length !== Math.min(PAGE_SIZE, Math.max(0, nextTotal - offset))) {
        throw new AppError('INCOMPLETE_DATA', '人物出演源分页范围、总数或记录数量不完整，未继续扫描。');
      }
      total = nextTotal;
      page.data.forEach((value, index) => {
        const path = `/data/${offset + index}`, group = record(value, path), entity = character(group.character, `${path}/character`);
        const characterId = id(entity.id, `${path}/character/id`);
        if (characterIds.has(characterId)) invalid(`${path}/character/id`, '跨页无重复的角色ID');
        characterIds.add(characterId);
        if (!Array.isArray(group.relations)) invalid(`${path}/relations`, '作品出演关系数组');
        for (const [relationIndex, value] of group.relations.entries()) {
          const relationPath = `${path}/relations/${relationIndex}`, relation = record(value, relationPath), appearanceRole = roleFromCode(relation.type, `${relationPath}/type`);
          append({ character: entity, subject: subject(relation.subject, `${relationPath}/subject`), staff: appearanceRole.label, appearanceRole, sourceTypeCode: appearanceRole.code });
        }
      });
      returned += page.data.length;
      if (returned === total) return { edges, sourceTotal: total, sourceReturnedCount: returned, sourceUnit: 'character' };
    }
    throw new AppError('INCOMPLETE_DATA', '人物出演源分页未覆盖完整范围。');
  }
  private async read(args: Data, context: AccessContext, signal: AbortSignal | undefined, options: BoundReadOptions): Promise<{ rows: Data[]; coverage: AppearanceCoverage; candidateEvidence?: AppearanceCandidateEvidence }> {
    const source = await this.source(args, context, signal, options), include = Array.isArray(args.include) ? args.include as string[] : [];
    const includeFacts = include.includes('subject_facts') || args.subject_form !== undefined, includeOwn = include.includes('own_collection');
    const candidates = source.edges.filter(edge => (args.appearance_role === undefined || edge.appearanceRole.meaning === args.appearance_role
      || options.candidateMode && edge.appearanceRole.meaning === 'unknown')
      && (args.subject_type === undefined || subjectType(edge.subject.type) === null || edge.subject.type === args.subject_type));
    const subjects = new Map<number, Data>();
    for (const edge of candidates) {
      const subjectId = Number(edge.subject.id), previous = subjects.get(subjectId);
      if (previous && subjectType(previous.type) !== null && subjectType(edge.subject.type) !== null && previous.type !== edge.subject.type) invalid('/relations/subject/type', '同作品一致的类型');
      if (!previous) subjects.set(subjectId, edge.subject);
    }
    const reads = new Map<number, SubjectRead>(), unknown = new Set<number>(), unavailable = new Set<number>(), unavailableCollections = new Set<number>();
    const values = [...subjects], needsForm = args.subject_form !== undefined || includeFacts;
    let next = 0, failure: unknown;
    const worker = async () => {
      while (failure === undefined) {
        const value = values[next++]; if (!value) return;
        const [subjectId, summary] = value;
        try {
          options.assertCurrent(); let resolved = summary, detail: Data | undefined, missing = false;
          const summaryFacts = facts(summary), summaryType = subjectType(summary.type);
          const typeMatches = args.subject_type === undefined || summaryType === null || summaryType === args.subject_type;
          const formMatches = args.subject_form === undefined || summaryFacts.form === null || summaryFacts.form === args.subject_form;
          const needDetail = typeMatches && formMatches && ((args.subject_type !== undefined && summaryType === null)
            || needsForm && summaryFacts.form === null || includeOwn);
          if (needDetail) {
            try {
              const raw = context.source === 'p1' && context.account
                ? await options.readAccount(`/p1/subjects/${subjectId}`, { expectedAccountId: context.account.id })
                : await this.transport.public(`/v0/subjects/${subjectId}`, {}, signal);
              options.assertCurrent(); detail = record(raw, `/subjects/${subjectId}`);
              if (detail.id !== subjectId) invalid(`/subjects/${subjectId}/id`, '与请求相同的作品ID');
              const detailedType = subjectType(detail.type);
              if (detail.type !== undefined && detailedType === null || summaryType !== null && detailedType !== null && summaryType !== detailedType) invalid(`/subjects/${subjectId}/type`, '与关系摘要一致的合法作品类型');
              // 详情是一次独立读取的作品证据，不把旧摘要的冲突标签混进新详情。
              resolved = subject(detail, `/subjects/${subjectId}`);
            } catch (error) {
              if (!(error instanceof AppError) || error.code !== 'BGM_HTTP_404') throw error;
              missing = true; unavailable.add(subjectId);
            }
          }
          const resolvedFacts = facts(resolved);
          let collection: OwnCollection | undefined;
          const resolvedTypeMatches = args.subject_type === undefined || resolved.type === args.subject_type;
          const resolvedFormMatches = args.subject_form === undefined || resolvedFacts.form === args.subject_form;
          if (needsForm && resolvedTypeMatches && resolved.type === 2 && resolvedFacts.form === null) unknown.add(subjectId);
          if (args.subject_type !== undefined && subjectType(resolved.type) === null) unavailable.add(subjectId);
          if (includeOwn && resolvedTypeMatches && (resolvedFormMatches || args.subject_form === undefined)) {
            collection = detail && !missing ? ownCollection(detail) : { state: 'unavailable', collectionStatus: null, chapters: null, volumes: null };
            if (collection.state === 'unavailable') unavailableCollections.add(subjectId);
          }
          reads.set(subjectId, { subject: resolved, facts: resolvedFacts, collection, unavailable: missing });
        } catch (error) { if (failure === undefined) failure = error; }
      }
    };
    // readAccount 是宿主提供的不可变只读范围；首次失败停止派发，并等待所有已派发读取结束。
    await Promise.all(Array.from({ length: Math.min(4, values.length) }, () => worker()));
    if (failure !== undefined) throw failure;
    options.assertCurrent();
    const rows: Data[] = [];
    for (const edge of candidates) {
      const resolved = reads.get(Number(edge.subject.id))!;
      if (args.appearance_role !== undefined && edge.appearanceRole.meaning !== args.appearance_role) continue;
      if (args.subject_type !== undefined && resolved.subject.type !== args.subject_type || args.subject_form !== undefined && resolved.facts.form !== args.subject_form) continue;
      rows.push({ ...edge.character, subject: subjectReference(resolved.subject), staff: edge.staff, appearanceRole: edge.appearanceRole, source_type_code: edge.sourceTypeCode,
        ...(includeFacts ? { subjectFacts: resolved.facts } : {}), ...(includeOwn ? { ownCollection: resolved.collection! } : {}) });
    }
    const ids = (values: Set<number>) => [...values].sort((a, b) => a - b);
    const confirmed = new Set(candidates.filter(edge => args.appearance_role === undefined || edge.appearanceRole.meaning === args.appearance_role)
      .map(edge => Number(edge.subject.id))), unknownRoles = new Set<number>();
    if (options.candidateMode && args.appearance_role !== undefined && args.appearance_role !== 'unknown') for (const edge of candidates) {
      const subjectId = Number(edge.subject.id), resolved = reads.get(subjectId)!;
      if (edge.appearanceRole.meaning !== 'unknown' || confirmed.has(subjectId)) continue;
      if (args.subject_type !== undefined && subjectType(resolved.subject.type) !== null && resolved.subject.type !== args.subject_type) continue;
      if (args.subject_form !== undefined && resolved.facts.form !== null && resolved.facts.form !== args.subject_form) continue;
      unknownRoles.add(subjectId);
    }
    return { rows, ...(options.candidateMode ? { candidateEvidence: { unknownRoleSubjectIds: ids(unknownRoles) } } : {}), coverage: { complete: unknown.size === 0 && unavailable.size === 0 && unavailableCollections.size === 0,
      sourceComplete: true, sourceTotal: source.sourceTotal, sourceReturnedCount: source.sourceReturnedCount, sourceUnit: source.sourceUnit,
      relationTotal: source.edges.length, matchedRelationTotal: rows.length, matchedSubjectTotal: new Set(rows.map(row => (row.subject as Data).id)).size,
      unknownSubjectFormIds: ids(unknown), unavailableSubjectIds: ids(unavailable), unavailableCollectionSubjectIds: ids(unavailableCollections) } };
  }
}
