import type { DialogueTools } from '../tools/dialogue-tools.js';
import type { OperationPlan } from '../core/operations.js';
import type { CandidateSet } from '../core/candidates.js';
import type { Message } from '../core/types.js';
import type { SessionLog } from '../storage/session.js';
import { AppError, credentialValues, redact } from '../domain/errors.js';
import { decisionFrom, selectionCommand } from '../domain/dialogue-intent.js';
import { CandidateState } from '../core/candidates.js';
import { resultLines } from './ui/format.js';

const FIELD_LABELS: Record<string, string> = { status: '收藏状态', rate: '评分', tags: '标签', comment: '短评', private: '私密', chapters: '章数', volumes: '卷数' };
export function selectionDisplay(input: string, candidates: CandidateState): string {
  if (!selectionCommand(input)) return input;
  const probe = new CandidateState(); probe.restoreSnapshot(candidates.snapshot());
  try { probe.fromUser(input); return `/select ${probe.current()?.title ?? '待消歧的作品'}`; }
  catch { return '/select 无效的作品选择'; }
}
export function showCandidates(set: CandidateSet): string {
  return `\n[候选 ${set.id}]\n${set.items.length ? set.items.map((item, index) => `${index + 1}. #${item.id} ${item.title} (${item.type}) ${item.url}`).join('\n') : '没有候选。'}\n可以说“第一项”或作品名；只有一项时可说“这个”。快捷命令：/select ${set.id} <编号>\n`;
}
export function showPlan(plan: OperationPlan): string {
  const rows = plan.actions.map(action => {
    const changes = action.changes.map(change => `  ${FIELD_LABELS[change.field] ?? change.field}: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`);
    const effects = action.effects.map(change => `  附带影响 ${FIELD_LABELS[change.field] ?? change.field}: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`);
    return [`#${action.subjectId} ${action.title}`, ...changes, ...effects, ...(action.notice ? [action.notice] : [])].join('\n');
  });
  rows.push(...(plan.unchanged ?? []).map(item => `#${item.subjectId} ${item.title}：读取时已符合要求，无需改动。`));
  if (plan.results) return `\n[变更结果 ${plan.id}]\n${resultLines(plan.results, plan)}${plan.stopped ? `\n已停止：${plan.stopped}` : ''}\n`;
  return `\n[变更预览 ${plan.id}] 账户 #${plan.accountId}\n${rows.join('\n')}\n${plan.requiresConfirmation ? `需确认：${plan.reasons.join('；')}\n可以说“确认执行”或“取消”；快捷命令 /confirm ${plan.id} 或 /reject ${plan.id}` : '明确单项请求已绑定，权限就绪。'}\n${plan.writeAvailable ? '已接入网站写入；成功仅以回读验证为准。' : '此入口仅预览，确认也不会修改账户。'}\n`;
}

/** 仅消费终端用户消息；确认、拒绝和选择都不注册为模型工具。 */
export class DialogueCommands {
  private readonly displayed = new Map<string, string>();
  constructor(private readonly tools: DialogueTools, private readonly log: SessionLog) {}
  presented(plan: OperationPlan): void { this.displayed.clear(); this.displayed.set(plan.id, plan.digest); }
  canHandle(input: string, history: readonly Message[]): boolean {
    return input.trim().startsWith('/') || decisionFrom(input) !== null || this.tools.canHandleUser(input, history);
  }
  resetRequests(): void { this.displayed.clear(); this.tools.resetRequests(); }
  selectionContinuation(input: string, history: readonly Message[]): string | null { return this.tools.selectionContinuation(input, history); }
  async handle(input: string, history: readonly Message[], signal: AbortSignal): Promise<Message[] | null> {
    if (!input.trim() || input.length > 8000) throw new AppError('INVALID_INPUT', '输入须为1～8000字。');
    input = redact(input, credentialValues());
    const naturalDecision = decisionFrom(input);
    const naturalRequest = selectionCommand(input) !== null
      || this.tools.canHandleProgressGate(input)
      || !input.trim().startsWith('/') && !naturalDecision && this.tools.canHandleUser(input, history);
    if (!input.trim().startsWith('/') && !naturalDecision && !naturalRequest) return null;
    signal.throwIfAborted();
    await this.log.append('turn/start', {});
    await this.log.append('message', { role: 'user', content: input });
    let completed = false;
    try {
      let answer: string;
      if (naturalRequest) {
        const result = await this.tools.handleUser(input, history, signal);
        answer = typeof result === 'string' ? result : result.results ? `变更结果：\n${resultLines(result.results, result)}${result.stopped ? `；已停止：${result.stopped}` : ''}`
          : result.state === 'pending' ? '具体变更已展示，请说“确认执行”或“取消”。'
            : '明确请求已绑定；此入口只有预览能力，账户没有修改。';
      } else if (naturalDecision) {
        const active = [...this.displayed.keys()].filter(id => this.tools.operations.get(id).state === 'pending');
        if (naturalDecision.kind === 'reject') {
          for (const id of active) this.tools.operations.reject(id);
          this.tools.dialogue.clear(); this.tools.operations.invalidate(); this.displayed.clear();
          answer = '已取消未完成的修改，未发送新的写入请求。';
        } else if (active.length !== 1) {
          answer = '当前没有本次终端展示的唯一待确认预览，请重新说明需要修改什么。';
        } else {
          const id = active[0]!; const plan = this.tools.operations.get(id);
          if (naturalDecision.scope === 'delete' && !plan.actions.every(action => action.kind === 'delete')
            || naturalDecision.scope === 'clear' && !plan.actions.every(action => action.kind === 'progress' && plan.reasons.includes('清空进度'))
            || naturalDecision.scope === 'rollback' && !plan.actions.every(action => action.kind === 'progress' && (action.notice?.includes('"mode":"rollback"') || plan.reasons.includes('降低进度')))) {
            answer = '确认内容与当前预览不匹配，请核对具体变更后说“确认执行”或“取消”。';
          } else {
            this.tools.operations.confirm(id, this.displayed.get(id)!);
            const result = await this.tools.operations.execute(id, signal);
            this.tools.presentPlan(result.plan);
            answer = result.plan.writeAvailable ? `变更结果：\n${resultLines(result.results, result.plan)}${result.stopped ? `；后续操作已停止：${result.stopped}` : ''}` : '具体变更已确认；此入口只有预览能力，账户没有修改。';
            this.displayed.delete(id);
            const continuation = await this.tools.afterConfirmation(result.plan, signal);
            if (continuation) answer += `\n${typeof continuation === 'string' ? continuation : '原任务的完整变更已重新展示，请核对后确认。'}`;
          }
        }
      } else {
        const decision = /^\/(confirm|reject)\s+([a-f0-9-]{36})$/.exec(input.trim());
        if (decision) {
          const id = decision[2]!; const digest = this.displayed.get(id);
          if (!digest) throw new AppError('PLAN_UNAVAILABLE', '本次终端未展示此预览，恢复后需要重新生成并确认。');
          if (decision[1] === 'reject') { this.tools.operations.reject(id); answer = '已拒绝该变更，未执行任何写入。'; }
          else {
            this.tools.operations.confirm(id, digest);
            const result = await this.tools.operations.execute(id, signal);
            this.tools.presentPlan(result.plan);
            answer = result.plan.writeAvailable ? `变更结果：\n${resultLines(result.results, result.plan)}${result.stopped ? `；后续操作已停止：${result.stopped}` : ''}` : '具体变更已确认，权限就绪；此入口只有预览能力，账户没有修改。';
            this.displayed.delete(id);
            const continuation = await this.tools.afterConfirmation(result.plan, signal);
            if (continuation) answer += `\n${typeof continuation === 'string' ? continuation : '原任务的完整变更已重新展示，请核对后确认。'}`;
          }
          if (decision[1] === 'reject') { this.displayed.delete(id); this.tools.dialogue.clear(); }
        } else if (input.trim() === '/help') {
          answer = '可以说“第一项”“这个结果是对的，把它改成8分”“确认执行”“取消”。快捷命令：/select [清单ID] 编号、/confirm 预览ID、/reject 预览ID；/exit 退出。明确单项直接执行，复杂项需确认；未知结果先核对网站。';
        } else throw new AppError('INVALID_INPUT', '未知或不完整的对话命令，输入 /help 查看。');
      }
      const messages: Message[] = [{ role: 'user', content: input }, { role: 'assistant', content: redact(answer, credentialValues()) }];
      await this.log.append('message', messages[1]!);
      await this.log.append('turn/end', { status: 'completed' });
      completed = true;
      return [...history, ...messages];
    } finally {
      if (naturalRequest) this.tools.endTurn(completed);
      if (!completed) await this.log.append('turn/end', { status: signal.aborted ? 'cancelled' : 'failed' });
    }
  }
}
