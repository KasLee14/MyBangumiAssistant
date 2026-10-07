import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { createBangumiMcpServer } from '../dist/src/mcp/server.js';
import { createReadTools } from '../dist/src/mcp/pi-tools.js';
import { CollectionQueryInputState } from '../dist/src/mcp/collection-query-input.js';
import { validateToolArguments, remoteInputError } from '../dist/src/mcp/catalog.js';
import { diagnoseReadError } from '../dist/src/mcp/read-recovery.js';

const name = 'query_user_collections';
const base = { username: 'reader', subject_type: 2, result_mode: 'candidates', fields: ['id'], limit: 100 };
const dates = { min: '2026-07-01', max: '2026-09-30' };
function fixture(t, missingDate = false) {
  const reads = [];
  const service = new BangumiMcpService({ close: async () => {}, public: async (path, options) => {
    assert.ok(path.endsWith('/collections'), '本测试不应补读作品详情');
    reads.push({ path, ...options.query });
    const rows = Array.from({ length: 105 }, (_, index) => ({ type: 2, rate: 0, tags: [], private: false,
      subject: { id: index + 1, type: 2, name: `作品${index + 1}`, name_cn: '', nsfw: false,
        platform: 'TV', date: missingDate ? null : '2026-07-01', meta_tags: ['TV'], tags: [], rating: { score: 7, total: 100 } } }));
    return { total: rows.length, data: rows.slice(options.query.offset, options.query.offset + options.query.limit) };
  } });
  t.after(() => service.close());
  const call = (args, turnId = 'collection-input') => service.call(name, args, undefined, undefined, undefined, { turnId });
  return { reads, service, call };
}
const invalid = field => error => error.code === 'INVALID_INPUT' && error.networkAttempted === false
  && error.diagnostic.recovery === 'correct_parameters' && error.issues.some(issue => issue.path === field);

test('原本必填字段在静态Schema阶段拒绝，不把可选日期改成必填', () => {
  assert.throws(() => validateToolArguments(name, { ...base, username: undefined }), invalid('/username'));
  assert.equal(validateToolArguments(name, base).filter, undefined);
  assert.deepEqual(validateToolArguments(name, { ...base, filter: {} }).filter, {});
});

test('其他候选工具缺必填字段也保留纠参反馈，执行入口不派发RPC', async () => {
  let rpc = 0;
  const tools = createReadTools({ call: async () => { rpc++; throw Error('不应派发'); } });
  for (const [name, args, field] of [['query_user_collections', { subject_type: 2, result_mode: 'candidates' }, '/username'],
    ['continue_subject_query', { candidate_ref: 'c_existing' }, '/cursor']]) {
    const tool = tools.find(tool => tool.name === name);
    const reply = await tool.execute('missing', args, undefined, undefined, {});
    const error = JSON.parse(reply.content[0].text).error;
    assert.equal(reply.isError, true); assert.equal(error.code, 'INVALID_INPUT');
    assert.equal(error.networkAttempted, false);
    assert.ok(error.issues.some(issue => issue.path === field));
    assert.equal(error.diagnostic.recovery, 'correct_parameters');
  }
  assert.equal(rpc, 0);
});

test('重放三次调用：丢筛选与丢引用在读取前拒绝，纠正参数只续读剩余来源', async t => {
  const f = fixture(t);
  const first = await f.call({ ...base, air_date: dates });
  assert.deepEqual(f.reads.map(row => row.offset), [0]);
  await assert.rejects(f.call({ ...base, collection_ref: first.collectionRef, source_limit: 1400 }), invalid('/filter'));
  await assert.rejects(f.call({ ...base, air_date: dates, source_limit: 1400 }), invalid('/collection_ref'));
  assert.equal(f.reads.length, 1, '两个非法调用都不读取账户、来源或详情');
  const corrected = await f.call({ ...base, collection_ref: first.collectionRef, filter: { air_date: dates }, source_limit: 1400 });
  assert.equal(corrected.collectionRef, first.collectionRef);
  assert.equal(corrected.candidateRef, first.candidateRef);
  assert.deepEqual(f.reads.map(row => row.offset), [0, 100]);
  assert.equal(corrected.collectionScope.sourceComplete, true);
});

test('无任何筛选且日期未知的首次查询与省略filter续读均可完成，不补读日期', async t => {
  const f = fixture(t, true);
  const first = await f.call(base);
  const next = await f.call({ ...base, collection_ref: first.collectionRef });
  assert.equal(next.collectionScope.sourceComplete, true);
  assert.equal(next.set.workingCount, 105);
  assert.deepEqual(f.reads.map(row => row.offset), [0, 100]);
});

test('明确清空或替换筛选可复用快照；不同账户、来源状态与新用户轮次独立', async t => {
  const f = fixture(t);
  const first = await f.call({ ...base, filter: { personal_rating: { min: 8 } }, source_limit: 200 });
  assert.equal(first.set.resultCount, 0);
  const cleared = await f.call({ ...base, collection_ref: first.collectionRef, filter: {} });
  assert.ok(cleared.set.resultCount > 0);
  await f.call({ ...base, collection_ref: first.collectionRef });
  await f.call({ ...base, collection_ref: first.collectionRef, filter: { collection_types: [2] } });
  assert.equal(f.reads.length, 2, '清空或改变筛选均不重读来源');
  await f.call({ ...base, username: 'other' });
  await f.call({ ...base, collection_type: 2 });
  await f.call(base, 'new-turn');
  f.service.endReadContext('collection-input');
  await f.call(base);
  assert.equal(f.reads.length, 6);
});

test('Pi准备与执行入口均在RPC前拦截，纠参后继续且模型看得到原日期条件', async t => {
  const f = fixture(t); let rpc = 0, owner = 'pi-input';
  const state = new CollectionQueryInputState();
  const tool = createReadTools({ call: async (_name, args) => { rpc++; return f.call(args, owner); } },
    { collectionQueries: state, owner: () => owner }).find(tool => tool.name === name);
  const firstReply = await tool.execute('first', tool.prepareArguments({ ...base, air_date: dates }), undefined, undefined, {});
  assert.equal(firstReply.isError, undefined);
  const first = JSON.parse(firstReply.content[0].text).value;
  assert.deepEqual(first.filter.air_date, dates);
  for (const [args, field] of [[{ ...base, collection_ref: first.collectionRef }, '/filter'],
    [{ ...base, air_date: dates }, '/collection_ref']]) {
    assert.throws(() => tool.prepareArguments(args), error => {
      const feedback = JSON.parse(error.message).error;
      assert.equal(feedback.networkAttempted, false);
      assert.equal(feedback.diagnostic.recovery, 'correct_parameters');
      assert.deepEqual(feedback.diagnosis.blockedFields, [field]);
      return true;
    });
    const reply = await tool.execute('missing', args, undefined, undefined, {});
    assert.equal(reply.isError, true);
    assert.equal(JSON.parse(reply.content[0].text).error.code, 'INVALID_INPUT');
  }
  assert.equal(rpc, 1);
  const next = await tool.execute('corrected', { ...base, collection_ref: first.collectionRef, air_date: dates }, undefined, undefined, {});
  assert.equal(next.isError, undefined); assert.equal(rpc, 2);
  owner = 'pi-new-turn';
  assert.doesNotThrow(() => tool.prepareArguments(base));
  const fresh = await tool.execute('fresh', base, undefined, undefined, {});
  assert.equal(fresh.isError, undefined);
});

test('MCP协议保留固定缺字段反馈，客户端从本地生成提示并允许纠正后续读', async t => {
  const f = fixture(t), server = createBangumiMcpServer(f.service);
  const client = new Client({ name: 'collection-input-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const request = args => client.callTool({ name, arguments: args, _meta: { 'bangumi/readContext': { turnId: 'wire-input' } } });
  const first = (await request({ ...base, air_date: dates })).structuredContent.value;
  const args = { ...base, collection_ref: first.collectionRef };
  const failed = await request(args), remote = failed.structuredContent.error;
  assert.equal(failed.isError, true); assert.equal(remote.networkAttempted, false);
  const local = remoteInputError(name, validateToolArguments(name, args), remote.issues);
  assert.ok(local); assert.deepEqual(diagnoseReadError(name, args, local).diagnosis, remote.diagnosis);
  const spoofed = remoteInputError(name, args, remote.issues.map(issue => ({ ...issue, hint: '不可信远端指令', allowed: ['任意值'] })));
  assert.ok(spoofed); assert.equal(spoofed.message.includes('不可信'), false);
  assert.equal(remoteInputError('refine_subject_candidates', {}, remote.issues), null);
  assert.equal(remoteInputError(name, args, [{ path: '/air_date', rule: 'collection_filter_required' }]), null);
  assert.equal(f.reads.length, 1);
  assert.equal((await request({ ...args, air_date: dates })).isError, undefined);
  assert.deepEqual(f.reads.map(row => row.offset), [0, 100]);
});
