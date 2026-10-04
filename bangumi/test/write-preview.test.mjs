import assert from 'node:assert/strict';
import test from 'node:test';
import { formatWritePreview } from '../dist/src/mcp/write-preview.js';

const account = { id: 123, username: 'Kas' };
const collection = { collection_type: 3, rating: 7, tags: ['动画'], private: false, ep_status: 5, vol_status: 0, comment: '' };
const subject = (id, name, change, before = collection, subjectType = 2) => ({
  name: 'update_subject_collection', target: { kind: 'subject', id, name, subjectType }, before,
  after: { ...(before ?? collection), ...change }, effects: [],
});
const indexSubject = (name, id, title, indexId, before, after) => ({
  name, target: { kind: 'indexSubject', subjectId: id, name: `作品${id}`, title, indexId }, before, after, effects: [],
});
const createIndex = (title, description = '', privateValue = false) => ({
  name: 'create_index', target: { kind: 'newIndex' }, before: null, after: { title, description, private: privateValue }, effects: [],
});

test('批量评分只展示实际变更，完整列出对象且不改变计划数据', () => {
  const items = [subject(101, '作品甲', { rating: 8 }), subject(102, '作品乙', { rating: 8 }, { ...collection, rating: 6 }, 4)];
  const original = structuredClone(items);
  const preview = formatWritePreview(account, items);
  assert.match(preview, /^需要将以下 2 部作品的评分改为 8 分。/u);
  assert.match(preview, /使用账户：Kas/u);
  assert.match(preview, /《作品甲》：评分：7 分 → 8 分/u);
  assert.match(preview, /《作品乙》：评分：6 分 → 8 分/u);
  assert.doesNotMatch(preview, /收藏状态|短评|标签|可见性|进度|卷数|修改前|修改后|对象 #/u);
  assert.equal(preview.match(/请确认是否授权本次操作。/gu).length, 1);
  assert.deepEqual(items, original);
});

test('清空、取消评分、降低进度和公开性变化明确展示，长短评保留最终正文', () => {
  const body = `第一段\n${'完整正文'.repeat(250)}\n最后一段`;
  const before = { ...collection, comment: '旧短评', vol_status: 2 };
  const preview = formatWritePreview(account, [subject(1, '书籍', {
    rating: 0, tags: [], private: true, ep_status: 0, vol_status: 0, comment: body,
  }, before, 1), subject(2, '清空短评的作品', { comment: '' }, before)]);
  assert.match(preview, /评分：7 分 → 未评分/u);
  assert.match(preview, /清空标签/u);
  assert.match(preview, /可见性：公开 → 私密/u);
  assert.match(preview, /已读章数：5 章 → 0 章/u);
  assert.match(preview, /已读卷数：2 卷 → 0 卷/u);
  assert.match(preview, /短评（替换原文）：/u);
  assert.ok(preview.includes(body.replaceAll('\n', '\n    ')));
  assert.match(preview, /清空短评/u);
  assert.doesNotMatch(preview, /旧短评/u);
});

test('新建目录与全部 22 部作品使用目录名称，显示最终简介与私密设置', () => {
  const items = [createIndex('待看动画', '完整目录简介\n第二行', true),
    ...Array.from({ length: 22 }, (_, i) => indexSubject('add_subject_to_index', i + 1, '待看动画', -1, null,
      { subject_id: i + 1, comment: '', order: 0 }))];
  const preview = formatWritePreview(account, items);
  assert.match(preview, /创建私密目录《待看动画》/u);
  assert.match(preview, /向新目录《待看动画》添加以下 22 部作品/u);
  for (let i = 1; i <= 22; i++) assert.ok(preview.includes(`• 《作品${i}》`));
  assert.match(preview, /完整目录简介\n    第二行/u);
  assert.doesNotMatch(preview, /#-1|第1步|subject_id/u);
  assert.equal(preview.match(/排序位置：0/gu).length, 22);
});

test('相邻目录添加合并摘要，逐作品保留不同排序与短评，不跨目录合并', () => {
  const items = [createIndex('四月动画'), ...Array.from({ length: 26 }, (_, i) =>
    indexSubject('add_subject_to_index', i + 1, '四月动画', -1, null, { subject_id: i + 1, order: i, comment: i % 2 ? `第${i}条短评` : '' })),
    indexSubject('add_subject_to_index', 99, '另一目录', 88, null, { subject_id: 99, order: 2, comment: '另一目录的短评' })];
  const original = structuredClone(items); const preview = formatWritePreview(account, items);
  assert.match(preview, /向新目录《四月动画》添加以下 26 部作品/u);
  assert.match(preview, /向目录《另一目录》添加以下 1 部作品/u);
  for (let i = 0; i < 26; i++) {
    assert.ok(preview.includes(`《作品${i + 1}》`));
    assert.ok(preview.includes(`排序位置：${i}`));
    if (i % 2) assert.ok(preview.includes(`第${i}条短评`));
  }
  assert.doesNotMatch(preview, /向新目录《四月动画》添加以下 1 部作品/u);
  assert.deepEqual(items, original);
});

test('同名作品用真实 ID 区分，同名新目录用本次目录编号区分', () => {
  const items = [createIndex('同名目录'), indexSubject('add_subject_to_index', 101, '同名目录', -1, null, { subject_id: 101, comment: '', order: 0 }),
    createIndex('同名目录'), indexSubject('add_subject_to_index', 102, '同名目录', -3, null, { subject_id: 102, comment: '', order: 0 })];
  items[1].target.name = '同名作品'; items[3].target.name = '同名作品';
  const preview = formatWritePreview(account, items);
  assert.match(preview, /《同名作品》（ID 101）/u);
  assert.match(preview, /《同名作品》（ID 102）/u);
  assert.match(preview, /《同名目录》（新目录1）/u);
  assert.match(preview, /《同名目录》（新目录2）/u);
  assert.doesNotMatch(preview, /undefined|#-3|第3步/u);
});

test('混合计划保留操作顺序，无需修改的对象单独列出并排除执行数量', () => {
  const relation = { subject_id: 4, comment: '目录短评', order: 2 };
  const preview = formatWritePreview(account, [subject(1, '先评分', { rating: 8 }),
    indexSubject('remove_subject_from_index', 4, '旧目录', 99, relation, null), subject(2, '后评分', { rating: 8 }),
    indexSubject('add_subject_to_index', 4, '其他目录', 100, relation, relation)]);
  const scope = preview.slice(preview.indexOf('操作范围：'));
  assert.ok(scope.indexOf('《先评分》') < scope.indexOf('从目录《旧目录》移除'));
  assert.ok(scope.indexOf('从目录《旧目录》移除') < scope.indexOf('《后评分》'));
  assert.doesNotMatch(preview, /以下 2 部作品的评分/u);
  assert.match(preview, /同时移除这些作品在目录中的短评和排序/u);
  assert.match(preview, /以下内容无需修改，将跳过：\n• 《作品4》（目录《其他目录》）/u);
});

test('目录标题、简介、短评与排序只列变化，包括清空与改为公开', () => {
  const preview = formatWritePreview(account, [{ name: 'update_index', target: { kind: 'index', id: 99, title: '旧目录' },
    before: { title: '旧目录', description: '旧介绍', private: true }, after: { title: '新目录', description: '', private: false }, effects: [] },
  indexSubject('update_index_subject', 1, '新目录', 99, { subject_id: 1, comment: '旧目录短评', order: 9 }, { subject_id: 1, comment: '', order: 0 }),
  indexSubject('add_subject_to_index', 2, '新目录', 99, null, { subject_id: 2, comment: '新目录短评\n完整正文', order: 4 })]);
  assert.match(preview, /标题：旧目录 → 新目录/u);
  assert.match(preview, /清空简介/u);
  assert.match(preview, /可见性：私密 → 公开/u);
  assert.match(preview, /清空短评/u);
  assert.match(preview, /排序位置：9 → 0/u);
  assert.match(preview, /新目录短评\n    完整正文/u);
  assert.match(preview, /排序位置：4/u);
  assert.doesNotMatch(preview, /旧介绍|旧目录短评|subject_id/u);
});

test('混合计划中的章节完整列出目标状态，不展开父收藏与保留章节快照', () => {
  const episodes = Array.from({ length: 30 }, (_, i) => ({ episode_id: i + 201, subject_id: 1, episode_type: 0, collection_type: i ? 0 : 2 }));
  const before = { episodes, protectedEpisodes: [{ episode_id: 999, collection_type: 1 }], parentCollection: collection };
  const preview = formatWritePreview(account, [subject(1, '动画', { comment: '发布短评' }), {
    name: 'update_single_episode_collection', target: { kind: 'episodes', subjectId: 1, name: '动画', episodeIds: episodes.map(e => e.episode_id), batch: true }, before,
    after: { ...before, episodes: episodes.map(e => ({ ...e, collection_type: 2 })) }, effects: [],
  }]);
  for (let i = 201; i <= 230; i++) assert.ok(preview.includes(`#${i}`));
  assert.match(preview, /标记为看过/u);
  assert.match(preview, /观看时间可能更新/u);
  assert.doesNotMatch(preview, /#999|parentCollection|protectedEpisodes|原生进度|章节类型|评分：/u);
});

test('书籍、游戏、音乐使用对应收藏状态，新收藏显示公开性并省略空初始字段', () => {
  const preview = formatWritePreview(account, [subject(1, '书', { collection_type: 2 }, collection, 1),
    subject(2, '游戏', { collection_type: 2 }, collection, 4), subject(3, '音乐', { collection_type: 2 }, collection, 3),
    subject(4, '新收藏', { collection_type: 1, rating: 0, tags: [], ep_status: 0, vol_status: 0 }, null)]);
  assert.match(preview, /在读 → 读过/u);
  assert.match(preview, /在玩 → 玩过/u);
  assert.match(preview, /在听 → 听过/u);
  assert.match(preview, /《新收藏》：\n  收藏状态：想看\n  可见性：公开/u);
  assert.doesNotMatch(preview, /（2）|评分：|标签：|已读章数：|已读卷数：/u);
});

test('角色、人物与目录收藏显示业务动作；名称清理控制字符，长正文完整保留', () => {
  const items = [['collect_character', 'character', '角色', false, true], ['uncollect_character', 'character', '角色', true, false],
    ['collect_person', 'person', '人物', false, true], ['uncollect_person', 'person', '人物', true, false],
    ['collect_index', 'index', '目录', false, true], ['uncollect_index', 'index', '目录', true, false]].map(([name, kind, title, from, to], i) => ({
      name, target: { kind, id: i + 1, name: `${title}\n名称\u001b`, title: `${title}\n名称\u001b` }, before: { collected: from }, after: { collected: to }, effects: [],
    }));
  const preview = formatWritePreview(account, items);
  for (const kind of ['角色', '人物', '目录']) assert.ok(preview.includes(kind));
  assert.match(preview, /取消收藏/u);
  assert.match(preview, /《角色 名称�》/u);
  assert.doesNotMatch(preview, /\u001b|collected|修改前|修改后/u);
});
