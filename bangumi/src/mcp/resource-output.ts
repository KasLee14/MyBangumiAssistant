import { AppError } from '../support/errors.js';
import { compileSchema, type JsonSchema } from '../support/tool-schema.js';
import { checkOutput } from './subject-output.js';

export type Data = Record<string, unknown>;
const known = (value: unknown): value is Data => value !== null && typeof value === 'object' && !Array.isArray(value);
export function record(value: unknown): Data { if (!known(value)) throw new AppError('INVALID_RESPONSE', '资料响应不是对象。'); return value; }
export function positive(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new AppError('INVALID_RESPONSE', '资料缺少合法对象ID。'); return value; }
const integer = (value: unknown, minimum = 0): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum ? value : null;
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = (value: unknown): string | null => typeof value === 'string' ? value : null;
const list = (value: unknown): unknown[] => { if (!Array.isArray(value)) throw new AppError('INVALID_RESPONSE', '资料清单不是数组。'); return value; };
const strings = (value: unknown): string[] | null => value == null ? null : list(value).map(item => { if (typeof item !== 'string') throw new AppError('INVALID_RESPONSE', '文本清单字段类型错误。'); return item; });
const now = (): string => new Date().toISOString();
/** 已核实p1收藏使用Unix秒；公共ISO字符串按明确格式解析，不按位数猜单位。 */
export function readTime(value: unknown, unixSeconds = false): string | null {
  if (value == null || value === 0 || value === '') return null;
  if (unixSeconds && typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 253402300799) return new Date(value * 1000).toISOString();
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : null;
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
  const type = raw.type ?? raw.role; const valid = kind === 'character' ? [1, 2, 3, 4] : [1, 2, 3];
  return { schemaVersion: 1, entity: kind, id, name: raw.name,
    ...(kind === 'character' ? { characterType: valid.includes(Number(type)) && typeof type === 'number' ? type : null }
      : { personType: valid.includes(Number(type)) && typeof type === 'number' ? type : null, career: strings(raw.career) }),
    url: `https://bgm.tv/${kind}/${id}` };
}
function infobox(value: unknown): unknown[] | null {
  if (value == null) return null;
  return list(value).map(value => { const raw = record(value); const data = raw.value ?? raw.values;
    return { key: raw.key, value: Array.isArray(data) ? data.map(value => { const pair = record(value); return { ...(pair.k === undefined ? {} : { k: pair.k }), v: pair.v }; }) : data };
  });
}
function stats(value: unknown): Data | null { if (value == null) return null; const raw = record(value); return { comments: integer(raw.comments), collects: integer(raw.collects) }; }
function details(value: unknown, kind: 'character' | 'person', args: Data): Data {
  const raw = record(value); const result: Data = { ...entitySummary(raw, kind), included: args.include, readAt: now() };
  for (const field of args.include as string[]) {
    if (field === 'summary') result.summary = text(raw.summary);
    if (field === 'infobox') result.infobox = infobox(raw.infobox);
    if (field === 'stats') result.stats = stats(raw.stat);
    if (field === 'bio') result.bio = { gender: text(raw.gender), bloodType: integer(raw.blood_type, 1), birthYear: integer(raw.birth_year, 1), birthMonth: integer(raw.birth_mon, 1), birthDay: integer(raw.birth_day, 1) };
  }
  return result;
}
export function episodeSummary(value: unknown, parent?: number): Data {
  const raw = record(value); const id = positive(raw.id); const subjectId = positive(raw.subject_id ?? raw.subjectID ?? parent);
  if (parent !== undefined && subjectId !== parent) throw new AppError('INVALID_RESPONSE', '章节与请求作品不一致。');
  if (typeof raw.type !== 'number' || ![0, 1, 2, 3, 4, 5, 6].includes(raw.type)) throw new AppError('INVALID_RESPONSE', '章节类型无效。');
  return { schemaVersion: 1, entity: 'episode', id, subjectId, episodeType: raw.type, name: text(raw.name) ?? '', nameCn: text(raw.name_cn ?? raw.nameCN),
    sort: number(raw.sort), mainSequence: raw.type === 0 ? number(raw.ep) : null, airDate: text(raw.airdate), disc: integer(raw.disc), duration: text(raw.duration), durationSeconds: integer(raw.duration_seconds), url: `https://bgm.tv/ep/${id}` };
}
function episodeState(value: unknown, parent?: number): Data {
  const raw = record(value); const state = raw.collection == null ? {} : record(raw.collection);
  const status = state.type ?? state.status ?? 0;
  if (typeof status !== 'number' || ![0, 1, 2, 3].includes(status)) throw new AppError('INVALID_RESPONSE', '个人章节状态无效。');
  return { episode: episodeSummary(raw, parent), episodeStatus: status, statusMeaning: ['未标记', '想看', '看过', '抛弃'][status], updatedAt: readTime(state.updated_at ?? state.updatedAt, true) };
}
function subjectReference(value: Data): Data {
  const id = positive(value.subject_id); const type = value.subject_type;
  return { entity: 'subject', id, name: text(value.subject_name), nameCn: text(value.subject_name_cn), subjectType: typeof type === 'number' && [1,2,3,4,6].includes(type) ? type : null, url: `https://bgm.tv/subject/${id}` };
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
  if (data.length > limit || raw.total != null && total === null || raw.limit !== undefined && raw.limit !== limit || raw.offset !== undefined && raw.offset !== offset) throw new AppError('INVALID_RESPONSE', '分页范围或数量无效。');
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
      const subjectType = recordValue.subject == null ? undefined : record(recordValue.subject).subjectType ?? record(recordValue.subject).type;
      const progressMeaning = subjectType === 1 ? '已读章数' : subjectType === 2 || subjectType === 6 ? '已看集数' : '原生进度计数';
      if (self) {
        if (typeof recordValue.type !== 'number' || ![1,2,3,4,5].includes(recordValue.type) || integer(recordValue.rate) === null || Number(recordValue.rate) > 10 || typeof recordValue.comment !== 'string' || typeof recordValue.private !== 'boolean'
          || !Array.isArray(recordValue.tags) || recordValue.tags.some(tag => typeof tag !== 'string') || integer(recordValue.ep_status) === null || integer(recordValue.vol_status) === null) throw new AppError('INCOMPLETE_COLLECTION', '完整收藏现状字段缺失。');
        collection = { subjectId: targetId, collectionStatus: recordValue.type, personalRating: recordValue.rate, personalTags: recordValue.tags, comment: recordValue.comment, private: recordValue.private,
          chapters: recordValue.ep_status, volumes: recordValue.vol_status, progressMeaning, complete: true };
      } else {
        if (recordValue.private === true) throw new AppError('PRIVATE_SCOPE', '公开接口返回了非公开收藏。');
        collection = { subjectId: targetId, collectionStatus: recordValue.type, personalRating: integer(recordValue.rate), personalTags: strings(recordValue.tags), comment: text(recordValue.comment), private: typeof recordValue.private === 'boolean' ? recordValue.private : null,
          chapters: integer(recordValue.ep_status), volumes: integer(recordValue.vol_status), progressMeaning };
      }
    } else {
      if (recordValue.id !== targetId) throw new AppError('INVALID_RESPONSE', '收藏返回了其他实体。');
      collection = { target: entitySummary(recordValue, kind), createdAt: readTime(recordValue.created_at ?? recordValue.collectedAt, self), collected: true };
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
      const entries = Object.entries(raw.data); const mapped: Data[] = [];
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
        if (ids.length === 1) base.targetId = ids[0];
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
    if (raw.private === true) throw new AppError('PRIVATE_SCOPE', '公开目录接口返回了私密字段。');
    return { schemaVersion: 1, entity: 'index', id: raw.id, title: raw.title, creatorRef: creatorReference(raw.creator ?? raw.user), ownerId: integer(raw.ownerId, 1), createdAt: readTime(raw.created_at), updatedAt: readTime(raw.updated_at), totalSubjects: integer(raw.total), url: `https://bgm.tv/index/${raw.id}`, visibility: 'public', included: args.include, private: typeof raw.private === 'boolean' ? raw.private : null, collected: null,
      ...((args.include as string[]).includes('description') ? { description: text(raw.description) } : {}), ...((args.include as string[]).includes('stats') ? { stats: stats(raw.stat) } : {}), readAt: now() };
  }
  if (/^get_(person|character|subject|episode)_revision$/.test(name)) { const raw = record(value); if (raw.id !== args.revision_id) throw new AppError('INVALID_RESPONSE', '修订对象不一致。'); return revisionDetails(raw, name.split('_')[1]!, args); }
  const raw = record(value); const data = list(raw.data); let entity = ''; let mapped: unknown[];
  if (name === 'search_characters' || name === 'search_persons') { const kind = name === 'search_characters' ? 'character' : 'person'; entity = kind; mapped = data.map(value => entitySummary(value, kind)); }
  else if (name === 'get_episodes' || name === 'get_user_episode_collection') { entity = name === 'get_episodes' ? 'episode' : 'episodeCollection'; mapped = data.map(value => name === 'get_episodes' ? episodeSummary(value, Number(args.subject_id)) : episodeState(value, Number(args.subject_id))); }
  else if (/^get_user_(character|person)_collections$/.test(name)) { const kind = name.includes('character') ? 'character' : 'person'; entity = `${kind}Collection`; mapped = data.map(value => { const row = record(value); return { target: entitySummary(row, kind), createdAt: readTime(row.created_at ?? row.collectedAt, args.username === '-'), collected: true }; }); }
  else if (/^get_(person|character|subject|episode)_revisions$/.test(name)) { const kind = name.split('_')[1]!; entity = 'revision'; mapped = data.map(value => revisionSummary(value, kind, Number(args[`${kind}_id`]))); }
  else if (name === 'get_subject_persons') { entity = 'subjectPerson'; mapped = data.map(value => { const row = record(value); return { person: entitySummary(row, 'person'), relation: text(row.relation), participationText: text(row.eps) }; }); }
  else if (name === 'get_subject_characters') { entity = 'subjectCharacter'; mapped = data.map(value => { const row = record(value); return { character: entitySummary(row, 'character'), relation: text(row.relation), actors: row.actors == null ? null : list(row.actors).map(value => entitySummary(value, 'person')), actorsCoverage: row.actors == null ? 'unavailable' : 'as_returned' }; }); }
  else if (name === 'get_character_persons' || name === 'get_person_characters') { const person = name === 'get_character_persons'; entity = person ? 'characterPerson' : 'personCharacter'; mapped = data.map(value => { const row = record(value); return { [person ? 'person' : 'character']: entitySummary(row, person ? 'person' : 'character'), subject: subjectReference(row), staff: text(row.staff), sourceTypeCode: integer(row.type) }; }); }
  else throw new AppError('UNKNOWN_TOOL', '资料工具缺少固定转换。');
  const self = args.username === '-' || name === 'get_user_episode_collection';
  return page(raw, mapped, args, entity, self ? 'self' : 'public', raw.account);
}

/** 输入绑定在schema之外核对；字段组、对象、账户、范围均不能由服务返回自行改绑。 */
export function checkResourceResponse(name: string, value: unknown, args: Data, schema: JsonSchema): void {
  const validator = compileSchema(schema);
  if (!validator({ value }) && validator.errors?.some(error => ['maxLength','maxItems'].includes(error.keyword))) throw new AppError('FIELD_LIMIT', '资料字段或嵌套清单超过固定上限；请缩小详情范围，未静默截断内容。');
  checkOutput(schema, { value }); const raw = record(value);
  if (raw.kind === 'page') {
    const p = record(raw.page), scope = record(raw.scope); const data = list(raw.data);
    if (p.limit !== args.limit || p.offset !== args.offset || p.returnedCount !== data.length || JSON.stringify(scope) !== JSON.stringify(args)) throw new AppError('MCP_INVALID_RESULT', '资料分页返回范围不一致。');
    const offset = Number(p.offset), limit = Number(p.limit), total = p.total;
    if (total !== null && data.length !== Math.min(limit, Math.max(0, Number(total) - offset))) throw new AppError('MCP_INVALID_RESULT', '资料分页数量与总数不一致。');
    if (p.complete !== (offset === 0 && total !== null && data.length === total) || p.nextOffset !== (total === null ? data.length === limit ? offset + data.length : null : offset + data.length < Number(total) ? offset + data.length : null)) throw new AppError('MCP_INVALID_RESULT', '资料分页完整性错误。');
    const self = args.username === '-' || name === 'get_user_episode_collection';
    if (raw.visibility !== (self ? 'self' : 'public')) throw new AppError('MCP_INVALID_RESULT', '资料可见范围错误。');
    const keys = data.map(value => { const row = record(value);
      if (row.episode) { const ep = record(row.episode); if (ep.subjectId !== args.subject_id || args.episode_type !== undefined && ep.episodeType !== args.episode_type) throw new AppError('MCP_INVALID_RESULT', '章节归属或类型不一致。'); return String(ep.id); }
      if (row.entity === 'episode') { if (row.subjectId !== args.subject_id || args.episode_type !== undefined && row.episodeType !== args.episode_type) throw new AppError('MCP_INVALID_RESULT', '章节归属或类型不一致。'); return String(row.id); }
      if (row.person && row.subject || row.character && row.subject) return JSON.stringify([record(row.person ?? row.character).id, record(row.subject).id, row.staff]);
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
  if (raw.kind === 'collectionState') { const target = record(raw.target), scope = record(raw.scope); if (target.id !== args[`${target.kind}_id`] || JSON.stringify(scope) !== JSON.stringify(args) || raw.visibility !== (args.username === '-' ? 'self' : 'public')) throw new AppError('MCP_INVALID_RESULT', '收藏对象或范围不一致。');
    if (raw.collection !== null) { const collection = record(raw.collection); if (target.kind === 'subject' ? collection.subjectId !== target.id : record(collection.target).id !== target.id || record(collection.target).entity !== target.kind) throw new AppError('MCP_INVALID_RESULT', '收藏现状对象不一致。'); }
  }
  if (raw.kind === 'episodeState') { if (record(record(raw.data).episode).id !== args.episode_id || JSON.stringify(raw.scope) !== JSON.stringify(args)) throw new AppError('MCP_INVALID_RESULT', '个人章节对象或范围不一致。'); }
  if (name === 'get_index' && raw.visibility !== (args.own === true ? 'self' : 'public')) throw new AppError('MCP_INVALID_RESULT', '目录可见范围与请求不一致。');
}
