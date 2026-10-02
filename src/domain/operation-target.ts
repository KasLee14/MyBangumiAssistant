import { AppError } from './errors.js';
import { mediaType, object, positiveId, type MediaType } from './bangumi.js';
import { referenceFrom, type Reference } from './dialogue-intent.js';

/** 对象类型属于参数契约；作品参数不能借角色、人物或目录的ID扩权。 */
export const subjectTargetSchema = {
  type: 'object', properties: {
    kind: { type: 'string', enum: ['subject'] },
    reference: { type: 'string', minLength: 1, maxLength: 300, description: '逐字取自真实输入的名称、链接、编号或指代；缺少对象时省略，不继承默认作品。' },
    subjectId: { type: 'integer', minimum: 1, description: '可选工具事实ID，宿主必须核对其与reference一致；不能用ID替代消歧。' },
    candidateSetId: { type: 'string', pattern: '^c[1-9]\\d*$', description: '编号所属的固定候选组；不授予权限。' },
    type: { type: 'string', enum: ['book', 'anime', 'music', 'game', 'real'] },
  }, required: ['kind'], additionalProperties: false,
};
export interface SubjectTarget {
  reference: Reference; candidateSetId?: string; type?: MediaType; subjectId?: number;
}
export function subjectTarget(value: unknown, source: string): SubjectTarget {
  const args = object(value, '操作对象');
  if (args.kind !== 'subject' || Object.keys(args).some(key => !['kind', 'reference', 'subjectId', 'candidateSetId', 'type'].includes(key))) {
    throw new AppError('INVALID_INPUT', '该操作只接受作品类型对象，角色、人物和目录须使用对应工具。');
  }
  if (args.reference !== undefined && (typeof args.reference !== 'string' || !args.reference.trim() || args.reference.length > 300 || !source.includes(args.reference))) {
    throw new AppError('INVALID_INPUT', '对象指代必须逐字来自本轮真实输入。');
  }
  if (args.candidateSetId !== undefined && (typeof args.candidateSetId !== 'string' || !/^c[1-9]\d*$/.test(args.candidateSetId))) throw new AppError('INVALID_INPUT', '候选组标识无效。');
  return { reference: referenceFrom(typeof args.reference === 'string' ? args.reference : ''),
    ...(args.candidateSetId === undefined ? {} : { candidateSetId: args.candidateSetId as string }),
    ...(args.type === undefined ? {} : { type: mediaType(args.type) }),
    ...(args.subjectId === undefined ? {} : { subjectId: positiveId(args.subjectId) }) };
}
