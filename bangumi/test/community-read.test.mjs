import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { BangumiMcpService } from '../dist/src/mcp/service.js';
import { CommunityReader, communityPlainText } from '../dist/src/mcp/community-service.js';
import { TOOL_DEFINITIONS, validateToolArguments } from '../dist/src/mcp/catalog.js';
import { createReadTools } from '../dist/src/mcp/pi-tools.js';
import { loadApplicationSkills } from '../dist/src/strategies/native-skills.js';

const tools = [
  'get_subject_comments', 'get_subject_reviews', 'get_blog_details', 'get_blog_comments',
  'get_subject_topics', 'get_subject_topic_details', 'get_subject_topic_replies', 'read_community_content',
];
const baseArgs = {
  get_subject_comments: { subject_id: 101 }, get_subject_reviews: { subject_id: 101 },
  get_blog_details: { blog_id: 301 }, get_blog_comments: { blog_id: 301 },
  get_subject_topics: { subject_id: 101 }, get_subject_topic_details: { subject_id: 101, topic_id: 401 },
  get_subject_topic_replies: { subject_id: 101, topic_id: 401 },
  read_community_content: { content_ref: `ct_${'a'.repeat(32)}` },
};
const epoch = 1_700_000_000;
const user = { id: 7, username: 'community_reader', nickname: '公开作者' };
const post = (id, mainID, content, extra = {}) => ({
  id, mainID, relatedID: 0, creatorID: user.id, user: { ...user }, creator: { ...user },
  content, state: 0, createdAt: epoch, replies: [], ...extra,
});

function fixture() {
  const raw = {
    comments: [
      { id: 111, user: { ...user }, type: 2, rate: 8, comment: '关于作品的第一条吐槽', updatedAt: epoch },
      { id: 112, user: { ...user }, type: 3, rate: 7, comment: '关于作品的第二条吐槽', updatedAt: epoch + 1 },
    ],
    reviews: [{ id: 201, user: { ...user }, entry: {
      id: 301, title: '关联日志', summary: '来自列表的文章摘要', replies: 2,
      createdAt: epoch, updatedAt: epoch + 1, public: true,
    } }],
    blogs: new Map([[301, { id: 301, public: true, title: '关联日志', user: { ...user },
      content: '日志正文', replies: 2, createdAt: epoch, updatedAt: epoch + 1 }]]),
    blogComments: new Map([[301, [post(501, 301, '日志评论', { replies: [post(502, 301, '评论的回复', { relatedID: 501 })] })]]]),
    topics: [{ id: 401, parentID: 101, title: '条目讨论', creator: { ...user }, creatorID: user.id,
      replyCount: 2, createdAt: epoch, updatedAt: epoch + 2 }],
    topic: { id: 401, parentID: 101, subject: { id: 101 }, title: '条目讨论',
      creator: { ...user }, creatorID: user.id, replyCount: 2, createdAt: epoch, updatedAt: epoch + 2,
      replies: [
        post(601, 401, '讨论主帖', { replies: [post(602, 401, '对主帖的回复', { relatedID: 601, createdAt: epoch + 1 })] }),
        post(603, 401, '独立楼层', { createdAt: epoch + 2 }),
      ],
    },
  };
  const calls = [];
  let pageMutation;
  const transport = {
    close: async () => {},
    public: async () => { throw Error('社区读取不应使用 public transport'); },
    account: async () => { throw Error('社区读取不应使用账户请求'); },
    currentUser: async () => { throw Error('社区读取不应查询当前账户'); },
    community: async (path, options = {}) => {
      calls.push({ path, options: structuredClone(options) });
      assert.ok(options.method === undefined || options.method === 'GET');
      assert.equal(options.body, undefined);
      assert.equal(options.expectedAccountId, undefined);
      const query = options.query ?? {};
      const paged = (key, data) => {
        const offset = query.offset ?? 0; const limit = query.limit ?? 20;
        const result = { data: data.slice(offset, offset + limit), total: data.length };
        return structuredClone(pageMutation?.(result, key, query) ?? result);
      };
      if (path === '/p1/subjects/101/comments') return paged('comments', raw.comments);
      if (path === '/p1/subjects/101/reviews') return paged('reviews', raw.reviews);
      if (path === '/p1/subjects/101/topics') return paged('topics', raw.topics);
      if (path === '/p1/subjects/-/topics/401') return structuredClone(raw.topic);
      const match = /^\/p1\/blogs\/(\d+)(\/comments)?$/.exec(path);
      if (match) {
        const id = Number(match[1]);
        const value = match[2] ? raw.blogComments.get(id) : raw.blogs.get(id);
        assert.ok(value, `未知日志 ID：${id}`);
        return structuredClone(value);
      }
      throw Error(`未预期的匿名社区路径：${path}`);
    },
  };
  const service = new BangumiMcpService(transport);
  return { raw, calls, service, transport, setPageMutation: fn => { pageMutation = fn; } };
}

const readerCall = (reader, name, args) => reader.call(name, validateToolArguments(name, args));
function assertNoText(value) {
  assert.equal(Object.hasOwn(value, 'content'), false);
  assert.equal(Object.hasOwn(value, 'excerpt'), false);
}

test('新增社区工具是具备固定输入输出契约的公开只读能力', () => {
  assert.equal(new Set(TOOL_DEFINITIONS.map(tool => tool.name)).size, TOOL_DEFINITIONS.length);
  for (const name of tools) {
    const definition = TOOL_DEFINITIONS.find(tool => tool.name === name);
    assert.ok(definition, name);
    assert.equal(definition.effect, 'read');
    assert.equal(definition.access, 'public');
    assert.equal(definition.inputSchema.additionalProperties, false);
    assert.ok(definition.outputSchema);
  }
  const available = createReadTools({ call: async () => { throw Error('不应执行'); }, close: async () => {} });
  for (const name of tools) assert.ok(available.some(tool => tool.name === name), name);
});

test('输入严格拒绝未声明字段、字符串 ID、非法展开与边界，并在验证后补默认值', () => {
  for (const name of tools) {
    const original = structuredClone(baseArgs[name]);
    const defaults = validateToolArguments(name, original);
    assert.deepEqual(original, baseArgs[name], '不得直接修改原始参数');
    assert.throws(() => validateToolArguments(name, { ...original, arbitrary: true }));
    for (const key of Object.keys(original).filter(key => key.endsWith('_id'))) {
      assert.throws(() => validateToolArguments(name, { ...original, [key]: String(original[key]) }));
      assert.throws(() => validateToolArguments(name, { ...original, [key]: 0 }));
      assert.throws(() => validateToolArguments(name, { ...original, [key]: Number.MAX_SAFE_INTEGER + 1 }));
    }
    if (name !== 'get_subject_topics' && name !== 'read_community_content') {
      assert.deepEqual(defaults.include, []);
      for (const include of [['invalid'], ['content', 'excerpt'], ['content', 'content']]) {
        assert.throws(() => validateToolArguments(name, { ...original, include }));
      }
    } else assert.throws(() => validateToolArguments(name, { ...original, include: [] }));
    if (name === 'read_community_content') {
      assert.equal(defaults.offset, 0); assert.equal(defaults.limit, 5000);
      assert.throws(() => validateToolArguments(name, { content_ref: 'ct_bad' }));
      for (const limit of [0, 5001, '100']) assert.throws(() => validateToolArguments(name, { ...original, limit }));
    } else if (!name.endsWith('_details')) {
      assert.equal(defaults.offset, 0);
      assert.equal(defaults.limit, name === 'get_subject_reviews' ? 5 : 10);
      for (const limit of [0, 21, '10']) assert.throws(() => validateToolArguments(name, { ...original, limit }));
    }
    if (Object.hasOwn(defaults, 'offset')) {
      for (const offset of [-1, 0.5, '0']) assert.throws(() => validateToolArguments(name, { ...original, offset }));
    }
  }
  assert.throws(() => validateToolArguments('get_subject_reviews', { subject_id: 101, include: ['content'] }));
  for (const name of ['get_blog_details', 'get_subject_topic_details']) {
    assert.throws(() => validateToolArguments(name, { ...baseArgs[name], include: ['excerpt'] }));
  }
  for (const name of ['get_blog_comments', 'get_subject_topic_replies']) {
    assert.throws(() => validateToolArguments(name, { ...baseArgs[name], offset: 1 }));
    assert.throws(() => validateToolArguments(name, { ...baseArgs[name], snapshot_ref: 'pg_bad' }));
  }
});

test('列表及详情默认不泄露正文，include 精确控制摘要或正文', async () => {
  const f = fixture();
  for (const name of tools.filter(name => name !== 'read_community_content')) {
    const value = await f.service.call(name, baseArgs[name]);
    assert.deepEqual(value.included, []);
    assert.deepEqual(value.scope, validateToolArguments(name, baseArgs[name]));
    assert.equal(value.visibility, 'public');
    assertNoText(value);
    for (const row of value.data ?? []) assertNoText(row);
  }
  for (const name of ['get_subject_comments', 'get_blog_comments', 'get_subject_topic_replies']) {
    for (const include of [['excerpt'], ['content']]) {
      const value = await f.service.call(name, { ...baseArgs[name], include });
      assert.deepEqual(value.included, include);
      assert.ok(value.data.length > 0);
      for (const row of value.data) {
        assert.equal(Object.hasOwn(row, include[0]), true);
        assert.equal(Object.hasOwn(row, include[0] === 'excerpt' ? 'content' : 'excerpt'), false);
        if (include[0] === 'content') assert.equal(row.content.state, 'available');
      }
    }
  }
  for (const name of ['get_blog_details', 'get_subject_topic_details']) {
    const value = await f.service.call(name, { ...baseArgs[name], include: ['content'] });
    assert.equal(value.content.state, 'available');
    assert.equal(Object.hasOwn(value, 'excerpt'), false);
  }
});

test('关联记录和日志 ID 分开，摘要请求不逐篇读取文章', async () => {
  const f = fixture();
  const reviews = await f.service.call('get_subject_reviews', { subject_id: 101, include: ['excerpt'] });
  const row = reviews.data[0];
  assert.equal(row.relationId, 201);
  assert.equal(row.blogId, 301);
  assert.equal(row.subjectId, 101);
  assert.equal(row.url, 'https://bgm.tv/blog/301');
  assert.equal(row.excerpt.text, '来自列表的文章摘要');
  assert.equal(row.excerpt.origin, 'upstream_summary');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].path, '/p1/subjects/101/reviews');
  const article = await f.service.call('get_blog_details', { blog_id: row.blogId, include: ['content'] });
  assert.equal(article.blogId, 301);
  assert.equal(article.content.text, '日志正文');
});

test('超长 Unicode 正文按同一引用连续重构，末尾空段不冒充全文', async () => {
  const f = fixture();
  const original = '𠮷🙂汉字'.repeat(3101);
  f.raw.blogs.get(301).content = original;
  const article = await f.service.call('get_blog_details', { blog_id: 301, include: ['content'] });
  let chunk = article.content;
  const reference = chunk.contentRef;
  const total = Array.from(original).length;
  assert.equal(chunk.range.offset, 0);
  assert.equal(chunk.range.returnedChars, 5000);
  assert.equal(chunk.range.totalChars, total);
  assert.equal(chunk.isFullText, false);
  const text = [];
  let offset = 0;
  while (true) {
    assert.equal(chunk.contentRef, reference);
    assert.equal(chunk.range.offset, offset);
    assert.equal(chunk.range.returnedChars, Array.from(chunk.text).length);
    assert.equal(chunk.range.totalChars, total);
    text.push(chunk.text);
    offset += chunk.range.returnedChars;
    if (chunk.range.nextOffset === null) break;
    assert.equal(chunk.range.nextOffset, offset);
    const result = await f.service.call('read_community_content', { content_ref: reference, offset, limit: 1379 });
    assert.deepEqual(result.source, { kind: 'blog', blogId: 301 });
    chunk = result.content;
  }
  assert.equal(text.join(''), original);
  assert.equal(offset, total);
  assert.equal(f.calls.length, 1, '续读不得重新获取网络正文');
  const end = await f.service.call('read_community_content', { content_ref: reference, offset: total });
  assert.equal(end.content.text, '');
  assert.deepEqual(end.content.range, { offset: total, returnedChars: 0, totalChars: total, nextOffset: null });
  assert.equal(end.content.isFullText, false);
  await assert.rejects(() => f.service.call('read_community_content', { content_ref: reference, offset: total + 1 }));
});

test('短评正文返回片段与可用续读引用，空正文与未请求区分', async () => {
  const f = fixture();
  const original = '🙂短评'.repeat(200);
  f.raw.comments[0].comment = original;
  const excerpts = await f.service.call('get_subject_comments', { subject_id: 101, include: ['excerpt'] });
  assert.equal(excerpts.data[0].excerpt.origin, 'content_prefix');
  assert.equal(Array.from(excerpts.data[0].excerpt.text).length, 300);
  assert.equal(excerpts.data[0].excerpt.truncated, true);
  const comments = await f.service.call('get_subject_comments', { subject_id: 101, include: ['content'] });
  const content = comments.data[0].content;
  assert.equal(content.range.returnedChars, 500);
  assert.equal(content.isFullText, false);
  const rest = await f.service.call('read_community_content', { content_ref: content.contentRef, offset: content.range.nextOffset });
  assert.deepEqual(rest.source, { kind: 'subjectComment', subjectId: 101, commentId: 111 });
  assert.equal(content.text + rest.content.text, original);
  f.raw.blogs.get(301).content = '';
  const empty = await f.service.call('get_blog_details', { blog_id: 301, include: ['content'] });
  assert.equal(empty.content.state, 'available');
  assert.equal(empty.content.text, '');
  assert.equal(empty.content.range.totalChars, 0);
  assert.equal(empty.content.isFullText, true);
});

test('明确请求的不可读或解析受限正文保留状态，不冒充空正文', async () => {
  const f = fixture();
  f.raw.comments[0].comment = null;
  f.raw.comments[1].comment = { unexpected: '不透传上游对象' };
  const comments = await f.service.call('get_subject_comments', { subject_id: 101, include: ['content'] });
  assert.deepEqual(comments.data[0].content, { state: 'unavailable', reason: 'not_exposed' });
  assert.deepEqual(comments.data[1].content, { state: 'unsupported_shape' });
  f.raw.blogComments.get(301)[0].state = 1;
  const hidden = await f.service.call('get_blog_comments', { blog_id: 301, include: ['content'] });
  assert.equal(hidden.data[0].content.state, 'unavailable');
  assert.equal(Object.hasOwn(hidden.data[0].content, 'text'), false);
  f.raw.blogs.get(301).public = false;
  await assert.rejects(() => f.service.call('get_blog_details', { blog_id: 301, include: ['content'] }));
});

test('正文引用未知、过期与有界缓存逐出后不能继续读取或静默联网', async () => {
  const f = fixture();
  let now = 1000;
  const reader = new CommunityReader(f.transport, { now: () => now, ttlMs: 10, maxEntries: 2, maxChars: 100_000 });
  const article = await readerCall(reader, 'get_blog_details', { blog_id: 301, include: ['content'] });
  await assert.rejects(() => readerCall(reader, 'read_community_content', { content_ref: `ct_${'x'.repeat(32)}` }));
  now += 11;
  await assert.rejects(() => readerCall(reader, 'read_community_content', { content_ref: article.content.contentRef }));
  assert.equal(f.calls.length, 1);
  const evict = new CommunityReader(f.transport, { now: () => now, ttlMs: 1000, maxEntries: 2, maxChars: 100_000 });
  const first = await readerCall(evict, 'get_blog_details', { blog_id: 301, include: ['content'] });
  for (const id of [302, 303]) {
    f.raw.blogs.set(id, { ...f.raw.blogs.get(301), id });
    await readerCall(evict, 'get_blog_details', { blog_id: id, include: ['content'] });
  }
  await assert.rejects(() => readerCall(evict, 'read_community_content', { content_ref: first.content.contentRef }));
});

test('日志与讨论回复平铺保留归属，主帖来源由首条根记录核实', async () => {
  const f = fixture();
  const comments = await f.service.call('get_blog_comments', { blog_id: 301, include: ['content'] });
  assert.deepEqual(comments.data.map(row => [row.id, row.parentId, row.rootId]), [[501, null, 501], [502, 501, 501]]);
  for (const row of comments.data) {
    assert.equal(row.blogId, 301);
    assert.equal(Object.hasOwn(row, 'replies'), false);
  }
  const topic = await f.service.call('get_subject_topic_details', { subject_id: 101, topic_id: 401, include: ['content'] });
  assert.equal(topic.content.text, '讨论主帖');
  assert.equal(Object.hasOwn(topic, 'replies'), false);
  const replies = await f.service.call('get_subject_topic_replies', { subject_id: 101, topic_id: 401, include: ['content'] });
  assert.deepEqual(replies.data.map(row => [row.id, row.parentId, row.rootId]), [[602, 601, 601], [603, null, 603]]);
  assert.equal(replies.data.some(row => row.id === 601), false);
  for (const row of replies.data) {
    assert.equal(row.subjectId, 101); assert.equal(row.topicId, 401);
    assert.equal(Object.hasOwn(row, 'replies'), false);
  }
  for (const name of ['get_subject_topic_details', 'get_subject_topic_replies']) {
    await assert.rejects(() => f.service.call(name, { subject_id: 999, topic_id: 401 }));
  }
});

test('复杂或错归属回复及不可信主帖不会被截成看似正常的数据', async () => {
  for (const change of [
    f => { f.raw.blogComments.get(301)[0].replies[0].replies = [post(503, 301, '第三层', { relatedID: 502 })]; },
    f => { f.raw.blogComments.get(301)[0].replies[0].mainID = 999; },
    f => { f.raw.blogComments.get(301)[0].replies[0].relatedID = 999; },
    f => { f.raw.blogComments.get(301)[0].replies[0].id = 501; },
  ]) {
    const f = fixture(); change(f);
    await assert.rejects(() => f.service.call('get_blog_comments', { blog_id: 301 }));
  }
  for (const change of [
    f => { f.raw.topic.replies[0].replies[0].replies = [post(604, 401, '第三层', { relatedID: 602 })]; },
    f => { f.raw.topic.replies.reverse(); },
    f => { f.raw.topic.replies[0].creatorID = 8; },
    f => { f.raw.topic.replies[0].createdAt += 1; },
  ]) {
    const f = fixture(); change(f);
    await assert.rejects(() => f.service.call('get_subject_topic_details', { subject_id: 101, topic_id: 401, include: ['content'] }));
  }
});

test('宿主分页复用同一快照，末页不冒充完整集合且拒绝跨资源引用', async () => {
  const f = fixture();
  const first = await f.service.call('get_blog_comments', { blog_id: 301, limit: 1, include: ['content'] });
  assert.equal(first.page.paginationSource, 'host');
  assert.equal(first.page.total, 2); assert.equal(first.page.nextOffset, 1); assert.equal(first.page.complete, false);
  f.raw.blogComments.get(301)[0].replies[0].content = '网站后来改过的内容';
  const next = await f.service.call('get_blog_comments', {
    blog_id: 301, limit: 1, offset: first.page.nextOffset, snapshot_ref: first.page.snapshotRef, include: ['content'],
  });
  assert.equal(next.page.snapshotRef, first.page.snapshotRef);
  assert.equal(next.data[0].content.text, '评论的回复');
  assert.equal(next.page.nextOffset, null); assert.equal(next.page.complete, false);
  assert.equal(f.calls.length, 2, '首次核实公开日志并读取评论，宿主续页不得重抓');
  await assert.rejects(() => f.service.call('get_blog_comments', { blog_id: 302, offset: 1, snapshot_ref: first.page.snapshotRef }));
  await assert.rejects(() => f.service.call('get_subject_topic_replies', {
    subject_id: 101, topic_id: 401, offset: 1, snapshot_ref: first.page.snapshotRef,
  }));
  assert.equal(f.calls.length, 2, '错资源快照必须在网络请求之前拒绝');
});

test('宿主分页快照过期明确失败，缓存总长度有界且取消不联网', async () => {
  const f = fixture();
  let now = 1000;
  const reader = new CommunityReader(f.transport, { now: () => now, ttlMs: 10 });
  const first = await readerCall(reader, 'get_blog_comments', { blog_id: 301, limit: 1 });
  now += 11;
  await assert.rejects(() => readerCall(reader, 'get_blog_comments', { blog_id: 301, offset: 1, snapshot_ref: first.page.snapshotRef }));
  assert.equal(f.calls.length, 2);
  f.raw.blogs.get(301).content = '文'.repeat(200);
  const bounded = new CommunityReader(f.transport, { maxChars: 100 });
  await assert.rejects(() => readerCall(bounded, 'get_blog_details', { blog_id: 301, include: ['content'] }));
  const calls = f.calls.length;
  const signal = AbortSignal.abort();
  await assert.rejects(() => reader.call('get_blog_details', validateToolArguments('get_blog_details', { blog_id: 301 }), signal));
  assert.equal(f.calls.length, calls);
});

test('源列表拒绝重复、短页、错误总数及条目归属', async () => {
  for (const corrupt of [
    page => ({ ...page, data: [page.data[0], page.data[0]] }),
    page => ({ ...page, data: [] }),
    page => ({ ...page, total: 0 }),
    page => ({ ...page, total: 1.5 }),
  ]) {
    const f = fixture(); f.setPageMutation(corrupt);
    await assert.rejects(() => f.service.call('get_subject_comments', { subject_id: 101 }));
  }
  const wrongTopic = fixture(); wrongTopic.raw.topics[0].parentID = 999;
  await assert.rejects(() => wrongTopic.service.call('get_subject_topics', { subject_id: 101 }));
});

test('序列化输出整体超限会失败，不偷偷删除记录或裁剪已声明字段', async () => {
  const f = fixture();
  f.raw.comments = Array.from({ length: 20 }, (_, i) => ({
    ...f.raw.comments[0], id: 1000 + i, comment: '\\'.repeat(500),
    user: { ...user, username: 'u'.repeat(100), nickname: '名'.repeat(300) },
  }));
  await assert.rejects(() => f.service.call('get_subject_comments', { subject_id: 101, limit: 20, include: ['content'] }));
});

test('Pi 桥接拒绝注入客户端伪造对象、scope、展开字段及正文范围', async () => {
  const f = fixture();
  const args = { subject_id: 101, include: ['content'] };
  const good = await f.service.call('get_subject_comments', args);
  for (const mutate of [
    value => { value.scope.subject_id = 999; },
    value => { value.data[0].subjectId = 999; },
    value => { value.included = []; },
    value => { value.data[0].excerpt = { text: '未请求摘要', origin: 'content_prefix', truncated: false }; },
    value => { value.data[0].content.range.returnedChars += 1; },
    value => { value.data[0].content.range.nextOffset = 1; },
    value => { value.data[0].content.isFullText = false; },
    value => { value.page.returnedCount += 1; },
    value => { value.page.complete = false; },
    value => { value.data[1].id = value.data[0].id; },
    value => { value.data[0].url = 'https://bgm.tv/subject/999/comments'; },
  ]) {
    const bad = structuredClone(good); mutate(bad);
    const client = { call: async () => bad, close: async () => {} };
    const tool = createReadTools(client).find(tool => tool.name === 'get_subject_comments');
    const result = await tool.execute('test', args, undefined, undefined, {});
    assert.equal(result.isError, true, JSON.stringify(bad));
    assert.ok(result.details.error);
    assert.equal(Object.hasOwn(result.details, 'value'), false);
  }
});

test('新增 Skill 由应用原生加载器发现，构建产物与源文件一致', async () => {
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const result = loadApplicationSkills(cwd, fileURLToPath(new URL('./nonexistent-agent-data/', import.meta.url)));
  const skill = result.skills.find(item => item.name === 'bangumi-community-read');
  assert.ok(skill, JSON.stringify(result.diagnostics));
  assert.equal(skill.disableModelInvocation, false);
  const source = await readFile(new URL('../src/strategies/skills/bangumi-community-read/SKILL.md', import.meta.url), 'utf8');
  assert.equal(await readFile(skill.filePath, 'utf8'), source);
});

test('正文视图保留代码、引用署名和列表边界，纯文本吐槽不改写标记', async () => {
  assert.ok(communityPlainText('[code]<div>hello</div>&amp;#65;[/code]').includes('<div>hello</div>&amp;#65;'));
  assert.equal(communityPlainText('&amp;#65;'), '&amp;#65;');
  assert.ok(communityPlainText('[quote=甲]原话[/quote]').includes('甲'));
  assert.match(communityPlainText('[list][*]支持[*]反对[/list]'), /支持\n.*反对/);
  const f = fixture();
  f.raw.comments[0].comment = '[b]原始吐槽[/b] <div>代码</div> &amp;#65;';
  const value = await f.service.call('get_subject_comments', { subject_id: 101, limit: 1, include: ['content'] });
  assert.equal(value.data[0].content.text, f.raw.comments[0].comment);
});

test('源分页不能把已有offset或limit矛盾包装成当前请求范围', async () => {
  for (const extra of [{ offset: 0 }, { limit: 2 }]) {
    const f = fixture(); f.setPageMutation(page => ({ ...page, ...extra }));
    await assert.rejects(() => f.service.call('get_subject_comments', { subject_id: 101, offset: 1, limit: 1 }), { code: 'INCOMPLETE_DATA' });
  }
});

test('快照在本次展开中到期时明确失败，不返回已删除的续页引用', async () => {
  const f = fixture(); let resume = false; let steps = 0;
  const reader = new CommunityReader(f.transport, { ttlMs: 10, now: () => resume ? (++steps <= 2 ? 9 : 11) : 0 });
  const first = await readerCall(reader, 'get_blog_comments', { blog_id: 301, limit: 1 });
  resume = true;
  await assert.rejects(() => readerCall(reader, 'get_blog_comments', { blog_id: 301, limit: 1, offset: 1, snapshot_ref: first.page.snapshotRef, include: ['content'] }), { code: 'CONTENT_REF_EXPIRED' });
});

test('折叠楼层保持可见文字，已删除楼层明确为不可用', async () => {
  const f = fixture();
  f.raw.topic.replies[1].state = 8;
  let value = await f.service.call('get_subject_topic_replies', { subject_id: 101, topic_id: 401, include: ['content'] });
  assert.equal(value.data.find(row => row.id === 603).content.text, '独立楼层');
  f.raw.topic.replies[1].state = 6;
  value = await f.service.call('get_subject_topic_replies', { subject_id: 101, topic_id: 401, include: ['content'] });
  assert.deepEqual(value.data.find(row => row.id === 603).content, { state: 'unavailable', reason: 'hidden' });
});
