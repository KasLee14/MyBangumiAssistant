import { isDeepStrictEqual } from 'node:util';
import type { Data } from './resource-output.js';

export interface WritePreviewItem { name: string; target: Data; before: unknown; after: unknown; effects: string[] }
interface PreviewNames { ids: Map<string, Set<number>>; newIndexes: Map<number, number> }
interface PreviewOperation { key: string; title(count: number): string; rows: string[]; note?: string }

const fields: Record<string, string> = {
  title: '标题', description: '简介', private: '可见性', comment: '短评', order: '排序位置', rating: '评分', tags: '标签',
  collection_type: '收藏状态', ep_status: '已读章数', vol_status: '已读卷数',
};
const subjectFields = ['collection_type', 'rating', 'tags', 'private', 'ep_status', 'vol_status', 'comment'];
const subjectStatuses: Record<number, string[]> = {
  1: ['未收藏', '想读', '读过', '在读', '搁置', '抛弃'],
  2: ['未收藏', '想看', '看过', '在看', '搁置', '抛弃'],
  3: ['未收藏', '想听', '听过', '在听', '搁置', '抛弃'],
  4: ['未收藏', '想玩', '玩过', '在玩', '搁置', '抛弃'],
  6: ['未收藏', '想看', '看过', '在看', '搁置', '抛弃'],
};
function data(value: unknown): Data { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Data : {}; }
function text(value: unknown): string {
  // 名称和正文均按纯文本显示，保留正文换行并清除终端控制字符。
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu, '�');
}
function line(value: unknown): string { return text(value).replace(/\s+/gu, ' ').trim(); }
function changed(before: Data, after: Data, keys: string[]): string[] { return keys.filter(key => !isDeepStrictEqual(before[key], after[key])); }
function value(key: string, raw: unknown, subjectType: unknown): string {
  if (key === 'private') return raw ? '私密' : '公开';
  if (key === 'collection_type') return (subjectStatuses[Number(subjectType)] ?? ['未收藏', '想收藏', '已完成', '进行中', '搁置', '抛弃'])[Number(raw)] ?? '未知状态';
  if (key === 'rating') return Number(raw) === 0 ? '未评分' : `${raw} 分`;
  if (key === 'ep_status') return `${raw} 章`;
  if (key === 'vol_status') return `${raw} 卷`;
  if (Array.isArray(raw)) return raw.length ? raw.map(line).join('、') : '无';
  return line(raw) || '无';
}
function details(keys: string[], before: Data, after: Data, subjectType?: unknown, creating = false): string[] {
  return keys.map(key => {
    const label = fields[key]!;
    if (key === 'comment' || key === 'description') {
      if (after[key] === '') return `清空${label}`;
      const action = creating || !before[key] ? label : `${label}（替换原文）`;
      return `${action}：\n    ${text(after[key]).replace(/\n/gu, '\n    ')}`;
    }
    if (key === 'tags' && Array.isArray(after.tags) && !after.tags.length && !creating) return '清空标签';
    const next = value(key, after[key], subjectType);
    return `${label}：${creating ? next : `${value(key, before[key], subjectType)} → ${next}`}`;
  });
}
function namesFor(items: WritePreviewItem[]): PreviewNames {
  const names: PreviewNames = { ids: new Map(), newIndexes: new Map() };
  const remember = (kind: string, name: unknown, id: unknown) => {
    if (!line(name) || typeof id !== 'number') return;
    const key = `${kind}:${line(name)}`;
    const ids = names.ids.get(key) ?? new Set<number>(); ids.add(id); names.ids.set(key, ids);
  };
  items.forEach((item, i) => {
    const t = item.target;
    if (t.kind === 'newIndex') {
      const id = -(i + 1);
      names.newIndexes.set(id, names.newIndexes.size + 1);
      remember('目录', data(item.after).title, id);
    }
    if (t.kind === 'index' || t.kind === 'indexSubject') remember('目录', t.title, t.indexId ?? t.id);
    if (t.kind === 'subject' || t.kind === 'episodes' || t.kind === 'indexSubject') remember('作品', t.name, t.subjectId ?? t.id);
    if (t.kind === 'character' || t.kind === 'person') remember(t.kind === 'character' ? '角色' : '人物', t.name, t.id);
  });
  return names;
}
function named(kind: string, name: unknown, id: unknown, names: PreviewNames): string {
  const title = line(name);
  if (!title) return typeof id === 'number' && id > 0 ? `${kind} #${id}` : kind;
  const duplicate = (names.ids.get(`${kind}:${title}`)?.size ?? 0) > 1;
  const suffix = duplicate && typeof id === 'number'
    ? id > 0 ? `（ID ${id}）` : `（新目录${names.newIndexes.get(id)}）` : '';
  return `《${title}》${suffix}`;
}
function subjectName(item: WritePreviewItem, names: PreviewNames): string { return named('作品', item.target.name, item.target.subjectId ?? item.target.id, names); }
function indexName(item: WritePreviewItem, names: PreviewNames): string {
  const id = item.target.indexId ?? item.target.id;
  const title = named('目录', item.target.title, id, names);
  return `${typeof id === 'number' && id < 0 ? '新目录' : '目录'}${title === '目录' || title.startsWith('目录 #') ? title.slice(2) : title}`;
}
function withDetails(target: string, changes: string[]): string {
  if (!changes.length) return target;
  return changes.length === 1 && !changes[0]!.includes('\n') ? `${target}：${changes[0]}` : `${target}：\n  ${changes.join('\n  ')}`;
}

/** 固定能力生成业务文案；完整校验快照仍由写入边界持有，不在授权卡展开。 */
function operation(item: WritePreviewItem, names: PreviewNames, step: number): PreviewOperation {
  const before = data(item.before); const after = data(item.after); const t = item.target;
  if (item.name === 'update_subject_collection') {
    const creating = item.before === null;
    const keys = creating ? subjectFields.filter(key => key === 'collection_type' || key === 'private'
      || (Array.isArray(after[key]) ? (after[key] as unknown[]).length > 0 : Boolean(after[key])))
      : changed(before, after, subjectFields);
    const subjectType = t.subjectType;
    const title = (count: number) => {
      const target = `以下 ${count} 部作品`;
      if (creating) return `收藏${target}`;
      if (keys.length === 1) {
        const key = keys[0]!;
        if (key === 'rating') return Number(after.rating) === 0 ? `取消${target}的评分` : `将${target}的评分改为 ${after.rating} 分`;
        if (key === 'collection_type') return `将${target}的收藏状态改为${value(key, after[key], subjectType)}`;
        if (key === 'private') return `将${target}的收藏设为${value(key, after[key], subjectType)}`;
        if (key === 'comment') return `${after.comment === '' ? '清空' : before.comment ? '修改' : '发布'}${target}的短评`;
        if (key === 'tags' && Array.isArray(after.tags) && !after.tags.length) return `清空${target}的标签`;
      }
      return `修改${target}的${keys.map(key => fields[key]).join('、')}`;
    };
    return { key: JSON.stringify([item.name, creating, keys.includes('collection_type') ? subjectType : null,
      keys.includes('comment') ? Boolean(before.comment) : null, keys.map(key => [key, after[key]])]), title,
      rows: [withDetails(subjectName(item, names), details(keys, before, after, subjectType, creating))] };
  }
  if (item.name === 'update_single_episode_collection' || item.name === 'update_episode_collection') {
    const statuses = ['未看', '想看', '看过', '抛弃'];
    const episodes = Array.isArray(after.episodes) ? after.episodes.map(data) : [];
    const groups = new Map<number, number[]>();
    for (const episode of episodes) {
      const status = Number(episode.collection_type); const ids = groups.get(status) ?? [];
      ids.push(Number(episode.episode_id)); groups.set(status, ids);
    }
    const target = subjectName(item, names);
    const label = t.batch === true ? `将${target}看到指定章节` : `修改${target}的指定章节状态`;
    return { key: JSON.stringify([item.name, t.subjectId, step]), title: () => label,
      rows: [...groups].map(([status, ids]) => `章节 ${ids.map(id => `#${id}`).join('、')}：标记为${statuses[status] ?? '未知状态'}`),
      ...(t.batch === true ? { note: '范围内原已看过的章节，观看时间可能更新。' } : {}) };
  }
  if (/^(collect|uncollect)_(character|person)$/.test(item.name)) {
    const kind = t.kind === 'character' ? '角色' : '人物'; const action = after.collected ? '收藏' : '取消收藏';
    return { key: `${item.name}`, title: count => `${action}以下 ${count} 个${kind}`, rows: [named(kind, t.name, t.id, names)] };
  }
  if (item.name === 'create_index') {
    const title = named('目录', after.title, -step, names); const visibility = after.private ? '私密' : '公开';
    return { key: `${item.name}:${step}`, title: () => `创建${visibility}目录${title}`,
      rows: [withDetails(`${visibility}目录${title}`, after.description ? details(['description'], {}, after, undefined, true) : [])] };
  }
  const target = indexName(item, names);
  if (item.name === 'collect_index' || item.name === 'uncollect_index') {
    return { key: item.name, title: count => `${after.collected ? '收藏' : '取消收藏'}以下 ${count} 个目录`, rows: [target] };
  }
  if (item.name === 'update_index') {
    const keys = changed(before, after, ['title', 'description', 'private']);
    return { key: `${item.name}:${step}`, title: () => keys.length === 1 && keys[0] === 'private' ? `将${target}设为${value('private', after.private, undefined)}`
      : `修改${target}的${keys.map(key => fields[key]).join('、')}`, rows: [withDetails(target, details(keys, before, after))] };
  }
  if (item.name === 'add_subject_to_index') {
    const keys = ['comment', 'order'].filter(key => key === 'order' ? after[key] !== undefined : Boolean(after[key]));
    return { key: JSON.stringify([item.name, t.indexId]), title: count => `向${target}添加以下 ${count} 部作品`,
      rows: [withDetails(subjectName(item, names), details(keys, {}, after, undefined, true))] };
  }
  if (item.name === 'remove_subject_from_index') {
    return { key: `${item.name}:${t.indexId}`, title: count => `从${target}移除以下 ${count} 部作品`, rows: [subjectName(item, names)],
      note: '同时移除这些作品在目录中的短评和排序。' };
  }
  if (item.name === 'update_index_subject') {
    const keys = changed(before, after, ['comment', 'order']);
    return { key: JSON.stringify([item.name, t.indexId, keys.map(key => [key, after[key]])]), title: count => `修改${target}中以下 ${count} 部作品的${keys.map(key => `目录${fields[key]}`).join('、')}`,
      rows: [withDetails(subjectName(item, names), details(keys, before, after))] };
  }
  throw new Error('写操作缺少授权说明，未提交修改。');
}
function unchangedTarget(item: WritePreviewItem, names: PreviewNames): string {
  if (item.target.kind === 'indexSubject') return `${subjectName(item, names)}（${indexName(item, names)}）`;
  if (item.target.kind === 'index') return indexName(item, names);
  if (item.target.kind === 'character' || item.target.kind === 'person') return named(item.target.kind === 'character' ? '角色' : '人物', item.target.name, item.target.id, names);
  return subjectName(item, names);
}
export function formatWriteItem(item: WritePreviewItem, number?: number): string {
  const preview = operation(item, namesFor([item]), number ?? 1);
  return [preview.title(1), ...preview.rows.map(row => `• ${row}`), preview.note].filter(Boolean).join('\n');
}
export function formatWritePreview(account: Data, items: WritePreviewItem[]): string {
  const names = namesFor(items); const skipped: string[] = [];
  const groups: { operation: PreviewOperation; count: number }[] = [];
  items.forEach((item, i) => {
    if (isDeepStrictEqual(item.before, item.after)) { skipped.push(unchangedTarget(item, names)); return; }
    const preview = operation(item, names, i + 1); const previous = groups.at(-1);
    // 仅合并相邻可共用动作摘要的操作；逐项明细保留排序、正文与原计划先后关系。
    if (previous?.operation.key === preview.key) { previous.operation.rows.push(...preview.rows); previous.count++; }
    else groups.push({ operation: preview, count: 1 });
  });
  const summary = groups.length === 1 ? `需要${groups[0]!.operation.title(groups[0]!.count)}。`
    : `需要进行以下操作：${groups.map(group => group.operation.title(group.count)).join('；')}。`;
  const scope = groups.map(group => [groups.length > 1 ? `${group.operation.title(group.count)}：` : '',
    ...group.operation.rows.map(row => `• ${row}`), group.operation.note].filter(Boolean).join('\n')).join('\n\n');
  return [groups.length ? summary : '本次操作范围内的内容均无需修改。', `使用账户：${line(account.username) || `账户 #${account.id}`}`,
    groups.length ? `操作范围：\n${scope}` : '', skipped.length ? `以下内容无需修改，将跳过：\n${skipped.map(target => `• ${target}`).join('\n')}` : '',
    groups.length ? '请确认是否授权本次操作。' : ''].filter(Boolean).join('\n\n');
}
