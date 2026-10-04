import { AppError } from '../support/errors.js';
import { compileSchema, type JsonSchema } from '../support/tool-schema.js';
import { checkOutput } from './subject-output.js';
import { normalizeInfobox } from './infobox-output.js';
import { isDeepStrictEqual } from 'node:util';

export type Data = Record<string, unknown>;
const known = (value: unknown): value is Data => value !== null && typeof value === 'object' && !Array.isArray(value);
export function record(value: unknown): Data { if (!known(value)) throw new AppError('INVALID_RESPONSE', '资料响应不是对象。'); return value; }
export function positive(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new AppError('INVALID_RESPONSE', '资料缺少合法对象ID。'); return value; }
const integer = (value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | null => {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new AppError('INVALID_RESPONSE', '资料整数字段类型或范围错误。');
  return value;
};
const number = (value: unknown): number | null => {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new AppError('INVALID_RESPONSE', '资料数字字段类型错误。');
  return value;
};
const text = (value: unknown): string | null => {
  if (value == null) return null;
  if (typeof value !== 'string') throw new AppError('INVALID_RESPONSE', '资料文本字段类型错误。');
  return value;
};
const boolean = (value: unknown): boolean | null => {
  if (value == null) return null;
  if (typeof value !== 'boolean') throw new AppError('INVALID_RESPONSE', '资料布尔字段类型错误。');
  return value;
};
function alias(raw: Data, ...fields: string[]): unknown {
  const values = fields.map(field => raw[field]).filter(value => value !== undefined && value !== null);
  if (values.some(value => !isDeepStrictEqual(value, values[0]))) throw new AppError('INVALID_RESPONSE', `资料字段 ${fields.join('/')} 相互冲突。`);
  return values[0] ?? null;
}
const list = (value: unknown): unknown[] => { if (!Array.isArray(value)) throw new AppError('INVALID_RESPONSE', '资料清单不是数组。'); return value; };
const strings = (value: unknown): string[] | null => value == null ? null : list(value).map(item => { if (typeof item !== 'string') throw new AppError('INVALID_RESPONSE', '文本清单字段类型错误。'); return item; });
const now = (): string => new Date().toISOString();
/** 已核实p1收藏使用Unix秒；公共ISO字符串按明确格式解析，不按位数猜单位。 */
export function readTime(value: unknown, unixSeconds = false): string | null {
  if (value == null || unixSeconds && value === 0 || value === '') return null;
  if (unixSeconds && typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 253402300799) return new Date(value * 1000).toISOString();
  const match = typeof value === 'string' ? /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value) : null;
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) throw new AppError('INVALID_RESPONSE', '资料时间格式或单位错误。');
  const day = new Date(`${match[1]}T00:00:00.000Z`), date = new Date(value as string);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== match[1] || !Number.isFinite(date.getTime())) throw new AppError('INVALID_RESPONSE', '资料时间包含不存在的日期。');
  return date.toISOString();
}
function account(value: unknown): Data { const raw = record(value); if (typeof raw.username !== 'string' || !raw.username.trim()) throw new AppError('INVALID_RESPONSE', '账户缺少用户名。'); return { id: positive(raw.id), username: raw.username }; }
const url = (value: unknown): string | null => {
  if (value == null) return null;
  if (typeof value !== 'string') throw new AppError('INVALID_RESPONSE', '图片地址类型错误。');
  let parsed: URL; try { parsed = new URL(value); } catch { throw new AppError('INVALID_RESPONSE', '图片地址无效。'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new AppError('INVALID_RESPONSE', '图片地址必须是无凭据的HTTPS地址。');
  return value;
};
export function entitySummary(value: unknown, kind: 'character' | 'person'): Data {
  const raw = record(value); const id = positive(raw.id); if (typeof raw.name !== 'string' || !raw.name.trim()) throw new AppError('INVALID_RESPONSE', '实体缺少名称。');
  const type = kind === 'character' ? alias(raw, 'type', 'role') : raw.type; const valid = kind === 'character' ? [1, 2, 3, 4] : [1, 2, 3];
  if (type != null && (typeof type !== 'number' || !valid.includes(type))) throw new AppError('INVALID_RESPONSE', '实体类型无效。');
  return { schemaVersion: 1, entity: kind, id, name: raw.name,
    ...(kind === 'character' ? { characterType: valid.includes(Number(type)) && typeof type === 'number' ? type : null }
      : { personType: valid.includes(Number(type)) && typeof type === 'number' ? type : null, career: strings(raw.career) }),
    nsfw: boolean(raw.nsfw), url: `https://bgm.tv/${kind}/${id}` };
}
function stats(value: unknown): Data | null {
  if (value == null) return null;
  const raw = record(value), comments = integer(raw.comments), collects = integer(raw.collects);
  if (comments === null || collects === null) throw new AppError('INVALID_RESPONSE', '资料统计对象字段不完整。');
  return { comments, collects };
}
function indexSubjectTotal(raw: Data): number | null {
  if (raw.stats === undefined || raw.stats === null) return raw.uid !== undefined || raw.createdAt !== undefined ? null : integer(raw.total);
  const source = record(record(raw.stats).subject); let total = 0;
  for (const [key, value] of Object.entries(source)) {
    if (!['anime', 'book', 'music', 'game', 'real'].includes(key)) throw new AppError('INVALID_RESPONSE', '目录作品统计包含未知媒体类型。');
    const count = integer(value); if (count === null) throw new AppError('INVALID_RESPONSE', '目录作品统计缺少有效计数。');
    total += count;
    if (!Number.isSafeInteger(total)) throw new AppError('INVALID_RESPONSE', '目录作品统计超过安全范围。');
  }
  return total;
}
function details(value: unknown, kind: 'character' | 'person', args: Data): Data {
  const raw = record(value); const result: Data = { ...entitySummary(raw, kind), included: args.include, readAt: now() };
  for (const field of args.include as string[]) {
    if (field === 'summary') result.summary = text(raw.summary);
    if (field === 'infobox') result.infobox = normalizeInfobox(raw.infobox);
    if (field === 'stats') result.stats = stats(raw.stat ?? (raw.comment !== undefined || raw.collects !== undefined ? { comments: raw.comment, collects: raw.collects } : null));
    if (field === 'bio') {
      const birthYear = integer(raw.birth_year, 1, 9999), birthMonth = integer(raw.birth_mon, 1, 12), birthDay = integer(raw.birth_day, 1, 31);
      // 缺少年份允许 2 月 29 日；已有完整生日必须是实际存在的日期。
      if (birthMonth !== null && birthDay !== null) {
        const year = birthYear ?? 2000, date = `${String(year).padStart(4, '0')}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`;
        if (new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) throw new AppError('INVALID_RESPONSE', '实体生日不存在。');
      }
      result.bio = { gender: text(raw.gender), bloodType: integer(raw.blood_type, 1, 4), birthYear, birthMonth, birthDay };
    }
  }
  return result;
}
export function episodeSummary(value: unknown, parent?: number): Data {
  const raw = record(value); const id = positive(raw.id); const subjectId = positive(alias(raw, 'subject_id', 'subjectID') ?? parent);
  if (parent !== undefined && subjectId !== parent) throw new AppError('INVALID_RESPONSE', '章节与请求作品不一致。');
  if (typeof raw.type !== 'number' || ![0, 1, 2, 3, 4, 5, 6].includes(raw.type)) throw new AppError('INVALID_RESPONSE', '章节类型无效。');
  return { schemaVersion: 1, entity: 'episode', id, subjectId, episodeType: raw.type, name: text(raw.name) ?? '', nameCn: text(alias(raw, 'name_cn', 'nameCN')),
    sort: number(raw.sort), mainSequence: raw.type === 0 ? number(raw.ep) : null, airDate: text(raw.airdate), disc: integer(raw.disc), duration: text(raw.duration), durationSeconds: integer(raw.duration_seconds), url: `https://bgm.tv/ep/${id}` };
}
/** p1 可省略未标记的 collection；只有完整 IEpisode 才能把省略转换为 0。服务须在补字段前调用。 */
export function episodeCollectionStatus(value: unknown): number {
  const raw = record(value); const state = raw.collection == null ? {} : record(raw.collection);
  if (raw.collection == null && !(typeof raw.type === 'number' && typeof raw.sort === 'number' && Number.isFinite(raw.sort)
    && integer(raw.disc) !== null && ['name', 'duration', 'airdate', 'desc'].every(key => typeof raw[key] === 'string')
    && typeof alias(raw, 'name_cn', 'nameCN') === 'string' && integer(raw.comment) !== null)) throw new AppError('INCOMPLETE_COLLECTION', '缺少个人标记的章节快照不完整，不能推断未标记。');
  const status = raw.collection == null ? 0 : alias(state, 'type', 'status');
  if (typeof status !== 'number' || ![0, 1, 2, 3].includes(status)) throw new AppError('INVALID_RESPONSE', '个人章节状态无效。');
  return status;
}
function episodeState(value: unknown, parent?: number): Data {
  const raw = record(value); const state = raw.collection == null ? {} : record(raw.collection), status = episodeCollectionStatus(raw);
  return { episode: episodeSummary(raw, parent), episodeStatus: status, statusMeaning: ['未标记', '想看', '看过', '抛弃'][status], updatedAt: readTime(alias(state, 'updated_at', 'updatedAt'), true) };
}
function subjectReference(value: Data): Data {
  const nested = value.subject == null ? undefined : record(value.subject);
  const field = (flat: string, ...aliases: string[]): unknown => {
    const values = [value[flat], ...aliases.map(key => nested?.[key])].filter(item => item !== undefined && item !== null);
    if (values.some(item => item !== values[0])) throw new AppError('INVALID_RESPONSE', `关联作品的${flat}字段相互冲突。`);
    return values[0] ?? null;
  };
  const id = positive(field('subject_id', 'id')); const type = field('subject_type', 'type', 'subjectType');
  if (type !== null && (typeof type !== 'number' || ![1,2,3,4,6].includes(type))) throw new AppError('INVALID_RESPONSE', '关联作品类型无效。');
  return { entity: 'subject', id, name: text(field('subject_name', 'name')), nameCn: text(field('subject_name_cn', 'name_cn', 'nameCN', 'nameCn')),
    subjectType: typeof type === 'number' && [1,2,3,4,6].includes(type) ? type : null, url: `https://bgm.tv/subject/${id}` };
}
const appearanceRoles = ['unknown', 'main', 'supporting', 'guest'] as const;
/** 出演关系与实体类型独立；v0的type描述实体，不能用它推断主角。 */
function appearanceRole(row: Data): Data {
  if (row.appearanceRole !== undefined) {
    const role = record(row.appearanceRole); const code = role.code === null ? null : integer(role.code);
    if (code === null && role.code !== null || !appearanceRoles.includes(role.meaning as typeof appearanceRoles[number])
      || role.label !== null && typeof role.label !== 'string' || code !== null && (code <= 3 ? role.meaning !== appearanceRoles[code] : role.meaning !== 'unknown')) throw new AppError('INVALID_RESPONSE', '出演关系代码与语义不一致。');
    return { code, meaning: role.meaning, label: role.label };
  }
  const source = row.appearance_type ?? row.relation_type ?? row.relationType;
  if (source !== undefined && source !== null) {
    const code = integer(source); if (code === null) throw new AppError('INVALID_RESPONSE', '出演关系代码无效。');
    return { code, meaning: appearanceRoles[code] ?? 'unknown', label: text(row.staff) };
  }
  const label = text(row.staff); const code = ['其他', '主角', '配角', '客串'].indexOf(label ?? '');
  return { code: code < 0 ? null : code, meaning: code < 0 ? 'unknown' : appearanceRoles[code], label };
}
const enhancedAppearance = (args: Data): boolean => ['subject_type', 'appearance_role', 'subject_form', 'include', 'snapshot_ref'].some(key => Object.hasOwn(args, key));
function appearanceFields(row: Data, args: Data): Data {
  const requested = args.include as string[] | undefined; const result: Data = {};
  if (requested?.includes('subject_facts') || args.subject_form !== undefined) { const facts = record(row.subjectFacts); result.subjectFacts = {
    airDate: facts.airDate, platform: facts.platform, form: facts.form, score: facts.score, ratingCount: facts.ratingCount,
  }; }
  if (requested?.includes('own_collection')) { const collection = record(row.ownCollection); result.ownCollection = {
    state: collection.state, collectionStatus: collection.collectionStatus, chapters: collection.chapters, volumes: collection.volumes,
  }; }
  return result;
}
function appearanceCoverage(value: unknown): Data {
  const raw = record(value); return Object.fromEntries(['complete', 'sourceComplete', 'sourceUnit', 'sourceTotal', 'sourceReturnedCount', 'relationTotal',
    'matchedRelationTotal', 'matchedSubjectTotal', 'unknownSubjectFormIds', 'unavailableSubjectIds', 'unavailableCollectionSubjectIds'].map(key => [key, raw[key]]));
}
function checkAppearancePage(raw: Data, args: Data): void {
  const enhanced = enhancedAppearance(args), meta = record(raw.page), data = list(raw.data);
  if (Object.hasOwn(meta, 'snapshotRef') !== enhanced || Object.hasOwn(raw, 'coverage') !== enhanced
    || enhanced && args.snapshot_ref !== undefined && meta.snapshotRef !== args.snapshot_ref) throw new AppError('MCP_INVALID_RESULT', '出演查询快照与请求不一致。');
  const include = args.include as string[] | undefined;
  const own = include?.includes('own_collection') ?? false;
  if (own) {
    const current = account(raw.account);
    if (raw.accessContext !== undefined) { const context = record(raw.accessContext);
      if (context.mode !== 'account' || context.account === null || record(context.account).id !== current.id || record(context.account).username !== current.username) throw new AppError('MCP_INVALID_RESULT', '出演查询本人收藏与账户上下文不一致。');
    }
  } else if (Object.hasOwn(raw, 'account')) throw new AppError('MCP_INVALID_RESULT', '公开出演查询带了本人账户。');
  for (const value of data) {
    const row = record(value), subject = record(row.subject), role = record(row.appearanceRole);
    if (args.subject_type !== undefined && subject.subjectType !== args.subject_type || args.appearance_role !== undefined && role.meaning !== args.appearance_role) throw new AppError('MCP_INVALID_RESULT', '出演查询返回了不满足媒体或角色条件的关系。');
    if (role.code !== null && Number(role.code) <= 3 && role.meaning !== appearanceRoles[Number(role.code)] || Number(role.code) > 3 && role.meaning !== 'unknown') throw new AppError('MCP_INVALID_RESULT', '出演关系代码与语义不一致。');
    if (Object.hasOwn(row, 'subjectFacts') !== ((include?.includes('subject_facts') ?? false) || args.subject_form !== undefined)
      || Object.hasOwn(row, 'ownCollection') !== own) throw new AppError('MCP_INVALID_RESULT', '出演查询附带字段与请求不一致。');
    if (args.subject_form !== undefined) {
      // 即使未显式include，宿主也必须提供形式证据给双端核对，不能仅声称已筛选。
      if (!row.subjectFacts || record(row.subjectFacts).form !== args.subject_form) throw new AppError('MCP_INVALID_RESULT', '出演查询缺少匹配的作品形式证据。');
    }
    if (row.ownCollection) { const collection = record(row.ownCollection);
      if (collection.state === 'collected' ? ![1,2,3,4,5].includes(Number(collection.collectionStatus)) : collection.collectionStatus !== null || collection.chapters !== null || collection.volumes !== null) throw new AppError('MCP_INVALID_RESULT', '出演查询收藏状态或进度不一致。');
    }
  }
  if (!enhanced) return;
  const coverage = record(raw.coverage), gaps = ['unknownSubjectFormIds', 'unavailableSubjectIds', 'unavailableCollectionSubjectIds'] as const;
  const hasGaps = gaps.some(key => list(coverage[key]).length > 0);
  if (coverage.sourceComplete === true && (coverage.sourceTotal === null || coverage.sourceReturnedCount !== coverage.sourceTotal)
    || coverage.sourceTotal !== null && Number(coverage.sourceReturnedCount) > Number(coverage.sourceTotal)
    || coverage.complete !== (coverage.sourceComplete === true && !hasGaps)
    || coverage.matchedRelationTotal !== meta.total || Number(coverage.matchedRelationTotal) > Number(coverage.relationTotal)
    || Number(coverage.matchedSubjectTotal) > Number(coverage.matchedRelationTotal)
    || coverage.sourceUnit === 'appearance' && coverage.sourceReturnedCount !== coverage.relationTotal
    || meta.complete === true && new Set(data.map(value => record(record(value).subject).id)).size !== coverage.matchedSubjectTotal) throw new AppError('MCP_INVALID_RESULT', '出演查询覆盖计数或完整性不一致。');
  if (!own && list(coverage.unavailableCollectionSubjectIds).length > 0) throw new AppError('MCP_INVALID_RESULT', '出演查询报告了未请求的本人收藏缺口。');
  for (const value of data) { const row = record(value), id = record(row.subject).id;
    if (row.subjectFacts && record(row.subject).subjectType === 2 && record(row.subjectFacts).form === null && !list(coverage.unknownSubjectFormIds).includes(id)
      || row.ownCollection && record(row.ownCollection).state === 'unavailable' && !list(coverage.unavailableCollectionSubjectIds).includes(id)) throw new AppError('MCP_INVALID_RESULT', '出演查询未报告资料缺口。');
  }
}
function revisionSummary(value: unknown, kind: string, parent?: number): Data {
  const raw = record(value); if (integer(raw.type) === null || typeof raw.summary !== 'string') throw new AppError('INVALID_RESPONSE', '修订元信息不完整。');
  return { schemaVersion: 1, entity: 'revision', revisionId: positive(raw.id), revisionType: raw.type, targetKind: kind, targetId: parent ?? null,
    creatorRef: creatorReference(raw.creator), changeNote: raw.summary, createdAt: readTime(raw.created_at) };
}
function creatorReference(value: unknown): Data | null {
  if (value == null) return null; const raw = record(value);
  return { id: integer(raw.id, 1), username: text(raw.username), nickname: text(raw.nickname) };
}
function page(raw: Data, data: unknown[], args: Data, entity: string, visibility: string, current?: unknown): Data {
  const limit = Number(args.limit); const offset = Number(args.offset); const total = raw.total == null ? null : integer(raw.total);
  if (raw.total === undefined || data.length > limit || raw.total != null && total === null || raw.limit !== undefined && raw.limit !== limit || raw.offset !== undefined && raw.offset !== offset) throw new AppError('INVALID_RESPONSE', '分页总数、范围或数量无效。');
  if (total !== null && data.length !== Math.min(limit, Math.max(0, total - offset))) throw new AppError('INCOMPLETE_DATA', '分页缺少记录。');
  return { schemaVersion: 1, kind: 'page', entity, data,
    page: { total, limit, offset, returnedCount: data.length, nextOffset: total === null ? data.length === limit ? offset + data.length : null : offset + data.length < total ? offset + data.length : null, complete: offset === 0 && total !== null && data.length === total },
    scope: { ...args }, visibility, readAt: now(), ...(visibility === 'self' ? { account: account(current) } : {}) };
}
function collectionState(value: unknown, kind: 'subject' | 'character' | 'person', args: Data): Data {
  const self = args.username === '-'; const wrapper = self ? record(value) : undefined; const raw = self ? wrapper!._record : value;
  const targetId = Number(args[`${kind}_id`]); let collection: unknown = null;
  if (raw !== null) {
    const recordValue = record(raw);
    if (kind === 'subject') {
      if (recordValue.subject_id !== targetId) throw new AppError('INVALID_RESPONSE', '收藏返回了其他作品。');
      const nested = recordValue.subject == null ? undefined : record(recordValue.subject);
      const subjectType = recordValue.subject_type ?? (nested ? alias(nested, 'subjectType', 'type') : undefined);
      const progressMeaning = subjectType === 1 ? '已读章数' : subjectType === 2 || subjectType === 6 ? '已看集数' : '原生进度计数';
      if (self) {
        if (typeof recordValue.type !== 'number' || ![1,2,3,4,5].includes(recordValue.type) || integer(recordValue.rate) === null || Number(recordValue.rate) > 10 || typeof recordValue.comment !== 'string' || typeof recordValue.private !== 'boolean'
          || !Array.isArray(recordValue.tags) || recordValue.tags.some(tag => typeof tag !== 'string') || integer(recordValue.ep_status) === null || integer(recordValue.vol_status) === null) throw new AppError('INCOMPLETE_COLLECTION', '完整收藏现状字段缺失。');
        collection = { subjectId: targetId, collectionStatus: recordValue.type, personalRating: recordValue.rate, personalTags: recordValue.tags, comment: recordValue.comment, private: recordValue.private,
          chapters: recordValue.ep_status, volumes: recordValue.vol_status, progressMeaning, complete: true };
      } else {
        if (recordValue.private !== false) throw new AppError('PRIVATE_SCOPE', '公开收藏缺少明确的公开范围证明。');
        if (typeof recordValue.type !== 'number' || ![1,2,3,4,5].includes(recordValue.type)) throw new AppError('INVALID_RESPONSE', '公开收藏状态无效。');
        collection = { subjectId: targetId, collectionStatus: recordValue.type, personalRating: integer(recordValue.rate, 0, 10), personalTags: strings(recordValue.tags), comment: text(recordValue.comment), private: false,
          chapters: integer(recordValue.ep_status), volumes: integer(recordValue.vol_status), progressMeaning };
      }
    } else {
      if (recordValue.id !== targetId) throw new AppError('INVALID_RESPONSE', '收藏返回了其他实体。');
      collection = { target: entitySummary(recordValue, kind), createdAt: readTime(alias(recordValue, 'created_at', 'collectedAt'), self || recordValue.collectedAt !== undefined), collected: true };
    }
  }
  return { schemaVersion: 1, kind: 'collectionState', target: { kind, id: targetId }, state: raw !== null ? 'collected' : self ? 'not_collected' : 'unavailable', collection,
    scope: { ...args }, visibility: self ? 'self' : 'public', readAt: now(), ...(self ? { account: account(wrapper!.account) } : {}) };
}
function revisionDetails(raw: Data, kind: string, args: Data): Data {
  const base = revisionSummary(raw, kind); const requested = (args.include as string[]).includes('content');
  let state = requested ? raw.data == null ? 'unavailable' : 'available' : 'not_requested';
  const versions: Data[] = []; let pageInfo: Data | null = null;
  if (state === 'available') {
    if (!known(raw.data)) state = 'unsupported_shape';
    else {
      // v0 SubjectRevisionData 是直接对象；人物和角色才是按版本键组织的对象。
      const entries = kind === 'subject' && Object.hasOwn(raw.data, 'subject_id') ? [['data', raw.data] as [string, Data]] : Object.entries(raw.data); const mapped: Data[] = [];
      for (const [sourceKey, value] of entries) {
        if (!known(value)) { state = 'unsupported_shape'; break; }
        let content: Data;
        const stringFields = (fields: string[]) => fields.every(field => typeof value[field] === 'string');
        if (kind === 'person' && stringFields(['prsn_name','prsn_summary','prsn_infobox']) && known(value.profession) && known(value.extra)) {
          content = { name: value.prsn_name, summary: value.prsn_summary, infoboxText: value.prsn_infobox,
            profession: ['producer','mangaka','artist','seiyu','writer','illustrator','actor'].filter(key => Object.hasOwn(value.profession as object, key)).map(career => ({ career, value: text((value.profession as Data)[career]) })), imageKey: text((value.extra as Data).img) };
        } else if (kind === 'character' && stringFields(['name','summary','infobox']) && known(value.extra)) {
          content = { name: value.name, summary: value.summary, infoboxText: value.infobox, imageKey: text((value.extra as Data).img) };
        } else if (kind === 'subject' && stringFields(['name','name_cn','field_summary','field_infobox','vote_field']) && integer(value.subject_id, 1) !== null) {
          content = { name: value.name, nameCn: value.name_cn, summary: value.field_summary, infoboxText: value.field_infobox, episodeCount: integer(value.field_eps), sourceType: integer(value.type), sourceTypeId: integer(value.type_id), platformCode: integer(value.platform), voteField: value.vote_field, subjectId: value.subject_id };
        } else if (kind === 'episode' && stringFields(['name','name_cn','desc','airdate','duration']) && integer(value.subject_id, 1) !== null && typeof value.type === 'number' && [0,1,2,3,4,5,6].includes(value.type)) {
          content = { name: value.name, nameCn: value.name_cn, description: value.desc, episodeType: value.type, sort: number(value.sort), mainSequence: value.type === 0 ? number(value.ep) : null, airDate: value.airdate, duration: value.duration, disc: integer(value.disc), subjectId: value.subject_id };
        } else { state = 'unsupported_shape'; break; }
        mapped.push({ sourceKey, content });
      }
      if (state === 'available') {
        const offset = Number(args.version_offset), limit = Number(args.version_limit); versions.push(...mapped.slice(offset, offset + limit));
        pageInfo = { total: mapped.length, limit, offset, returnedCount: versions.length, nextOffset: offset + versions.length < mapped.length ? offset + versions.length : null, complete: offset === 0 && versions.length === mapped.length };
        const ids = [...new Set(mapped.map(item => (item.content as Data).subjectId).filter(id => id !== undefined))];
        // episode 内容中的 subject_id 代表章节的父作品，不是章节目标ID。
        if (kind === 'subject' && ids.length === 1) base.targetId = ids[0];
      }
    }
  }
  return { ...base, included: args.include, contentState: state, versions, versionsPage: pageInfo, readAt: now() };
}
export function resourceResult(name: string, value: unknown, args: Data): unknown {
  if (name === 'get_current_user') return { schemaVersion: 1, kind: 'account', ...account(value), readAt: now() };
  if (name === 'get_user_info') {
    const raw = record(value); if (typeof raw.username !== 'string' || typeof raw.nickname !== 'string' || integer(raw.user_group) === null) throw new AppError('INVALID_RESPONSE', '用户公开资料不完整。');
    return { schemaVersion: 1, entity: 'user', id: positive(raw.id), username: raw.username, nickname: raw.nickname, userGroup: raw.user_group, url: `https://bgm.tv/user/${encodeURIComponent(raw.username)}`, included: args.include,
      ...((args.include as string[]).includes('sign') ? { sign: text(raw.sign) } : {}), readAt: now() };
  }
  if (name === 'get_user_avatar') {
    const raw = record(value); return { schemaVersion: 1, kind: 'avatar', userIdentifier: args.username, userId: raw.account == null ? null : positive(record(raw.account).id), username: raw.account == null ? null : record(raw.account).username,
      imageType: args.avatar_type, url: url(raw.url) };
  }
  if (/^get_(subject|character|person)_image$/.test(name)) { const raw = record(value); const kind = name.split('_')[1]!;
    if (raw.id !== args[`${kind}_id`]) throw new AppError('INVALID_RESPONSE', '图片对象与请求不一致。');
    return { schemaVersion: 1, kind: 'image', target: { kind, id: raw.id }, imageType: args.image_type, url: url(raw.url) };
  }
  if (['get_character_details','get_person_details'].includes(name)) { const kind = name.includes('character') ? 'character' : 'person'; const result = details(value, kind, args); if (result.id !== args[`${kind}_id`]) throw new AppError('INVALID_RESPONSE', '详情返回了其他对象。'); return result; }
  if (name === 'get_episode_details') { const raw = record(value); const base = episodeSummary(raw); if (base.id !== args.episode_id) throw new AppError('INVALID_RESPONSE', '章节详情对象不一致。');
    return { ...base, included: args.include, ...((args.include as string[]).includes('description') ? { description: text(raw.desc) } : {}), ...((args.include as string[]).includes('stats') ? { stats: { comments: integer(raw.comment) } } : {}), readAt: now() };
  }
  if (/^get_user_(subject|character|person)_collection$/.test(name)) return collectionState(value, name.split('_')[2] as 'subject'|'character'|'person', args);
  if (name === 'get_single_episode_collection') { const raw = record(value); const result = episodeState(raw); if (record(result.episode).id !== args.episode_id) throw new AppError('INVALID_RESPONSE', '个人章节对象不一致。');
    return { schemaVersion: 1, kind: 'episodeState', data: result, scope: { ...args }, complete: true, visibility: 'self', account: account(raw.account), readAt: now() };
  }
  if (name === 'get_index') {
    const raw = record(value); if (raw.id !== args.index_id) throw new AppError('INVALID_RESPONSE', '目录对象不一致。');
    if (args.own === true) {
      if (integer(raw.ownerId, 1) === null || typeof raw.title !== 'string' || typeof raw.description !== 'string' || typeof raw.private !== 'boolean' || typeof raw.collected !== 'boolean') throw new AppError('INCOMPLETE_RESPONSE', '完整目录现状字段缺失。');
      const current = account(raw.account); if (raw.private === true && raw.ownerId !== current.id) throw new AppError('PRIVATE_SCOPE', '不能读取他人私密目录。');
      return { schemaVersion: 1, kind: 'indexState', id: raw.id, ownerId: raw.ownerId, title: raw.title, description: raw.description, private: raw.private, collected: raw.collected, complete: true, visibility: 'self', account: current, readAt: now() };
    }
    const privateScope = boolean(raw.private);
    if (privateScope === true || raw.uid !== undefined && privateScope !== false) throw new AppError('PRIVATE_SCOPE', '公开目录缺少明确的公开范围证明。');
    const creator = creatorReference(alias(raw, 'creator', 'user'));
    const ownerId = integer(alias(raw, 'ownerId', 'uid') ?? creator?.id, 1);
    if (creator?.id !== null && creator?.id !== undefined && ownerId !== creator.id) throw new AppError('INVALID_RESPONSE', '目录所有者与作者身份不一致。');
    return { schemaVersion: 1, entity: 'index', id: raw.id, title: raw.title, creatorRef: creator, ownerId,
      createdAt: readTime(alias(raw, 'created_at', 'createdAt'), raw.createdAt !== undefined), updatedAt: readTime(alias(raw, 'updated_at', 'updatedAt'), raw.updatedAt !== undefined),
      totalSubjects: indexSubjectTotal(raw), url: `https://bgm.tv/index/${raw.id}`, visibility: 'public', included: args.include, private: privateScope, collected: null,
      ...((args.include as string[]).includes('description') ? { description: text(alias(raw, 'description', 'desc')) } : {}),
      ...((args.include as string[]).includes('stats') ? { stats: stats(raw.stat ?? (raw.replies !== undefined || raw.collects !== undefined ? { comments: raw.replies, collects: raw.collects } : null)) } : {}), readAt: now() };
  }
  if (/^get_(person|character|subject|episode)_revision$/.test(name)) { const raw = record(value); if (raw.id !== args.revision_id) throw new AppError('INVALID_RESPONSE', '修订对象不一致。'); return revisionDetails(raw, name.split('_')[1]!, args); }
  const raw = record(value); const data = list(raw.data); let entity = ''; let mapped: unknown[];
  if (name === 'search_characters' || name === 'search_persons') { const kind = name === 'search_characters' ? 'character' : 'person'; entity = kind; mapped = data.map(value => entitySummary(value, kind)); }
  else if (name === 'get_episodes' || name === 'get_user_episode_collection') { entity = name === 'get_episodes' ? 'episode' : 'episodeCollection'; mapped = data.map(value => name === 'get_episodes' ? episodeSummary(value, Number(args.subject_id)) : episodeState(value, Number(args.subject_id))); }
  else if (/^get_user_(character|person)_collections$/.test(name)) { const kind = name.includes('character') ? 'character' : 'person'; entity = `${kind}Collection`; mapped = data.map(value => { const row = record(value); return { target: entitySummary(row, kind), createdAt: readTime(alias(row, 'created_at', 'collectedAt'), args.username === '-' || row.collectedAt !== undefined), collected: true }; }); }
  else if (/^get_(person|character|subject|episode)_revisions$/.test(name)) { const kind = name.split('_')[1]!; entity = 'revision'; mapped = data.map(value => revisionSummary(value, kind, Number(args[`${kind}_id`]))); }
  else if (name === 'get_subject_persons') { entity = 'subjectPerson'; mapped = data.map(value => { const row = record(value); return { person: entitySummary(row, 'person'), relation: text(row.relation), participationText: text(row.eps) }; }); }
  else if (name === 'get_subject_characters') { entity = 'subjectCharacter'; mapped = data.map(value => { const row = record(value); return { character: entitySummary(row, 'character'), relation: text(row.relation), actors: row.actors == null ? null : list(row.actors).map(value => entitySummary(value, 'person')), actorsCoverage: row.actors == null ? 'unavailable' : 'as_returned' }; }); }
  else if (name === 'get_character_persons' || name === 'get_person_characters') { const person = name === 'get_character_persons'; entity = person ? 'characterPerson' : 'personCharacter'; mapped = data.map(value => { const row = record(value); return {
    [person ? 'person' : 'character']: entitySummary(row, person ? 'person' : 'character'), subject: subjectReference(row), staff: text(row.staff),
    sourceTypeCode: integer(row.source_type_code ?? row.sourceTypeCode ?? row.type), appearanceRole: appearanceRole(row),
    ...(person ? {} : appearanceFields(row, args)),
  }; }); }
  else throw new AppError('UNKNOWN_TOOL', '资料工具缺少固定转换。');
  const self = args.username === '-' || name === 'get_user_episode_collection' || name === 'get_person_characters' && (args.include as string[] | undefined)?.includes('own_collection');
  const result = page(raw, mapped, args, entity, self ? 'self' : 'public', raw.account);
  if (name === 'get_person_characters' && enhancedAppearance(args)) {
    record(result.page).snapshotRef = raw.snapshotRef; result.coverage = appearanceCoverage(raw.coverage);
  }
  if (name === 'get_person_characters' && raw.readAt !== undefined) result.readAt = raw.readAt;
  return result;
}

/** 输入绑定在schema之外核对；字段组、对象、账户、范围均不能由服务返回自行改绑。 */
export function checkResourceResponse(name: string, value: unknown, args: Data, schema: JsonSchema): void {
  const validator = compileSchema(schema);
  if (!validator({ value }) && validator.errors?.some(error => ['maxLength','maxItems'].includes(error.keyword))) throw new AppError('FIELD_LIMIT', '资料字段或嵌套清单超过固定上限；请缩小详情范围，未静默截断内容。');
  checkOutput(schema, { value }); const raw = record(value);
  const semantics = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(semantics); return; }
    if (!known(value)) return;
    for (const field of ['readAt', 'createdAt', 'updatedAt']) if (value[field] !== undefined && value[field] !== null) {
      try { if (readTime(value[field]) !== value[field]) throw new Error('not canonical'); }
      catch { throw new AppError('MCP_INVALID_RESULT', '资料时间不是有效且规范的UTC时间。'); }
    }
    if (['character', 'person', 'episode', 'subject'].includes(String(value.entity)) && value.id !== undefined) {
      const kind = value.entity === 'episode' ? 'ep' : value.entity;
      if (value.url !== `https://bgm.tv/${kind}/${value.id}`) throw new AppError('MCP_INVALID_RESULT', '资料来源链接与对象身份不一致。');
    }
    if (value.episodeStatus !== undefined && value.statusMeaning !== ['未标记', '想看', '看过', '抛弃'][Number(value.episodeStatus)]) throw new AppError('MCP_INVALID_RESULT', '个人章节状态代码与语义不一致。');
    Object.values(value).forEach(semantics);
  };
  semantics(raw);
  if (raw.visibility === 'self') {
    const current = account(raw.account);
    if (raw.accessContext !== undefined) {
      const context = record(raw.accessContext);
      if (context.mode !== 'account' || !isDeepStrictEqual(context.account, current)) throw new AppError('MCP_INVALID_RESULT', '本人资料与账户上下文不一致。');
    }
  } else if (Object.hasOwn(raw, 'account')) throw new AppError('MCP_INVALID_RESULT', '公开资料带了本人账户身份。');
  if (raw.kind === 'page') {
    const p = record(raw.page), scope = record(raw.scope); const data = list(raw.data);
    if (p.limit !== args.limit || p.offset !== args.offset || p.returnedCount !== data.length || !isDeepStrictEqual(scope, args)) throw new AppError('MCP_INVALID_RESULT', '资料分页返回范围不一致。');
    const offset = Number(p.offset), limit = Number(p.limit), total = p.total;
    if (total !== null && data.length !== Math.min(limit, Math.max(0, Number(total) - offset))) throw new AppError('MCP_INVALID_RESULT', '资料分页数量与总数不一致。');
    if (p.complete !== (offset === 0 && total !== null && data.length === total) || p.nextOffset !== (total === null ? data.length === limit ? offset + data.length : null : offset + data.length < Number(total) ? offset + data.length : null)) throw new AppError('MCP_INVALID_RESULT', '资料分页完整性错误。');
    const self = args.username === '-' || name === 'get_user_episode_collection' || name === 'get_person_characters' && (args.include as string[] | undefined)?.includes('own_collection');
    if (raw.visibility !== (self ? 'self' : 'public')) throw new AppError('MCP_INVALID_RESULT', '资料可见范围错误。');
    if (name === 'get_person_characters') checkAppearancePage(raw, args);
    if (name === 'search_characters' && args.nsfw_filter === false && data.some(value => record(value).nsfw !== false)) throw new AppError('MCP_INVALID_RESULT', '角色搜索未明确满足排除NSFW的条件。');
    if (name === 'get_character_persons') for (const value of data) { const role = record(record(value).appearanceRole);
      if (role.code !== null && (Number(role.code) <= 3 ? role.meaning !== appearanceRoles[Number(role.code)] : role.meaning !== 'unknown')) throw new AppError('MCP_INVALID_RESULT', '出演关系代码与语义不一致。');
    }
    const keys = data.map(value => { const row = record(value);
      if (row.episode) { const ep = record(row.episode); if (ep.subjectId !== args.subject_id || args.episode_type !== undefined && ep.episodeType !== args.episode_type) throw new AppError('MCP_INVALID_RESULT', '章节归属或类型不一致。'); return String(ep.id); }
      if (row.entity === 'episode') { if (row.subjectId !== args.subject_id || args.episode_type !== undefined && row.episodeType !== args.episode_type) throw new AppError('MCP_INVALID_RESULT', '章节归属或类型不一致。'); return String(row.id); }
      if (row.person && row.subject || row.character && row.subject) return JSON.stringify([record(row.person ?? row.character).id, record(row.subject).id, row.appearanceRole ? record(row.appearanceRole).code : null, row.staff]);
      if (row.person || row.character) return JSON.stringify([record(row.person ?? row.character).id, row.relation]);
      return String(row.id ?? row.revisionId ?? record(row.target).id);
    });
    if (new Set(keys).size !== keys.length) throw new AppError('MCP_INVALID_RESULT', '资料分页包含重复记录。');
  }
  if (raw.included !== undefined) {
    const expected = args.include as string[];
    if (!Array.isArray(raw.included) || raw.included.length !== expected.length || expected.some(field => !(raw.included as string[]).includes(field))) throw new AppError('MCP_INVALID_RESULT', '资料详情字段组不一致。');
    for (const key of ['summary','infobox','bio','stats','sign','description']) if (Object.hasOwn(raw,key) !== expected.includes(key)) throw new AppError('MCP_INVALID_RESULT', '资料详情带了未请求字段。');
  }
  if (raw.entity === 'character' && raw.id !== args.character_id || raw.entity === 'person' && raw.id !== args.person_id || raw.entity === 'episode' && raw.id !== args.episode_id || raw.entity === 'revision' && raw.revisionId !== args.revision_id || name === 'get_index' && raw.id !== args.index_id) throw new AppError('MCP_INVALID_RESULT', '资料详情对象不一致。');
  if (raw.kind === 'image') { const kind = name.split('_')[1]!; if (record(raw.target).kind !== kind || record(raw.target).id !== args[`${kind}_id`] || raw.imageType !== args.image_type) throw new AppError('MCP_INVALID_RESULT', '图片对象或尺寸不一致。'); url(raw.url); }
  if (raw.kind === 'avatar') { if (raw.userIdentifier !== args.username || raw.imageType !== args.avatar_type) throw new AppError('MCP_INVALID_RESULT', '头像对象或尺寸不一致。'); url(raw.url); }
  if (raw.kind === 'collectionState') { const target = record(raw.target), scope = record(raw.scope); if (target.kind !== name.split('_')[2] || target.id !== args[`${target.kind}_id`] || !isDeepStrictEqual(scope, args) || raw.visibility !== (args.username === '-' ? 'self' : 'public')) throw new AppError('MCP_INVALID_RESULT', '收藏对象或范围不一致。');
    if ((raw.state === 'collected' ? raw.collection === null : raw.collection !== null)
      || raw.visibility === 'self' && raw.state === 'unavailable' || raw.visibility === 'public' && raw.state === 'not_collected') throw new AppError('MCP_INVALID_RESULT', '收藏状态与现状或可见范围不一致。');
    if (raw.collection !== null) { const collection = record(raw.collection); if (target.kind === 'subject' ? collection.subjectId !== target.id : record(collection.target).id !== target.id || record(collection.target).entity !== target.kind) throw new AppError('MCP_INVALID_RESULT', '收藏现状对象不一致。'); }
  }
  if (raw.kind === 'episodeState') { if (record(record(raw.data).episode).id !== args.episode_id || !isDeepStrictEqual(raw.scope, args)) throw new AppError('MCP_INVALID_RESULT', '个人章节对象或范围不一致。'); }
  if (name === 'get_index' && raw.visibility !== (args.own === true ? 'self' : 'public')) throw new AppError('MCP_INVALID_RESULT', '目录可见范围与请求不一致。');
}
