import { appendFileSync, writeFileSync } from 'node:fs';
import type { FixtureDefinition, FixtureSubject, NetworkEvent } from './schema.js';
import { record } from './schema.js';

const names = ['星港追踪', '玻璃海的回声', '雨夜档案', '午夜列车', '星港追踪 第二季', '山城来信',
  '夏日烟火', '镜中旅人', '无声信号', '旧街侦探', '星港追踪 完结篇', '未定日的约定'];
export function fixtureDefinition(id: string): FixtureDefinition {
  const profiles = ['standard', 'read-once', 'read-always', 'auth-expired', 'write-unknown'];
  if (!profiles.includes(id)) throw new Error('未登记的数据夹具：' + id);
  const dates = ['2024-01-08', '2024-04-12', '2024-07-03', '2024-05', '2024-10-05', '2023-10-01',
    '2024-08-01', '2024-02-08', '2024-06-01', '2024-03-03', '2024-12-31', null];
  const forms = ['TV', 'Movie', 'TV', 'OVA', 'TV', 'TV', 'Movie', 'TV', 'WEB', 'TV', 'TV', 'TV'];
  const scores = [8.4, 8.1, 8.2, 7.8, 7.6, 8.6, 6.2, 7.7, 8.1, 7.4, 9, 8.2];
  const statuses = [2, 1, 3, 1, 1, undefined, undefined, 4, undefined, 5, 1, 1];
  const subjects: FixtureSubject[] = names.map((name, index) => ({
    id: 1001 + index, name, date: dates[index]!, form: forms[index]!, score: scores[index]!,
    summary: name + '讲述调查失踪档案的旅程。叙事围绕身份疑点和逐步揭露的线索，强调人物关系与悬疑推理。'
      + (index === 5 ? '虽然标签没有悬疑，但正文明确围绕调查谜案；故事结局温暖。' : '结尾给出主要谜团的解释。'),
    tags: index === 5 ? ['成长'] : ['悬疑', '推理'], ...(statuses[index] === undefined ? {} : { status: statuses[index] }),
  }));
  const fillers = Array.from({ length: 120 }, (_, index): FixtureSubject => ({
    id: 2001 + index, name: '日常练习' + (index + 1), date: '2020-01-01', form: 'TV', score: 6,
    summary: '平静的校园日常，没有调查谜案主线。', tags: ['日常'], status: 1,
  }));
  const fault = id === 'standard' ? undefined : id.replaceAll('-', '_') as FixtureDefinition['fault'];
  return { id, version: 1, account: { id: 42, username: 'benchmark_reader' },
    subjects: [...subjects.slice(0, 10), ...fillers, ...subjects.slice(10)],
    relations: [{ parent: 1001, child: 1005, relation: '续集' }, { parent: 1005, child: 1011, relation: '续集' }, { parent: 1003, child: 1011, relation: '续集' }],
    appearances: [{ characterId: 11, subjectId: 1002, role: 1 }, { characterId: 11, subjectId: 1005, role: 2 },
      { characterId: 12, subjectId: 1002, role: 1 }, { characterId: 12, subjectId: 1007, role: 1 }, { characterId: 13, subjectId: 1006, role: 1 }],
    blog: { id: 301, title: '星港追踪长评',
      content: '开头观点：线索安排清晰，观众可以参与推理。\n' + '中段讨论镜头、配乐和人物选择，不能用评分替代剧情证据。\n'.repeat(250)
        + '\n尾段结论：真正的主题是记忆保管权，作者批评配角缺乏自主选择。' },
    ...(fault === undefined ? {} : { fault }) };
}
export function publicSubject(subject: FixtureSubject): Record<string, unknown> {
  return { id: subject.id, type: 2, name: subject.name, name_cn: subject.name, date: subject.date,
    platform: subject.form, meta_tags: [subject.form], nsfw: false, eps: 12, total_episodes: 12,
    summary: subject.summary, tags: subject.tags.map(name => ({ name, count: 20 })),
    rating: { total: 3000, score: subject.score, rank: subject.id - 1000, count: { '8': 3000 } },
    collection: { wish: 100, collect: 200, doing: 30, on_hold: 10, dropped: 10 },
    images: { large: 'https://example.invalid/benchmark/' + subject.id + '.png' },
    infobox: [{ key: '放送开始', value: subject.date ?? '' }, { key: '每集时长', value: '24分钟' }],
  };
}
export function accountSubject(subject: FixtureSubject): Record<string, unknown> {
  return { ...publicSubject(subject), nameCN: subject.name, metaTags: [subject.form],
    airtime: { date: subject.date ?? '' }, platform: { id: 1, name: subject.form, nameCN: subject.form },
    info: subject.date ?? '', volumes: 0, redirect: 0, seriesEntry: 0, locked: false, series: false,
    interest: subject.status === undefined ? null : { type: subject.status, rate: 8, comment: '原有短评',
      tags: ['原标签'], private: false, epStatus: subject.status === 2 ? 12 : 0, volStatus: 0, updatedAt: 1700000000 },
  };
}
/** 请求驱动的固定上游；支持不同合法工具路径，所有未登记路径都失败且不会联网。 */
export class FixtureRouter {
  readonly events: NetworkEvent[] = [];
  readonly subjects = new Map<number, Record<string, unknown>>();
  private readonly started = performance.now();
  private detailReads = 0;
  constructor(readonly definition: FixtureDefinition, private readonly outputDir?: string) {
    definition.subjects.forEach(subject => this.subjects.set(subject.id, accountSubject(subject)));
    this.saveState();
  }
  private saveState(): void {
    if (this.outputDir) writeFileSync(this.outputDir + '/fixture-state.json', JSON.stringify([...this.subjects.values()]));
  }
  readonly fetch = async (input: string, init: { method?: string; body?: unknown }): Promise<Response> => {
    const start = performance.now(), url = new URL(input), path = url.pathname, method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? record(JSON.parse(init.body)) : record(init.body);
    const query = Object.fromEntries(url.searchParams), id = Number(path.split('/').at(-1));
    const write = path.startsWith('/p1/collections/') && method !== 'GET';
    const event: NetworkEvent = { seq: this.events.length + 1, timestampMs: performance.timeOrigin + start, elapsedMs: start - this.started, durationMs: 0,
      source: 'fixture', path, method, status: null, write, subjectId: Number.isSafeInteger(id) && id > 0 ? id : null,
      body: method === 'GET' ? null : body, fixtureMiss: false };
    let value: unknown, status = 200;
    const page = (rows: unknown[]) => ({ data: rows.slice(Number(query.offset ?? 0), Number(query.offset ?? 0) + Number(query.limit ?? 30)), total: rows.length });
    const filterSubjects = () => {
      const filter = record(body.filter), keyword = String(body.keyword ?? query.keyword ?? '').toLowerCase();
      let rows = this.definition.subjects.filter(subject => !keyword || (subject.name + subject.summary + subject.tags.join(' ')).toLowerCase().includes(keyword));
      const types = filter.type;
      if (Array.isArray(types) && !types.includes(2) || query.type !== undefined && Number(query.type) !== 2) rows = [];
      if (Array.isArray(filter.tag)) rows = rows.filter(subject => (filter.tag as string[]).every(tag => subject.tags.includes(tag) || subject.form.toLowerCase() === tag.toLowerCase()));
      for (const condition of Array.isArray(filter.air_date) ? filter.air_date : []) {
        if (typeof condition === 'string') { const match = /^(>=|<=|>|<|=)(.+)$/.exec(condition);
          if (match) rows = rows.filter(subject => subject.date !== null && (match[1] === '>=' ? subject.date >= match[2]! : match[1] === '<=' ? subject.date <= match[2]! : match[1] === '>' ? subject.date > match[2]! : match[1] === '<' ? subject.date < match[2]! : subject.date === match[2])); }
      }
      for (const condition of Array.isArray(filter.rating) ? filter.rating : []) {
        if (typeof condition === 'string') { const match = /^(>=|<=|>|<|=)([\d.]+)$/.exec(condition);
          if (match) rows = rows.filter(subject => match[1] === '>=' ? subject.score >= Number(match[2]) : match[1] === '<=' ? subject.score <= Number(match[2]) : match[1] === '>' ? subject.score > Number(match[2]) : match[1] === '<' ? subject.score < Number(match[2]) : subject.score === Number(match[2])); }
      }
      if (query.cat !== undefined) rows = rows.filter(subject => subject.form === ({ '1': 'TV', '2': 'OVA', '3': 'Movie', '5': 'WEB' } as Record<string, string>)[query.cat!]);
      if (query.year !== undefined) rows = rows.filter(subject => subject.date?.startsWith(query.year! + (query.month === undefined ? '' : '-' + query.month.padStart(2, '0'))));
      return rows;
    };
    try {
      if (!['api.bgm.tv', 'next.bgm.tv'].includes(url.hostname)) { event.fixtureMiss = true; throw new Error('FIXTURE_MISS'); }
      if (path === '/p1/me') { value = this.definition.account; if (this.definition.fault === 'auth_expired') status = 401; }
      else if (path === '/p1/privacy') value = { preferences: { showNsfwSubject: false, allowNsfw: false } };
      else if (/^\/(?:v0|p1)\/subjects\/\d+$/.test(path)) {
        this.detailReads++;
        if (this.definition.fault === 'read_always' || this.definition.fault === 'read_once' && this.detailReads === 1) { status = 503; value = {}; }
        else { const subject = this.definition.subjects.find(row => row.id === id);
          value = subject ? path.startsWith('/p1') ? this.subjects.get(id) : publicSubject(subject) : {}; if (!subject) status = 404; }
      } else if (path === '/v0/search/subjects' || path === '/p1/search/subjects' || path === '/v0/subjects') {
        value = page(filterSubjects().map(subject => path.startsWith('/p1') ? this.subjects.get(subject.id) : publicSubject(subject)));
      } else if (path === '/p1/subjects') {
        const rows = filterSubjects(); value = { data: rows.slice((Number(query.page ?? 1) - 1) * 24, Number(query.page ?? 1) * 24).map(subject => this.subjects.get(subject.id)), total: Math.ceil(rows.length / 24) };
      } else if (path === '/p1/collections/subjects' || /^\/v0\/users\/[^/]+\/collections$/.test(path)) {
        const type = Number(query.type), media = Number(query.subjectType ?? query.subject_type ?? 2);
        const rows = [...this.subjects.values()].filter(subject => subject.interest && media === 2 && (!type || record(subject.interest).type === type));
        value = page(path.startsWith('/p1') ? rows : rows.map(subject => ({ ...record(subject.interest), subject_id: subject.id,
          subject: publicSubject(this.definition.subjects.find(row => row.id === subject.id)!) })));
      } else if (/^\/p1\/collections\/subjects\/\d+$/.test(path) && ['PUT', 'PATCH'].includes(method)) {
        const subject = this.subjects.get(id); if (!subject) { status = 404; value = {}; }
        else { subject.interest = { ...record(subject.interest), ...body, epStatus: record(subject.interest).epStatus ?? 0, volStatus: 0, updatedAt: 1700000000 };
          delete record(subject.interest).progress; value = {}; this.saveState();
          if (this.definition.fault === 'write_unknown') throw new Error('FIXTURE_WRITE_RESPONSE_LOST'); }
      } else if (/^\/v0\/subjects\/\d+\/subjects$/.test(path)) {
        const parent = Number(path.split('/')[3]); value = this.definition.relations.filter(edge => edge.parent === parent)
          .map(edge => ({ ...publicSubject(this.definition.subjects.find(row => row.id === edge.child)!), relation: edge.relation }));
      } else if (/^\/p1\/subjects\/\d+\/subjects$/.test(path)) {
        const parent = Number(path.split('/')[3]); value = page(this.definition.relations.filter(edge => edge.parent === parent)
          .map(edge => ({ subject: this.subjects.get(edge.child), relation: 2 })));
      } else if (/^\/v0\/persons\/\d+\/characters$/.test(path)) {
        value = this.definition.appearances.map(edge => ({ id: edge.characterId, type: 1, name: '角色' + edge.characterId,
          name_cn: '角色' + edge.characterId, nsfw: false, subject: publicSubject(this.definition.subjects.find(row => row.id === edge.subjectId)!),
          staff: edge.role === 1 ? '主角' : '配角', images: {} }));
      } else if (/^\/v0\/subjects\/\d+\/characters$/.test(path)) {
        const parent = Number(path.split('/')[3]), edges = path.includes('/persons/') ? this.definition.appearances : this.definition.appearances.filter(edge => edge.subjectId === parent);
        value = [...new Set(edges.map(edge => edge.characterId))].map(characterId => ({ id: characterId, type: 1, name: '角色' + characterId,
          name_cn: '角色' + characterId, nsfw: false, relation: '主角', images: {} }));
      } else if (/^\/p1\/persons\/\d+\/(?:characters|casts)$/.test(path)) {
        value = page([...new Set(this.definition.appearances.map(edge => edge.characterId))].map(characterId => ({
          character: { id: characterId, type: 1, name: '角色' + characterId, nameCN: '角色' + characterId },
          relations: this.definition.appearances.filter(edge => edge.characterId === characterId).map(edge => ({ subject: this.subjects.get(edge.subjectId), type: edge.role })) })));
      } else if (/^\/v0\/characters\/\d+\/subjects$/.test(path)) {
        const characterId = Number(path.split('/')[3]); value = this.definition.appearances.filter(edge => edge.characterId === characterId)
          .map(edge => ({ ...publicSubject(this.definition.subjects.find(row => row.id === edge.subjectId)!), staff: edge.role === 1 ? '主角' : '配角' }));
      } else if (/^\/v0\/subjects\/\d+\/persons$/.test(path)) {
        value = this.definition.appearances.some(edge => edge.subjectId === Number(path.split('/')[3]))
          ? [{ id: 71, type: 1, name: '林星', name_cn: '林星', relation: '声优', career: ['seiyu'], images: {} }] : [];
      } else if (/^\/v0\/persons\/\d+\/subjects$/.test(path)) value = [];
      else if (/^\/v0\/characters\/\d+\/persons$/.test(path)) value = [];
      else if (/^\/(?:v0|p1)\/characters\/\d+$/.test(path)) value = { id, type: 1, name: '角色' + id, name_cn: '角色' + id,
        nameCN: '角色' + id, summary: '调查员角色。', nsfw: false, images: {}, infobox: [] };
      else if (path === '/calendar') value = Array.from({ length: 7 }, (_, index) => ({
        weekday: { id: index + 1, en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][index],
          cn: '星期' + (index + 1) }, items: [] }));
      else if (/^\/(?:v0|p1)\/persons\/71$/.test(path)) value = { id: 71, type: 1, name: '林星', name_cn: '林星', nameCN: '林星', career: ['seiyu'], careers: ['seiyu'], nsfw: false, images: {} };
      else if (/^\/(?:v0|p1)\/search\/persons$/.test(path)) value = page(String(body.keyword ?? '').includes('林星')
        ? [{ id: 71, type: 1, name: '林星', name_cn: '林星', career: ['seiyu'], nsfw: false, images: {} }] : []);
      else if (path === '/p1/blogs/301') value = { ...this.definition.blog, public: true, user: { ...this.definition.account, nickname: '作者' },
        replies: 0, createdAt: 1700000000, updatedAt: 1700000000 };
      else if (/^\/p1\/subjects\/\d+\/reviews$/.test(path)) value = page([{ id: 201, user: { ...this.definition.account, nickname: '作者' },
        entry: { id: 301, title: this.definition.blog.title, summary: '线索安排与记忆保管权', replies: 0, public: true, createdAt: 1700000000, updatedAt: 1700000000 } }]);
      else if (/^\/p1\/subjects\/\d+\/comments$/.test(path)) value = page([{ id: 111, user: { ...this.definition.account, nickname: '作者' },
        type: 2, rate: 8, comment: '线索安排清晰，但配角的自主选择不足。', updatedAt: 1700000000 }]);
      else if (/^\/v0\/users\/[^/]+\/collections\/\d+$/.test(path)) { const subject = this.subjects.get(id);
        if (subject?.interest) value = { ...record(subject.interest), subject_id: id, subject: publicSubject(this.definition.subjects.find(row => row.id === id)!) }; else { status = 404; value = {}; } }
      else { event.fixtureMiss = true; throw new Error('FIXTURE_MISS'); }
      event.status = status;
      return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
    } catch (error) { event.error = error instanceof Error ? error.message : 'FIXTURE_ERROR'; throw error; }
    finally { event.durationMs = performance.now() - start; this.events.push(event);
      if (this.outputDir) appendFileSync(this.outputDir + '/network.jsonl', JSON.stringify(event) + '\n'); }
  };
}
