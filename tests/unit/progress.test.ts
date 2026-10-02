import test from 'node:test';
import assert from 'node:assert/strict';
import { planEpisodeTargets } from '../../src/domain/progress.js';
import type { Episode } from '../../src/domain/bangumi.js';

const episodes: Episode[] = [
  { id: 103, number: 3, type: 0, name:'第三集',status:null,url:'' },
  { id: 102, number: 2, type: 0, name:'第二集',status:2,url:'' },
  { id: 190, number: 1, type: 1, name:'SP',status:null,url:'' },
  { id: 101, number: 1, type: 0, name:'第一集',status:null,url:'' },
];
test('累计进度仅选择主线；单集和特殊章节明确选择', () => {
  assert.deepEqual(planEpisodeTargets('anime',episodes,true,{mode:'through',number:2}),[101,102]);
  assert.deepEqual(planEpisodeTargets('real',episodes,true,{mode:'single',number:2}),[102]);
  assert.deepEqual(planEpisodeTargets('anime',episodes,true,{mode:'explicit',episodeId:190}),[190]);
  assert.equal(episodes[0]?.status,null);
});
test('分页不完整、不存在集数和不支持的类型禁止生成更新清单', () => {
  assert.throws(() => planEpisodeTargets('anime',episodes,false,{mode:'through',number:2}),{code:'INCOMPLETE_EPISODES'});
  assert.throws(() => planEpisodeTargets('anime',episodes,true,{mode:'single',number:8}),{code:'EPISODE_AMBIGUOUS'});
  for(const type of ['book','music','game'] as const) assert.throws(() => planEpisodeTargets(type,episodes,true,{mode:'single',number:1}),{code:'UNSUPPORTED_PROGRESS'});
});
