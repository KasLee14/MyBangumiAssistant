import test from 'node:test';
import assert from 'node:assert/strict';
import { expandResourceContent } from '../dist/src/output/resource-content.js';
import { BangumiMcpService } from '../dist/src/mcp/service.js';

const ref = `rr_${'a'.repeat(32)}`;
const snapshot = { type: 'SubjectCards', pending: false, props: { title: '百合推荐', layout: 'grid',
  items: [{ id: 1, name: '作品1', kind: 'anime', image: 'https://example.invalid/1.jpg' }, { id: 2, name: '作品2', kind: 'anime', image: 'https://example.invalid/2.jpg' }] } };
const cached = value => ({ resourceRef: ref, sourceTool: 'prepare_candidate_output', value: { presentation: { content: value } } });

test('已准备快照只传resourceRef可展开，同值title/layout视为冗余且缓存原值不被修改', async () => {
  const original = cached([structuredClone(snapshot)]), before = structuredClone(original);
  for (const extra of [{}, { title: snapshot.props.title }, { layout: 'grid' }, { title: snapshot.props.title, layout: 'grid' }]) {
    const result = await expandResourceContent('SubjectCards', { resourceRef: ref, ...extra }, async () => original);
    assert.deepEqual(result, snapshot);
    result.props.items[0].name = '外部修改';
    assert.deepEqual(original, before);
  }
});

test('不同title/layout、成员筛选及不存在于快照的控制参数继续拒绝', async () => {
  for (const extra of [{ title: '新的标题' }, { layout: 'list' }, { items: [{ id: 1 }] }, { items: [{ id: 2 }, { id: 1 }] }, { items: [] }]) {
    await assert.rejects(expandResourceContent('SubjectCards', { resourceRef: ref, ...extra }, async () => cached([snapshot])), { reason: 'resource_reference_invalid' });
  }
  const untitled = structuredClone(snapshot); delete untitled.props.title;
  await assert.rejects(expandResourceContent('SubjectCards', { resourceRef: ref, title: '新加标题' }, async () => cached([untitled])), { reason: 'resource_reference_invalid' });
});

test('多块准备快照需要partIndex，冗余参数须与指定块一致', async () => {
  const second = { ...snapshot, props: { ...snapshot.props, title: '第二页', layout: 'list', items: snapshot.props.items.slice(1) } };
  const resolver = async () => cached([snapshot, second]);
  await assert.rejects(expandResourceContent('SubjectCards', { resourceRef: ref }, resolver), { reason: 'resource_reference_invalid' });
  assert.deepEqual(await expandResourceContent('SubjectCards', { resourceRef: ref, partIndex: 1, title: '第二页', layout: 'list' }, resolver), second);
  await assert.rejects(expandResourceContent('SubjectCards', { resourceRef: ref, partIndex: 1, title: snapshot.props.title }, resolver), { reason: 'resource_reference_invalid' });
});

test('服务准备快照记录固定事实版本，原引用在新鲜详情刷新后拒绝', async t => {
  let score = 8.5;
  const subject = id => ({ id, type: 2, name: `作品${id}`, name_cn: '', nsfw: false, platform: 'TV', date: '2026-10-01',
    rating: { score, total: 100 }, tags: [{ name: '百合', count: 20 }], meta_tags: ['TV'], summary: `评分版本${score}`, infobox: [],
    images: { large: `https://example.invalid/${id}.jpg` } });
  const service = new BangumiMcpService({ close: async () => {}, public: async path => path === '/v0/search/subjects'
    ? { data: [subject(1), subject(2)], total: 2 } : subject(Number(path.split('/').at(-1))) });
  t.after(() => service.close());
  const context = { turnId: 'prepared-version' };
  const call = (name, args) => service.call(name, args, undefined, undefined, undefined, context);
  const recalled = await call('search_subjects', { keyword: '百合', subject_type: 2, result_mode: 'candidates', fields: ['id'], limit: 2 });
  const prepared = await call('prepare_candidate_output', { candidate_ref: recalled.resultRef, format: 'subject_cards', card_fields: ['image', 'score'] });
  const old = await service.readCachedResource(prepared.resourceRef, context);
  assert.ok(old.value.resourceCandidateVersions.length === 2);
  assert.equal(prepared.resourceCandidateVersions, undefined, '固定版本元数据只在宿主缓存中');
  score = 9;
  await call('get_subject_details', { subject_id: 1, include: [] });
  await assert.rejects(service.readCachedResource(prepared.resourceRef, context), { code: 'RESOURCE_VERSION_CHANGED' });
});
