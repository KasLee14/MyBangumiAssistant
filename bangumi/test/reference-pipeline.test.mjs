import test from 'node:test';
import assert from 'node:assert/strict';
import { expandResourceContent, normalizeResourceReference, resourceReferenceSchema } from '../dist/src/output/resource-content.js';
import { projectTranscriptForModel } from '../dist/src/output/model-context.js';
import { validateMixedContent } from '../dist/src/output/content-schema.js';

const ref = `rr_${'b'.repeat(32)}`;
const rows = [1, 2].map(id => ({ id, entity: 'subject', subjectType: 2, name: `作品${id}`, nameCn: `中文作品${id}`,
  image: `https://example.invalid/${id}.jpg`, summary: `缓存简介${id}`, url: `https://bgm.tv/subject/${id}`, score: 8 + id / 10 }));
const resource = { resourceRef: ref, sourceTool: 'search_subjects', value: { entity: 'subject', data: rows } };
const resolver = async requested => { assert.equal(requested, ref); return structuredClone(resource); };

test('只有进度的引用不能把非空候选结果展示为空卡片，真实空集合仍合法', async () => {
  const progress = { resourceRef: ref, sourceTool: 'search_subjects', value: { entity: 'subject_candidate',
    responseView: 'reference', data: [], set: { workingCount: 2, resultCount: 2 } } };
  await assert.rejects(expandResourceContent('SubjectCards', { resourceRef: ref }, async () => progress), /不能将非空结果展示为空集合/);
  const empty = { ...progress, value: { ...progress.value, set: { workingCount: 0, resultCount: 0 } } };
  const result = await expandResourceContent('SubjectCards', { resourceRef: ref }, async () => empty);
  assert.deepEqual(result.props.items, []); assert.equal(result.pending, false);
});

test('引用展开按模型顺序补齐图文并满足前端完整契约，源缓存保持不变', async () => {
  const input = { resourceRef: ref, layout: 'grid', items: [{ id: 2 }, { id: 1 }] };
  const result = await expandResourceContent('SubjectCards', input, resolver);
  assert.equal(result.pending, false);
  assert.deepEqual(result.props.items.map(row => row.id), [2, 1]);
  assert.equal(result.props.items[0].name, '作品2'); assert.equal(result.props.items[0].image, rows[1].image);
  assert.equal(result.props.items[0].summary, rows[1].summary); assert.equal(result.props.items[0].url, rows[1].url);
  assert.equal(result.props.resourceRef, undefined);
  assert.doesNotThrow(() => validateMixedContent({ content: [result] }));
  result.props.items[0].name = '外部修改'; assert.equal(resource.value.data[1].name, '作品2');
});

test('错误成员、重复主键、错误实体与引用错配都拒绝，模型不能覆盖缓存事实', async () => {
  for (const items of [[{ id: 999 }], [{ id: 1 }, { id: 1 }], [{ id: 1, entity: 'person' }]]) {
    await assert.rejects(expandResourceContent('SubjectCards', { resourceRef: ref, items }, resolver));
  }
  assert.throws(() => normalizeResourceReference({ resourceRef: ref, items: [{ id: 1, image: '模型伪造' }] }));
  assert.throws(() => normalizeResourceReference({ resourceRef: ref, summary: '模型伪造' }));
  await assert.rejects(expandResourceContent('SubjectCards', { resourceRef: ref }, async () => ({ ...resource, resourceRef: `rr_${'c'.repeat(32)}` })));
  await assert.rejects(expandResourceContent('SubjectCards', { resourceRef: ref }, async () => ({ ...resource, value: { entity: 'person', id: 1, name: '人物' } })));
  await assert.rejects(expandResourceContent('SubjectCards', { resourceRef: ref }, undefined));
});

test('准备的展示快照不可重新选成员或覆盖版式，取消后不能完成组件', async () => {
  const part = await expandResourceContent('SubjectCards', { resourceRef: ref, items: [{ id: 1 }] }, resolver);
  const prepared = async () => ({ ...resource, value: { presentation: { content: [part] } } });
  assert.deepEqual(await expandResourceContent('SubjectCards', { resourceRef: ref }, prepared), part);
  await assert.rejects(expandResourceContent('SubjectCards', { resourceRef: ref, items: [{ id: 2 }] }, prepared));
  const abort = new AbortController(); let resolved = 0;
  await assert.rejects(expandResourceContent('SubjectCards', { resourceRef: ref }, async () => { resolved++; abort.abort(); return resource; }, abort.signal));
  assert.equal(resolved, 1);
});

test('历史快照供重放而后续模型请求仅带身份顺序与创作理由，临时引用不复用', async () => {
  const part = await expandResourceContent('SubjectCards', { resourceRef: ref, items: [{ id: 2 }, { id: 1 }] }, resolver);
  const context = { messages: [{ role: 'assistant', content: [part, { type: 'text', text: '模型选择理由', nextType: null }], timestamp: 1 }] };
  const projected = projectTranscriptForModel(context), wire = JSON.stringify(projected);
  assert.ok(wire.includes('模型选择理由')); assert.ok(wire.includes('作品2'));
  assert.equal(wire.includes('缓存简介'), false); assert.equal(wire.includes('example.invalid'), false);
  assert.equal(wire.includes('https://bgm.tv/subject'), false); assert.equal(wire.includes(ref), false);
  assert.ok(wire.indexOf('作品2') < wire.indexOf('作品1'));
  assert.equal(context.messages[0].content[0].props.items[0].summary, rows[1].summary);
});

test('人物与角色同ID仍按各自主键别名展开画廊，生成参数和宿主允许参数一致', async () => {
  for (const [entity, primaryKey] of [['person', 'personId'], ['character', 'characterId']]) {
    const cached = { resourceRef: ref, sourceTool: `get_${entity}_details`, value: { entity, id: 1,
      name: entity, image: `https://example.invalid/${entity}.jpg`, url: `https://bgm.tv/${entity}/1` } };
    const part = await expandResourceContent('Gallery', { resourceRef: ref, items: [{ [primaryKey]: 1 }] }, async () => cached);
    assert.equal(part.props.items[0].name, entity); assert.equal(part.props.items[0].image, cached.value.image);
    const wrongKey = primaryKey === 'personId' ? 'characterId' : 'personId';
    await assert.rejects(expandResourceContent('Gallery', { resourceRef: ref, items: [{ [wrongKey]: 1 }] }, async () => cached));
  }
  assert.equal(resourceReferenceSchema('Gallery').properties.layout, undefined);
  assert.throws(() => normalizeResourceReference({ resourceRef: ref, layout: 'grid' }, false, 'Gallery'));
  assert.doesNotThrow(() => normalizeResourceReference({ resourceRef: ref, layout: 'grid' }, false, 'SubjectCards'));
});
