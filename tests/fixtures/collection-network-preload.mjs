// 收藏列表真实桥接离线验收：拒绝所有写入与未知端点，仅临时假OAuth数据。
import { createRequire } from 'node:module';
const undici = createRequire(import.meta.url)('undici');
const data = Array.from({ length: 125 }, (_, i) => ({ id: i + 1, type: [1, 2, 3, 4, 6][i % 5], name: `收藏作品${i + 1}`,
  summary: '不应进入工具结果的长简介', rating: { score: 9.9 }, interest: { type: Math.floor(i / 5) % 5 + 1,
    rate: i % 12 === 11 ? null : i % 12, comment: '不应进入工具结果的短评', tags: ['测试'], private: i % 2 === 0, epStatus: 0, volStatus: 0 } }));
undici.fetch = async (raw, init) => {
  const url = new URL(raw);
  if (url.origin !== 'https://next.bgm.tv' || init.method !== 'GET' || init.redirect !== 'manual'
    || init.headers.Authorization !== 'Bearer offline-collection-token-123456' || init.headers.Cookie) throw new Error('测试禁止真实网络、写入或旧认证');
  if (process.env.COLLECTION_FIXTURE_MODE === 'unauthorized') return new Response('', { status: 401 });
  const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  if (url.pathname === '/p1/me') return json({ id: process.env.COLLECTION_FIXTURE_MODE === 'account-changed' ? 8 : 7, username: 'fixture' });
  if (url.pathname !== '/p1/collections/subjects') throw new Error('仅允许固定本人收藏端点');
  let filtered = data;
  if (url.searchParams.has('subjectType')) filtered = filtered.filter(row => row.type === Number(url.searchParams.get('subjectType')));
  if (url.searchParams.has('type')) filtered = filtered.filter(row => row.interest.type === Number(url.searchParams.get('type')));
  const limit = Number(url.searchParams.get('limit')); const offset = Number(url.searchParams.get('offset'));
  return json({ data: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset });
};
