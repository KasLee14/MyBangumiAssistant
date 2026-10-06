import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

// 只生成字段声明；不构建、联网或调用业务工具。
const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const documentPath = join(appRoot, 'mcp.md');
const cell = value => String(value ?? '—').replace(/\r?\n/g, ' ').replace(/\|/g, '&#124;');
const literal = value => Array.isArray(value) ? value.length ? value.map(literal).join('、') : '空数组' : value === null ? 'null' : typeof value === 'object' ? '对象' : value === '' ? '空字符串' : String(value);
const table = rows => ['| 字段 | 类型 | 必填 | 默认 | 允许值与约束 | 说明 |', '| --- | --- | --- | --- | --- | --- |', ...rows.map(row => `| ${row.map(cell).join(' | ')} |`)].join('\n');
function dereference(schema, root) {
  if (!schema?.$ref) return schema;
  if (!schema.$ref.startsWith('#/$defs/')) throw Error(`不能引用外置声明：${schema.$ref}`);
  const value = root.$defs?.[schema.$ref.slice(8)];
  if (!value) throw Error(`缺少引用：${schema.$ref}`);
  return { ...value, ...Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$ref')) };
}
function simpleType(schema, root) {
  schema = dereference(schema, root);
  if (typeof schema === 'boolean') return schema ? '任意' : '禁止';
  if (schema.type === 'array') return `array<${simpleType(schema.items ?? {}, root)}>`;
  if (schema.anyOf || schema.oneOf) return [...new Set((schema.anyOf ?? schema.oneOf).map(child => simpleType(child, root)))].join(' / ');
  return Array.isArray(schema.type) ? schema.type.join(' / ') : schema.type ?? (schema.properties ? 'object' : schema.enum || Object.hasOwn(schema, 'const') ? typeof (schema.enum?.[0] ?? schema.const) : '组合字段');
}
function constraints(schema) {
  if (typeof schema === 'boolean') return schema ? '允许' : '禁止';
  const rows = [];
  for (const [key, label] of Object.entries({ const: '固定', enum: '允许', minimum: '≥', maximum: '≤', exclusiveMinimum: '>', exclusiveMaximum: '<',
    minLength: '最短字符数', maxLength: '最长字符数', minItems: '最少项', maxItems: '最多项', minProperties: '最少字段', maxProperties: '最多字段', pattern: '正则', format: '格式' }))
    if (Object.hasOwn(schema, key)) rows.push(`${label} ${literal(schema[key])}`);
  if (schema.uniqueItems) rows.push('元素不重复');
  if (schema.items && !schema.items.properties && !schema.items.$ref) {
    const item = constraints(schema.items); if (item !== '—') rows.push(`元素：${item}`);
  }
  if (schema.additionalProperties === false) rows.push('拒绝额外字段');
  for (const key of ['allOf', 'oneOf', 'anyOf']) if (schema[key]) {
    rows.push(`${key} ${schema[key].length} 个分支`);
    for (const child of schema[key]) if (!child.properties && !child.$ref && child.type !== 'null') {
      const value = constraints(child); if (value !== '—') rows.push(`${child.type ?? '分支'}：${value}`);
    }
  }
  if (schema.if) rows.push(`条件：${condition(schema.if)}`);
  return rows.join('；') || '—';
}
function condition(schema) {
  const required = schema.required?.length ? `提供 ${schema.required.join('、')}` : '';
  const properties = Object.entries(schema.properties ?? {}).map(([key, value]) => `${key}${Object.hasOwn(value, 'const') ? `=${literal(value.const)}` : value.enum ? `∈${literal(value.enum)}` : ''}`);
  return [required, ...properties].filter(Boolean).join('；') || '符合声明条件';
}
export function inputRows(root) {
  const rows = [], seen = new Set();
  function visit(raw, path, required, branch = '', refs = new Set()) {
    if (raw?.$ref && refs.has(raw.$ref)) return;
    const schema = dereference(raw, root), nextRefs = raw?.$ref ? new Set([...refs, raw.$ref]) : refs;
    if (path && (schema.type || schema.properties || schema.enum || Object.hasOwn(schema, 'const'))) {
      const row = [path, simpleType(schema, root), required ? '是' : '否', Object.hasOwn(schema, 'default') ? literal(schema.default) : '—', constraints(schema), [schema.description, branch].filter(Boolean).join('；')];
      const key = JSON.stringify(row); if (!seen.has(key)) { seen.add(key); rows.push(row); }
    }
    for (const [name, child] of Object.entries(schema.properties ?? {})) visit(child, path ? `${path}.${name}` : name, schema.required?.includes(name), branch, nextRefs);
    if (schema.items && typeof schema.items === 'object') visit(schema.items, `${path}[]`, true, branch, nextRefs);
    for (const kind of ['allOf', 'oneOf', 'anyOf']) for (const [index, child] of (schema[kind] ?? []).entries()) {
      const name = child.properties?.tool?.const;
      visit(child, path, required, [branch, name ? `${kind}: ${name}${child.required?.includes('index_from') ? '（index_from分支）' : ''}` : `${kind} ${index + 1}`].filter(Boolean).join('；'), nextRefs);
    }
    if (schema.if) for (const kind of ['then', 'else']) if (schema[kind]) visit(schema[kind], path, false, `${kind}: ${condition(schema.if)}`, nextRefs);
  }
  visit(root, '', true);
  return rows;
}
/** 输出嵌套结构按实际形状去重，每个公共结构只声明一次。 */
export function renderMcpDocument(tools, batchInput) {
  if (!tools.length || new Set(tools.map(tool => tool.name)).size !== tools.length) throw Error('工具目录必须非空且名称不能重复。');
  const models = [], modelKeys = new Map(), modelNames = new Set();
  function shape(raw, root, refs = new Set()) {
    if (raw === null || typeof raw !== 'object') return raw;
    if (Array.isArray(raw)) return raw.map(value => shape(value, root, refs));
    if (raw.$ref) {
      if (refs.has(raw.$ref)) return { reference: raw.$ref };
      return shape(dereference(raw, root), root, new Set([...refs, raw.$ref]));
    }
    return Object.fromEntries(Object.keys(raw).filter(key => !['$defs', 'description', 'title'].includes(key)).sort().map(key => [key, shape(raw[key], root, refs)]));
  }
  function register(raw, root, hint) {
    const key = JSON.stringify(shape(raw, root));
    if (modelKeys.has(key)) return modelKeys.get(key);
    let name = hint.replace(/[^A-Za-z0-9_]/g, '_') || 'Object';
    const base = name; let suffix = 2;
    while (modelNames.has(name)) name = `${base}_${suffix++}`;
    modelNames.add(name); modelKeys.set(key, name); models.push({ name, schema: dereference(raw, root), root });
    return name;
  }
  function outputType(raw, root, hint) {
    const reference = raw?.$ref?.slice(8), schema = dereference(raw, root);
    if (schema.type === 'array') return `array<${outputType(schema.items ?? {}, root, `${hint}Item`)}>`;
    if (schema.anyOf || schema.oneOf) return [...new Set((schema.anyOf ?? schema.oneOf).map(child => outputType(child, root, hint)))].join(' / ');
    if (schema.properties || schema.allOf) return register(raw, root, reference ?? hint);
    return simpleType(schema, root);
  }
  function outputRows(raw, root, prefix, hint, branch = '') {
    const schema = dereference(raw, root), rows = [];
    for (const [field, childRaw] of Object.entries(schema.properties ?? {})) {
      const child = dereference(childRaw, root), path = prefix ? `${prefix}.${field}` : field;
      const type = field === 'scope' ? 'object（本工具输入字段）' : outputType(childRaw, root, field === 'accessContext' ? 'AccessContext' : `${hint}_${field}`);
      rows.push([path, type, schema.required?.includes(field) ? '是' : '否', Object.hasOwn(child, 'default') ? literal(child.default) : '—', field === 'accessContext' ? '见公共结构' : constraints(child), [child.description, branch].filter(Boolean).join('；')]);
    }
    for (const kind of ['allOf', 'oneOf', 'anyOf']) for (const [index, child] of (schema[kind] ?? []).entries()) rows.push(...outputRows(child, root, prefix, hint, `${kind} ${index + 1}`));
    if (schema.if) for (const kind of ['then', 'else']) if (schema[kind]) rows.push(...outputRows(schema[kind], root, prefix, hint, `${kind}: ${condition(schema.if)}`));
    return rows.filter((row, index, all) => all.findIndex(value => JSON.stringify(value) === JSON.stringify(row)) === index);
  }
  function envelopes(raw, root, toolName) {
    const schema = dereference(raw, root), rows = [];
    if (schema.properties?.value) rows.push(...outputRows(schema.properties.value, root, 'value', toolName));
    if (schema.properties?.error) register(schema.properties.error, root, schema.properties.error.$ref?.slice(8) ?? 'SafeError');
    for (const kind of ['allOf', 'oneOf', 'anyOf']) for (const child of schema[kind] ?? []) rows.push(...envelopes(child, root, toolName));
    return rows;
  }
  const sections = tools.map(tool => {
    const output = envelopes(tool.outputSchema, tool.outputSchema, tool.name);
    return `## \`${tool.name}\`\n\n输入字段\n\n${table(inputRows(tool.inputSchema))}\n\n成功输出字段\n\n${table(output)}`;
  });
  sections.push(`## \`execute_write_batch\`\n\n输入字段\n\n${table(inputRows(batchInput))}\n\n成功输出字段\n\n${table(BATCH_OUTPUT_FIELDS)}`);
  const common = [];
  for (let index = 0; index < models.length; index++) {
    const model = models[index];
    common.push(`### \`${model.name}\`\n\n${table(outputRows(model.schema, model.root, '', model.name))}`);
    if (models.length > 500) throw Error('公共输出结构展开过多，检查循环引用。');
  }
  return ['# Bangumi MCP 字段声明',
    `${tools.length} 个底层工具及宿主工具 execute_write_batch。输入字段递归声明；输出嵌套对象引用末尾的公共结构，scope 对应本工具输入。底层结果封装为 value 或 error，错误字段见公共安全错误结构。`,
    ...sections, '## 公共输出结构', ...common].join('\n\n').trimEnd() + '\n';
}
const BATCH_OUTPUT_FIELDS = [
  ['value.state', 'string', '是', '—', 'success / unchanged / partial / failed / unknown；进度更新 running', '整批状态'],
  ['value.items[]', 'object', '是', '—', '保留原 step', '每个计划项的结果'],
  ['value.items[].step', 'integer', '是', '—', '≥ 1', '原输入序号'],
  ['value.items[].tool', 'string', '是', '—', '固定写工具名称', '对应 operations[].tool'],
  ['value.items[].state', 'string', '是', '—', 'success / submitted / unchanged / skipped / failed / unknown / blocked / not_executed', '条目状态'],
  ['value.items[].networkAttempted', 'boolean', '是', '—', '—', '写入尝试事实'],
  ['value.items[].writeNetworkAttempted', 'boolean', '否', '—', '—', '排除明确未投递的写入尝试'],
  ['value.items[].target', 'object', '否', '—', '按工具目标字段', '原对象范围'],
  ['value.items[].reason', 'string', '否', '—', '—', '跳过或阻塞原因'],
  ['value.items[].blockedBy[]', 'integer', '否', '—', '≥ 1', '依赖的原步骤编号'],
  ['value.items[].stageResults[]', 'object', '否', '—', 'stage / state / target；可含提交、回读与错误', '复合操作子阶段结果'],
  ['value.items[].preflightSkipped[]', 'object', '否', '—', 'episodeId / reason / error', '预检未通过的章节'],
  ['value.items[].submission', 'object', '否', '—', '对应底层写工具输出', '提交回执'],
  ['value.items[].submissionError', 'object', '否', '—', '公共安全错误字段', '提交阶段错误'],
  ['value.items[].verificationError', 'object', '否', '—', '公共安全错误字段', '回读阶段错误'],
  ['value.items[].verification', 'object', '否', '—', '对应宿主回读结果', '独立验证事实'],
  ['value.items[].actual', 'object', '否', '—', '对应目标的状态字段', '回读实际状态'],
  ['value.items[].error', 'object', '否', '—', '公共安全错误字段', '条目失败'],
  ['value.items[].accountId', 'integer', '否', '—', '≥ 1', '提交账户'],
  ['value.items[].before', 'object', '否', '—', '对应目标字段', '修改前基线'],
  ['value.items[].after', 'object', '否', '—', '对应目标字段', '预期修改目标'],
  ...['requestId', 'batchId', 'logicalOperationId'].map(field => [`value.items[].${field}`, 'string', '否', '—', '宿主生成', '执行身份']),
  ['value.items[].createdId', 'integer', '否', '—', '≥ 1', '创建目录的实际ID'],
  ['value.items[].partial', 'boolean', '否', '—', '—', '子阶段部分完成'],
  ['value.items[].resolution', 'string', '否', '—', 'observed_partial等宿主事实', '结果依据'],
  ...['readbackCompleted', 'requestedStateMatched', 'protectedFieldsMatched', 'superseded'].map(field => [`value.items[].verification.${field}`, 'boolean', '否', '—', '—', '回读及目标、保护范围核对']),
  ['value.items[].verification.mismatchedFields[]', 'string', '否', '—', '目标字段名称', '未匹配字段'],
  ['value.items[].verification.state', 'string', '否', '—', 'pending / success / unchanged / failed / unknown', '验证状态'],
  ['value.items[].verification.scope', 'string', '否', '—', 'batch_final_state / recovery', '验证范围'],
  ['value.items[].verification.parentProgress', 'object', '否', '—', 'subjectId / before / actual', '作品父进度核对'],
  ['value.summary', 'object', '是', '—', '各状态计数为非负整数', 'success / submitted / unchanged / skipped / failed / unknown / blocked / not_executed'],
  ...['success', 'submitted', 'unchanged', 'skipped', 'failed', 'unknown', 'blocked', 'not_executed'].map(field => [`value.summary.${field}`, 'integer', '是', '—', '≥ 0', '原计划项状态计数']),
  ['value.partial', 'boolean', '是', '—', '—', '是否存在已核实部分与未完成范围'],
  ['value.networkAttempted', 'boolean', '是', '—', '—', '汇总写入尝试'],
  ['value.writeNetworkAttempted', 'boolean', '否', '—', '—', '汇总实际写入尝试'],
  ['value.confirmation', 'object', '否', '—', 'required: boolean；reasons: array<string>', '完整计划确认政策'],
  ['value.confirmation.required', 'boolean', '是', '—', '—', '是否要求确认'],
  ['value.confirmation.reasons[]', 'string', '是', '—', '宿主政策原因', '确认原因'],
  ['value.accessContext', 'AccessContext', '否', '—', '公共结构', '账户与权限事实'],
  ['value.failures[]', 'object', '否', '—', 'phase / step / tool / target / sourceTool / error', '全部已定位错误'],
  ['value.failure', 'object', '否', '—', '同 failures[]', '首项兼容字段'],
  ['value.error', 'object', '否', '—', '公共安全错误字段', '整批异常'],
  ['value.prior', 'object', '否', '—', '已记录执行事实', '已执行计划的历史事实'],
  ['value.recovery', 'object', '否', '—', 'blockers / createdTargets / action', '未完成范围的恢复事实'],
  ['value.recovery.blockers[]', 'object', '是', '—', '宿主恢复事实', '未核实冲突范围'],
  ['value.recovery.createdTargets[]', 'object', '否', '—', 'tool / indexId / args / actual', '已核实新目录'],
  ['value.recovery.action', 'string', '是', '—', 'replan_remaining / independent_readback', '当前剩余工作'],
  ['value.completedSteps', 'integer', '否', '—', '≥ 0', '进度更新的已完成步骤数'],
  ['value.totalSteps', 'integer', '否', '—', '≥ 0', '进度更新的计划项数'],
];
async function sourceFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await sourceFiles(path));
    else if (entry.isFile() && path.endsWith('.ts')) result.push(path);
  }
  return result;
}
export async function syncMcpDocument(checking = false) {
  const sources = [...await sourceFiles(join(appRoot, 'src/mcp')), ...await sourceFiles(join(appRoot, 'src/support')), join(appRoot, 'src/extension.ts')];
  for (const source of sources) {
    const compiled = join(appRoot, 'dist', relative(appRoot, source).replace(/\.ts$/, '.js'));
    let build; try { build = await stat(compiled); } catch { throw Error(`构建产物缺失：${relative(appRoot, compiled)}；请先统一构建。`); }
    if (build.mtimeMs < (await stat(source)).mtimeMs) throw Error(`构建产物过期：${relative(appRoot, compiled)}；请先统一构建。`);
  }
  const { TOOL_DEFINITIONS } = await import(pathToFileURL(join(appRoot, 'dist/src/mcp/catalog.js')).href);
  const { BATCH_INPUT_SCHEMA } = await import(pathToFileURL(join(appRoot, 'dist/src/mcp/batch-write.js')).href);
  const rendered = renderMcpDocument(TOOL_DEFINITIONS, BATCH_INPUT_SCHEMA);
  const original = (await readFile(documentPath, 'utf8')).replace(/\r\n/g, '\n');
  if (checking && rendered !== original) throw Error('mcp.md与工具字段不一致；运行 node scripts/sync-mcp-doc.mjs 同步。');
  if (!checking && rendered !== original) await writeFile(documentPath, rendered, 'utf8');
  return rendered;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(value => value !== '--check')) throw Error('只接受可选参数 --check。');
  await syncMcpDocument(process.argv.includes('--check'));
  const { TOOL_DEFINITIONS } = await import(pathToFileURL(join(appRoot, 'dist/src/mcp/catalog.js')).href);
  console.log(`${process.argv.includes('--check') ? '字段一致性校验通过' : '字段文档同步完成'}：${TOOL_DEFINITIONS.length}底层工具及execute_write_batch。`);
}
