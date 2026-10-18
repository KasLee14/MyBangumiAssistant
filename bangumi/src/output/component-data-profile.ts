import type { ComponentKind, ComponentPropsMap } from './content-types.js';

export interface ComponentDataProfile {
  category: string;
  purpose: string;
  data: string;
  sourceCapability: 'available' | 'limited' | 'unavailable' | 'text';
  /** 直接事实由宿主内部补读，不要求模型复制。id/entity与查询元数据始终随资源保留。 */
  requiredFacts: readonly string[];
  derivedFields: readonly string[];
  limitations: readonly string[];
  unavailableReason?: string;
}

/** 当前 Archive 能力与组件事实依赖的唯一登记；不改变历史 canonical 内容或 Web 协议。 */
export const COMPONENT_DATA_PROFILES: Readonly<Record<ComponentKind, ComponentDataProfile>> = {
  SubjectCards: {
    category: '作品', purpose: '展示公共作品搜索和推荐结果，以及当前页或明确选中成员的范围',
    data: '作品身份、名称、媒体类型及绑定快照的资源引用；总数和范围提示由宿主生成', sourceCapability: 'limited',
    requiredFacts: ['name', 'nameCn', 'subjectType', 'url', 'score', 'ratingCount', 'rank', 'date', 'summary', 'tags', 'fieldStates'],
    derivedFields: ['kind', 'scoreCount', 'total', 'hint'],
    limitations: ['Archive 不含封面地址，缺图使用现有组件占位，不构造图片链接。', '单页总数表示原查询范围；明确选中与多来源组合会另外说明，不能相加各来源的查询总数。'],
  },
  StatsCard: {
    category: '统计', purpose: '展示单个作品的原始评分、评分人数和评分分布；跨作品分组统计使用 DataTable',
    data: '单作品 score、ratingCount、ratingDistribution；headline、ratio 与说明由宿主生成', sourceCapability: 'limited',
    requiredFacts: ['score', 'ratingCount', 'ratingDistribution'], derivedFields: ['headline', 'entries', 'ratio', 'note'],
    limitations: ['每次只接受一个作品，不把多作品评分分布相加。', '比例分母为完整分布的总票数；零票为零比例，未知分布不补零，原评分不由分布重算。'],
  },
  ProgressView: {
    category: '进度', purpose: '保留历史逐集观看进度回放；当前个人库仅提供条目级进度计数',
    data: '当前源没有逐集观看状态；条目级epStatus/volStatus与章节清单使用DataTable', sourceCapability: 'unavailable',
    requiredFacts: ['name', 'sort'], derivedFields: [],
    limitations: ['条目级epStatus/volStatus不是逐集状态，不能由计数、章节存在或放送日期推断具体已看章节。', '用DataTable展示已同步的条目进度计数或公共章节清单。'],
    unavailableReason: '当前数据不含逐集观看状态，不能生成ProgressView。可用DataTable展示本人条目级epStatus/volStatus或公共章节清单。',
  },
  InfoBox: {
    category: '事实', purpose: '展示单对象的 Wiki 属性或明确选择的基础字段', data: '单对象 infobox 或显式字段',
    sourceCapability: 'limited', requiredFacts: ['infobox'], derivedFields: ['rows'],
    limitations: ['缺失或解析失败的 Wiki 属性保持未知；没有个人资料补取或网络回退。'],
  },
  DataTable: {
    category: '事实', purpose: '按列展示公共事实、本人收藏字段、关系、章节和分组统计', data: '明确列定义与当前引用成员；个人字段仅从本人范围引用读取',
    sourceCapability: 'available', requiredFacts: ['name'], derivedFields: ['columns', 'rows'],
    limitations: ['缺失字段为空单元格；复杂对象需选择可用标量字段，不执行表达式或任意 SQL。'],
  },
  Timeline: {
    category: '事件', purpose: '按作品发行或章节放送日期展示时间线', data: '作品 date 或章节 airDate，以及已核实名称',
    sourceCapability: 'limited', requiredFacts: ['name', 'date', 'airDate'], derivedFields: ['entries'],
    limitations: ['作品发行与章节放送日期不等于用户动态时间；当前源没有用户动态、操作者或评论正文。', '没有有效日期的记录不能推定日期后放入时间线。'],
  },
  TagCloud: {
    category: '标签', purpose: '展示已导出的公共标签及已有计数', data: 'tags 或 tagStats', sourceCapability: 'limited',
    requiredFacts: ['tags', 'tagStats'], derivedFields: ['name', 'count'],
    limitations: ['标签并非完整标注，缺少标签不证明作品没有该题材；selected 属于界面状态，宿主不伪造选中状态。'],
  },
  Gallery: {
    category: '人物图片', purpose: '展示人物、角色或作品的名称与关联信息，缺图正常降级', data: '当前引用的实体名称、关系与链接',
    sourceCapability: 'limited', requiredFacts: ['name', 'nameCn', 'url', 'relation', 'staff'], derivedFields: ['subtitle'],
    limitations: ['Archive 没有作品封面、人物或角色图片地址，现有组件以无图形式显示；不能为画廊虚构图片。'],
  },
  CompareTable: {
    category: '事实', purpose: '保留历史前后对照回放；当前公共查询不生成 before/after 对照资源',
    data: '当前六个数据工具没有同资源 before/after；并排比较作品应使用 DataTable', sourceCapability: 'unavailable',
    requiredFacts: ['name'], derivedFields: [],
    limitations: ['存在两代数据快照不等于已生成可核验的前后对照资源。', '更换参数不能生成 before/after；用 DataTable 比较当前实体，用 Callout 说明历史变化不可用。'],
    unavailableReason: '当前查询没有可核验的 before/after 对照资源，不能生成 CompareTable。请用 DataTable 比较当前实体，并用 Callout 说明历史变化不可用；更换参数无法生成该资源。',
  },
  QuoteBlock: {
    category: '文字', purpose: '引用已读取的原始简介、Wiki 或工具文本', data: '已实际读取的引用文字与必要来源说明',
    sourceCapability: 'text', requiredFacts: [], derivedFields: [],
    limitations: ['正文仍由模型填写，应忠于已读文本；Archive 没有评论、长评或帖子正文。'],
  },
  Callout: {
    category: '文字', purpose: '展示业务提示、缺失说明和查询状态', data: '明确的业务状态与提示文字',
    sourceCapability: 'text', requiredFacts: [], derivedFields: [], limitations: ['提示不得将未知或不可用资料写成已确认事实。'],
  },
  LinkList: {
    category: '链接', purpose: '展示当前实体的名称和条目链接', data: '实体名称、身份与按身份生成的条目链接',
    sourceCapability: 'available', requiredFacts: ['name', 'nameCn', 'url'], derivedFields: ['links'],
    limitations: ['条目链接由宿主按实体身份构造，不声称它是 Archive 原始图片或原始 URL 字段。'],
  },
};

/** 动态列仍仅来自已校验的字段白名单，不能借组件依赖扩大成员或改变缓存范围。 */
export function componentDataFields(kind: ComponentKind, controls: Record<string, unknown>): string[] | undefined {
  if (kind === 'QuoteBlock' || kind === 'Callout') return undefined;
  if (kind === 'DataTable') return Array.isArray(controls.columns)
    ? (controls.columns as { key: string }[]).map(column => column.key)
    : Array.isArray(controls.fields) ? controls.fields as string[] : ['id', 'name'];
  if (kind === 'InfoBox' || kind === 'CompareTable') return Array.isArray(controls.fields)
    ? controls.fields as string[] : [...COMPONENT_DATA_PROFILES[kind].requiredFacts];
  return [...COMPONENT_DATA_PROFILES[kind].requiredFacts];
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

/** 评分事实与柱形派生分开：原评分永不从分布重算，未知档位也不补为零票。 */
export function ratingCardPresentation(row: Record<string, unknown>, mode?: 'list' | 'bars' | 'histogram'): Omit<ComponentPropsMap['StatsCard'], 'title'> {
  const distribution = record(row.ratingDistribution) ? row.ratingDistribution : undefined;
  const bins = Array.from({ length: 10 }, (_, index) => ({ label: String(10 - index), count: count(distribution?.[String(10 - index)]) }));
  const complete = distribution !== undefined && bins.every(bin => bin.count !== undefined);
  const sum = complete ? bins.reduce((total, bin) => total + bin.count!, 0) : undefined;
  const denominator = sum !== undefined && Number.isSafeInteger(sum) ? sum : undefined;
  const ratingCount = count(row.ratingCount);
  const score = typeof row.score === 'number' && Number.isFinite(row.score) && row.score >= 0 && row.score <= 10 ? row.score : undefined;
  const noVotes = ratingCount === 0 || denominator === 0;
  const notes: string[] = [];
  if (ratingCount === undefined) notes.push('评分人数未知。');
  else if (denominator === undefined || ratingCount !== denominator) notes.push(`评分人数：${ratingCount}。`);
  if (denominator !== undefined) {
    notes.push(denominator === 0 ? '分布共 0 票，各档比例为 0。' : `分布共 ${denominator} 票，比例按分布总票数计算。`);
    if (ratingCount !== undefined && ratingCount !== denominator) notes.push('评分人数与分布总票数不一致。');
  } else if (distribution) notes.push('评分分布不完整，未知档位不补零，改用列表。');
  else notes.push('缺少评分分布。');
  if (score === undefined) notes.push(noVotes ? '暂无有效评分。' : '评分未知。');
  return {
    headline: { value: score === undefined ? noVotes ? '暂无评分' : '未知' : String(score), label: '评分' },
    mode: denominator === undefined ? 'list' : mode ?? 'histogram',
    entries: distribution ? bins.map(bin => ({
      label: bin.label, value: bin.count === undefined ? '未知' : String(bin.count),
      ...(denominator === undefined ? {} : { ratio: denominator > 0 ? bin.count! / denominator : 0 }),
    })) : [],
    note: notes.join(''),
  };
}

/** total 服从组件展示范围，hint 同时保留原查询范围，避免界面把选中条目当成全部匹配。 */
export function subjectCardRange(value: Record<string, unknown>, displayedCount: number, selected: boolean): Pick<ComponentPropsMap['SubjectCards'], 'total' | 'hint'> {
  const page = record(value.page) ? value.page : undefined;
  const total = count(page?.total), offset = count(page?.offset), windowCount = count(page?.returnedCount);
  const original = total === undefined ? '' : `原查询共 ${total} 条`;
  const window = windowCount === undefined ? '' : `当前页 ${windowCount} 条`;
  if (value.kind === 'local_entities' && Array.isArray(value.requestedIds)) {
    const requestedCount = value.requestedIds.length;
    const missingCount = Array.isArray(value.missingIds) ? value.missingIds.length : undefined;
    const returnedCount = missingCount === undefined ? undefined : requestedCount - missingCount;
    return {
      total: displayedCount,
      hint: returnedCount === displayedCount && missingCount === 0 ? ''
        : `请求 ${requestedCount} 条${returnedCount === undefined ? '' : `，返回 ${returnedCount} 条`}${missingCount ? `，${missingCount} 条未取得` : ''}${returnedCount === displayedCount ? '' : `，展示其中 ${displayedCount} 条`}。`,
    };
  }
  if (selected) return {
    total: displayedCount,
    hint: `选出 ${displayedCount} 条${original || window ? `；${[window, original].filter(Boolean).join('，')}` : '；匹配总数未知'}。`,
  };
  if (page && total !== undefined && offset !== undefined && windowCount !== undefined && windowCount === displayedCount && total >= offset + displayedCount) return {
    total,
    hint: total === 0 ? '共 0 条。' : displayedCount === 0 ? `共 ${total} 条，当前页未返回条目。`
      : `共 ${total} 条，当前展示第 ${offset + 1}–${offset + displayedCount} 条。`,
  };
  // 不完整页元数据不能反推完整匹配数；已有准确总数只作范围说明。
  return { total: displayedCount, hint: `展示 ${displayedCount} 条${original ? `，${original}；分页范围未知` : '；匹配总数未知'}。` };
}

export function combinedSubjectCardRange(displayedCount: number, sources: readonly { displayedCount: number; hint?: string }[]): Pick<ComponentPropsMap['SubjectCards'], 'total' | 'hint'> {
  return {
    total: displayedCount,
    hint: [`组合展示 ${displayedCount} 条；联合匹配总数未知。`,
      ...sources.map((source, index) => `来源 ${index + 1}：${source.hint || `展示 ${source.displayedCount} 条。`}`)].join(' '),
  };
}
