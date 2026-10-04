import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMUNITY_TOOL_DEFINITIONS, communityOutputSchema } from '../dist/src/mcp/community-schemas.js';
import { checkCommunityResponse } from '../dist/src/mcp/community-output.js';
import { compileSchema, schemaArguments } from '../dist/src/support/tool-schema.js';

const time = '2026-10-04T00:00:00.000Z';
const contentRef = `ct_${'a'.repeat(32)}`;
const snapshotRef = `pg_${'b'.repeat(32)}`;
const author = { id: 9, username: 'public_author', nickname: null };
const definition = name => COMMUNITY_TOOL_DEFINITIONS.find(tool => tool.name === name);
const argsFor = (name, args) => schemaArguments(definition(name).inputSchema, args);
const changed = (value, edit) => { const copy = structuredClone(value); edit(copy); return copy; };
const reject = (name, value, args, code = 'MCP_INVALID_RESULT') => assert.throws(
  () => checkCommunityResponse(name, value, args), error => error?.code === code,
);
function content(text = '甲😀乙', offset = 0, totalChars = Array.from(text).length, ref = contentRef) {
  const returnedChars = Array.from(text).length;
  return { state: 'available', format: 'plain_text', contentRef: ref, text,
    range: { offset, returnedChars, totalChars, nextOffset: offset + returnedChars < totalChars ? offset + returnedChars : null },
    isFullText: offset === 0 && returnedChars === totalChars };
}
function comment(id, extra = {}) {
  return { id, blogId: 301, parentId: null, rootId: id, author, createdAt: time, url: 'https://bgm.tv/blog/301', ...extra };
}
function page(data = [comment(1)], extraArgs = {}, total = data.length) {
  const args = argsFor('get_blog_comments', { blog_id: 301, ...extraArgs });
  const next = args.offset + data.length;
  const value = { schemaVersion: 1, kind: 'page', entity: 'blogComment', scope: args, included: args.include, data,
    page: { paginationSource: 'host', total, limit: args.limit, offset: args.offset, returnedCount: data.length,
      nextOffset: next < total ? next : null, complete: args.offset === 0 && data.length === total, snapshotRef },
    visibility: 'public', readAt: time };
  return { args, value };
}
function chunk(text = '甲😀乙', extraArgs = {}, totalChars = Array.from(text).length) {
  const args = argsFor('read_community_content', { content_ref: contentRef, ...extraArgs });
  return { args, value: { schemaVersion: 1, kind: 'content_chunk', scope: args, source: { kind: 'blog', blogId: 301 },
    content: content(text, args.offset, totalChars), visibility: 'public', readAt: time } };
}

test('社区输入严格拒绝未知展开、重复字段组、余字段及错误参数类型', () => {
  const name = 'get_subject_comments';
  for (const args of [{ subject_id: 101, include: ['unknown'] }, { subject_id: 101, include: ['content', 'content'] },
    { subject_id: 101, include: ['content', 'excerpt'] }, { subject_id: 101, extra: true }, { subject_id: '101' },
    { subject_id: Number.MAX_SAFE_INTEGER + 1 }, { subject_id: 101, limit: 21 }]) {
    assert.throws(() => argsFor(name, args));
  }
  assert.deepEqual(argsFor(name, { subject_id: 101 }), { subject_id: 101, limit: 10, offset: 0, include: [] });
  assert.throws(() => argsFor('get_subject_topics', { subject_id: 101, include: [] }));
  assert.throws(() => argsFor('get_subject_reviews', { subject_id: 101, include: ['content'] }));
  assert.throws(() => argsFor('get_blog_details', { blog_id: 301, include: ['excerpt'] }));
  assert.throws(() => argsFor('get_blog_comments', { blog_id: 301, offset: 1 }));
  assert.throws(() => argsFor('get_blog_comments', { blog_id: 301, offset: 1, snapshot_ref: 'pg_bad' }));
});

test('所有社区schema可严格编译，并只接受封闭的安全错误封装', () => {
  for (const tool of COMMUNITY_TOOL_DEFINITIONS) {
    compileSchema(tool.inputSchema);
    const check = compileSchema(communityOutputSchema(tool.name));
    assert.equal(check({ error: { code: 'INVALID_RESPONSE', message: '社区响应无效。' } }), true, tool.name);
    assert.equal(check({ error: { code: 'INVALID_INPUT', message: '参数无效。', networkAttempted: false,
      issues: [{ path: '/subject_id', rule: 'type', hint: '必须是整数' }] } }), true, tool.name);
    assert.equal(check({ error: { code: 'X', message: '错误', rawResponse: '不应透传' } }), false, tool.name);
    assert.equal(check({ error: { code: 'X', message: '错误', networkAttempted: true } }), false, tool.name);
    assert.equal(check({ value: {}, error: { code: 'X', message: '错误' } }), false, tool.name);
  }
});

test('封闭输出拒绝额外字段，也拒绝在include为空时夹带正文或摘要', () => {
  const f = page();
  checkCommunityResponse('get_blog_comments', f.value, f.args);
  for (const edit of [value => { value.rawResponse = {}; }, value => { value.data[0].replies = []; },
    value => { value.data[0].author.email = 'not-in-schema'; }, value => { value.data[0].content = content(); },
    value => { value.data[0].excerpt = null; }]) {
    reject('get_blog_comments', changed(f.value, edit), f.args);
  }
  const withContent = page([comment(1, { content: content() })], { include: ['content'] });
  checkCommunityResponse('get_blog_comments', withContent.value, withContent.args);
  reject('get_blog_comments', changed(withContent.value, value => { delete value.data[0].content; }), withContent.args);
  reject('get_blog_comments', changed(withContent.value, value => { value.data[0].excerpt = null; }), withContent.args);
});

test('scope与根资源必须绑定本次请求，来源URL也必须指向同一资源', () => {
  const f = page();
  for (const edit of [value => { value.scope.blog_id = 302; }, value => { value.scope.limit = 5; },
    value => { value.data[0].blogId = 302; }, value => { value.data[0].url = 'https://bgm.tv/blog/302'; }]) {
    reject('get_blog_comments', changed(f.value, edit), f.args);
  }
  const args = argsFor('get_subject_topic_details', { subject_id: 101, topic_id: 401 });
  const details = { schemaVersion: 1, kind: 'details', entity: 'subjectTopic', scope: args, included: [], subjectId: 101,
    topicId: 401, title: '主题', author, createdAt: time, updatedAt: time, replyCount: 0,
    url: 'https://bgm.tv/subject/topic/401', visibility: 'public', readAt: time };
  checkCommunityResponse('get_subject_topic_details', details, args);
  reject('get_subject_topic_details', changed(details, value => { value.subjectId = 102; }), args);
  reject('get_subject_topic_details', changed(details, value => { value.topicId = 402; }), args);
});

test('正文范围按Unicode字符计算，末段不能冒称全文', () => {
  const f = chunk('😀乙', { offset: 1, limit: 2 }, 3);
  checkCommunityResponse('read_community_content', f.value, f.args);
  assert.equal(f.value.content.text.length, 3, 'UTF16长度与正文字符范围不同');
  assert.equal(f.value.content.range.returnedChars, 2);
  assert.equal(f.value.content.isFullText, false);
  for (const edit of [value => { value.content.range.returnedChars = 3; }, value => { value.content.range.nextOffset = 3; },
    value => { value.content.range.totalChars = 1; }, value => { value.content.range.offset = 0; },
    value => { value.content.isFullText = true; }, value => { value.content.range.raw = 1; }]) {
    reject('read_community_content', changed(f.value, edit), f.args);
  }
  const empty = chunk(''); checkCommunityResponse('read_community_content', empty.value, empty.args);
  assert.equal(empty.value.content.isFullText, true);
  const full = chunk(); checkCommunityResponse('read_community_content', full.value, full.args);
  reject('read_community_content', changed(full.value, value => { value.content.isFullText = false; }), full.args);
});

test('续读必须返回请求的contentRef，source只允许已声明的资源种类和字段', () => {
  const f = chunk();
  reject('read_community_content', changed(f.value, value => { value.content.contentRef = `ct_${'x'.repeat(32)}`; }), f.args);
  reject('read_community_content', changed(f.value, value => { value.source.kind = 'arbitrary'; }), f.args);
  reject('read_community_content', changed(f.value, value => { value.source.subjectId = 101; }), f.args);
  reject('read_community_content', changed(f.value, value => { value.source.blogId = 0; }), f.args);
  for (const source of [{ kind: 'subjectComment', subjectId: 101, commentId: 1 },
    { kind: 'blogComment', blogId: 301, commentId: 1 }, { kind: 'topicPost', subjectId: 101, topicId: 401, postId: 1 }]) {
    checkCommunityResponse('read_community_content', { ...f.value, source }, f.args);
  }
});

test('列表拒绝重复记录，宿主续页必须使用请求的snapshotRef且分页数学一致', () => {
  const duplicate = page([comment(1), comment(1)]);
  reject('get_blog_comments', duplicate.value, duplicate.args);
  const f = page([comment(2)], { offset: 1, limit: 1, snapshot_ref: snapshotRef }, 2);
  checkCommunityResponse('get_blog_comments', f.value, f.args);
  for (const edit of [value => { value.page.snapshotRef = `pg_${'c'.repeat(32)}`; },
    value => { value.page.returnedCount = 2; }, value => { value.page.total = 3; },
    value => { value.page.complete = true; }, value => { value.page.nextOffset = 2; }, value => { value.page.offset = 0; }]) {
    reject('get_blog_comments', changed(f.value, edit), f.args);
  }
});

test('回复图拒绝循环、自引用和跨根绑定，父评论在其他页时仍可读取', () => {
  for (const rows of [[comment(1, { parentId: 2, rootId: 3 }), comment(2, { parentId: 1, rootId: 3 })],
    [comment(1, { parentId: 1, rootId: 2 })], [comment(1), comment(2, { parentId: 1, rootId: 3 })],
    [comment(1, { rootId: 2 })], [comment(1, { parentId: 3, rootId: 2 }), comment(2, { parentId: 4, rootId: 5 })]]) {
    const f = page(rows); reject('get_blog_comments', f.value, f.args);
  }
  const crossPage = page([comment(2, { parentId: 1, rootId: 1 })], { offset: 1, limit: 1, snapshot_ref: snapshotRef }, 2);
  checkCommunityResponse('get_blog_comments', crossPage.value, crossPage.args);
});

test('真实UTC时间校验拒绝日期滚动及非UTC或缺毫秒的结果', () => {
  const f = page();
  for (const invalidTime of ['2026-02-30T00:00:00.000Z', '2026-10-04T24:00:00.000Z',
    '2026-10-04T08:00:00.000+08:00', '2026-10-04T00:00:00Z']) {
    assert.throws(() => checkCommunityResponse('get_blog_comments', changed(f.value, value => { value.readAt = invalidTime; }), f.args));
  }
  reject('get_blog_comments', changed(f.value, value => { value.data[0].createdAt = '2026-02-30T00:00:00.000Z'; }), f.args);
});

test('各字段合法的结果仍须遵守包含value封装的20000 UTF16字符上限', () => {
  const rows = Array.from({ length: 20 }, (_, index) => comment(index + 1, {
    author: { id: 9, username: 'u'.repeat(100), nickname: 'n'.repeat(300) },
    content: content('测'.repeat(500), 0, 500, `ct_${String(index).padStart(32, 'a')}`),
  }));
  const f = page(rows, { limit: 20, include: ['content'] });
  assert.equal(compileSchema(communityOutputSchema('get_blog_comments'))({ value: f.value }), true);
  assert.ok(JSON.stringify({ value: f.value }).length > 20_000);
  reject('get_blog_comments', f.value, f.args, 'CONTEXT_LIMIT');
});
