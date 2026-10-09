import { randomBytes } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { anonymousContext, type AccessContext } from './access-context.js';
import { AppError } from '../support/errors.js';
import type { McpTransport } from './transport.js';

type Data = Record<string, unknown>;
type TextSource = Data;
interface StoredRow { dto: Data; text: string | null; state: 'available' | 'unavailable' | 'unsupported_shape'; source: TextSource; reason?: 'hidden' | 'not_exposed' }
type Stored = { kind: 'text'; source: TextSource; chars: string[] } | { kind: 'page'; key: string; rows: StoredRow[] };
interface CacheEntry { value: Stored; size: number; expires: number; viewer: string }
export interface CommunityReaderOptions { now?: () => number; ttlMs?: number; maxEntries?: number; maxChars?: number }

const record = (value: unknown): Data => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('INVALID_RESPONSE', '社区资料必须是对象。');
  return value as Data;
};
const positive = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new AppError('INVALID_RESPONSE', '社区资料缺少有效资源ID。');
  return Number(value);
};
const count = (value: unknown): number | null => {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new AppError('INVALID_RESPONSE', '社区计数字段类型或范围错误。');
  return value;
};
function nullableCode(value: unknown, allowed: readonly number[]): number | null {
  if (value == null) return null;
  if (typeof value !== 'number' || !allowed.includes(value)) throw new AppError('INVALID_RESPONSE', '社区评分或收藏状态类型、范围错误。');
  return value;
}
function hiddenState(value: unknown): boolean {
  const state = count(value);
  if (state === null) throw new AppError('INVALID_RESPONSE', '社区楼层缺少状态，不能推断正文可见。');
  return [1, 2, 5, 6, 7].includes(state);
}
function string(value: unknown, max: number, required = false): string | null {
  if (value == null && !required) return null;
  if (typeof value !== 'string' || required && !value.trim()) throw new AppError('INVALID_RESPONSE', '社区元资料文本类型或内容无效。');
  if (Array.from(value).length > max) throw new AppError('FIELD_LIMIT', '社区元资料超过固定字段范围。');
  return value;
}
function author(value: unknown, expected?: unknown): Data | null {
  if (value == null) return null;
  const raw = record(value); const id = positive(raw.id);
  if (expected !== undefined && id !== positive(expected)) throw new AppError('INVALID_RESPONSE', '社区资料作者归属不一致。');
  return { id, username: string(raw.username, 100), nickname: string(raw.nickname, 300) };
}
function time(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 253402300799) throw new AppError('INVALID_RESPONSE', '社区资料时间无效。');
  return new Date(value * 1000).toISOString();
}

/** 统一为可续读的纯文本视图，链接、图片位置和引用保留；不执行来源标记。 */
export function communityPlainText(value: string): string {
  const normalized = value.replace(/\r\n?/g, '\n');
  // BBCode的code区包含原始代码；不得把里面的HTML或实体再次当标记处理。
  return normalized.split(/(\[code(?:=[^\]]*)?\][\s\S]*?\[\/code\])/gi).map(part => {
    if (/^\[code(?:=[^\]]*)?\]/i.test(part)) return part.replace(/^\[code(?:=[^\]]*)?\]/i, '代码：\n').replace(/\[\/code\]$/i, '\n');
    return part
    .replace(/\[url=([^\]\r\n]+)\]([\s\S]*?)\[\/url\]/gi, '$2 ($1)')
    .replace(/\[url\]([\s\S]*?)\[\/url\]/gi, '$1')
    .replace(/\[img(?:=[^\]]*)?\]([\s\S]*?)\[\/img\]/gi, '[图片：$1]')
    .replace(/\[quote(?:=([^\]]*))?\]/gi, (_tag, by: string | undefined) => `\n引用${by ? `（${by}）` : ''}：\n`).replace(/\[\/quote\]/gi, '\n')
    .replace(/\[\/?list(?:=[^\]]*)?\]/gi, '\n').replace(/\[\*\]/g, '\n• ')
    .replace(/\[\/?(?:b|i|u|s|size|color|font|align|center|left|right|collapse)(?:=[^\]]*)?\]/gi, '');
  }).join('');
}
function storedRow(dto: Data, value: unknown, source: TextSource, hidden = false, plain = false): StoredRow {
  if (hidden) return { dto, text: null, state: 'unavailable', source, reason: 'hidden' };
  if (value == null) return { dto, text: null, state: 'unavailable', source, reason: 'not_exposed' };
  if (typeof value !== 'string') return { dto, text: null, state: 'unsupported_shape', source };
  return { dto, text: plain ? value.replace(/\r\n?/g, '\n') : communityPlainText(value), state: 'available', source };
}

/** 缓存仅属于本实例并绑定查看账户及NSFW权限；引用不能访问路径、会话或其他实例。 */
export class CommunityReader {
  private readonly viewer = new AsyncLocalStorage<AccessContext>();
  private fullViews = new WeakMap<Data, Data>();
  private textRefs = new WeakMap<StoredRow, { viewer: string; ref: string }>();
  private viewerKey(): string {
    const context = this.viewer.getStore(), accountSource = context?.mode === 'account' && context.source === 'p1';
    return JSON.stringify(['p1', accountSource ? context.account?.id ?? null : null, accountSource && context.nsfwApplied && context.nsfw.allowed === true]);
  }
  private request(path: string, options: import('./transport.js').McpRequestOptions, signal?: AbortSignal): Promise<unknown> {
    const context = this.viewer.getStore(); const account = context?.source === 'p1' ? context.account : null;
    return account ? this.transport.account(path, { ...options, expectedAccountId: account.id }, signal) : this.transport.community(path, options, signal);
  }
  private readonly entries = new Map<string, CacheEntry>();
  private readonly expired = new Set<string>();
  private chars = 0;
  private readonly now: () => number;
  private readonly ttl: number;
  private readonly maxEntries: number;
  private readonly maxChars: number;
  constructor(private readonly transport: McpTransport, options: CommunityReaderOptions = {}) {
    this.now = options.now ?? Date.now;
    this.ttl = options.ttlMs ?? 10 * 60_000;
    this.maxEntries = options.maxEntries ?? 256;
    this.maxChars = options.maxChars ?? 8_000_000;
    if (![this.ttl, this.maxEntries, this.maxChars].every(n => Number.isSafeInteger(n) && n > 0)) throw new AppError('INVALID_INPUT', '社区缓存配置无效。');
  }
  clear(): void { this.entries.clear(); this.expired.clear(); this.chars = 0; this.fullViews = new WeakMap(); this.textRefs = new WeakMap(); }
  /** 返回已取得且核实过的完整正文视图；不读取网络，也不暴露原始标记。 */
  completeResource(value: Data): Data { return structuredClone(this.fullViews.get(value) ?? value); }
  private detailed(envelope: Data, row: Data): Data {
    const result = { ...envelope, ...row };
    this.fullViews.set(result, { ...envelope, ...(this.fullViews.get(row) ?? row) });
    return result;
  }
  private remove(ref: string): void {
    const entry = this.entries.get(ref);
    if (!entry) return;
    this.chars -= entry.size; this.entries.delete(ref); this.expired.add(ref);
    if (this.expired.size > 512) this.expired.delete(this.expired.values().next().value!);
  }
  private put(value: Stored, pins: Set<string>): string {
    const size = JSON.stringify(value).length;
    if (size > this.maxChars) throw new AppError('COMMUNITY_CACHE_LIMIT', '社区来源超过快照缓存上限，请缩小读取范围。');
    for (const [ref, entry] of this.entries) if (entry.expires <= this.now()) this.remove(ref);
    while (this.entries.size >= this.maxEntries || this.chars + size > this.maxChars) {
      const ref = [...this.entries.keys()].find(key => !pins.has(key));
      if (!ref) throw new AppError('COMMUNITY_CACHE_LIMIT', '本次社区读取超过快照缓存上限，请缩小范围。');
      this.remove(ref);
    }
    const ref = `${value.kind === 'text' ? 'ct' : 'pg'}_${randomBytes(24).toString('base64url')}`;
    this.entries.set(ref, { value, size, expires: this.now() + this.ttl, viewer: this.viewerKey() }); this.chars += size; pins.add(ref);
    return ref;
  }
  private get(ref: string, kind: Stored['kind']): Stored {
    const entry = this.entries.get(ref);
    if (!entry) throw new AppError(this.expired.has(ref) ? 'CONTENT_REF_EXPIRED' : 'CONTENT_REF_INVALID', '社区引用已过期或无效，请重新读取对应来源。');
    if (entry.viewer !== this.viewerKey()) throw new AppError('CONTENT_REF_INVALID', '账户或NSFW权限改变，不能续读旧权限范围的社区快照。');
    if (entry.expires <= this.now()) { this.remove(ref); throw new AppError('CONTENT_REF_EXPIRED', '社区引用已过期，请重新读取对应来源。'); }
    if (entry.value.kind !== kind) throw new AppError('CONTENT_REF_INVALID', '社区引用类型不匹配。');
    return entry.value;
  }
  private content(ref: string, chars: string[], offset: number, limit: number): Data {
    if (offset > chars.length) throw new AppError('CONTENT_RANGE_INVALID', '正文偏移超过内容长度。');
    const text = chars.slice(offset, offset + limit).join(''); const returnedChars = Math.min(limit, chars.length - offset); const end = offset + returnedChars;
    return { state: 'available', format: 'plain_text', contentRef: ref, text,
      range: { offset, returnedChars, totalChars: chars.length, nextOffset: end < chars.length ? end : null }, isFullText: offset === 0 && end === chars.length };
  }
  private expand(row: StoredRow, include: string[], limit: number, pins: Set<string>, excerptOrigin = 'content_prefix'): Data {
    const result = { ...row.dto };
    let complete: Data = { ...result };
    if (excerptOrigin === 'upstream_summary') {
      const chars = row.text === null ? null : Array.from(row.text);
      complete.excerpt = chars === null ? null : { text: chars.slice(0, 300).join(''), origin: excerptOrigin, truncated: chars.length > 300 };
    } else if (Object.keys(row.source).length) {
      if (row.state === 'unavailable') complete.content = { state: 'unavailable', reason: row.reason ?? 'not_exposed' };
      else if (row.state === 'unsupported_shape') complete.content = { state: 'unsupported_shape' };
      else {
        const chars = Array.from(row.text!), previous = this.textRefs.get(row);
        const old = previous?.viewer === this.viewerKey() ? this.entries.get(previous.ref) : undefined;
        const ref = old && old.expires > this.now() ? previous!.ref : this.put({ kind: 'text', source: row.source, chars }, pins);
        pins.add(ref); this.textRefs.set(row, { viewer: this.viewerKey(), ref });
        complete.content = { state: 'available', format: 'plain_text', contentRef: ref, text: row.text,
          range: { offset: 0, returnedChars: chars.length, totalChars: chars.length, nextOffset: null }, isFullText: true };
      }
    }
    if (include.includes('excerpt')) {
      const chars = row.text === null ? null : Array.from(row.text);
      result.excerpt = chars === null ? null : { text: chars.slice(0, 300).join(''), origin: excerptOrigin, truncated: chars.length > 300 };
    }
    if (include.includes('content')) {
      if (row.state === 'unavailable') result.content = { state: 'unavailable', reason: row.reason ?? 'not_exposed' };
      else if (row.state === 'unsupported_shape') result.content = { state: 'unsupported_shape' };
      else {
        const chars = Array.from(row.text!); const cached = complete.content as Data | undefined;
        const ref = typeof cached?.contentRef === 'string' ? cached.contentRef : this.put({ kind: 'text', source: row.source, chars }, pins);
        result.content = this.content(ref, chars, 0, limit);
      }
    }
    this.fullViews.set(result, complete);
    return result;
  }
  private envelope(args: Data, kind: string, entity?: string): Data {
    return { schemaVersion: 1, kind, ...(entity ? { entity, included: args.include ?? [] } : {}), scope: structuredClone(args), visibility: 'public', readAt: new Date(this.now()).toISOString() };
  }
  private page(args: Data, entity: string, rows: StoredRow[], total: number, source: 'upstream' | 'host', pins: Set<string>, snapshotRef?: string, excerptOrigin?: string): Data {
    const offset = Number(args.offset); const limit = Number(args.limit);
    const data = rows.map(row => this.expand(row, args.include as string[] ?? [], 500, pins, excerptOrigin));
    const result = { ...this.envelope(args, 'page', entity), data,
      page: { paginationSource: source, total, limit, offset, returnedCount: rows.length, nextOffset: offset + rows.length < total ? offset + rows.length : null,
        complete: offset === 0 && rows.length === total, ...(snapshotRef ? { snapshotRef } : {}) } };
    this.fullViews.set(result, { ...result, data: data.map(row => this.fullViews.get(row) ?? row) });
    return result;
  }
  private async upstream(args: Data, entity: string, path: string, map: (raw: Data) => StoredRow, pins: Set<string>, signal?: AbortSignal, origin?: string): Promise<Data> {
    const limit = Number(args.limit); const offset = Number(args.offset);
    const value = record(await this.request(path, { query: { limit, offset } }, signal));
    const total = count(value.total);
    if (total === null || !Array.isArray(value.data) || value.data.length !== Math.min(limit, Math.max(0, total - offset))
      || value.limit !== undefined && value.limit !== limit || value.offset !== undefined && value.offset !== offset) throw new AppError('INCOMPLETE_DATA', '社区分页数量、总数或范围不一致。');
    return this.page(args, entity, value.data.map(raw => map(record(raw))), total, 'upstream', pins, undefined, origin);
  }
  private flatten(value: unknown, kind: 'blog' | 'topic', id: number, subjectId?: number): StoredRow[] {
    if (!Array.isArray(value)) throw new AppError('INVALID_RESPONSE', '社区回复清单必须是数组。');
    const rows: StoredRow[] = []; const seen = new Set<number>(); let lastRoot = 0;
    const visit = (item: unknown, parentId: number | null, rootId?: number): void => {
      const raw = record(item); const postId = positive(raw.id); const root = rootId ?? postId;
      if (seen.has(postId)) throw new AppError('INVALID_RESPONSE', '社区回复清单含重复记录。'); seen.add(postId);
      if (kind === 'blog' && (positive(raw.mainID) !== id || raw.relatedID !== (parentId ?? 0))) throw new AppError('INVALID_RESPONSE', '日志评论归属或回复关系不一致。');
      if (kind === 'topic' && parentId === null) {
        if (postId <= lastRoot) throw new AppError('INVALID_RESPONSE', '讨论主楼顺序不一致。'); lastRoot = postId;
      }
      if (parentId !== null && raw.replies !== undefined && (!Array.isArray(raw.replies) || raw.replies.length)) throw new AppError('INVALID_RESPONSE', '社区回复层级超过固定范围。');
      const dto: Data = { id: postId, ...(kind === 'blog' ? { blogId: id } : { subjectId, topicId: id }), parentId, rootId: root,
        author: author(kind === 'blog' ? raw.user : raw.creator, raw.creatorID), createdAt: time(raw.createdAt), url: kind === 'blog' ? `https://bgm.tv/blog/${id}` : `https://bgm.tv/subject/topic/${id}` };
      const source = kind === 'blog' ? { kind: 'blogComment', blogId: id, commentId: postId } : { kind: 'topicPost', subjectId, topicId: id, postId };
      // 非正常楼层只报告不可用，避免上游被遮蔽的空内容冒充原文为空。
      rows.push(storedRow(dto, raw.content, source, hiddenState(raw.state)));
      if (parentId === null) {
        if (!Array.isArray(raw.replies)) throw new AppError('INVALID_RESPONSE', '社区评论缺少固定回复清单。');
        for (const child of raw.replies) visit(child, postId, root);
      }
    };
    for (const item of value) visit(item, null);
    return rows;
  }
  private checkedTopic(value: unknown, args: Data): Data {
    const raw = record(value); const sid = positive(args.subject_id); const tid = positive(args.topic_id);
    if (positive(raw.id) !== tid || positive(raw.parentID) !== sid || positive(record(raw.subject).id) !== sid) throw new AppError('INVALID_RESPONSE', '讨论返回了其他主题或条目。');
    return raw;
  }
  private mainPost(raw: Data): Data {
    if (!Array.isArray(raw.replies) || !raw.replies.length) throw new AppError('INCOMPLETE_DATA', '讨论缺少可核实的主帖。');
    const first = record(raw.replies[0]);
    if (positive(first.creatorID) !== positive(raw.creatorID) || first.createdAt !== raw.createdAt) throw new AppError('INCOMPLETE_DATA', '讨论主帖作者或创建时间不一致。');
    return first;
  }
  private topicMeta(raw: Data, sid: number): Data {
    const id = positive(raw.id);
    if (positive(raw.parentID) !== sid) throw new AppError('INVALID_RESPONSE', '讨论列表返回了其他条目。');
    return { topicId: id, subjectId: sid, title: string(raw.title, 300, true), author: author(raw.creator, raw.creatorID), createdAt: time(raw.createdAt), updatedAt: time(raw.updatedAt), replyCount: count(raw.replyCount), url: `https://bgm.tv/subject/topic/${id}` };
  }
  async call(name: string, args: Data, signal?: AbortSignal, context: AccessContext = anonymousContext()): Promise<Data> {
    return this.viewer.run(context, () => this.execute(name, args, signal));
  }
  private async execute(name: string, args: Data, signal?: AbortSignal): Promise<Data> {
    signal?.throwIfAborted();
    const pins = new Set<string>();
    const result = await this.read(name, args, pins, signal);
    signal?.throwIfAborted();
    for (const ref of pins) {
      const entry = this.entries.get(ref);
      if (!entry || entry.expires <= this.now()) { this.remove(ref); throw new AppError('CONTENT_REF_EXPIRED', '社区快照在读取期间到期，请重新读取对应来源。'); }
    }
    return result;
  }
  private async read(name: string, args: Data, pins: Set<string>, signal?: AbortSignal): Promise<Data> {
    if (name === 'read_community_content') {
      const ref = String(args.content_ref); const entry = this.get(ref, 'text');
      if (entry.kind !== 'text') throw new AppError('CONTENT_REF_INVALID', '正文引用无效。');
      pins.add(ref);
      return { ...this.envelope(args, 'content_chunk'), source: structuredClone(entry.source), content: this.content(ref, entry.chars, Number(args.offset), Number(args.limit)) };
    }
    const sid = Number(args.subject_id); const bid = Number(args.blog_id); const tid = Number(args.topic_id);
    if (name === 'get_subject_comments') return this.upstream(args, 'subjectComment', `/p1/subjects/${sid}/comments`, raw => {
      const id = positive(raw.id);
      return storedRow({ id, subjectId: sid, author: author(raw.user), rating: nullableCode(raw.rate, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
        collectionStatus: nullableCode(raw.type, [1, 2, 3, 4, 5]), updatedAt: time(raw.updatedAt), url: `https://bgm.tv/subject/${sid}/comments` }, raw.comment, { kind: 'subjectComment', subjectId: sid, commentId: id }, false, true);
    }, pins, signal);
    if (name === 'get_subject_reviews') return this.upstream(args, 'subjectReview', `/p1/subjects/${sid}/reviews`, raw => {
      const entry = record(raw.entry); const blogId = positive(entry.id);
      if (entry.public !== true) throw new AppError('PRIVATE_SCOPE', '社区长评列表返回了非公开日志。');
      return storedRow({ relationId: positive(raw.id), blogId, subjectId: sid, title: string(entry.title, 300, true), author: author(entry.user ?? raw.user, entry.uid),
        createdAt: time(entry.createdAt), updatedAt: time(entry.updatedAt), replyCount: count(entry.replies), url: `https://bgm.tv/blog/${blogId}` }, entry.summary, { kind: 'blog', blogId });
    }, pins, signal, 'upstream_summary');
    if (name === 'get_subject_topics') return this.upstream(args, 'subjectTopic', `/p1/subjects/${sid}/topics`, raw => storedRow(this.topicMeta(raw, sid), null, {}), pins, signal);
    if (name === 'get_blog_details') {
      const raw = record(await this.request(`/p1/blogs/${bid}`, {}, signal));
      if (positive(raw.id) !== bid || raw.public !== true) throw new AppError('PRIVATE_SCOPE', '日志归属或公开范围不一致。');
      const meta = { blogId: bid, title: string(raw.title, 300, true), author: author(raw.user, raw.uid), createdAt: time(raw.createdAt), updatedAt: time(raw.updatedAt), replyCount: count(raw.replies), url: `https://bgm.tv/blog/${bid}` };
      return this.detailed(this.envelope(args, 'details', 'blog'), this.expand(storedRow(meta, raw.content, { kind: 'blog', blogId: bid }), args.include as string[], 5000, pins));
    }
    if (name === 'get_subject_topic_details') {
      const raw = this.checkedTopic(await this.request(`/p1/subjects/-/topics/${tid}`, {}, signal), args);
      const meta = this.topicMeta(raw, sid);
      let row = storedRow(meta, null, {});
      {
        this.flatten(raw.replies, 'topic', tid, sid);
        const first = this.mainPost(raw);
        row = storedRow(meta, first.content, { kind: 'topicPost', subjectId: sid, topicId: tid, postId: positive(first.id) }, hiddenState(first.state));
      }
      return this.detailed(this.envelope(args, 'details', 'subjectTopic'), this.expand(row, args.include as string[], 5000, pins));
    }
    if (name === 'get_blog_comments' || name === 'get_subject_topic_replies') {
      const key = name === 'get_blog_comments' ? `blog:${bid}` : `topic:${sid}:${tid}`;
      let ref: string; let rows: StoredRow[];
      if (args.snapshot_ref !== undefined) {
        ref = String(args.snapshot_ref); const entry = this.get(ref, 'page');
        if (entry.kind !== 'page' || entry.key !== key) throw new AppError('CONTENT_REF_INVALID', '评论快照不属于本次资源。');
        pins.add(ref); rows = entry.rows;
      } else {
        if (name === 'get_blog_comments') {
          // 认证接口可能允许查看本人私密日志；先核实公开资源，再建立公开评论快照。
          const blog = record(await this.request(`/p1/blogs/${bid}`, {}, signal));
          if (positive(blog.id) !== bid) throw new AppError('INVALID_RESPONSE', '日志评论所属日志与请求不一致。');
          if (blog.public !== true) throw new AppError('PRIVATE_SCOPE', '日志评论缺少公开日志范围证明。');
          rows = this.flatten(await this.request(`/p1/blogs/${bid}/comments`, {}, signal), 'blog', bid);
        }
        else {
          const raw = this.checkedTopic(await this.request(`/p1/subjects/-/topics/${tid}`, {}, signal), args);
          const mainId = positive(this.mainPost(raw).id);
          rows = this.flatten(raw.replies, 'topic', tid, sid).filter(row => row.dto.id !== mainId);
        }
        ref = this.put({ kind: 'page', key, rows }, pins);
      }
      const offset = Number(args.offset); const limit = Number(args.limit);
      return this.page(args, name === 'get_blog_comments' ? 'blogComment' : 'topicPost', rows.slice(offset, offset + limit), rows.length, 'host', pins, ref);
    }
    throw new AppError('UNKNOWN_TOOL', '社区工具没有固定读取映射。');
  }
}
