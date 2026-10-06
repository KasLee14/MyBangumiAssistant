import assert from 'node:assert/strict';
import test from 'node:test';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { AppError } from '../dist/src/support/errors.js';
import { checkAccessResponse } from '../dist/src/mcp/access-context.js';

const subject = (id, score = 8) => ({ id, type: 2, name: `作品${id}`, name_cn: `作品${id}`,
  date: '2026-04-01', nsfw: false, platform: 'TV', meta_tags: ['TV'],
  eps: 12, volumes: 0, rating: { score, total: 3000, rank: 50 },
  tags: [{ name: '搞笑', count: 200 }, { name: '日常', count: 100 }],
});
const ids = result => result.data.map(row => row.id);
const invoke = async (service, name, args, turnId = 'candidate-integration') => {
  const value = await service.call(name, args, undefined, undefined, undefined, { turnId });
  checkAccessResponse(name, value);
  return value;
};

test('已提供的非法个人评分拒绝，而不是当未知再展开单项补读', async t => {
  const row = personal(1); row.interest.rate = '8';
  const f = ownFixture([row]); t.after(() => f.service.close());
  await assert.rejects(invoke(f.service, 'query_user_collections', { username: '-', subject_type: 2,
    result_mode: 'candidates', fields: ['id', 'personalRating'], filter: { personal_rating: { min: 1 } } }), error => error.code === 'INVALID_RESPONSE');
  assert.ok(f.calls.every(call => call.path === '/p1/collections/subjects'));
});

const coverageSources = async (service, value) => (await invoke(service, 'get_candidate_coverage', { coverage_ref: value.coverage.coverageRef, limit: 100 })).sources;

function publicFixture() {
  const rows = Array.from({ length: 40 }, (_, index) => subject(index + 1, index < 20 ? 4 : 8));
  const branch = [rows[20], rows[21], subject(101)];
  const calls = [];
  const service = new BangumiMcpService({ close: async () => {},
    identity: async () => { throw Error('公共候选不得读取账户'); },
    currentUser: async () => { throw Error('公共候选不得读取账户'); },
    account: async () => { throw Error('公共候选不得读取私有接口'); },
    public: async (path, options = {}) => {
      calls.push({ path, options: structuredClone(options) });
      if (path === '/v0/search/subjects') {
        const source = options.body.keyword === '新分支' ? branch : rows;
        const { limit, offset } = options.query;
        return { data: source.slice(offset, offset + limit), total: source.length };
      }
      const match = /^\/v0\/subjects\/(\d+)$/.exec(path);
      if (match) {
        const id = Number(match[1]);
        const row = [...rows, ...branch].find(row => row.id === id);
        assert.ok(row, `意外读取作品${id}`);
        return { ...row, summary: `作品${id}的已核实简介`, infobox: [] };
      }
      throw Error(`不允许的来源读取 ${path}`);
    },
  });
  return { service, calls, detailIds: () => calls.flatMap(call => /^\/v0\/subjects\/(\d+)$/.test(call.path) ? [Number(call.path.split('/').at(-1))] : []) };
}

test('服务漏斗先用未展示的评分筛选，再只补通过作品简介；合并分支保留缓存', async t => {
  const f = publicFixture(); t.after(() => f.service.close());
  const recalled = await invoke(f.service, 'search_subjects', { keyword: '召回', subject_type: 2, limit: 40,
    result_mode: 'candidates', fields: ['id', 'name'] });
  assert.equal(recalled.kind, 'candidate_page');
  assert.equal(recalled.data.length, 40);
  assert.ok(recalled.data.every(row => !Object.hasOwn(row, 'score') && !Object.hasOwn(row, 'tags') && !Object.hasOwn(row, 'summary')));
  assert.deepEqual(f.detailIds(), []);

  const filtered = await invoke(f.service, 'refine_subject_candidates', { candidate_ref: recalled.candidateRef,
    filter: { rating: { min: 7.5 } }, fields: ['id', 'name'], limit: 100 });
  assert.deepEqual(ids(filtered), Array.from({ length: 20 }, (_, index) => index + 21));
  assert.equal(filtered.stage.excludedCount, 20);
  assert.equal(filtered.stage.matchedCount, 20);
  assert.deepEqual(f.detailIds(), [], '未展示的评分仍来自召回缓存，无需重复详情');

  const described = await invoke(f.service, 'refine_subject_candidates', { candidate_ref: filtered.candidateRef,
    fields: ['id', 'name', 'summary', 'ratingCount'], limit: 100 });
  assert.equal(described.data.length, 20);
  assert.deepEqual(f.detailIds(), ids(described));
  assert.ok(described.data.every(row => row.ratingCount === 3000 && typeof row.summary === 'string'));

  const again = await invoke(f.service, 'refine_subject_candidates', { candidate_ref: described.candidateRef,
    fields: ['id', 'summary', 'score'], limit: 100 });
  assert.equal(again.data.length, 20);
  assert.equal(f.detailIds().length, 20, '同一详情返回的多个字段及简介均直接复用');

  const merged = await invoke(f.service, 'search_subjects', { keyword: '新分支', subject_type: 2,
    result_mode: 'candidates', merge_ref: described.candidateRef, fields: ['id', 'name'], limit: 40 });
  const mergedDescribed = await invoke(f.service, 'refine_subject_candidates', { candidate_ref: merged.candidateRef,
    fields: ['id', 'summary'], limit: 100 });
  assert.deepEqual(ids(mergedDescribed), [...Array.from({ length: 20 }, (_, index) => index + 21), 101]);
  assert.equal(new Set(ids(mergedDescribed)).size, 21);
  assert.deepEqual(f.detailIds(), [...Array.from({ length: 20 }, (_, index) => index + 21), 101], '新分支仅新ID需要补简介');

  const beforeEnd = f.calls.length;
  f.service.endReadContext('candidate-integration');
  await assert.rejects(invoke(f.service, 'refine_subject_candidates', { candidate_ref: mergedDescribed.candidateRef,
    fields: ['id'], limit: 100 }), error => error.code === 'CANDIDATE_REF_EXPIRED');
  assert.equal(f.calls.length, beforeEnd, '失效引用必须在网络读取之前拒绝');
});

test('召回投影不会为缺失字段读详情；refine才按当前窗口补字段', async t => {
  const f = publicFixture(); t.after(() => f.service.close());
  const recalled = await invoke(f.service, 'search_subjects', { keyword: '召回', subject_type: 2, limit: 40,
    result_mode: 'candidates', fields: ['id', 'summary'] });
  assert.equal(recalled.data.length, 40);
  assert.ok(recalled.data.every(row => row.summary === null && row.fieldStates.summary === 'unknown'));
  assert.deepEqual(f.detailIds(), [], '投影不应隐式触发40个详情读取');

  const fields = ['id', 'summary'];
  const first = await invoke(f.service, 'refine_subject_candidates', { candidate_ref: recalled.candidateRef, fields, limit: 1 });
  assert.deepEqual(ids(first), [1]);
  assert.deepEqual(f.detailIds(), [1]);
  assert.equal(first.stage.remainingCount, 39);
  const second = await invoke(f.service, 'refine_subject_candidates', { candidate_ref: first.candidateRef, cursor: first.page.nextCursor, fields, limit: 1 });
  assert.deepEqual(ids(second), [2]);
  assert.deepEqual(f.detailIds(), [1, 2]);
  assert.equal(second.stage.processedCount, 2);
});

const viewer = { id: 42, username: 'integration_user' };
const identity = () => ({ mode: 'account', account: viewer, nsfw: { preference: null, allowed: null, state: 'not_checked' },
  source: 'p1', nsfwApplied: false, checkedAt: new Date().toISOString() });
const personal = (id, rating = 8) => ({ ...subject(id), nameCN: `作品${id}`, date: '',
  interest: { type: 2, rate: rating, tags: ['笑点'], comment: '', private: false, epStatus: 12, volStatus: 0, updatedAt: 1700000000 } });

function ownFixture(rows) {
  const calls = [];
  const service = new BangumiMcpService({ close: async () => {}, identity: async () => identity(), currentUser: async () => viewer,
    public: async path => {
      calls.push({ path });
      const match = /^\/v0\/subjects\/(\d+)$/.exec(path);
      assert.ok(match, `不允许的公共读取 ${path}`);
      return { ...subject(Number(match[1])), summary: `作品${match[1]}的简介`, infobox: [] };
    },
    account: async (path, options) => {
      calls.push({ path, options: structuredClone(options) });
      assert.equal(options.expectedAccountId, viewer.id);
      if (path === '/p1/collections/subjects') {
        const selected = rows.filter(row => options.query.type === undefined || row.interest.type === options.query.type);
        const { offset, limit } = options.query;
        return { data: selected.slice(offset, offset + limit), total: selected.length };
      }
      if (/^\/p1\/subjects\/\d+$/.test(path)) throw new AppError('BGM_TIMEOUT', '离线核实暂时失败');
      throw Error(`不允许的账户读取 ${path}`);
    },
  });
  return { service, calls };
}

test('收藏服务先筛个人评分再补作品简介；无日期条件不为未知日期读取详情', async t => {
  const rows = Array.from({ length: 20 }, (_, index) => personal(index + 1, index < 15 ? 5 : 9));
  const f = ownFixture(rows); t.after(() => f.service.close());
  const selected = await invoke(f.service, 'query_user_collections', { username: '-', subject_type: 2,
    result_mode: 'candidates', filter: { personal_rating: { min: 8 } }, fields: ['id', 'personalRating', 'personalTags'], limit: 100 });
  assert.deepEqual(ids(selected), [16, 17, 18, 19, 20]);
  assert.ok(selected.data.every(row => row.personalRating === 9 && row.personalTags[0] === '笑点'));
  assert.equal(selected.coverage.complete, true);
  assert.deepEqual(f.calls.map(call => call.path), ['/p1/collections/subjects']);
  const described = await invoke(f.service, 'refine_subject_candidates', { candidate_ref: selected.candidateRef,
    fields: ['id', 'summary'], limit: 100 });
  assert.deepEqual(ids(described), [16, 17, 18, 19, 20]);
  assert.deepEqual(f.calls.filter(call => /\/subjects\/\d+$/.test(call.path)).map(call => Number(call.path.split('/').at(-1))), [16, 17, 18, 19, 20]);
});

test('部分收藏缺席保持待核实；继续读完本人全状态范围后缺席才可证明未收藏', async t => {
  const f = ownFixture(Array.from({ length: 130 }, (_, index) => personal(index + 1)));
  t.after(() => f.service.close());
  const scope = { username: '-', subject_type: 2, result_mode: 'candidates', source_limit: 100, fields: ['id'], limit: 100 };
  const sampled = await invoke(f.service, 'query_user_collections', scope);
  assert.equal((await coverageSources(f.service, sampled)).some(source => !source.complete), true);
  const identified = await invoke(f.service, 'refine_subject_candidates', { subject_ids: [250], fields: ['id', 'subjectType'] });
  assert.equal(identified.data[0].subjectType, 2, '先核实候选媒体，收藏范围缺席证明必须适用');
  const unknown = await invoke(f.service, 'refine_subject_candidates', { candidate_ref: identified.candidateRef, collection_ref: sampled.collectionRef,
    filter: { exclude_collection_types: [1, 2, 3, 4, 5] }, fields: ['id', 'collectionState'], limit: 100 });
  assert.deepEqual(unknown.data, []);
  assert.deepEqual(unknown.pending.map(row => row.id), [250]);
  assert.ok(f.calls.some(call => call.path === '/p1/subjects/250'), '不完整收藏中的缺席须按需核实，不能静默认为未收藏');

  const continued = await invoke(f.service, 'query_user_collections', { ...scope, collection_ref: sampled.collectionRef });
  assert.ok((await coverageSources(f.service, continued)).every(source => source.complete));
  const before = f.calls.length;
  const absent = await invoke(f.service, 'refine_subject_candidates', { candidate_ref: identified.candidateRef, collection_ref: continued.collectionRef,
    filter: { exclude_collection_types: [1, 2, 3, 4, 5] }, fields: ['id', 'collectionState'], limit: 100 });
  assert.deepEqual(absent.data.map(row => ({ id: row.id, state: row.collectionState })), [{ id: 250, state: 'not_collected' }]);
  assert.equal(f.calls.length, before, '完整且适用的收藏证据可直接关联，无需逐项请求');
});

test('零匹配不代表来源结束；收藏续来源只回新匹配，候选窗口在refine续查', async t => {
  const rows = Array.from({ length: 130 }, (_, index) => personal(index + 1, index < 120 ? 5 : 9));
  const f = ownFixture(rows); t.after(() => f.service.close());
  const fields = ['id', 'personalRating']; const filter = { personal_rating: { min: 8 } };
  const scope = { username: '-', subject_type: 2, result_mode: 'candidates', source_limit: 100, fields, filter, limit: 3 };
  const empty = await invoke(f.service, 'query_user_collections', scope);
  assert.deepEqual(empty.data, []);
  assert.equal(empty.page.complete, true);
  assert.ok((await coverageSources(f.service, empty)).some(source => !source.complete));
  assert.deepEqual(f.calls.map(call => call.options.query.offset), [0]);

  const found = await invoke(f.service, 'query_user_collections', { ...scope, collection_ref: empty.collectionRef });
  assert.deepEqual(ids(found), [121, 122, 123]);
  assert.equal(found.stage.inputCount, 10);
  assert.equal(found.stage.remainingCount, 7);
  assert.ok((await coverageSources(f.service, found)).every(source => source.complete));
  const before = f.calls.length;
  const continued = await invoke(f.service, 'refine_subject_candidates', { candidate_ref: found.candidateRef,
    cursor: found.page.nextCursor, fields, filter, collection_ref: empty.collectionRef, limit: 3 });
  assert.deepEqual(ids(continued), [124, 125, 126]);
  assert.equal(continued.stage.processedCount, 6);
  assert.equal(f.calls.length, before, '读取匹配窗口不得重新扫描原始收藏');
  await assert.rejects(invoke(f.service, 'query_user_collections', { ...scope, collection_ref: found.collectionRef,
    cursor: found.page.nextCursor }), error => error.code === 'INVALID_INPUT');
  assert.equal(f.calls.length, before);
});
