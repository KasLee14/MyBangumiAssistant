import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResourceImages, selectResourceImage } from '../dist/src/mcp/resource-images.js';
import { subjectDetails, subjectSummary, completeSubjectResource, completeSubjectPageResource } from '../dist/src/mcp/subject-output.js';
import { completeResourceResult } from '../dist/src/mcp/resource-output.js';
import { CommunityReader } from '../dist/src/mcp/community-service.js';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { createReadTools } from '../dist/src/mcp/pi-tools.js';

const raw = () => ({ id: 123, type: 2, name: '核实作品', name_cn: '中文名称', nsfw: false,
  summary: '只存后端的完整剧情资料', infobox: [{ key: '导演', value: '作者' }], tags: [],
  images: { large: 'https://lain.bgm.tv/pic/cover/l/actual.jpg', medium: 'https://lain.bgm.tv/pic/cover/m/actual.jpg' } });

test('图片仅保留实际尺寸且显式尺寸不猜替代，缺失状态不伪造地址', () => {
  assert.deepEqual(normalizeResourceImages({}), {});
  assert.deepEqual(normalizeResourceImages({ images: null }), { images: null, image: null });
  const normalized = normalizeResourceImages(raw());
  assert.equal(normalized.image, raw().images.medium);
  assert.equal(selectResourceImage(normalized.images, 'grid'), null);
  assert.equal(selectResourceImage(normalized.images, 'large'), raw().images.large);
  assert.deepEqual(normalizeResourceImages({ images: { large: '', medium: '', small: '', grid: '' } }), { images: {}, image: null });
  for (const value of ['http://lain.bgm.tv/x', 'https://u:p@lain.bgm.tv/x', 'https://lain.bgm.tv/x y', 3])
    assert.throws(() => normalizeResourceImages({ images: { large: value } }), /图片/);
});

test('一项无图不会使整页失败或删除已取得成员', () => {
  const rows = [raw(), { ...raw(), id: 569767, images: { large: '', medium: '', small: '', grid: '' } }];
  const normalized = rows.map(subjectSummary);
  assert.deepEqual(normalized.map(row => row.id), [123, 569767]);
  assert.equal(normalized[1].image, null); assert.equal(normalized[0].image, raw().images.medium);
});

test('基本详情保留图片身份，完整缓存独立于include且坏详情组只标failed', () => {
  const base = subjectDetails(raw(), [], 123);
  assert.equal(base.summary, undefined); assert.equal(base.image, raw().images.medium);
  const complete = completeSubjectResource(raw(), 123);
  assert.equal(complete.value.summary, raw().summary); assert.equal(complete.fieldStates.summary, 'known');
  const broken = completeSubjectResource({ ...raw(), infobox: '未请求的坏信息栏' }, 123);
  assert.equal(broken.fieldStates.infobox, 'failed'); assert.equal(broken.value.summary, raw().summary);
  assert.equal(broken.value.infobox, undefined);
});

test('角色完整资源同时保留图片和未请求简介', () => {
  const result = completeResourceResult('get_character_details', { id: 456, name: '角色', type: 1,
    summary: '角色简介', images: raw().images, infobox: [], nsfw: false }, { character_id: 456, include: [] });
  assert.equal(result.value.summary, '角色简介'); assert.equal(result.value.image, raw().images.medium);
});

test('列表已取得简介可缓存补全，基础评分和日期证据不被原body覆盖', () => {
  const item = raw(), base = { ...subjectSummary(item), score: 6, date: '2026-10' };
  const full = completeSubjectPageResource({ data: [{ ...item, rating: { score: 8 } }] }, { kind: 'page', entity: 'subject', data: [base] });
  assert.equal(full.data[0].summary, item.summary); assert.equal(full.data[0].score, 6); assert.equal(full.data[0].date, '2026-10');
  assert.equal(base.summary, undefined);
});

test('社区默认无正文的读取也保留全文，缓存展开和正文续读均零额外网络', async () => {
  let requests = 0;
  const body = '正文🌟'.repeat(1500);
  const reader = new CommunityReader({ close: async () => {}, community: async () => {
    requests++; return { id: 321, public: true, uid: 1, user: { id: 1, username: 'reader', nickname: '读者' },
      title: '日志', createdAt: 1700000000, updatedAt: 1700000000, replies: 0, content: body };
  } });
  const basic = await reader.call('get_blog_details', { blog_id: 321, include: [] });
  assert.equal(basic.content, undefined);
  const full = reader.completeResource(basic);
  assert.equal(full.content.text, body); assert.equal(full.content.isFullText, true); assert.equal(requests, 1);
  const part = await reader.call('read_community_content', { content_ref: full.content.contentRef, offset: 4, limit: 6 });
  assert.equal(part.content.text, Array.from(body).slice(4, 10).join('')); assert.equal(requests, 1);
  reader.clear(); assert.equal(basic.content, undefined);
});

test('所有API字段入口中的社区fields通过服务、RPC及Pi完整scope校验，正文窗口与全文缓存分离', async t => {
  let requests = 0;
  const text = '社区正文'.repeat(2000), read = { turnId: 'community-full-fields' };
  const service = new BangumiMcpService({ close: async () => {}, community: async () => {
    requests++; return { id: 321, public: true, uid: 1, user: { id: 1, username: 'reader', nickname: '读者' },
      title: '已核实日志', createdAt: 1700000000, updatedAt: 1700000000, replies: 0, content: text };
  } });
  t.after(() => service.close());
  const client = { close: async () => {}, call: (name, args, signal) => service.call(name, args, signal, undefined, undefined, read),
    readCachedResource: (ref, signal) => service.readCachedResource(ref, read, signal) };
  const tool = createReadTools(client).find(item => item.name === 'get_blog_details');
  const prepared = tool.prepareArguments({ blog_id: 321, fields: ['title', 'content'] });
  assert.equal(prepared.include, undefined);
  const result = await tool.execute('community-api-fields', prepared, undefined, undefined, {});
  const model = JSON.parse(result.content[0].text);
  assert.equal(model.error, undefined, JSON.stringify(model.error)); assert.equal(model.value.title, '已核实日志');
  assert.equal(Array.from(model.value.content.text).length, 5000);
  assert.equal(model.value.content.isFullText, false);
  const full = await service.readCachedResource(model.value.resourceRef, read);
  assert.equal(full.value.content.text, text); assert.equal(requests, 1);
});
