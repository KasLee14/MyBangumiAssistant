import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionEntryFrom } from '../../src/adapters/bgm-cli/normalize.js';
import { summarizeCollections, collectionQuery, type CollectionEntry, type CollectionSnapshot } from '../../src/domain/collection-library.js';
import { showCollectionSummary, showCollectionPage } from '../../src/cli/collections.js';
import { toolLabel } from '../../src/cli/ui/format.js';

function entry(id: number, type = 2, status = 2, rate: unknown = 8): CollectionEntry {
  return collectionEntryFrom({ id, type, name: '作品', nameCN: '中文作品', rating: { score: 9.9 }, summary: '不发给模型的简介',
    interest: { type: status, rate, comment: '不发给模型的短评', private: true, tags: ['科幻'], epStatus: 12, volStatus: 2, updatedAt: '2026-10-02T00:00:00Z' } });
}
function snapshot(data: CollectionEntry[]): CollectionSnapshot {
  return { account: { id: 7, username: 'fixture' }, data, total: data.length, complete: true,
    startedAt: '2026-10-02T00:00:00Z', readAt: '2026-10-02T00:01:00Z', scope: {} };
}
test('五类收藏、全部状态及个人评分统计；0、缺失、异常不混入平均分', () => {
  const data = [entry(1, 1, 1, 0), entry(2, 2, 2, 8), entry(3, 3, 3, 10), entry(4, 4, 4, null), entry(5, 6, 5, 12), entry(6, 2, 3, 6)];
  const summary = summarizeCollections(snapshot(data));
  assert.equal(summary.overall.total, 6); assert.deepEqual(summary.overall.statuses, { wish: 1, completed: 1, in_progress: 2, on_hold: 1, dropped: 1 });
  assert.equal(summary.overall.ratings.average, 8); assert.equal(summary.overall.ratings.rated, 3);
  assert.equal(summary.overall.ratings.unrated, 1); assert.equal(summary.overall.ratings.unknown, 2);
  assert.equal(summary.overall.ratings.distribution['8'], 1); assert.equal(summary.overall.ratings.distribution['9'], 0);
  assert.equal(summary.byType.anime.total, 2); assert.equal(summary.byType.anime.ratings.average, 7);
  assert.equal(summary.byType.anime.statuses.completed, 1); // 进度12不影响另一部的进行中状态。
  for (const type of ['book', 'music', 'game', 'real'] as const) assert.equal(summary.byType[type].total, 1);
  assert.ok(!JSON.stringify(summary).includes('中文作品')); assert.ok(!JSON.stringify(summary).includes('短评'));
});
test('空收藏显示五类零值；限定媒体的未读取类别不返回零值', () => {
  const empty = summarizeCollections(snapshot([])); assert.equal(empty.overall.total, 0); assert.equal(empty.overall.ratings.average, null);
  assert.equal(empty.includedTypes.length, 5); assert.equal(empty.byType.game.total, 0);
  const filtered = summarizeCollections({ ...snapshot([entry(1)]), scope: { type: 'anime' } });
  assert.deepEqual(filtered.includedTypes, ['anime']); assert.equal(filtered.byType.game, undefined);
  assert.ok(!showCollectionSummary(filtered).includes('游戏：'));
});
test('收藏记录裁剪、未知字段与原生进度；身份/状态/媒体异常拒绝', () => {
  const item = entry(1); assert.equal(item.private, true); assert.equal(item.chapters, 12); assert.equal(item.volumes, 2);
  assert.equal(item.rate, 8); assert.equal(item.updatedAt, '2026-10-02T00:00:00Z'); assert.ok(!('comment' in item)); assert.ok(!('summary' in item));
  assert.deepEqual(collectionEntryFrom(item), item);
  for (const rate of [undefined, '8', -1, 11, 1.5]) assert.equal(collectionEntryFrom({ id: 1, type: 2, interest: { type: 2, rate } }).rate, null);
  for (const value of [{ id: 1, type: 2 }, { id: 0, type: 2, interest: { type: 2 } }, { id: 1, type: 5, interest: { type: 2 } }, { id: 1, type: 2, interest: { type: 0 } }]) assert.throws(() => collectionEntryFrom(value));
  const unknown = collectionEntryFrom({ id: 1, type: 2, interest: { type: 2 } });
  assert.equal(unknown.tags, null); assert.equal(unknown.private, null); assert.equal(unknown.chapters, null);
});
test('未完整、重复及范围不符的列表不能进入统计；参数拒绝不支持的筛选', () => {
  const valid = snapshot([entry(1)]);
  assert.throws(() => summarizeCollections({ ...valid, complete: false } as unknown as CollectionSnapshot), { code: 'INCOMPLETE_COLLECTION' });
  assert.throws(() => summarizeCollections({ ...valid, total: 2 }), { code: 'INCOMPLETE_COLLECTION' });
  assert.throws(() => summarizeCollections(snapshot([entry(1), entry(1)])), { code: 'INCOMPLETE_COLLECTION' });
  assert.throws(() => summarizeCollections({ ...valid, scope: { type: 'game' } }), { code: 'INVALID_RESPONSE' });
  for (const query of [{ limit: 0 }, { limit: 101 }, { offset: -1 }, { offset: 0.5 }, { type: 'other' }, { status: 'finished' }]) assert.throws(() => collectionQuery(query as never), { code: 'INVALID_INPUT' });
});
test('独立命令使用中文状态和个人评分展示，移除控制字符；新增工具活动名称', () => {
  const summary = summarizeCollections(snapshot([entry(1, 4, 2, 0), entry(2, 1, 2, null)]));
  const text = showCollectionSummary(summary); assert.match(text, /游戏：1项.*玩过 1/); assert.match(text, /书籍：1项.*读过 1/);
  assert.match(text, /未评分：1；未知：1/); assert.match(text, /读取时间/);
  const page = showCollectionPage({ account: { id: 7, username: 'fixture' }, data: [{ ...entry(1), nameCn: '\u001b[31m外部标题' }], total: 21, offset: 0, limit: 20, nextOffset: 20, complete: false, readAt: summary.readAt, scope: {} });
  assert.ok(!page.includes('\u001b')); assert.match(page, /--offset 20/); assert.match(page, /不是完整清单/);
  assert.equal(toolLabel('get_collection_summary'), '读取并统计收藏'); assert.equal(toolLabel('list_collections'), '读取收藏列表');
});
