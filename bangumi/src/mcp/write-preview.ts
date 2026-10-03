import type { Data } from './resource-output.js';

export const WRITE_LABELS: Record<string, string> = {
  update_subject_collection: '修改作品收藏', update_single_episode_collection: '修改章节进度', update_episode_collection: '修改指定章节状态',
  collect_character: '收藏角色', uncollect_character: '取消角色收藏', collect_person: '收藏人物', uncollect_person: '取消人物收藏',
  create_index: '创建目录', update_index: '修改目录', add_subject_to_index: '向目录添加作品', update_index_subject: '修改目录作品',
  remove_subject_from_index: '从目录移除作品', collect_index: '收藏目录', uncollect_index: '取消目录收藏',
};
const fields: Record<string, string> = {
  title: '标题', description: '简介', private: '可见性', comment: '短评', order: '顺序', rating: '评分', tags: '标签',
  collection_type: '收藏状态', ep_status: '原生进度计数（动画为已看集数，书籍为章数）', vol_status: '卷数', collected: '是否收藏', episodes: '章节', protectedEpisodes: '保留状态的后续及特殊章节', parentCollection: '整部作品收藏',
  subject_id: '作品ID', episode_id: '章节ID', episode_type: '章节类型', index_id: '目录ID', ownerId: '所有者ID',
};
function shown(value: unknown, key = '', episode = false): string {
  if (key === 'protectedEpisodes' && Array.isArray(value)) return `${value.length}条，保留原状态`;
  if (key === 'private') return value ? '私密' : '公开';
  if (key === 'collection_type') {
    const labels = episode ? ['未收藏', '想看', '看过', '抛弃'] : ['', '想看', '看过', '在看', '搁置', '抛弃'];
    return `${labels[Number(value)] ?? '未知'}（${value}）`;
  }
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (value === null) return '无';
  if (value === '') return '无';
  if (Array.isArray(value)) return value.length ? value.map(item => shown(item, '', episode)).join('、') : '无';
  if (value && typeof value === 'object') return Object.entries(value).map(([name, item]) => `${fields[name] ?? name}：${shown(item, name, name === 'parentCollection' ? false : episode)}`).join('\n');
  // 远端名称/正文只作为文字显示，不能通过ANSI或控制字符改变确认界面。
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u009B]/gu, '�');
}
export interface WritePreviewItem { name: string; target: Data; before: unknown; after: unknown; effects: string[] }
export function formatWriteItem(item: WritePreviewItem, number?: number): string {
  const t = item.target;
  const indexId = t.indexId ?? (t.kind === 'index' ? t.id : undefined);
  const indexName = typeof indexId === 'number' && indexId < 0 ? `本批第${-indexId}步新建目录` : indexId === undefined ? '' : `目录 #${indexId}`;
  const entityId = t.subjectId ?? (t.kind !== 'index' ? t.id : undefined);
  const target = [indexName, t.title, t.name, entityId === undefined ? '' : `对象 #${entityId}`, t.episodeIds ? `章节ID：${shown(t.episodeIds)}` : ''].filter(Boolean).map(v => shown(v)).join(' · ');
  const episode = item.name.includes('episode_collection');
  const label = item.name === 'update_single_episode_collection' && t.batch === true ? '设置看到此集' : WRITE_LABELS[item.name] ?? item.name;
  return [`${number === undefined ? '' : `${number}. `}${label}${target ? `｜${target}` : ''}`,
    `修改前：\n${shown(item.before, '', episode)}`, `修改后：\n${shown(item.after, '', episode)}`,
    ...item.effects.map(effect => `说明：${shown(effect)}`)].join('\n');
}
export function formatWritePreview(account: Data, items: WritePreviewItem[], skipped = 0): string {
  const count = items.length - skipped;
  const groups = new Map<string, number>();
  for (const item of items) groups.set(item.name, (groups.get(item.name) ?? 0) + 1);
  return [`账户：${shown(account.username)}（#${account.id}）`, `完整范围：${items.length}项操作；需执行${count}项；无需修改${skipped}项`,
    `操作构成：${[...groups].map(([name, total]) => `${WRITE_LABELS[name] ?? name}${total}项`).join('、')}`,
    '授权仅用于以下完整清单。执行中取消、失败或结果未知将停止后续；已完成的修改不会自动撤销。',
    '', ...items.map((item, i) => formatWriteItem(item, i + 1))].join('\n\n');
}
