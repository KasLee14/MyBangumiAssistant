import { AppError } from './errors.js';
import { mutationFrom } from './dialogue-intent.js';

export type ScopeKind = 'in_scope' | 'out_of_scope' | 'unsupported' | 'clarify' | 'mixed';
export type ScopeReason = 'bangumi' | 'general_task' | 'community' | 'scheduling' | 'custom_progress' | 'cross_account' | 'missing_capability' | 'missing_history' | 'unsupported_progress' | 'collection_deletion' | 'unclear';
export interface ScopeDecision {
  kind: ScopeKind; reason: ScopeReason; goal: string; allowedParts: string[];
}
export interface BoundaryRecord {
  code: 'IN_SCOPE' | 'OUT_OF_SCOPE' | 'UNSUPPORTED_CAPABILITY' | 'CLARIFICATION_REQUIRED' | 'MIXED_SCOPE' | 'BOUNDARY_UNAVAILABLE';
  /** 只供宿主恢复上下文；不发送为 provider 的消息字段，也不构成写入授权。 */
  modelInput: string | null;
}
export const SCOPE_REFUSAL = '我只处理 Bangumi 作品查询、比较、收藏、原生进度、动画推荐及相关使用问题，无法处理独立的数学解题、编程、办公或其他无关任务。';
export const SCOPE_CLARIFICATION = '请说明你希望查询哪部作品，或处理什么 Bangumi 收藏、进度、推荐或使用问题。';
export const BOUNDARY_UNAVAILABLE = '暂时无法判断这个请求是否属于 Bangumi 助手的范围，请重述具体的作品或操作；本轮未调用业务工具。';
export const CAPABILITY_NOTICE = '这个请求属于 Bangumi 助手的范围，但当前工具尚不能完整完成。当前可查询具体作品、现存收藏列表与统计、单项收藏及原生进度，或基于已查到的资料提供建议；我不能承诺完成工具尚未支持的部分。';
export function capabilityReply(reason: ScopeReason): string {
  if (reason === 'collection_deletion') return '条目取消收藏暂未开放，请在 Bangumi 网站操作；不能用搁置或抛弃替代取消收藏。';
  if (reason === 'missing_history') return '当前可读取和统计现存收藏，但没有包含已删除记录的完整观看历史或长期偏好读取工具；可以基于当前收藏或你提供的作品查询并尝试推荐。';
  if (reason === 'unsupported_progress') return '音乐和游戏当前不支持细粒度原生进度写入；可以管理条目收藏状态，不能用短评或标签模拟进度。';
  return CAPABILITY_NOTICE;
}

export function scopeReply(reason: ScopeReason): string {
  switch (reason) {
    case 'community': return '当前助手不提供讨论区发帖、回复、日志、动态或通知等社区功能；可以查询作品及管理个人收藏。';
    case 'scheduling': return '当前助手不提供定时任务或提醒；可以在当前对话中查询作品及管理个人收藏。';
    case 'custom_progress': return '当前助手只处理网站原生进度，不记录游戏游玩时长、路线或自定义完成百分比；可以管理条目收藏状态。';
    case 'cross_account': return '当前助手只处理本机当前账户，不提供跨账户操作。';
    default: return SCOPE_REFUSAL;
  }
}

/** 仅匹配少量完整命令；作品名、引述或混合请求交给上下文/语义判断。 */
export function localScope(input: string): ScopeDecision | null {
  if (mutationFrom(input)?.mutation?.kind === 'delete') return { kind: 'unsupported', reason: 'collection_deletion', goal: '条目取消收藏暂未开放，请在 Bangumi 网站操作', allowedParts: [] };
  const text = input.trim().replace(/[。！!？?]$/, '');
  if (/^(?:请)?(?:帮我|给我)?(?:算(?:一下)?|解(?:一下)?|解答(?:一下)?)(?:一道|这道|这个)?数学题$/.test(text)) {
    return { kind: 'out_of_scope', reason: 'general_task', goal: '独立数学解题', allowedParts: [] };
  }
  if (/^(?:你好|您好|嗨|谢谢|谢谢你|多谢|再见|hello|hi)$/i.test(text)) {
    return { kind: 'in_scope', reason: 'bangumi', goal: '简短礼貌交互', allowedParts: [] };
  }
  return null;
}

/** 分类结果不是授权。混合任务只接受原文中的有序、不重叠片段，禁止改写或新增任务。 */
export function parseScope(content: string, input: string): ScopeDecision {
  const value: unknown = JSON.parse(content);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('INVALID_SCOPE', '边界分类格式无效。');
  const item = value as Record<string, unknown>;
  const kinds: ScopeKind[] = ['in_scope', 'out_of_scope', 'unsupported', 'clarify', 'mixed'];
  const reasons: ScopeReason[] = ['bangumi', 'general_task', 'community', 'scheduling', 'custom_progress', 'cross_account', 'missing_capability', 'missing_history', 'unsupported_progress', 'collection_deletion', 'unclear'];
  if (Object.keys(item).length !== 4 || Object.keys(item).some(key => !['kind', 'reason', 'goal', 'allowedParts'].includes(key))
    || !kinds.includes(item.kind as ScopeKind) || !reasons.includes(item.reason as ScopeReason)
    || typeof item.goal !== 'string' || !item.goal.trim() || item.goal.length > 300
    || !Array.isArray(item.allowedParts) || item.allowedParts.length > 8) throw new AppError('INVALID_SCOPE', '边界分类字段无效。');
  const result = item as unknown as ScopeDecision;
  if (result.kind === 'in_scope' && result.reason !== 'bangumi'
    || result.kind === 'unsupported' && !['missing_capability', 'missing_history', 'unsupported_progress', 'collection_deletion'].includes(result.reason)
    || result.kind === 'clarify' && result.reason !== 'unclear'
    || result.kind === 'out_of_scope' && !['general_task', 'community', 'scheduling', 'custom_progress', 'cross_account'].includes(result.reason)
    || result.kind === 'mixed' && !['general_task', 'community', 'scheduling', 'custom_progress', 'cross_account', 'missing_capability', 'missing_history', 'unsupported_progress', 'collection_deletion'].includes(result.reason)) {
    throw new AppError('INVALID_SCOPE', '边界分类类别与原因不匹配。');
  }
  if (result.kind !== 'mixed' && result.allowedParts.length || result.kind === 'mixed' && !result.allowedParts.length) throw new AppError('INVALID_SCOPE', '混合任务片段无效。');
  let end = 0;
  for (const part of result.allowedParts) {
    if (typeof part !== 'string' || !part.trim() || part.length >= input.length) throw new AppError('INVALID_SCOPE', '任务片段不是有效原文。');
    const start = input.indexOf(part, end);
    if (start < 0) throw new AppError('INVALID_SCOPE', '任务片段必须逐字来自用户原文且不重叠。');
    end = start + part.length;
  }
  return result;
}
