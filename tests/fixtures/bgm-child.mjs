const query = process.argv[5];
const [group, action] = process.argv.slice(3);
if (group === 'collection' && action === 'list') {
  const flags = Object.fromEntries(Array.from({ length: (process.argv.length - 5) / 2 }, (_, i) => [process.argv[5 + i * 2], process.argv[6 + i * 2]]));
  const types = { book: 1, anime: 2, music: 3, game: 4, real: 6 };
  const states = { wish: 1, completed: 2, in_progress: 3, on_hold: 4, dropped: 5 };
  let data = Array.from({ length: 125 }, (_, i) => ({ id: i + 1, type: [1,2,3,4,6][i % 5], name: `测试作品${i + 1}`, interest: { type: Math.floor(i / 5) % 5 + 1, rate: i % 12 === 11 ? null : i % 12, private: i % 2 === 0 } }));
  if (flags['--type']) data = data.filter(item => item.type === types[flags['--type']]);
  if (flags['--status']) data = data.filter(item => item.interest.type === states[flags['--status']]);
  const offset = Number(flags['--offset']); const limit = Number(flags['--limit']);
  console.log(JSON.stringify({ account: { id: 7, username: 'fixture-user' }, total: data.length, data: data.slice(offset, offset + limit), offset, limit }));
} else if (group === 'user' && action === 'me') {
  console.log(JSON.stringify({ id: 7, username: 'fixture-user', email: 'private@example.test', accessToken: 'fake-file-secret' }));
} else if (query === '400602' && group === 'episode' && action === 'list') {
  const offset = Number(process.argv.at(-1)); const limit = Number(process.argv[7]);
  const data = Array.from({ length: 36 }, (_, i) => ({ id: i + 1, type: i < 28 ? 0 : 1, ep: i + 1, collection: { status: 2 } }));
  console.log(JSON.stringify({ data: data.slice(offset, offset + limit), total: 36, offset }));
} else if (query === '400602' && group === 'subject' && action === 'get') {
  console.log(JSON.stringify({ id: 400602, type: 2, name: '测试动画' }));
} else if (query === '400602' && group === 'collection' && action === 'get') {
  console.log(JSON.stringify({ collection: { type: 3, rate: 8, ep_status: 28, tags: ['测试'] } }));
} else if (query === 'dialogue-fixture' && group === 'subject' && action === 'search') {
  console.log(JSON.stringify({ data: [{ id: 1, type: 2, name: '第一部' }, { id: 400602, type: 2, name: '第二部' }], total: 2 }));
} else if (query === 'slow') {
  setTimeout(() => console.log('{}'), 10000);
} else if (query === 'invalid-json') {
  console.log('not json');
} else if (query === 'fail') {
  console.error(`Bearer ${process.env.TEST_API_KEY}`);
  process.exitCode = 1;
} else if (query === 'unauthorized' || query === 'forbidden' || query === 'collection-missing' || query === 'not-found') {
  const status = query === 'unauthorized' ? 401 : query === 'forbidden' ? 403 : 404;
  console.error(`Bangumi API error (${status}): ${query === 'collection-missing' ? 'Collection for subject 1 was not found.' : 'unknown-disk-credential'}`);
  console.error('unknown-disk-credential');
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ argv: process.argv.slice(2), configDir: process.env.BGM_CONFIG_DIR, proxy: process.env.BGM_PROXY, proxyPolicy: process.env.BANGUMI_PROXY_POLICY }));
}
