import {
  CONTENT_OUTPUT_SCHEMA, CONTENT_OUTPUT_SYSTEM_MARKER, ContentOutputError,
  MAX_CONTENT_BYTES, MAX_CONTENT_PARTS, validateMixedContent, validateMixedPart,
  isContentKind, type MixedContent, type MixedPart,
} from './content-schema.js';
import { deriveNextTypes } from './content-normalize.js';
import { isResourceReference, normalizeResourceReference, resourcePlaceholder, resourceReferenceSchema } from './resource-content.js';

export interface OutputAdjustment { path: string; rule: 'ignored_envelope_field' | 'host_owned_pending' | 'derived_next_type' }
type ObserveAdjustment = (adjustment: OutputAdjustment) => void;
const pointer = (key: string): string => key.replaceAll('~', '~0').replaceAll('/', '~1');
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** 生成提示仍要求最简根对象；入口投影和内部严格校验是另外两项职责。 */
export const PROVIDER_CONTENT_SCHEMA = structuredClone(CONTENT_OUTPUT_SCHEMA);
for (const branch of PROVIDER_CONTENT_SCHEMA.properties!.content!.items!.anyOf!) {
  if (branch.properties!.type!.enum![0] === 'text') branch.required = ['type', 'text'];
  else { delete branch.properties!.pending; branch.required = ['type', 'props']; branch.properties!.props = { anyOf: [branch.properties!.props!, resourceReferenceSchema(branch.properties!.type!.enum![0] as Exclude<MixedPart['type'], 'text'>)] }; }
}

/** 只接受已约定的内容字段；旧状态字段是建议数据，不参与完成状态判断。 */
export function normalizeProviderPart(value: unknown, observe?: ObserveAdjustment): MixedPart {
  if (!record(value) || !isContentKind(value.type)) return validateMixedPart(value);
  const allowed = value.type === 'text' ? ['type', 'text', 'nextType'] : ['type', 'props', 'pending'];
  const extra = Object.keys(value).find(key => !allowed.includes(key));
  if (extra !== undefined) throw new ContentOutputError('内容块包含未允许的字段', 'schema', [],
    [{ path: `/${pointer(extra)}`, rule: 'additionalProperties', message: '内容块包含未允许的字段' }]);
  if (value.type === 'text') {
    if (Object.hasOwn(value, 'nextType') && value.nextType !== null && !isContentKind(value.nextType)) observe?.({ path: '/nextType', rule: 'derived_next_type' });
    return validateMixedPart({ type: 'text', nextType: isContentKind(value.nextType) ? value.nextType : null, text: value.text });
  }
  if (Object.hasOwn(value, 'pending') && value.pending !== false) observe?.({ path: '/pending', rule: 'host_owned_pending' });
  if (isResourceReference(value.props)) { normalizeResourceReference(value.props, false, value.type); return resourcePlaceholder(value.type); }
  return validateMixedPart({ type: value.type, pending: false, props: value.props });
}

/** 原始线路全量计费；仅消费根对象自有content，不猜测其他包装或递归搜寻。 */
export function normalizeProviderContent(value: unknown, observe?: ObserveAdjustment): MixedContent {
  const serialized = JSON.stringify(value);
  if (serialized !== undefined && Buffer.byteLength(serialized, 'utf8') > MAX_CONTENT_BYTES) throw new ContentOutputError('输出超过字节上限', 'size', [], [], 'content_bytes_limit');
  if (!record(value) || !Object.hasOwn(value, 'content') || !Array.isArray(value.content)) throw new ContentOutputError('模型输出根对象必须包含content数组', 'schema', [],
    [{ path: '/content', rule: 'envelope', message: '根对象必须包含自有content数组', expected: 'array' }], 'content_envelope_invalid');
  if (value.content.length > MAX_CONTENT_PARTS) throw new ContentOutputError('内容块超过数量上限', 'size', [], [], 'content_parts_limit');
  for (const key of Object.keys(value)) if (key !== 'content') observe?.({ path: `/${pointer(key)}`, rule: 'ignored_envelope_field' });
  const parts = value.content.map((part, index) => {
    try { return normalizeProviderPart(part, adjustment => observe?.({ ...adjustment, path: `/content/${index}${adjustment.path}` })); }
    catch (error) { if (error instanceof ContentOutputError) throw error.at(`/content/${index}`); throw error; }
  });
  const derived = deriveNextTypes(parts);
  for (const [index, part] of derived.entries()) if (part.type === 'text' && part.nextType !== (parts[index] as { nextType?: unknown }).nextType)
    observe?.({ path: `/content/${index}/nextType`, rule: 'derived_next_type' });
  // 引用输入是尚未展开的生成契约；正式组件验证由宿主展开后执行。
  return derived.some(part => part.type !== 'text' && part.pending) ? { content: derived } : validateMixedContent({ content: derived });
}

export const CONTENT_OUTPUT_INSTRUCTION = `${CONTENT_OUTPUT_SYSTEM_MARKER}
助手文字输出必须是单个JSON对象，根对象只生成content数组，数组按阅读顺序包含text和具体组件类型。
text项提供type和text；可在text之前提供可选nextType，提示紧邻下一项以便提前显示骨架，未知时省略。最终连接关系由宿主按实际顺序生成。
组件项提供type和props，全部组件参数放在props中，不需要生成pending。宿主在组件对象闭合且字段校验通过后才标记完成。
工具返回resourceRef时，展示事实优先使用引用props：resourceRef绑定缓存，items只提供主键并指定成员顺序，SubjectCards可提供layout。DataTable可提供columns，InfoBox/CompareTable可提供fields。url、image、summary等由宿主缓存展开，不抄写到引用props。已准备presentation快照只传resourceRef，多块快照使用partIndex选择同类型块的索引，不覆盖其成员或字段。引用仅当前读取轮次有效，历史精简props里的身份可用于后续重新查询。
引用锁定本次来源：图片资源只有图片地址，完整实体展示使用具有名称等必填事实的详情或列表引用，不能用图片引用替代。resourceRef用于read_cached_resource或展示props，candidateRef/resultRef用于候选筛选，collectionRef用于收藏范围，三者不能互换。缓存工具的keys只筛选该引用的列表成员，单个详情省略keys，不混用其他实体或其他引用的主键。
候选资源中只展示已选作品时，items明确列出该引用中已核实的成员，其他候选尚未处理不代表这些成员不可展示；不提供items的候选集合展示须完成对应阶段。续查后的resourceRef只代表返回成员窗口，需要累计集合时沿最新resultRef选定成员或准备展示快照。已准备快照不再附带title、layout或items，这些内容已被冻结。
作品详情、候选或已准备快照已提供适用引用时，SubjectCards使用该引用交付，不重抄完整items而遗漏封面、链接等事实。少量作品推荐使用grid封面卡片；调用prepare_candidate_output准备时显式指定layout="grid"，card_fields包含image及本次需要展示的评分等字段。紧凑核对列表可使用list。
引用参数依具体组件契约：layout只用于SubjectCards，Gallery不带layout；TagCloud不带title，StatsCard可带mode。工具主体id和对应subjectId/personId/characterId/episodeId均按实体身份核对。
历史消息里的nextType和pending是宿主维护的状态，事实仍在text和props；不要把API的json_object格式配置写入正文。
text内允许Markdown，文本与组件可以交错；不要输出代码围栏或JSON外正文。
组件事实来自已获得的信息，不补造字段，不重复用Markdown展示同一份组件数据。
工具调用仍使用原生工具通道；思考仍使用原生思考通道，不写进content。
只提供必填属性及已知的可选属性，未知可选属性省略；普通解释/澄清可以只有text。
DataTable.props.rows使用对象数组，每行按columns.key提供字符串单元格，空单元格用空字符串；columns.key不得重复，不使用二维数组。
InfoBox.props直接包含rows；TagCloud.props是标签对象数组，不套tags对象。
URL必须是http/https绝对地址；整个输出最多${MAX_CONTENT_BYTES} UTF-8字节、${MAX_CONTENT_PARTS}项。组件字段遵守以下契约：
${JSON.stringify(PROVIDER_CONTENT_SCHEMA)}`;
