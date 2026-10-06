import { ContentOutputError } from './content-schema.js';
import { COMPONENT_KINDS, type ComponentKind } from './content-types.js';

export type ComponentType = ComponentKind;

/** 默认展示选择由模型执行；组件参数仍只依据已取得的事实填写。 */
export const COMPONENT_SELECTION_INSTRUCTION = `展示类型按内容选择：
作品搜索、推荐结果及收藏作品列表，默认用 SubjectCards 承载作品主体，不能仅生成 Markdown 列表或表格；跨书籍、动画、音乐、游戏、三次元使用条目真实 kind。
多列事实列表、季度计数及其他行列数据用 DataTable；评分、数量分布和指标汇总用 StatsCard；单对象键值信息用 InfoBox；观看进度及章节状态用 ProgressView。
简单人物或角色候选及图片列表用 Gallery；事件顺序用 Timeline；标签用 TagCloud；前后变化用 CompareTable；引用用 QuoteBlock；提示与结果状态用 Callout；链接集合用 LinkList。
解释、澄清、推荐理由及资料不足的说明用 text。多个文本段与组件可以按阅读顺序交错；用户明确要求纯文本、代码或原始数据时尊重要求。
同一份数据仅在一个组件内展示，不再重复为 Markdown 列表或表格。没有相应事实时不为了凑组件补造 ID、图片、评分或其他字段。
列表筛选条件、排序依据、数据覆盖缺口及写入未知结果仍须如实说明；结构化展示不改变业务工具及宿主授权边界。`;

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
