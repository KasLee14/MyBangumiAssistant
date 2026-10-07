import test from 'node:test';
import assert from 'node:assert/strict';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { createReadTools } from '../dist/src/mcp/pi-tools.js';
import { checkAccessResponse } from '../dist/src/mcp/access-context.js';
import { ContentDecoder } from '../dist/src/output/content-decoder.js';

const subject = id => ({ id, type: 2, name: `原名${id}`, name_cn: `中文${id}`, platform: 'TV',
  nsfw: false, date: '2026-10-01', meta_tags: ['TV'], tags: [{ name: '已缓存标签', count: 20 }],
  rating: { score: 8, total: 100, rank: 50 }, eps: 12 });
function fixture(total = 12) {
  const reads = [];
  const service = new BangumiMcpService({ close: async () => {},
    identity: async () => { throw Error('公开SFW选集准备不得读取账户'); },
    currentUser: async () => { throw Error('公开SFW选集准备不得读取账户'); },
    account: async () => { throw Error('公开SFW选集准备不得读取私有来源'); },
    public: async (path, options = {}) => {
      reads.push(path); assert.equal(path, '/v0/search/subjects');
      const { offset, limit } = options.query;
      const all = Array.from({ length: total }, (_, index) => subject(index + 1));
      return { data: all.slice(offset, offset + limit), total: all.length };
    },
  });
  const call = async (name, args) => {
    const value = await service.call(name, args, undefined, undefined, undefined, { turnId: 'candidate-output-bridge' });
    checkAccessResponse(name, value); return value;
  };
  return { service, reads, call };
}
function decode(presentation) { const decoder = new ContentDecoder(); decoder.feed(JSON.stringify(presentation)); return decoder.finish(); }

test('真实McpService.call与Pi桥接可交付部分母源里的2项已核推荐，不误入资源转换器或追加网络', async t => {
  const f = fixture(); t.after(() => f.service.close());
  const recalled = await f.call('search_subjects', { keyword: '召回', subject_type: 2, result_mode: 'candidates',
    fields: ['id', 'name', 'nameCn'], limit: 4 });
  assert.equal(recalled.sourcePage.nextOffset, 4); assert.equal(recalled.coverage.complete, false);
  const selected = await f.call('refine_subject_candidates', { candidate_ref: recalled.resultRef,
    filter: { subject_ids: [1, 2], subject_type: 2, subject_form: ['tv'], rating: { min: 8 } }, fields: ['id'] });
  assert.equal(selected.stage.remainingCount, 0); assert.equal(selected.stage.pendingCount, 0);
  const before = f.reads.length;
  const args = { candidate_ref: selected.resultRef, format: 'subject_cards', card_fields: ['nameCn', 'score', 'scoreCount'],
    introduction: '推荐"两个"。\\路径\n下一行', reasons: [{ subject_id: 1, reason: '本次适配理由"含引号"\n下一行' }, { subject_id: 2, reason: '另一条理由' }] };
  const direct = await f.call('prepare_candidate_output', args);
  assert.equal(direct.kind, 'candidate_output'); assert.equal(direct.scope.completion_scope, 'selected');
  assert.equal(direct.counts.preparedCount, 2); assert.equal(direct.coverage.complete, false);
  assert.deepEqual(decode(direct.presentation).content[1].props.items.map(item => item.id), [1, 2]);
  const tool = createReadTools({ call: f.call }).find(tool => tool.name === 'prepare_candidate_output');
  const reply = await tool.execute('candidate-output-bridge', args, undefined, undefined, {}), parsed = JSON.parse(reply.content[0].text);
  assert.equal(parsed.error, undefined); assert.equal(parsed.value.kind, 'candidate_output');
  assert.equal(parsed.value.presentation,undefined);
  const snapshot=await f.service.readCachedResource(parsed.value.resourceRef,{turnId:'candidate-output-bridge'});
  assert.equal(parsed.value.bytes,Buffer.byteLength(JSON.stringify(snapshot.value.presentation),'utf8'));
  const canonical=decode(snapshot.value.presentation);
  assert.equal(canonical.content[0].text, args.introduction);
  assert.deepEqual(canonical.content[1].props.items.map(item => item.id), [1, 2]);
  assert.ok(canonical.content.at(-1).text.includes(args.reasons[0].reason));
  assert.ok(canonical.content.at(-1).text.includes('未完整来源1个'));
  assert.equal(f.reads.length, before, '两个最终出口都只读已缓存事实，不补来源或图片');
});

test('服务根出口table默认要求来源分页耗尽，Pi桥接交付全部当前成员并保留搜索总量的估计缺口', async t => {
  const f = fixture(); t.after(() => f.service.close());
  const partial = await f.call('search_subjects', { keyword: '召回', subject_type: 2, result_mode: 'candidates', fields: ['id'], limit: 4 });
  await assert.rejects(f.call('prepare_candidate_output', { candidate_ref: partial.resultRef }), error => error.code === 'CANDIDATE_STAGE_INCOMPLETE');
  assert.equal(createReadTools({ call: f.call }).some(tool => tool.name === 'prepare_candidate_table' || tool.name === 'review_subject_candidates'), false);
  const fullPage = await f.call('search_subjects', { keyword: '召回', subject_type: 2, result_mode: 'candidates', fields: ['id'], limit: 12 });
  const complete = await f.call('search_subjects', { keyword: '召回', subject_type: 2, result_mode: 'candidates', fields: ['id'],
    limit: 12, offset: fullPage.sourcePage.nextOffset, merge_ref: fullPage.candidateRef });
  assert.equal(complete.sourcePage.nextOffset, null); assert.equal(complete.coverage.complete, false);
  const before = f.reads.length, tool = createReadTools({ call: f.call }).find(tool => tool.name === 'prepare_candidate_output');
  const reply = await tool.execute('candidate-output-table-bridge', { candidate_ref: complete.resultRef,
    introduction: '当前集合12项', conclusion: '此次来源分页已耗尽。' }, undefined, undefined, {});
  const parsed = JSON.parse(reply.content[0].text); assert.equal(parsed.error, undefined);
  assert.equal(parsed.value.scope.completion_scope, 'exhaustive'); assert.equal(parsed.value.counts.preparedCount, 12);
  assert.equal(parsed.value.presentation,undefined);
  const snapshot=await f.service.readCachedResource(parsed.value.resourceRef,{turnId:'candidate-output-bridge'});
  const canonical = decode(snapshot.value.presentation); assert.equal(canonical.content[1].props.rows.length, 12);
  assert.deepEqual(canonical.content[1].props.rows.map(row => row.url), Array.from({ length: 12 }, (_, index) => `https://bgm.tv/subject/${index + 1}`));
  assert.ok(canonical.content.at(-1).text.includes('此次来源分页已耗尽。'));
  assert.ok(canonical.content.at(-1).text.includes('未完整来源1个')); assert.equal(f.reads.length, before);
});


test('可选输出分页沿同一全集引用交付全部成员，保留字段且不新增网络读取', async t => {
  const f = fixture(125); t.after(() => f.service.close());
  const sourceArgs = { keyword: '召回', subject_type: 2, result_mode: 'candidates', fields: ['id'], response_view: 'reference', limit: 100 };
  let candidates = await f.call('search_subjects', sourceArgs), windows = 1;
  while (candidates.sourcePage.nextOffset !== null) {
    candidates = await f.call('search_subjects', { ...sourceArgs, offset: candidates.sourcePage.nextOffset, merge_ref: candidates.candidateRef });
    assert.ok(++windows <= 3);
  }
  assert.equal(candidates.set.resultCount, 125);
  const before = f.reads.length, collected = [], reference = candidates.resultRef;
  let offset = 0;
  do {
    const result = await f.call('prepare_candidate_output', { candidate_ref: reference, format: 'table', completion_scope: 'selected',
      fields: ['displayName', 'url', 'score'], offset, limit: 50 });
    assert.equal(result.kind, 'candidate_output'); assert.equal(result.candidateRef, reference);
    assert.equal(result.counts.memberCount, 125); assert.equal(result.page.totalCount, 125);
    assert.equal(result.counts.preparedCount, result.page.returnedCount);
    assert.equal(result.counts.remainingCount, 125 - offset - result.page.returnedCount);
    const table = decode(result.presentation).content.find(part => part.type === 'DataTable');
    assert.deepEqual(table.props.columns.map(column => column.key), ['displayName', 'url', 'score']);
    assert.ok(table.props.rows.every(row => row.displayName && row.url && row.score === '8'));
    collected.push(...table.props.rows.map(row => Number(row.url.split('/').at(-1))));
    offset = result.page.nextOffset;
  } while (offset !== null);
  assert.deepEqual(collected, Array.from({ length: 125 }, (_, index) => index + 1));
  assert.equal(new Set(collected).size, 125); assert.equal(f.reads.length, before);
});
