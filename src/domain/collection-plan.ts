import { AppError } from './errors.js';
import type { Collection, Subject, Episode } from './bangumi.js';
import type { ChangeValue, PlannedAction, FieldChange } from './permissions.js';

export function collectionPatch(value: unknown): Record<string, ChangeValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('INVALID_INPUT', '修改字段应为对象。');
  const patch = value as Record<string, unknown>; const keys = Object.keys(patch);
  if (!keys.length || keys.some(key => !['status', 'rate', 'tags', 'comment', 'private'].includes(key) || patch[key] === undefined)) throw new AppError('INVALID_INPUT', '只允许收藏状态、评分、标签、最终短评和可见性字段，字段值不得缺失。');
  if (patch.status !== undefined && (typeof patch.status !== 'number' || !Number.isInteger(patch.status) || patch.status < 1 || patch.status > 5)) throw new AppError('INVALID_INPUT', '收藏状态须为1～5。');
  if (patch.rate !== undefined && (typeof patch.rate !== 'number' || !Number.isInteger(patch.rate) || patch.rate < 0 || patch.rate > 10)) throw new AppError('INVALID_INPUT', '评分须为0～10的整数。');
  if (patch.private !== undefined && typeof patch.private !== 'boolean') throw new AppError('INVALID_INPUT', '可见性 private 须为布尔值。');
  if (patch.comment !== undefined && (typeof patch.comment !== 'string' || patch.comment.normalize('NFC').length > 380)) throw new AppError('INVALID_INPUT', '最终短评须为不超过380字的文本。');
  if (typeof patch.comment === 'string') patch.comment = patch.comment.normalize('NFC');
  if (patch.tags !== undefined && (!Array.isArray(patch.tags) || patch.tags.length > 40 || patch.tags.some(tag => typeof tag !== 'string' || !tag.trim() || /\s/u.test(tag) || tag.length > 100)
    || new Set(patch.tags).size !== patch.tags.length)) throw new AppError('INVALID_INPUT', '标签须为最多40项的不重复文本数组，每项1～100字且不包含空白。');
  return structuredClone(patch) as Record<string, ChangeValue>;
}

export function collectionAction(subject: Subject, current: Collection, patchValue: unknown): PlannedAction {
  const patch = collectionPatch(patchValue);
  if (current.subjectId !== subject.id || current.status === null) throw new AppError('INCOMPLETE_COLLECTION', '无法确认该条目的现有收藏，不生成写入预览。');
  const nextStatus = patch.status ?? current.status;
  if (nextStatus === 1 && current.rate === null) throw new AppError('INCOMPLETE_COLLECTION', '现有评分未知，无法完整展示想看状态可能造成的附带影响。');
  if (nextStatus === 1 && typeof patch.rate === 'number' && patch.rate > 0) throw new AppError('UNSUPPORTED_RATING', 'bgm-cli 的想看状态会将评分设为0；请明确其他收藏状态后再评分。');
  const changes = Object.entries(patch).sort(([a], [b]) => a.localeCompare(b)).flatMap(([field, after]) => {
    const before = current[field as keyof Collection] as ChangeValue;
    return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ field, before: structuredClone(before), after: structuredClone(after) }];
  });
  if (!changes.length) throw new AppError('NO_CHANGE', '当前值已与请求一致，无需修改。');
  const effects: FieldChange[] = nextStatus === 1 && !Object.hasOwn(patch, 'rate') && current.rate !== null && current.rate !== 0
    ? [{ field: 'rate', before: current.rate, after: 0 }] : [];
  if (!Object.hasOwn(patch, 'comment') && current.comment !== current.comment.normalize('NFC')) {
    effects.push({ field: 'comment', before: current.comment, after: current.comment.normalize('NFC') });
  }
  return { subjectId: subject.id, title: subject.nameCn || subject.name, kind: 'collection', changes, effects };
}

export function collectionWriteAction(subject: Subject, current: Collection | null, patchValue: unknown): PlannedAction {
  const patch = collectionPatch(patchValue);
  if (current) return { ...collectionAction(subject, current, patch), baseline: { type: subject.type, collection: structuredClone(current) } };
  if (typeof patch.status !== 'number') throw new AppError('COLLECTION_REQUIRED', '此条目尚未收藏，请先明确选择收藏状态；不默认创建。');
  if (patch.status === 1 && typeof patch.rate === 'number' && patch.rate > 0) throw new AppError('UNSUPPORTED_RATING', '想看状态不能设置正评分。');
  return { subjectId: subject.id, title: subject.nameCn || subject.name, kind: 'collection',
    changes: Object.entries(patch).map(([field, after]) => ({ field, before: null, after })), effects: [],
    baseline: { type: subject.type, collection: null }, notice: '新建收藏：未指定字段使用网站默认值（评分0、空标签/短评、公开、进度0），不自动完成进度。' };
}
/** 保留旧计划形状供拒绝/兼容检查；当前宿主与执行器均禁止条目取消收藏。 */
export function deleteCollectionAction(subject:Subject,current:Collection|null,episodes?:Episode[]):PlannedAction {
  if(!current) throw new AppError('NO_CHANGE','此条目未收藏，无需删除。');
  if(current.subjectId !== subject.id || current.status === null) throw new AppError('INCOMPLETE_COLLECTION','不能核实完整收藏，不生成删除计划。');
  return {subjectId:subject.id,title:subject.nameCn||subject.name,kind:'delete',
    changes:['status','rate','tags','comment','private','chapters','volumes'].map(field=>({field,before:structuredClone(current[field as keyof Collection]) as ChangeValue,after:null})),effects:[],
    baseline:{type:subject.type,collection:structuredClone(current),...(episodes ? {episodes:structuredClone(episodes)} : {})},
    notice:'将移除整个个人条目收藏及以上字段；关联章节可能受网站级联处理影响，删除后独立核查；不额外清空章节、不自动恢复。所有删除必须确认。'};
}
