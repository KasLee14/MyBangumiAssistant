// 实际 worker 的离线依赖替身，所有网络入口均覆盖或抛错。
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = dirname(createRequire(import.meta.url).resolve('@aronnaxlin/bgm-cli/package.json'));
const { BangumiClient } = await import(pathToFileURL(join(root, 'src/core/client.js')).href);
BangumiClient.prototype.request = async () => { throw new Error('测试禁止访问真实服务'); };
BangumiClient.prototype.getMe = async () => ({ id: 7, username: 'fixture' });
BangumiClient.prototype.getSubject = async id => ({ id, type: 2 });
BangumiClient.prototype.getEpisode = async id => ({ id, subjectID: 1, collection: null });
BangumiClient.prototype.listCollections = async (_user, { offset }) => {
  const scenario = process.env.FIXTURE_SCENARIO;
  const ids = Array.from({ length: 101 }, (_, index) => index === 100 && scenario === 'found' ? 999 : index + 1);
  const data = ids.slice(offset, offset + 100).map(subject_id => ({ subject_id, type: 3, rate: 0, comment: '', tags: [], private: false, ep_status: 0, vol_status: 0 }));
  if (scenario === 'missing' && offset === 100) data.length = 0;
  return { data, total: scenario === 'changed' && offset === 100 ? 102 : 101 };
};
BangumiClient.prototype.patchMyCollection = async (_id, patch) => {
  if (patch.epStatus !== 0 || patch.volStatus !== 0) throw new Error('unexpected patch');
};
BangumiClient.prototype.upsertMyCollection = async (_id, patch) => {
  if (patch.progress !== false || patch.tags[0] !== '科幻,动画' || patch.comment !== '--help;$(x)') throw new Error('unexpected payload');
};
BangumiClient.prototype.updateMyEpisodeCollection = async (_id, patch) => {
  if (patch.type !== 0 || patch.batch !== false) throw new Error('unexpected episode patch');
};
