import { ContentOutputError } from './content-schema.js';
import { COMPONENT_KINDS, type ComponentKind } from './content-types.js';

export type ComponentType = ComponentKind;

/** 默认展示选择由模型执行；组件参数仍只依据已取得的事实填写。 */
export const COMPONENT_SELECTION_INSTRUCTION = `展示类型按内容选择：
作品搜索和推荐结果默认用 SubjectCards 承载作品主体；用户明确要求表格时使用DataTable。跨书籍、动画、音乐、游戏、三次元使用条目真实 kind。
已明确组件名时通过read_component_spec直接加载；其他事实列表、统计、进度、人物图片、事件、标签、引用及链接按索引用途发现。只按下一请求实际声明的render参数调用，DataTable用columns声明所需列。
纯解释、澄清及资料不足用原生文字；组件旁的正式说明放render的before/after。多份已有缓存用sources表达顺序，全部任务完成才在最后render提交final；用户明确要求纯文本、代码或原始数据时尊重要求。
同一份数据仅在一个组件内展示，不再重复为 Markdown 列表或表格。没有相应事实时不为了凑组件补造 ID、图片、评分或其他字段。
列表筛选条件、排序依据、Archive快照时间和数据覆盖缺口如实说明。模型只提供资源引用、成员和展示意图，宿主从同一快照补齐事实；没有图片时正常无图展示，不要求账户或补采。`;

const componentTypes: ReadonlySet<string> = new Set(COMPONENT_KINDS);

/**
 * 完整载荷校验后，上层已明确指定组件时的完成检查。不猜测用户意图，不把文字强制转换为组件。
 * pending:true 仍是占位，只有 pending:false 的有效完成组件可满足要求。
 */
export function validateRequiredComponents<T extends { content: readonly { type: string; pending?: boolean }[] }>(
  answer: T, requiredTypes: readonly ComponentType[],
): T {
  const required = [...new Set(requiredTypes)];
  const unknown = required.filter(type => !componentTypes.has(type));
  if (unknown.length) throw new ContentOutputError(`未知的必要组件类型：${unknown.join('、')}`, 'schema');
  const completed = new Set(answer.content.filter(part => part.pending === false).map(part => part.type));
  const missing = required.filter(type => !completed.has(type));
  if (missing.length) throw new ContentOutputError(`最终结果缺少已完成的必要组件：${missing.join('、')}`, 'schema',
    missing.map(type => `content 必须包含 pending:false 的 ${type}`));
  return answer;
}
