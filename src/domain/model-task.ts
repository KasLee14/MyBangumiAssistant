import { AppError } from './errors.js';
import { object, mediaType, type MediaType } from './bangumi.js';

/** 模型描述的读取目标只用于消歧与续接，不是工具、账户或写入授权。 */
export interface ReadTask {
  kind: 'read'; sourceText: string; goal: string; mode: 'single' | 'compare' | 'browse';
  targetName?: string; type?: MediaType; requestedFields: string[];
}
export const readTaskSchema = {
  type: 'object', properties: {
    kind: { type: 'string', enum: ['read'] },
    sourceText: { type: 'string', minLength: 1, maxLength: 8000, description: '逐字等于本轮真实用户原文；选择续接时可使用宿主保存的原读取原文。' },
    goal: { type: 'string', minLength: 1, maxLength: 500, description: '完整保留查询目的、范围及条件，不提供执行代码或修改授权。' },
    mode: { type: 'string', enum: ['single', 'compare', 'browse'], description: '单作品查询、比较或浏览；比较/浏览不绑定唯一作品。' },
    targetName: { type: 'string', minLength: 1, maxLength: 300, description: '原文中的完整作品名，保留季度；无需解析中文句式。' },
    type: { type: 'string', enum: ['book', 'anime', 'music', 'game', 'real'] },
    requestedFields: { type: 'array', maxItems: 20, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 80 }, description: '查询所需字段，如score、ratingCount、个人rate；复杂条件同时保留在goal。' },
  }, required: ['kind', 'sourceText', 'goal', 'mode'], additionalProperties: false,
};
export function readTaskFrom(value: unknown, sourceText: string): ReadTask {
  const args = object(value, '读取任务');
  if (Object.keys(args).some(key => !['kind', 'sourceText', 'goal', 'mode', 'targetName', 'type', 'requestedFields'].includes(key))
    || args.kind !== 'read' || args.sourceText !== sourceText || !['single', 'compare', 'browse'].includes(String(args.mode))
    || typeof args.goal !== 'string' || !args.goal.trim() || args.goal.length > 500) throw new AppError('INVALID_INPUT', '读取任务必须绑定真实原文及已声明字段，不能提供写入授权或执行代码。');
  if (args.targetName !== undefined && (typeof args.targetName !== 'string' || !args.targetName.trim() || args.targetName.length > 300
    || !sourceText.normalize('NFKC').replace(/\s/g, '').includes(args.targetName.normalize('NFKC').replace(/\s/g, '')))) throw new AppError('INVALID_INPUT', '作品名称必须来自宿主持有的真实任务原文，不能自行改写对象。');
  const fields = args.requestedFields ?? [];
  if (!Array.isArray(fields) || fields.length > 20 || fields.some(field => typeof field !== 'string' || !field.trim() || field.length > 80)
    || new Set(fields).size !== fields.length) throw new AppError('INVALID_INPUT', '查询字段必须是有界且不重复的字符串清单。');
  return { kind: 'read', sourceText, goal: args.goal.trim(), mode: args.mode as ReadTask['mode'], requestedFields: fields,
    ...(args.targetName === undefined ? {} : { targetName: args.targetName as string }), ...(args.type === undefined ? {} : { type: mediaType(args.type) }) };
}
