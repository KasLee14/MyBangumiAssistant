import { isComponentKind } from './content-types.js';
import { validateMixedPart } from './content-schema.js';
import { HISTORY_REFERENCE_NOTE_PREFIX, inspectPresentationHistory as inspectHistory, projectPresentationContent, projectPresentationHistory } from './presentation-history.js';
export { bindPresentationHistory } from './presentation-history.js';
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = new Set(['id', 'entity', 'subjectId', 'episodeId', 'revisionId', 'targetKind', 'targetId', 'relationId', 'username', 'ownerId', 'name', 'nameCn', 'displayName', 'title', 'label']);
function names(value) {
    if (Array.isArray(value))
        return value.map(names);
    if (!record(value))
        return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => identity.has(key)).map(([key, item]) => [key, names(item)]));
}
/** 展示快照保留在会话文件；模型仅看到成员身份及模型创作的说明。 */
export function projectContentForModel(value) {
    if (Array.isArray(value))
        return value.map(projectContentForModel);
    if (!record(value))
        return value;
    if (isComponentKind(value.type)) {
        const props = value.props;
        if (value.type === 'Callout' || value.type === 'QuoteBlock')
            return value;
        if (Array.isArray(props))
            return { type: value.type, props: names(props) };
        if (!record(props))
            return { type: value.type };
        const result = {};
        for (const key of ['title', 'layout', 'hint', 'note'])
            if (props[key] !== undefined)
                result[key] = props[key];
        if (Array.isArray(props.items))
            result.items = names(props.items);
        if (Array.isArray(props.links))
            result.links = names(props.links);
        if (Array.isArray(props.episodes))
            result.episodes = names(props.episodes);
        if (Array.isArray(props.rows) && value.type === 'DataTable')
            result.rows = names(props.rows);
        return { type: value.type, props: result };
    }
    return Object.fromEntries(Object.entries(value).filter(([key]) => !['resourceRef', 'images', 'image', 'summary', 'url'].includes(key)).map(([key, item]) => [key, projectContentForModel(item)]));
}
function historicalReferences(value, resolver, refs) {
    if (Array.isArray(value)) {
        value.forEach(item => historicalReferences(item, resolver, refs));
        return;
    }
    if (!record(value))
        return;
    for (const [key, item] of Object.entries(value)) {
        if (['resourceRef', 'resource_ref'].includes(key) && typeof item === 'string' && !resolver?.isCurrent?.(item))
            refs.add(item);
        else
            historicalReferences(item, resolver, refs);
    }
}
function baseProjection(context, resolver) {
    const keepTexts = new Set();
    const noteReferences = (content, refs) => {
        if (!refs.size)
            return;
        const note = { type: 'text', text: HISTORY_REFERENCE_NOTE_PREFIX + JSON.stringify([...refs]) };
        content.push(note);
        keepTexts.add(note);
    };
    const base = { ...context, messages: context.messages.map(message => {
            if (message.role === 'toolResult') {
                const visible = { ...message };
                delete visible.details;
                delete visible.structuredContent;
                const refs = new Set();
                const content = message.content.map(part => {
                    if (part.type !== 'text')
                        return part;
                    // 本地组件契约中的 resourceRef 是Schema字段名，不能当过期事实引用剔除。
                    if (message.toolName === 'read_component_index' || message.toolName === 'read_component_spec')
                        return part;
                    try {
                        historicalReferences(JSON.parse(part.text), resolver, refs);
                    }
                    catch { /* 普通工具文字保持原样。 */ }
                    return part;
                });
                noteReferences(content, refs);
                return { ...visible, content };
            }
            if (message.role !== 'assistant')
                return message;
            const refs = new Set();
            const content = message.content.map(part => {
                if (isComponentKind(part.type))
                    return { type: 'text', text: `历史展示摘要：${JSON.stringify(projectPresentationContent(part))}` };
                if (part.type === 'toolCall') {
                    historicalReferences(part.arguments, resolver, refs);
                    return part;
                }
                if (part.type === 'text' && part.text.trimStart().startsWith('{')) {
                    // Pi.convertToLlm 已将应用组件变成 JSON 文字；仍须在 provider 边界投影。
                    try {
                        const value = JSON.parse(part.text);
                        if (record(value) && isComponentKind(value.type) && value.pending === false) {
                            validateMixedPart(value);
                            return { ...part, text: `历史展示摘要：${JSON.stringify(projectPresentationContent(value))}` };
                        }
                    }
                    catch { /* 普通助手文字保持原样，不猜测JSON包装。 */ }
                }
                return part;
            });
            noteReferences(content, refs);
            return { ...message, content };
        }) };
    return { base, keepTexts };
}
export function projectTranscriptForModel(context, resolver) {
    const { base, keepTexts } = baseProjection(context, resolver);
    const projected = projectPresentationHistory(context, base, keepTexts);
    return { ...projected, messages: projected.messages.map(message => {
            if (message.role !== 'assistant')
                return message;
            const { diagnostics: _diagnostics, ...visible } = message;
            return visible;
        }) };
}
/** 与真实请求使用同一普通投影和归并，只返回无正文的离线审计。 */
export function inspectPresentationHistory(context, resolver) {
    const { base, keepTexts } = baseProjection(context, resolver);
    return inspectHistory(context, base, keepTexts);
}
//# sourceMappingURL=model-context.js.map