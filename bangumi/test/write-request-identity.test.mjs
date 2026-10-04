import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { createWriteBoundary } from '../dist/src/mcp/write-boundary.js';
import { createBatchWriteTool } from '../dist/src/mcp/batch-write.js';
import { AppError } from '../dist/src/support/errors.js';

// 真实宿主及MCP服务均运行，账户、HTTP和持久存储全部使用离线内存夹具。
function fixture() {
  const account = { id: 42, username: 'request_identity_fixture' };
  const index = { id: 500, uid: 42, title: '原目录', desc: '保留介绍', private: false };
  const book = { id: 201, type: 1, name: '离线书籍', nameCN: '离线书籍', eps: 12, volumes: 10,
    interest: { type: 3, rate: 5, comment: '保留短评', tags: ['保留标签'], private: false, epStatus: 1, volStatus: 0 } };
  const writes = [], entries = [], ledger = [], hooks = { confirm: undefined, progress: undefined, started: undefined };
  let input = { text: '按明确范围更新目录', generation: 1, requestId: 'request-1' };
  const store = { entries: () => structuredClone(ledger), append: fact => ledger.push(structuredClone(fact)) };
  const append = (customType, data) => entries.push(structuredClone({ type: 'custom', customType, data, timestamp: new Date().toISOString() }));
  const context = { sessionManager: { getEntries: () => entries } };
  const transport = {
    preflight: async () => ({ mode: 'account', account, nsfw: { preference: true, allowed: true, state: 'enabled' }, source: 'p1', nsfwApplied: true, checkedAt: new Date().toISOString() }),
    currentUser: async () => account, close: async () => {}, public: async () => { throw Error('不得使用匿名网络'); },
    account: async (path, options = {}) => {
      if (options.expectedAccountId !== undefined) assert.equal(options.expectedAccountId, 42);
      if (options.method && options.method !== 'GET') {
        writes.push({ path, body: structuredClone(options.body), requestId: input.requestId });
        if (path === '/p1/indexes/500') {
          assert.equal(options.method, 'PATCH');
          Object.assign(index, { title: options.body.title ?? index.title, desc: options.body.desc ?? index.desc, private: options.body.private ?? index.private });
        } else if (path === '/p1/collections/subjects/201') {
          if (options.method === 'PUT') Object.assign(book.interest, { type: options.body.type, rate: options.body.rate, comment: options.body.comment, tags: options.body.tags, private: options.body.private });
          else if (options.method === 'PATCH') Object.assign(book.interest, options.body);
          else throw Error(`未登记的离线写方法 ${options.method}`);
        } else throw Error(`未登记的离线写路径 ${path}`);
        return {};
      }
      if (path === '/p1/indexes/500') return structuredClone(index);
      if (path === '/p1/subjects/201') return structuredClone(book);
      if (path === '/p1/collections/indexes') return { data: [], total: 0 };
      throw Error(`未登记的离线路径 ${path}`);
    },
  };
  let service, boundary, batch;
  function restart() {
    service = new BangumiMcpService(transport);
    boundary = createWriteBoundary({ call: (...args) => service.call(...args) }, () => input,
      data => { append('bangumi/write', data); if (data.phase === 'started') hooks.started?.(data); },
      { canConfirm: () => true, confirm: async () => { hooks.confirm?.(); return true; } }, undefined, { journal: store });
    batch = createBatchWriteTool(boundary, data => {
      store.append({ kind: 'bangumi-batch', ...data }); append('bangumi/batch', data);
      if (data.phase === 'progress') hooks.progress?.();
    });
  }
  restart();
  return { index, book, writes, entries, ledger, hooks, context, get boundary() { return boundary; }, get input() { return input; },
    nextInput: (requestId = `request-${input.generation + 1}`) => { input = { ...input, generation: input.generation + 1, requestId }; },
    restartFrom: snapshot => {
      entries.splice(0, entries.length, ...structuredClone(snapshot.entries));
      ledger.splice(0, ledger.length, ...structuredClone(snapshot.ledger)); restart();
    },
    run: async operations => (await batch.execute(`call-${input.generation}-${ledger.length}`, { operations }, undefined, undefined, context)).details.value };
}
const update = title => ({ tool: 'update_index', args: { index_id: 500, title } });

test('旧执行中到达的新请求不接收旧batch catch写入事实，新请求能够重新核实并提交', async () => {
  const f = fixture(); const original = f.input.requestId;
  f.hooks.progress = () => {
    f.hooks.progress = undefined;
    assert.equal(f.writes.length, 1); f.nextInput('request-new-arrival');
    throw new AppError('STALE_PREVIEW', '离线模拟新输入到达，旧执行停止并进入catch收尾');
  };
  const first = await f.run([update('第一请求目标')]);
  assert.equal(first.error.code, 'STALE_PREVIEW'); assert.equal(first.writeNetworkAttempted, true);
  assert.equal(f.writes.length, 1);
  const oldCompleted = f.ledger.filter(fact => fact.kind === 'bangumi-batch' && fact.phase === 'completed');
  assert.equal(oldCompleted.length, 1); assert.equal(oldCompleted[0].requestId, original);
  assert.equal(f.boundary.recordedRequest(f.context, f.input), undefined, '旧操作必须只污染原请求身份');
  const second = await f.run([update('新请求目标')]);
  assert.equal(second.state, 'success', JSON.stringify(second)); assert.equal(f.writes.length, 2);
  assert.equal(f.writes[1].requestId, 'request-new-arrival'); assert.equal(f.index.title, '新请求目标');
});

test('确认期间的新输入撤销旧计划而不提交，新的真实请求仍可独立确认完整范围', async () => {
  const f = fixture(); const plan = [update('中间标题'), update('最终标题')];
  let confirmations = 0;
  f.hooks.confirm = () => {
    confirmations++; f.hooks.confirm = () => { confirmations++; };
    f.nextInput('request-confirm-arrival');
  };
  const old = await f.run(plan);
  assert.equal(old.state, 'failed'); assert.equal(old.error.code, 'STALE_PREVIEW'); assert.equal(f.writes.length, 0);
  assert.equal(f.boundary.recordedRequest(f.context, f.input), undefined);
  const next = await f.run(plan);
  assert.equal(next.state, 'success', JSON.stringify(next)); assert.equal(f.writes.length, 2); assert.equal(confirmations, 2);
  assert.ok(f.writes.every(write => write.requestId === 'request-confirm-arrival'));
});

test('同真实requestId禁止追加与跨generation重放，新requestId允许合法重复目标', async () => {
  const f = fixture(); const original = f.input.requestId;
  assert.equal((await f.run([update('第一次目标')])).state, 'success');
  const append = await f.run([update('追加目标')]);
  assert.equal(append.error.code, 'BATCH_ALREADY_RECORDED'); assert.equal(f.writes.length, 1);
  f.nextInput(original);
  const replay = await f.run([update('追加目标')]);
  assert.equal(replay.error.code, 'BATCH_ALREADY_RECORDED'); assert.equal(f.writes.length, 1);
  f.nextInput('request-fresh');
  const fresh = await f.run([update('追加目标')]);
  assert.equal(fresh.state, 'success', JSON.stringify(fresh)); assert.equal(f.writes.length, 2);
  assert.equal(f.index.title, '追加目标');
});

test('硬中断保留第二网络阶段started时的完整未知目标，生效可只读结案，未生效仍不重发', async () => {
  const plan = [{ tool: 'update_subject_collection', args: { subject_id: 201, rating: 8, ep_status: 5, vol_status: 2 } }];
  for (const applied of [true, false]) {
    const f = fixture(); let snapshot;
    f.hooks.started = fact => {
      if (typeof fact.stageId === 'string' && fact.stageId.endsWith('/2')) snapshot = structuredClone({ ledger: f.ledger, entries: f.entries });
    };
    assert.equal((await f.run(plan)).state, 'success'); assert.equal(f.writes.length, 2); assert.ok(snapshot);
    const pending = snapshot.ledger.findLast(fact => fact.kind === 'bangumi-write');
    assert.equal(pending.phase, 'started'); assert.equal(pending.state, 'unknown');
    assert.deepEqual(pending.submission.items.map(item => item.submissionState), ['acknowledged', 'unknown']);
    assert.equal(new Map(pending.expected).get('collection:201').ep_status, 5, '投递未知阶段目标必须进入持久保护视图');
    // 仅保留RPC开始前已经落盘的事实，模拟进程在响应返回前硬中断。
    // applied=false表示第二请求已尝试，但独立读取目前只能看到第一阶段。
    if (!applied) { f.book.interest.epStatus = 1; f.book.interest.volStatus = 0; }
    f.hooks.started = undefined; f.restartFrom(snapshot); f.nextInput(`request-recovery-${applied}`);
    const next = await f.run(plan);
    assert.equal(f.writes.length, 2, '恢复过程及后续计划不能重放旧未知请求或重复已经达成的阶段');
    if (applied) {
      assert.equal(next.state, 'unchanged', JSON.stringify(next));
      assert.ok(f.ledger.some(fact => fact.kind === 'bangumi-write' && fact.phase === 'reconciled' && fact.operationId === pending.operationId
        && fact.state === 'success' && fact.resolution === 'observed_applied'));
    } else {
      assert.equal(next.error.code, 'PREVIOUS_WRITE_UNKNOWN', JSON.stringify(next));
      assert.equal(f.ledger.some(fact => fact.kind === 'bangumi-write' && fact.phase === 'reconciled' && fact.operationId === pending.operationId), false);
    }
  }
});
