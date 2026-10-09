import { AppError } from '../support/errors.js';
import { object } from '../support/bangumi.js';
import type { AccessContext } from './access-context.js';
import type { McpRequestOptions, McpTransport } from './transport.js';
import { fullDate } from './collection-query.js';
import { compileSubjectSearch, applySearchPlan } from './search-capabilities.js';

type Data = Record<string, unknown>;
const compact = (value: Data): Data => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
export function normalizeSubject(value: unknown): Data {
  const raw = object(value); const platform = raw.platform && typeof raw.platform === 'object' ? object(raw.platform) : null;
  return { ...raw, name_cn: raw.name_cn ?? raw.nameCN ?? raw.nameCn ?? '',
    date: raw.date ?? (raw.airtime && object(raw.airtime).date) ?? fullDate(raw.info),
    platform: platform ? platform.nameCN ?? platform.name ?? platform.alias ?? null : raw.platform,
    total_episodes: raw.total_episodes ?? raw.eps, meta_tags: raw.meta_tags ?? raw.metaTags };
}
function normalizeEntity(value: unknown): Data {
  const raw = object(value); return { ...raw, name_cn: raw.name_cn ?? raw.nameCN,
    career: raw.career ?? raw.careers, type: raw.type ?? raw.role };
}
function appearanceRole(value: unknown): Data {
  const code = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const meaning = code === 1 ? 'main' : code === 2 ? 'supporting' : code === 3 ? 'guest' : 'unknown';
  return { code, meaning, label: code === 1 ? '主角' : code === 2 ? '配角' : code === 3 ? '客串' : null };
}
/** 现有 v0 工具的固定 p1 对应映射；从不把账户 Cookie 发往 v0 或网页。 */
export async function accountRead(transport: McpTransport, path: string, options: McpRequestOptions, context: AccessContext, signal?: AbortSignal): Promise<unknown> {
  const account = context.account!; const query = options.query ?? {};
  const request = async (target: string, args: McpRequestOptions = {}) => {
    const value = await transport.account(target, { ...args, expectedAccountId: account.id }, signal);
    const check = (raw: unknown): void => {
      if (Array.isArray(raw)) { raw.forEach(check); return; }
      if (!raw || typeof raw !== 'object') return;
      const row = raw as Data;
      if (row.id !== undefined && row.nsfw !== undefined && row.nsfw !== null) {
        if (typeof row.nsfw !== 'boolean') throw new AppError('INVALID_RESPONSE', '上游NSFW字段类型无效。');
        if (context.nsfw.allowed === false && row.nsfw) throw new AppError('NSFW_SCOPE_MISMATCH', '上游返回了当前权限之外的NSFW资料。');
      }
      Object.values(row).forEach(check);
    };
    check(value); return value;
  };
  const all = async (target: string, filter: Data = {}): Promise<Data[]> => {
    const rows: Data[] = []; let total: number | undefined; const seen = new Set<number>();
    for (let offset = 0; offset < 10000; offset += 100) {
      signal?.throwIfAborted(); const page = object(await request(target, { query: { ...filter, limit: 100, offset } }));
      if (!Array.isArray(page.data) || !Number.isSafeInteger(page.total) || Number(page.total) > 10000 || Number(page.total) < 0
        || total !== undefined && page.total !== total || page.data.length !== Math.min(100, Math.max(0, Number(page.total) - offset))) throw new AppError('INCOMPLETE_DATA', '账户关联分页缺少记录或总数改变。');
      total = Number(page.total);
      for (const value of page.data) { const row = object(value); const id = Number(row.id ?? object(row.subject ?? row.character ?? row.staff).id);
        if (!Number.isSafeInteger(id) || id < 1 || seen.has(id)) throw new AppError('INCOMPLETE_DATA', '账户关联分页身份无效或重复。'); seen.add(id); rows.push(row); }
      if (rows.length === total) return rows;
    }
    throw new AppError('INCOMPLETE_DATA', '账户关联分页超过完整读取上限。');
  };
  context.source = 'p1'; context.nsfwApplied = context.nsfw.allowed === true && context.nsfw.preference !== false;
  const search = /^\/v0\/search\/(subjects|characters|persons)$/.exec(path);
  if (search) {
    if (search[1] !== 'subjects') { const page = object(await request(`/p1/search/${search[1]}`, options)); return { ...page, data: (page.data as unknown[]).map(normalizeEntity) }; }
    const body = object(options.body); const filter = body.filter == null ? {} : object(body.filter);
    const plan = compileSubjectSearch(body, context); applySearchPlan(context, plan);
    if (plan.source === 'v0') return transport.public(path, { ...options, body: plan.body }, signal);
    const page = object(await request('/p1/search/subjects', { ...options, body: plan.body }));
    if (!Array.isArray(page.data)) throw new AppError('INVALID_RESPONSE', '账户搜索缺少作品列表。');
    return { ...page, data: page.data.map(normalizeSubject) };
  }
  if (path === '/calendar') {
    const raw = await request('/p1/calendar'); if (Array.isArray(raw)) return raw;
    const days = object(raw); const en = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const cn = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
    return Array.from({ length: 7 }, (_, i) => { const rows = days[String(i + 1)] ?? [];
      if (!Array.isArray(rows)) throw new AppError('INVALID_RESPONSE', '账户日历缺少完整星期数据。');
      return { weekday: { id: i + 1, en: en[i], cn: cn[i] }, items: rows.map(row => normalizeSubject(object(row).subject)) };
    });
  }
  if (path === '/v0/subjects') {
    if (query.platform !== undefined) { context.source = 'v0'; context.nsfwApplied = false; return transport.public(path, options, signal); }
    const limit = Number(query.limit ?? 30), offset = Number(query.offset ?? 0); const rows: Data[] = [];
    // p1 浏览总数是页数，且摘要会另行隐藏NSFW；源限制明确报告，不能冒充完整账户权限范围。
    let pageCount: number | undefined; const ids = new Set<number>();
    // 无日期范围时保留 p1 源排序，用可见条目的连续偏移；不能把源总页数伪装成总条数。
    context.nsfwApplied = false;
    for (let pageNumber = 1; pageNumber <= 417; pageNumber++) {
      const page = object(await request('/p1/subjects', { query: compact({ ...query, sort: query.sort ?? 'rank', limit: undefined, offset: undefined, page: pageNumber }) }));
      if (!Array.isArray(page.data) || !Number.isSafeInteger(page.total) || Number(page.total) < 0 || Number(page.total) > 417
        || pageCount !== undefined && pageCount !== page.total || page.data.length > 24) throw new AppError('INCOMPLETE_DATA', '账户浏览源页数或记录数量异常。');
      pageCount = Number(page.total);
      for (const value of page.data) { const item = normalizeSubject(value); const id = Number(item.id);
        if (!Number.isSafeInteger(id) || id < 1 || ids.has(id)) throw new AppError('INCOMPLETE_DATA', '账户浏览记录身份无效或重复。'); ids.add(id); rows.push(item); }
      const exhausted = pageNumber >= pageCount;
      if (rows.length >= offset + limit || exhausted) return { data: rows.slice(offset, offset + limit), total: exhausted ? rows.length : null, limit, offset };
    }
    throw new AppError('INCOMPLETE_DATA', '账户浏览未覆盖请求偏移。');
  }
  const image = /^\/v0\/(subjects|characters|persons)\/(\d+)\/image$/.exec(path);
  if (image) { const raw = object(await request(`/p1/${image[1]}/${image[2]}`)); if (raw.id !== Number(image[2])) throw new AppError('INVALID_RESPONSE', '图片详情返回了其他对象。'); const images = object(raw.images);
    const url = images[String(query.type)]; if (typeof url !== 'string') throw new AppError('RESOURCE_UNAVAILABLE', '账户资料没有请求尺寸的图片。'); return { Location: url }; }
  const detail = /^\/v0\/(subjects|characters|persons|episodes)\/(\d+)$/.exec(path);
  if (detail) { const raw = object(await request(`/p1/${detail[1]}/${detail[2]}`)); if (raw.id !== Number(detail[2])) throw new AppError('INVALID_RESPONSE', '账户详情返回了其他对象。'); return detail[1] === 'subjects' ? normalizeSubject(raw) : normalizeEntity(raw); }
  const episodeList = /^\/v0\/episodes$/.test(path);
  if (episodeList) { const sid = Number(query.subject_id);
    if (query.type === 0) { const rows = (await all(`/p1/subjects/${sid}/episodes`)).filter(row => row.type === 0); const limit = Number(query.limit ?? 100), offset = Number(query.offset ?? 0);
      return { data: rows.slice(offset, offset + limit).map(value => ({ ...normalizeEntity(value), subject_id: value.subjectID ?? value.subject_id })), total: rows.length, limit, offset }; }
    const raw = object(await request(`/p1/subjects/${sid}/episodes`, { query: compact({ ...query, subject_id: undefined }) }));
    if (!Array.isArray(raw.data)) throw new AppError('INVALID_RESPONSE', '账户章节列表缺少数组。');
    return { ...raw, data: raw.data.map(value => { const row = object(value); const owner = row.subjectID ?? row.subject_id;
      if (owner !== sid || query.type !== undefined && row.type !== query.type) throw new AppError('INVALID_RESPONSE', '账户章节归属或类型不符合请求。');
      return { ...normalizeEntity(value), subject_id: owner }; }) }; }
  const relation = /^\/v0\/(subjects|characters|persons)\/(\d+)\/(subjects|characters|persons)$/.exec(path);
  if (relation) {
    const [, kind, id, target] = relation;
    if (kind === 'subjects' && target === 'subjects') return (await all(`/p1/subjects/${id}/relations`)).map(row => ({ ...normalizeSubject(row.subject), relation: object(row.relation).cn ?? object(row.relation).name }));
    if (kind === 'subjects' && target === 'characters') return (await all(`/p1/subjects/${id}/characters`)).map(row => ({ ...normalizeEntity(row.character), relation: ['其他', '主角', '配角', '客串'][Number(row.type)] ?? null,
      actors: (row.casts as Data[] ?? []).map(cast => normalizeEntity(cast.person)) }));
    if (kind === 'subjects' && target === 'persons') return (await all(`/p1/subjects/${id}/staffs/persons`)).map(row => ({ ...normalizeEntity(row.staff), relation: (row.positions as Data[]).map(position => object(position.type).cn).join('、'), eps: null }));
    if (kind === 'persons' && target === 'subjects') return (await all(`/p1/persons/${id}/works`)).map(row => ({ ...normalizeSubject(row.subject), staff: (row.positions as Data[]).map(position => object(position.type).cn).join('、') }));
    if (kind === 'characters') { const rows = await all(`/p1/characters/${id}/casts`);
      if (target === 'subjects') return rows.map(row => ({ ...normalizeSubject(row.subject), relation: ['其他', '主角', '配角', '客串'][Number(row.type)] ?? null }));
      return rows.flatMap(row => {
        if (!Array.isArray(row.casts)) throw new AppError('INVALID_RESPONSE', '角色出演资料缺少人物清单。');
        const role = appearanceRole(row.type);
        return row.casts.map(value => { const cast = object(value); return { ...normalizeEntity(cast.person), subject: normalizeSubject(row.subject),
          staff: role.label, appearanceRole: role, source_type_code: row.type }; });
      }); }
    if (kind === 'persons' && target === 'characters') return (await all(`/p1/persons/${id}/casts`)).flatMap(row => {
      if (!Array.isArray(row.relations)) throw new AppError('INVALID_RESPONSE', '人物出演资料缺少作品关系清单。');
      return row.relations.map(value => { const relation = object(value); const role = appearanceRole(relation.type);
        return { ...normalizeEntity(row.character), subject: normalizeSubject(relation.subject), staff: role.label,
          appearanceRole: role, source_type_code: relation.type }; });
    });
  }
  const user = /^\/v0\/users\/([^/]+)(?:\/(avatar|collections)(?:\/([^/]+))?)?$/.exec(path);
  if (user) {
    const [, username, section, sid] = user;
    if (!section || section === 'avatar') { const profile = object(await request(`/p1/users/${username}`));
      const requested = decodeURIComponent(username!);
      if (typeof profile.id !== 'number' || !Number.isSafeInteger(profile.id) || profile.id < 1
        || profile.username !== requested && (!/^\d+$/.test(requested) || profile.id !== Number(requested))) throw new AppError('INVALID_RESPONSE', '账户用户资料返回了其他用户。');
      if (section === 'avatar') return { Location: object(profile.avatar)[String(query.type)] };
      return { ...profile, user_group: profile.group }; }
    if (!sid) return request(`/p1/users/${username}/collections/subjects`, { query: compact({ ...query, subjectType: query.subject_type, subject_type: undefined }) });
    const rows = await all(`/p1/users/${username}/collections/subjects`); const found = rows.find(row => row.id === Number(sid));
    if (!found) throw new AppError('BGM_HTTP_404', '此账户可见范围内未取得指定用户收藏，不能推断本人未收藏。');
    const interest = object(found.interest);
    if (found.private !== undefined && found.private !== false || interest.private !== undefined && interest.private !== false) throw new AppError('PRIVATE_SCOPE', '公开用户收藏响应出现私密或非法可见性字段。');
    return { subject: normalizeSubject(found), subject_id: found.id, type: interest.type, rate: interest.rate, tags: interest.tags, comment: interest.comment, private: false };
  }
  const entities = /^\/v0\/users\/([^/]+)\/collections\/-\/(characters|persons)(?:\/(\d+))?$/.exec(path);
  if (entities) { const [, username, kind, id] = entities; const rows = await all(`/p1/users/${username}/collections/${kind}`);
    if (id) { const found = rows.find(row => row.id === Number(id)); if (!found) throw new AppError('BGM_HTTP_404', '此账户可见范围内未取得收藏。'); return normalizeEntity(found); }
    const limit = Number(query.limit ?? 30), offset = Number(query.offset ?? 0); return { data: rows.slice(offset, offset + limit).map(normalizeEntity), total: rows.length, limit, offset }; }
  const index = /^\/v0\/indices\/(\d+)(?:\/(subjects))?$/.exec(path);
  if (index) { const raw = object(await request(`/p1/indexes/${index[1]}`));
    if (raw.private === true) throw new AppError('PRIVATE_SCOPE', '该目录是私密目录，请明确使用 own=true。');
    if (!index[2]) return raw;
    const page = object(await request(`/p1/indexes/${index[1]}/related`, { query: compact({ cat: 0, type: query.type, limit: query.limit, offset: query.offset }) }));
    return { ...page, data: (page.data as Data[]).map(row => ({ ...row, subject: normalizeSubject(row.subject), subject_id: object(row.subject).id })) };
  }
  // v0 修订格式没有等价的 p1 DTO；仍先完成账户预检，并明确该资料不应用 NSFW 权限。
  if (/^\/v0\/revisions\//.test(path)) { context.source = 'v0'; context.nsfwApplied = false;
    context.queryCoverage = { requested: 'account', actual: 'public_visible', nsfw: 'unknown', totalKind: 'unknown', limitations: ['public_revision_source'] };
    return transport.public(path, options, signal); }
  throw new AppError('ACCOUNT_QUERY_UNSUPPORTED', '该查询没有已核实的账户接口映射，未退回匿名查询。');
}
