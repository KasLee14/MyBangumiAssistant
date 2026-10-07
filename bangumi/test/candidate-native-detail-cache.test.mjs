import test from 'node:test';
import assert from 'node:assert/strict';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { AppError } from '../dist/src/support/errors.js';
import { checkAccessResponse } from '../dist/src/mcp/access-context.js';

const read = async (service, name, args, turnId = 'native-detail-cache') => {
  const result = await service.call(name, args, undefined, undefined, undefined, { turnId });
  checkAccessResponse(name, result); return result;
};
const basicArgs = { subject_ids: [1], fields: ['id'], response_view: 'reference', filter: { rating: { min: 0 } } };
const facts = (service, ref, turnId = 'native-detail-cache') => {
  const binding = service.candidates.peekBinding(ref, turnId).binding;
  return service.candidates.get(ref, binding).rows[0];
};

function nativeFixture(options = {}) {
  const calls = [];
  let viewer = { id: 42, username: 'fixture_user' }, allowed = true, preference = true, revision = 1, status = 2;
  const context = () => ({ mode: 'account', account: { ...viewer }, source: 'p1', nsfwApplied: false,
    nsfw: { preference: null, allowed: null, state: 'not_checked' }, checkedAt: new Date().toISOString() });
  const raw = () => ({ id: 1, type: 2, name: '作品1', name_cn: '作品一', date: '2026-04-01', nsfw: false, platform: 'TV',
    eps: 12, volumes: 0, rating: { score: 8, total: 100, rank: 5 }, tags: [{ name: '标签', count: 10 }], meta_tags: ['TV'],
    summary: `未请求的简介 ${revision}`, infobox: [{ key: '每集时长', value: `${revision * 6}分钟` }], ...options.raw });
  const service = new BangumiMcpService({ close: async () => {}, currentUser: async () => ({ ...viewer }), identity: async () => context(),
    ensureNsfw: async () => ({ ...context(), nsfwApplied: allowed && preference,
      nsfw: { preference, allowed, state: allowed ? 'enabled' : 'disabled' } }),
    public: async (path, request = {}) => {
      calls.push({ source: 'v0', path, request });
      if (path === '/v0/search/subjects' && options.recallScore !== undefined)
        return { total: 1, data: [{ ...raw(), rating: { ...raw().rating, score: options.recallScore } }] };
      assert.equal(path, '/v0/subjects/1');
      if (options.accountOnly) throw new AppError('BGM_HTTP_404', '公开详情不可见');
      return options.publicRead ? options.publicRead(raw()) : raw();
    },
    account: async (path, request = {}) => {
      calls.push({ source: 'p1', path, request }); assert.equal(request.expectedAccountId, viewer.id);
      if (path === '/p1/collections/subjects/1' && request.method === 'PUT') { status = request.body.type; revision++; return {}; }
      assert.equal(path, '/p1/subjects/1');
      return { ...raw(), nameCN: '作品一', interest: { type: status, rate: 9, tags: ['个人标签'], comment: '个人短评', private: true,
        epStatus: 0, volStatus: 0, updatedAt: 1700000000 } };
    },
  });
  return { service, calls, setViewer: next => { viewer = next; }, setAllowed: next => { allowed = next; }, setPreference: next => { preference = next; }, bump: () => { revision++; } };
}

test('候选基础事实后补duration复用一次原生HTTP，未请求正文不投影或提前resolved', async t => {
  const f = nativeFixture(); t.after(() => f.service.close());
  const first = await read(f.service, 'refine_subject_candidates', basicArgs);
  assert.deepEqual(first.data, []); assert.equal(f.calls.length, 1); assert.equal(first.stage.pendingCount, 0);
  const row = facts(f.service, first.resultRef);
  for (const field of ['summary', 'infobox', 'durationMinutes']) {
    assert.equal(Object.hasOwn(row.facts, field), false); assert.equal(row.resolvedFields.includes(field), false);
  }
  assert.equal(JSON.stringify(first).includes('未请求的简介'), false);
  const duration = await read(f.service, 'refine_subject_candidates', { candidate_ref: first.resultRef, fields: ['id', 'durationMinutes'] });
  assert.deepEqual(duration.data, [{ id: 1, durationMinutes: 6 }]); assert.equal(f.calls.length, 1);
  assert.equal(JSON.stringify(duration).includes('未请求的简介'), false); assert.equal(duration.data[0].infobox, undefined);
  assert.equal(JSON.stringify(duration).includes('candidateCacheSupplementOnly'), false);
  const described = await read(f.service, 'refine_subject_candidates', { candidate_ref: duration.resultRef, fields: ['id', 'summary'] });
  assert.deepEqual(described.data, [{ id: 1, summary: '未请求的简介 1' }]); assert.equal(f.calls.length, 1);
  const direct = await read(f.service, 'get_subject_details', { subject_id: 1, include: [] });
  assert.deepEqual(direct.included, []); assert.equal(direct.summary, undefined); assert.equal(direct.infobox, undefined); assert.equal(f.calls.length, 2, 'direct原生工具仍独立读取');
});

test('旧raw8补infobox不覆盖其它召回更新的宿主score6，当前max7条件保持匹配', async t => {
  const f = nativeFixture({ recallScore: 6 }); t.after(() => f.service.close());
  const first = await read(f.service, 'refine_subject_candidates', basicArgs);
  assert.equal(facts(f.service, first.resultRef).facts.score, 8);
  const recalled = await read(f.service, 'search_subjects', { keyword: '作品', subject_type: 2, result_mode: 'candidates', fields: ['id', 'score'], limit: 1 });
  assert.deepEqual(recalled.data, [{ id: 1, score: 6 }]);
  const projected = await read(f.service, 'refine_subject_candidates', { candidate_ref: recalled.resultRef,
    filter: { rating: { max: 7 } }, fields: ['id', 'score', 'durationMinutes'] });
  assert.deepEqual(projected.data, [{ id: 1, score: 6, durationMinutes: 6 }]);
  assert.equal(projected.stage.matchedCount, 1); assert.equal(projected.stage.excludedCount, 0);
  assert.equal(f.calls.filter(call => call.path === '/v0/subjects/1').length, 1);
  assert.equal(facts(f.service, projected.resultRef).facts.score, 6); assert.equal(JSON.stringify(projected).includes('candidateCacheSupplementOnly'), false);
});

test('未要求的畸形infobox不破坏base，显式infobox失败仅标该证据并保留已知事实', async t => {
  const f = nativeFixture({ raw: { infobox: '畸形未请求信息栏' } }); t.after(() => f.service.close());
  const first = await read(f.service, 'refine_subject_candidates', basicArgs);
  assert.equal(first.stage.pendingCount, 0); assert.equal(facts(f.service, first.resultRef).facts.score, 8); assert.equal(f.calls.length, 1);
  const requested = await read(f.service, 'refine_subject_candidates', { candidate_ref: first.resultRef, fields: ['id', 'infobox'] });
  assert.deepEqual(requested.data, [{ id: 1, infobox: null, fieldStates: { infobox: 'failed' } }]); assert.equal(f.calls.length, 1);
  const row = facts(f.service, requested.resultRef);
  assert.equal(row.fieldStates.infobox, 'failed'); assert.equal(row.failureCodes.infobox, 'INVALID_RESPONSE');
  assert.equal(row.facts.score, 8); assert.equal(row.fieldStates.score, 'known'); assert.equal(row.resolvedFields.includes('durationMinutes'), false);
  const preserved = await read(f.service, 'refine_subject_candidates', { candidate_ref: requested.resultRef, fields: ['id', 'score'] });
  assert.deepEqual(preserved.data, [{ id: 1, score: 8 }]); assert.equal(f.calls.length, 1);
});

test('cached原生body仍按explicit字段解析，缺失时长如实unknown且硬条件保留pending', async t => {
  const f = nativeFixture({ raw: { infobox: [] } }); t.after(() => f.service.close());
  const first = await read(f.service, 'refine_subject_candidates', basicArgs);
  const projected = await read(f.service, 'refine_subject_candidates', { candidate_ref: first.resultRef, fields: ['id', 'durationMinutes'] });
  assert.deepEqual(projected.data, [{ id: 1, durationMinutes: null, fieldStates: { durationMinutes: 'unknown' } }]);
  assert.equal(projected.coverage.complete, false); assert.equal(projected.coverage.unknownFieldCount, 1); assert.equal(f.calls.length, 1);
  const pending = await read(f.service, 'refine_subject_candidates', { candidate_ref: projected.resultRef, filter: { duration: { max: 10 } }, fields: ['id'] });
  assert.deepEqual(pending.data, []); assert.deepEqual(pending.pending, [{ id: 1, missingFields: ['durationMinutes'], failedFields: [] }]);
  assert.equal(pending.stage.pendingCount, 1); assert.equal(pending.coverage.complete, false); assert.equal(f.calls.length, 1);
});

test('outer账户realm改变不复用原生body，旧个人引用在读缓存前拒绝', async t => {
  const f = nativeFixture(); t.after(() => f.service.close());
  const first = await read(f.service, 'refine_subject_candidates', { ...basicArgs, filter: { ...basicArgs.filter, nsfw: 'account' } });
  assert.equal(f.calls.length, 1);
  f.setViewer({ id: 99, username: 'another_user' }); f.bump();
  await assert.rejects(read(f.service, 'refine_subject_candidates', { candidate_ref: first.resultRef, filter: { nsfw: 'account' }, fields: ['id', 'durationMinutes'] }),
    error => ['CANDIDATE_SCOPE_MISMATCH', 'ACCOUNT_CHANGED'].includes(error.code));
  assert.equal(f.calls.length, 1);
  const next = await read(f.service, 'refine_subject_candidates', { subject_ids: [1], filter: { nsfw: 'account' }, fields: ['id', 'durationMinutes'] });
  assert.deepEqual(next.data, [{ id: 1, durationMinutes: 12 }]); assert.equal(f.calls.length, 2);
});

test('outer NSFW allowed和preference分别绑定原生body，SFW事实不携带旧realm未解析正文', async t => {
  const f = nativeFixture(); t.after(() => f.service.close());
  const first = await read(f.service, 'refine_subject_candidates', { ...basicArgs, filter: { ...basicArgs.filter, nsfw: 'account' } });
  f.setAllowed(false); f.bump();
  const disabled = await read(f.service, 'refine_subject_candidates', { candidate_ref: first.resultRef, filter: { nsfw: 'account' }, fields: ['id', 'durationMinutes'] });
  assert.deepEqual(disabled.data, [{ id: 1, durationMinutes: 12 }]); assert.equal(f.calls.length, 2);
  f.setAllowed(true); f.setPreference(false); f.bump();
  const hidden = await read(f.service, 'refine_subject_candidates', { candidate_ref: disabled.resultRef, filter: { nsfw: 'account' }, fields: ['id', 'summary'] });
  assert.deepEqual(hidden.data, [{ id: 1, summary: '未请求的简介 3' }]); assert.equal(f.calls.length, 3);
});

test('同账户同NS但不同来源scopeKey不复用未解析body', async t => {
  let details = 0;
  const service = new BangumiMcpService({ close: async () => {}, identity: async () => { throw Error('第三方来源不读本人账户'); },
    public: async path => {
      if (path === '/v0/subjects/1') { details++; return { id: 1, type: 2, name: '作品', name_cn: '作品', nsfw: false, platform: 'TV',
        summary: '已核简介', rating: { score: 8, total: 100 }, tags: [], meta_tags: [], infobox: [{ key: '每集时长', value: `${details * 6}分钟` }] }; }
      assert.ok(['/v0/users/alice/collections', '/v0/users/bob/collections'].includes(path));
      return { total: 1, data: [{ subject_id: 1, type: 2, rate: 8, tags: [], private: false,
        subject: { id: 1, type: 2, name: '作品', name_cn: '作品', nsfw: false, platform: 'TV', rating: { score: 8, total: 100 }, tags: [], meta_tags: [] } }] };
    },
  });
  t.after(() => service.close());
  const sourceArgs = { subject_type: 2, result_mode: 'candidates', fields: ['id'] };
  const alice = await read(service, 'query_user_collections', { ...sourceArgs, username: 'alice' });
  await read(service, 'refine_subject_candidates', { candidate_ref: alice.resultRef, fields: ['id', 'summary'] });
  const bob = await read(service, 'query_user_collections', { ...sourceArgs, username: 'bob' });
  const next = await read(service, 'refine_subject_candidates', { candidate_ref: bob.resultRef, fields: ['id', 'durationMinutes'] });
  assert.deepEqual(next.data, [{ id: 1, durationMinutes: 12 }]); assert.equal(details, 2);
});

test('新turn和endReadContext都使原生body失效，相同ID需重读真实来源', async t => {
  const f = nativeFixture(); t.after(() => f.service.close());
  await read(f.service, 'refine_subject_candidates', basicArgs, 'native-detail-one'); f.bump();
  const other = await read(f.service, 'refine_subject_candidates', { subject_ids: [1], fields: ['id', 'durationMinutes'] }, 'native-detail-two');
  assert.deepEqual(other.data, [{ id: 1, durationMinutes: 12 }]); assert.equal(f.calls.length, 2);
  f.service.endReadContext('native-detail-one'); f.bump();
  const reusedTurn = await read(f.service, 'refine_subject_candidates', { subject_ids: [1], fields: ['id', 'durationMinutes'] }, 'native-detail-one');
  assert.deepEqual(reusedTurn.data, [{ id: 1, durationMinutes: 18 }]); assert.equal(f.calls.length, 3);
  await f.service.close(); assert.equal(f.service.resources.rawEntries.size, 0); assert.equal(f.service.resources.bytes, 0);
});

test('endReadContext期间迟到详情promise不能重新填入原生body缓存', async t => {
  let release, announce;
  const started = new Promise(resolve => { announce = resolve; });
  const f = nativeFixture({ publicRead: raw => { announce(); return new Promise(resolve => { release = () => resolve(raw); }); } }); t.after(() => f.service.close());
  const pending = read(f.service, 'refine_subject_candidates', basicArgs);
  const rejected = assert.rejects(pending, error => error.code === 'CANDIDATE_REF_EXPIRED');
  await started; f.service.endReadContext('native-detail-cache'); release(); await rejected;
  assert.equal(f.service.resources.rawEntries.size, 0); assert.equal(f.service.resources.bytes, 0);
});

test('source/account marker匹配成功fallback才复用p1 body，关闭权限先拒绝受保护引用', async t => {
  const f = nativeFixture({ accountOnly: true, raw: { nsfw: true } }); t.after(() => f.service.close());
  const first = await read(f.service, 'refine_subject_candidates', { ...basicArgs, filter: { ...basicArgs.filter, nsfw: 'account' } });
  assert.equal(first.accessContext.nsfw.allowed, true); assert.equal(f.calls.filter(call => call.source === 'p1').length, 1);
  const duration = await read(f.service, 'refine_subject_candidates', { candidate_ref: first.resultRef, filter: { nsfw: 'account' }, fields: ['id', 'durationMinutes'] });
  assert.deepEqual(duration.data, [{ id: 1, durationMinutes: 6 }]); assert.equal(f.calls.length, 2, '一次v0失败加一次p1成功，后补不重复两种来源');
  f.setAllowed(false);
  await assert.rejects(read(f.service, 'refine_subject_candidates', { candidate_ref: duration.resultRef, filter: { nsfw: 'account' }, fields: ['id', 'summary'] }),
    error => ['NSFW_SCOPE_CHANGED', 'NSFW_UNAVAILABLE', 'NSFW_PERMISSION_UNKNOWN'].includes(error.code));
  assert.equal(f.calls.length, 2);
});

test('匿名候选单项v0 404保留pending并继续SFW项，不为公共阶段读取本地账户或整阶段fatal', async t => {
  let identities = 0;
  const paths = [];
  const service = new BangumiMcpService({ close: async () => {},
    identity: async () => { identities++; throw Error('匿名候选不能借本地账户fallback'); },
    currentUser: async () => { throw Error('匿名候选不能读取本人'); }, account: async () => { throw Error('匿名候选不能访问p1'); },
    public: async path => {
      paths.push(path);
      if (path === '/v0/subjects/1') throw new AppError('BGM_HTTP_404', '来源未取得该项');
      assert.equal(path, '/v0/subjects/2');
      return { id: 2, type: 2, name: '作品2', name_cn: '作品二', date: '2026-04-01', nsfw: false, platform: 'TV',
        rating: { score: 8, total: 100, rank: 5 }, tags: [], meta_tags: ['TV'], summary: '未请求简介', infobox: [] };
    },
  });
  t.after(() => service.close());
  const response = await read(service, 'refine_subject_candidates', { ...basicArgs, subject_ids: [1, 2], filter: { subject_type: 2 } });
  assert.equal(response.accessContext.mode, 'anonymous'); assert.equal(response.stage.processedCount, 2);
  assert.equal(response.stage.matchedCount, 1); assert.equal(response.stage.pendingCount, 1); assert.equal(response.coverage.complete, false);
  const binding = service.candidates.peekBinding(response.resultRef, 'native-detail-cache').binding;
  assert.deepEqual(service.candidates.get(response.resultRef, binding).rows.map(row => row.id), [2]);
  assert.deepEqual(service.candidates.get(response.candidateRef, binding).qualification.pendingIds, [1]);
  assert.equal(identities, 0); assert.deepEqual(paths, ['/v0/subjects/1', '/v0/subjects/2']);
});

test('成功响应的final source marker不匹配capture时保守不缓存', async t => {
  const f = nativeFixture(); t.after(() => f.service.close());
  const original = f.service.callScoped.bind(f.service);
  f.service.callScoped = async (...args) => {
    const result = await original(...args);
    if (args[0] !== 'get_subject_details') return result;
    return { ...result, accessContext: { mode: 'account', account: { id: 42, username: 'fixture_user' }, source: 'p1', nsfwApplied: true,
      nsfw: { preference: true, allowed: true, state: 'enabled' }, checkedAt: new Date().toISOString() } };
  };
  const first = await read(f.service, 'refine_subject_candidates', { ...basicArgs, filter: { ...basicArgs.filter, nsfw: 'account' } }); f.bump();
  const next = await read(f.service, 'refine_subject_candidates', { candidate_ref: first.resultRef, filter: { nsfw: 'account' }, fields: ['id', 'durationMinutes'] });
  assert.deepEqual(next.data, [{ id: 1, durationMinutes: 12 }]); assert.equal(f.calls.length, 2);
});

test('已授权真实service写入清除原生详情性能缓存，写后相同turn重新读事实', async t => {
  const f = nativeFixture(); t.after(() => f.service.close());
  await read(f.service, 'refine_subject_candidates', basicArgs);
  const submitted = await f.service.call('update_subject_collection', { subject_id: 1, collection_type: 3 }, undefined,
    { accountId: 42, subjectId: 1, expectedStatus: 2 }, undefined, { turnId: 'native-detail-cache' });
  checkAccessResponse('update_subject_collection', submitted);
  assert.equal(f.calls.filter(call => call.request.method === 'PUT').length, 1);
  const next = await read(f.service, 'refine_subject_candidates', { subject_ids: [1], fields: ['id', 'durationMinutes'] });
  assert.deepEqual(next.data, [{ id: 1, durationMinutes: 12 }]); assert.equal(f.calls.filter(call => call.source === 'v0').length, 2);
});
