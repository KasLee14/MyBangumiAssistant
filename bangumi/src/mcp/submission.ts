import { AppError, type SubmissionReceipt, type SubmissionItem } from '../support/errors.js';
import { type Data, record, positive } from './resource-output.js';

/** 仅记录固定写入流程的调用阶段，不授予权限，也不重试。 */
export class SubmissionTracker {
  private readonly receipt: SubmissionReceipt;
  constructor(private readonly name: string, private readonly args: Data, accountId: number, parent?: number) {
    const role = name.endsWith('_character') ? 'character' : 'person';
    const target: Data | null = name === 'create_index' ? null : name === 'update_subject_collection' || name === 'update_episode_collection' ? { kind: 'subject', id: args.subject_id }
      : name === 'update_single_episode_collection' ? parent ? { kind: 'episode', id: args.episode_id, subjectId: parent } : null
      : /^(collect|uncollect)_(character|person)$/.test(name) ? { kind: role, id: args[`${role}_id`] }
      : ['add_subject_to_index','update_index_subject','remove_subject_from_index'].includes(name) ? { kind: 'indexSubject', indexId: args.index_id, subjectId: args.subject_id, relationId: null }
      : { kind: 'index', id: args.index_id };
    const stages = name === 'update_subject_collection' ? [
      ...(['collection_type','rating','comment','tags','private'].some(key => Object.hasOwn(args,key)) ? ['subject_collection'] : []),
      ...(['ep_status','vol_status'].some(key => Object.hasOwn(args,key)) ? ['book_progress'] : [])]
      : name.includes('episode_collection') ? ['episode_collection'] : /^(collect|uncollect)_(character|person)$/.test(name) ? ['entity_collection']
      : name === 'create_index' ? ['index_create'] : name === 'update_index' ? ['index_update'] : name === 'add_subject_to_index' ? ['index_subject_add']
      : name === 'update_index_subject' ? ['index_subject_update'] : name === 'remove_subject_from_index' ? ['index_subject_remove'] : ['index_collection'];
    const items: SubmissionItem[] = name === 'update_episode_collection' ? (args.episode_ids as number[]).map(id => ({ target: { kind: 'episode', id, subjectId: args.subject_id }, stage: 'episode_collection', submissionState: 'not_attempted' }))
      : stages.map(stage => ({ target: structuredClone(target), stage, submissionState: 'not_attempted' }));
    const fields = name === 'update_subject_collection' ? ['collection_type','rating','comment','tags','private','ep_status','vol_status'] : name.includes('episode_collection') ? ['collection_type'] : ['title','description','private','comment','order'];
    this.receipt = { schemaVersion: 1, kind: 'submission', tool: name, expectedAccountId: accountId, target, submissionState: 'not_attempted', verification: 'pending', items,
      requestedFields: /^(collect|uncollect)_/.test(name) ? ['collected'] : name === 'remove_subject_from_index' ? ['membership'] : [
        ...(name === 'add_subject_to_index' ? ['membership'] : []), ...fields.filter(key => Object.hasOwn(args,key))],
      createdId: null, relatedId: null, requestedCollected: /^(collect|uncollect)_/.test(name) ? name.startsWith('collect_') : null,
      requestedEpisodeStatus: name.includes('episode_collection') ? Number(args.collection_type) : null };
  }
  parent(id: number, subjectId: number): void {
    const target = { kind: 'episode', id, subjectId };
    for (const item of this.receipt.items) if (this.name === 'update_single_episode_collection' || item.target?.id === id) item.target = target;
    if (this.name === 'update_single_episode_collection') this.receipt.target = target;
  }
  related(id: number): void {
    this.receipt.relatedId = positive(id);
    if (this.receipt.target?.kind === 'indexSubject') this.receipt.target.relationId = id;
    for (const item of this.receipt.items) if (item.target?.kind === 'indexSubject') item.target.relationId = id;
  }
  async submit(path: string, method: string, execute: () => Promise<unknown>): Promise<unknown> {
    const stage = this.name === 'update_subject_collection' ? method === 'PUT' ? 'subject_collection' : 'book_progress' : this.receipt.items[0]!.stage;
    const id = Number(path.split('/').at(-1));
    const item = this.receipt.items.find(item => item.stage === stage && item.submissionState === 'not_attempted' && (this.name !== 'update_episode_collection' || item.target?.id === id));
    if (!item) throw new AppError('MCP_INVALID_RESULT', '写入阶段与固定计划不一致。');
    item.submissionState = 'unknown';
    const value = await execute(); item.submissionState = 'acknowledged'; return value;
  }
  finish(value: unknown): SubmissionReceipt {
    if (this.name === 'create_index') {
      this.receipt.createdId = positive(record(value).id); const target = { kind: 'index', id: this.receipt.createdId };
      this.receipt.target = target; this.receipt.items[0]!.target = target;
    }
    if (['add_subject_to_index','update_index_subject','remove_subject_from_index'].includes(this.name)) this.related(positive(record(value).id));
    if (!this.receipt.target || this.receipt.items.some(item => item.submissionState !== 'acknowledged')) throw new AppError('MCP_INVALID_RESULT', '提交回执不完整。');
    this.receipt.submissionState = 'acknowledged'; return structuredClone(this.receipt);
  }
  failed(): SubmissionReceipt {
    const acknowledged = this.receipt.items.filter(item => item.submissionState === 'acknowledged').length;
    this.receipt.submissionState = this.receipt.items.every(item => item.submissionState === 'not_attempted') ? 'not_attempted'
      : acknowledged > 0 && acknowledged < this.receipt.items.length ? 'partial' : 'unknown';
    return structuredClone(this.receipt);
  }
}

/** 每份回执绑定原调用与宿主专用guard；服务输出不是新授权。 */
export function checkSubmission(name: string, value: unknown, args: Data, accountId: number, parent?: number): void {
  const receipt = record(value);
  if (receipt.tool !== name || receipt.expectedAccountId !== accountId || receipt.verification !== 'pending') throw new AppError('MCP_INVALID_RESULT', '提交回执与原工具或账户不一致。');
  const target = receipt.target == null ? null : record(receipt.target);
  const ids = name === 'update_episode_collection' ? args.episode_ids as number[] : name === 'update_single_episode_collection' ? [Number(args.episode_id)] : undefined;
  if (name === 'update_subject_collection' || name === 'update_episode_collection') { if (target?.id !== args.subject_id) throw new AppError('MCP_INVALID_RESULT', '提交作品对象不一致。'); }
  else if (name === 'create_index') { if (receipt.submissionState === 'acknowledged' && (target?.id !== receipt.createdId || typeof receipt.createdId !== 'number')) throw new AppError('MCP_INVALID_RESULT', '创建回执缺少真实ID。'); }
  else if (name.endsWith('_character') || name.endsWith('_person')) { const kind = name.endsWith('_character') ? 'character' : 'person'; if (target?.id !== args[`${kind}_id`]) throw new AppError('MCP_INVALID_RESULT', '提交实体对象不一致。'); }
  else if (name !== 'update_single_episode_collection') {
    if (target?.kind === 'indexSubject' ? target.indexId !== args.index_id || target.subjectId !== args.subject_id : target?.id !== args.index_id) throw new AppError('MCP_INVALID_RESULT', '提交目录对象不一致。');
  }
  const items = receipt.items as SubmissionItem[];
  if (ids) {
    if (items.length !== ids.length || items.some((item,index) => item.target !== null && (item.target.id !== ids[index] || args.subject_id !== undefined && item.target.subjectId !== args.subject_id))
      || receipt.requestedEpisodeStatus !== args.collection_type) throw new AppError('MCP_INVALID_RESULT', '逐章节回执与请求不一致。');
    if (name === 'update_single_episode_collection' && target !== null && (target.id !== args.episode_id || parent !== undefined && target.subjectId !== parent)) throw new AppError('MCP_INVALID_RESULT', '单章节回执与原绑定不一致。');
  }
  if (receipt.relatedId !== null && target?.kind === 'indexSubject' && target.relationId !== receipt.relatedId) throw new AppError('MCP_INVALID_RESULT', '目录关系回执ID不一致。');
  const expected = new SubmissionTracker(name,args,accountId,parent).failed();
  if (JSON.stringify(receipt.requestedFields) !== JSON.stringify(expected.requestedFields) || receipt.requestedCollected !== expected.requestedCollected
    || items.length !== expected.items.length || items.some((item,index) => item.stage !== expected.items[index]!.stage)) throw new AppError('MCP_INVALID_RESULT', '提交阶段或字段与请求不一致。');
}
