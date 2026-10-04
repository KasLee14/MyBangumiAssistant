import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

// 只维护文档，绝不构建、联网或调用业务工具。先由统一构建生成最新 dist。
const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const documentPath = join(appRoot, 'mcp.md');
const checking = process.argv.includes('--check');
if (process.argv.slice(2).some(value => value !== '--check')) throw Error('只接受可选参数 --check。');
const requireInvariant = (condition, message) => { if (!condition) throw Error(message); };
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (entry.isFile() && entry.name.endsWith('.ts')) result.push(path);
  }
  return result;
}
const sourcePaths = [...await files(join(appRoot, 'src/mcp')), ...await files(join(appRoot, 'src/support')), join(appRoot, 'src/extension.ts')]
  .sort((left, right) => relative(appRoot, left).localeCompare(relative(appRoot, right), 'en'));
const sourceSnapshot = new Map(), buildSnapshot = new Map();
for (const source of sourcePaths) {
  const compiled = join(appRoot, 'dist', relative(appRoot, source).replace(/\.ts$/, '.js'));
  let output; try { output = await stat(compiled); } catch { throw Error(`构建产物缺失：${relative(appRoot, compiled)}；请先完成统一构建。`); }
  const input = await stat(source);
  requireInvariant(output.mtimeMs >= input.mtimeMs, `构建产物已过期：${relative(appRoot, compiled)}；请先完成统一构建。`);
  sourceSnapshot.set(source, await readFile(source)); buildSnapshot.set(compiled, output.mtimeMs);
}
const { TOOL_DEFINITIONS } = await import(pathToFileURL(join(appRoot, 'dist/src/mcp/catalog.js')).href);
const { BATCH_INPUT_SCHEMA } = await import(pathToFileURL(join(appRoot, 'dist/src/mcp/batch-write.js')).href);
const { compileSchema } = await import(pathToFileURL(join(appRoot, 'dist/src/support/tool-schema.js')).href);
requireInvariant(TOOL_DEFINITIONS.length === 64, '当前维护基准为64项工具；目录数量变化时需先更新正文分组与覆盖说明。');
requireInvariant(new Set(TOOL_DEFINITIONS.map(tool => tool.name)).size === 64, '工具目录含重复名称。');
requireInvariant(TOOL_DEFINITIONS.filter(tool => tool.effect === 'read').length === 50 && TOOL_DEFINITIONS.filter(tool => tool.effect === 'write').length === 14, '读取/写入数量与维护基准不符。');
for (const tool of TOOL_DEFINITIONS) {
  requireInvariant(tool.inputSchema && tool.outputSchema, `${tool.name}缺少完整输入/输出Schema。`);
  compileSchema(tool.inputSchema); compileSchema(tool.outputSchema);
}
compileSchema(BATCH_INPUT_SCHEMA);

const markdownCell = value => String(value ?? '—').replace(/\r?\n/g, ' ').replace(/\|/g, '&#124;');
const jsonInline = value => `\`${markdownCell(JSON.stringify(value))}\``;
function constraints(schema) {
  const values = [];
  for (const [key, label] of Object.entries({ const: '固定值', enum: '允许值', default: '声明默认值', minimum: '最小值', maximum: '最大值',
    exclusiveMinimum: '排除下界', exclusiveMaximum: '排除上界', minLength: '最小字符数', maxLength: '最大字符数',
    minItems: '最少项数', maxItems: '最多项数', uniqueItems: '去重', minProperties: '最少字段数', maxProperties: '最多字段数', pattern: '正则', format: '格式' })) {
    if (Object.hasOwn(schema, key)) values.push(`${label} ${jsonInline(schema[key])}`);
  }
  if (schema.additionalProperties === false) values.push('拒绝额外字段');
  if (schema.required?.length) values.push(`本对象必填 ${jsonInline(schema.required)}`);
  for (const key of ['oneOf', 'anyOf', 'allOf']) if (schema[key]) values.push(`${key} ${schema[key].length} 分支`);
  if (schema.if) values.push('含 if/then/else 条件，结合完整 Schema 阅读');
  if (schema.$ref) values.push(`引用 ${jsonInline(schema.$ref)}`);
  return values.join('；') || '—';
}
function fieldTable(root, output = false) {
  const rows = [];
  function visit(schema, path, branch, required, refs = new Set()) {
    if (typeof schema === 'boolean') { rows.push([path, branch, 'boolean Schema', required, schema ? '允许' : '禁止', '—']); return; }
    requireInvariant(schema && typeof schema === 'object', `字段索引结构无效：${path}`);
    if (schema.$ref) {
      requireInvariant(schema.$ref.startsWith('#/$defs/'), `文档不允许外置Schema依赖：${schema.$ref}`);
      const key = schema.$ref.slice(8);
      requireInvariant(root.$defs?.[key], `Schema引用缺失：${key}`);
      if (refs.has(key)) { rows.push([path, branch, `$ref ${key}`, required, constraints(schema), schema.description]); return; }
      return visit({ ...root.$defs[key], ...Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$ref')) }, path, branch,
        required, new Set([...refs, key]));
    }
    const type = Array.isArray(schema.type) ? schema.type.join(' / ') : schema.type ?? (schema.properties ? 'object' : schema.enum ? '枚举' : '组合约束');
    rows.push([path, branch, type, required, constraints(schema), schema.description]);
    // 这两个公共对象的全文仍在JSON中；正文3.5及本工具输入表提供其字段解释。
    if (output && ['/value/accessContext', '/error/accessContext', '/value/scope'].includes(path)) return;
    for (const [key, child] of Object.entries(schema.properties ?? {})) visit(child, path === '/' ? `/${key}` : `${path}/${key}`, branch,
      schema.required?.includes(key) ? '所在分支必填' : '所在分支可选', refs);
    if (schema.items && !Array.isArray(schema.items)) visit(schema.items, `${path}/*`, branch, '每个数组元素', refs);
    for (const key of ['oneOf', 'anyOf', 'allOf']) for (const [index, child] of (schema[key] ?? []).entries()) {
      visit(child, path, `${branch}/${key}[${index + 1}]`, required, refs);
    }
    for (const key of ['if', 'then', 'else']) if (schema[key]) visit(schema[key], path, `${branch}/${key}`, '条件约束', refs);
  }
  visit(root, '/', '根分支', '根对象');
  requireInvariant(rows.length < 3000, '单工具字段索引过大，需检查递归引用或增加有据的公共模型索引。');
  return ['| 字段路径 | 约束所在分支 | 类型 | 本分支必填性 | 字段约束 | 含义/声明说明 |', '| --- | --- | --- | --- | --- | --- |',
    ...rows.map(row => `| ${row.map(markdownCell).join(' | ')} |`)].join('\n');
}
const outputIndex = schema => `<details>\n<summary>输出字段与约束索引（展开引用；成功与错误分支分别列出）</summary>\n\n表中 allOf 分支共同生效；oneOf 恰好一个分支成立，anyOf 至少一个分支成立。条件字段须结合完整 Schema；accessContext 子字段见第3.5节，scope 对应本工具输入。\n\n${fieldTable(schema, true)}\n\n</details>`;
const original = (await readFile(documentPath, 'utf8')).replace(/\r\n/g, '\n');
const headingMatches = [...original.matchAll(/^#### (7\.\d+\.\d+) `([a-z0-9_]+)`$/gm)];
requireInvariant(headingMatches.length === 64 && new Set(headingMatches.map(match => match[2])).size === 64, '文档须恰好包含64个不重复底层工具章节。');
const catalog = new Map(TOOL_DEFINITIONS.map(tool => [tool.name, tool]));
let rendered = original;
for (const heading of headingMatches.reverse()) {
  const tool = catalog.get(heading[2]); requireInvariant(tool, `文档含未登记工具：${heading[2]}`);
  const start = heading.index;
  const tail = original.slice(start + heading[0].length);
  const endMarker = /\n(?:<a id="tool-|### 7\.|## 8\.)/.exec(tail);
  requireInvariant(endMarker, `${tool.name}缺少章节结束标记。`);
  const end = start + heading[0].length + endMarker.index;
  let section = original.slice(start, end);
  const fences = [...section.matchAll(/```json\n([\s\S]*?)\n```/g)];
  requireInvariant(fences.length === 2, `${tool.name}必须恰好包含输入/输出两份JSON Schema。`);
  const schemaForFence = [tool.inputSchema, tool.outputSchema];
  for (let index = 1; index >= 0; index--) {
    const fence = fences[index];
    section = section.slice(0, fence.index) + `\`\`\`json\n${JSON.stringify(schemaForFence[index], null, 2)}\n\`\`\`` + section.slice(fence.index + fence[0].length);
  }
  if (/\*\*作用：\*\*/.test(section)) section = section.replace(/\*\*作用：\*\*[^\n]*/, `**作用：** ${tool.description}`);
  if (tool.name === 'get_character_persons') {
    const tablePattern = /\*\*输入字段与约束\*\*\n\n\|[\s\S]*?(?=\n\n完整输入 Schema：)/;
    if (tablePattern.test(section)) section = section.replace(tablePattern, `**输入字段与约束**\n\n${fieldTable(tool.inputSchema)}`);
    else section = section.replace('完整输入 Schema：', `**输入字段与约束**\n\n${fieldTable(tool.inputSchema)}\n\n完整输入 Schema：`);
  } else if (/\*\*输入字段与约束\*\*/.test(section)) {
    section = section.replace(/(\*\*输入字段与约束\*\*\n\n)\|[\s\S]*?(?=\n\n<details>)/, `$1${fieldTable(tool.inputSchema)}`);
  } else if (tool.name === 'get_person_characters') {
    section = section.replace(/输入字段：\n\n\|[\s\S]*?(?=\n\n运行时规则：)/, `输入字段：\n\n${fieldTable(tool.inputSchema)}`);
  } else throw Error(`${tool.name}缺少可同步输入字段表。`);
  const indexPattern = /<details>\n<summary>输出字段与约束索引[^\n]*<\/summary>[\s\S]*?<\/details>/;
  if (indexPattern.test(section)) section = section.replace(indexPattern, outputIndex(tool.outputSchema));
  else section = section.replace('完整输出 Schema：', `${outputIndex(tool.outputSchema)}\n\n完整输出 Schema：`);
  requireInvariant(section.includes(outputIndex(tool.outputSchema)), `${tool.name}输出字段表未同步。`);
  rendered = rendered.slice(0, start) + section + rendered.slice(end);
}
const batchPattern = /(<summary>完整 execute_write_batch 输入 Schema<\/summary>\n\n)```json\n[\s\S]*?\n```/;
requireInvariant(batchPattern.test(rendered), '宿主batch输入Schema区块缺失。');
rendered = rendered.replace(batchPattern, `$1\`\`\`json\n${JSON.stringify(BATCH_INPUT_SCHEMA, null, 2)}\n\`\`\``);
// 宿主容错策略与结果语义跟随统一输入契约一起更新，保留底层64工具的固定能力。
rendered = rendered.replace(/^执行按计划顺序串行进行[^\n]*$/m,
  '执行按原计划顺序串行进行，同账户写入和登录相关操作受宿主账户队列约束。开始统一核实账户、NSFW及各对象；条目预检错误记录skipped，依赖失败记录blocked，完整预览展示可执行范围和跳过原因。明确拒绝不重试，安全独立范围继续；未知投递隔离冲突域，不重发。账户/权限/授权变化、用户取消或事实持久化失败停止整批，已提交范围仍独立回读。当前用户轮次开始提交后不能追加另一计划；授权不持久化、不随恢复/分支复用。目录创建及添加由bangumi-index Skill指导完整范围和index_from依赖。');
rendered = rendered.replace(/^整批汇总对[^\n]*$/m,
  '整批汇总对 success/submitted/unchanged/skipped/failed/unknown/blocked/not_executed 分别计数；submitted只是提交阶段待核实的中间事实。终态state为success、unchanged、partial、failed或unknown；执行进度为running。partial表示部分范围已核实但仍有跳过、失败、阻塞或未执行项，不表示全部完成。items保留原step，reason/error解释缺口，blockedBy列原依赖步骤，stageResults记录复合子项。failures包含全部已定位错误，failure兼容首项；未知对象仍不能自动重发。');
if (!rendered.includes('| `skipped` |')) rendered = rendered.replace(/^\| `failed` \|/m,
  '| `skipped` | 对象预检未通过或无需发送的错误项；保留原范围、原因及未写入事实 |\n| `blocked` | 前序依赖失败或同冲突范围未知，本项未提交，blockedBy列原依赖步骤 |\n| `failed` |');
rendered = rendered.replace(/^\| `not_executed` \|[^\n]*$/m,
  '| `not_executed` | 整批停止或取消时尚未执行的项；条目跳过与依赖阻塞另以skipped/blocked表示 |');
rendered = rendered.replace(/^\| `\/value\/state` \|[^\n]*$/m,
  '| `/value/state` | `success/unchanged/partial/failed/unknown`；执行更新可为 `running` | 包含正常、部分完成及未知终态；不能据顶层单一状态忽略各项与子阶段结果 |');
rendered = rendered.replace(/^\| `\/value\/partial` \|[^\n]*$/m,
  '| `/value/partial` | 布尔值 | 部分操作或子阶段已独立核实，但原完整范围仍有未完成项；不是全部完成 |');
rendered = rendered.replace(/^\| `\/value\/summary` \|[^\n]*$/m,
  '| `/value/summary` | 对象 | 统计success/submitted/unchanged/skipped/failed/unknown/blocked/not_executed；按逻辑计划项计数，复合子阶段成功须另读stageResults |');
rendered = rendered.replace(/^\| `\/value\/failure` \|[^\n]*$/m,
  '| `/value/failure` | 对象 | 兼容首个已定位错误；完整缺口读取failures与items，取消可能只有整批error |');
if (!rendered.includes('| `/value/failures` |')) rendered = rendered.replace(/^\| `\/value\/failure` \|/m,
  '| `/value/failures` | 数组 | 各已定位错误的phase、原step、tool及可选target/sourceTool/error；不把所有未执行项归因于创建失败 |\n| `/value/failure` |');
rendered = rendered.replace(/^常规终态 `summary`[^\n]*$/m,
  '常规终态summary按items统计，保留原逻辑步骤编号；有未知结果时state=unknown。已核实操作或子阶段与未完成范围共存时state=partial，即使该复合父项为failed且summary.success=0，仍由stageResults呈现已核实子项；无已核实部分且仍有失败/跳过/阻塞时为failed，全部目标核实时为success，全部无需修改时为unchanged。同一代输入中的相同完整计划返回缓存事实，不新增网络写入。');
if (!rendered.includes('| `reason/blockedBy` |')) rendered = rendered.replace(/^\| `step\/tool\/state\/networkAttempted` \|([^\n]*)$/m,
  '| `step/tool/state/networkAttempted` |$1\n| `reason/blockedBy` | 条目跳过或阻塞原因，以及原计划依赖步骤编号数组；未静默删去失败对象 |\n| `stageResults/preflightSkipped` | 复合操作各子项的stage/state/target及可选提交、回读、实际状态和错误；预检不可见子项保留原章节ID与原因 |');
const episodeHostNote = '- 上述失败/未知停止后续是底层单次MCP调用的契约；execute_write_batch宿主先拆分已核实的章节阶段，明确条目失败可继续安全独立阶段，未知仍隔离父作品及相关冲突范围，stageResults保留逐集结果。';
if (!rendered.includes(episodeHostNote)) rendered = rendered.replace(/(^- 宿主核实所有章节[^\n]*出现失败或未知停止后续。)$/m, `$1\n${episodeHostNote}`);
const sourceHasher = createHash('sha256');
for (const path of sourcePaths) {
  const source = sourceSnapshot.get(path);
  requireInvariant(source.equals(await readFile(path)), `同步期间源码变化：${relative(appRoot, path)}；请完成构建后重新同步。`);
  sourceHasher.update(relative(appRoot, path).replaceAll('\\', '/')); sourceHasher.update('\0'); sourceHasher.update(source); sourceHasher.update('\0');
}
for (const [path, modifiedAt] of buildSnapshot) requireInvariant((await stat(path)).mtimeMs === modifiedAt, '同步期间构建产物变化；请等待统一构建结束再同步。');
const sourceHash = sourceHasher.digest('hex');
const toolHash = createHash('sha256').update(JSON.stringify({ tools: TOOL_DEFINITIONS, batchInputSchema: BATCH_INPUT_SCHEMA })).digest('hex');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: appRoot, encoding: 'utf8' }).trim();
rendered = rendered.replace(/Git HEAD `[a-f0-9]+`/, `Git HEAD \`${head.slice(0, 7)}\``)
  .replace(/\| HEAD \|[^\n]*/, `| HEAD | \`${head}\`，包含当前工作区改动 |`)
  .replace(/\| 工具与宿主输入契约 SHA-256 \|[^\n]*/, `| 工具与宿主输入契约 SHA-256 | \`${toolHash}\` |`)
  .replace(/\| 核对时 MCP\/支持源码及 extension\.ts SHA-256 \|[^\n]*/, `| 核对时 MCP/支持源码及 extension.ts SHA-256 | \`${sourceHash}\` |`);
// 重新解析实际输出全文，防止替换落入错误章节、漏项或误引旧Schema。
const actualHeadings = [...rendered.matchAll(/^#### (7\.\d+\.\d+) `([a-z0-9_]+)`$/gm)];
for (let index = 0; index < actualHeadings.length; index++) {
  const match = actualHeadings[index], next = actualHeadings[index + 1]?.index ?? rendered.indexOf('\n## 8.');
  const blocks = [...rendered.slice(match.index, next).matchAll(/```json\n([\s\S]*?)\n```/g)];
  const tool = catalog.get(match[2]);
  requireInvariant(blocks.length === 2 && isDeepStrictEqual(JSON.parse(blocks[0][1]), tool.inputSchema)
    && isDeepStrictEqual(JSON.parse(blocks[1][1]), tool.outputSchema), `${tool.name}完整Schema与最终目录不一致。`);
}
const allBlocks = [...rendered.matchAll(/```json\n([\s\S]*?)\n```/g)];
requireInvariant(allBlocks.length === 129 && isDeepStrictEqual(JSON.parse(allBlocks.at(-1)[1]), BATCH_INPUT_SCHEMA), '全文必须恰好包含128份底层Schema及1份宿主输入Schema。');
if (checking) requireInvariant(rendered === original, 'mcp.md与最新目录不一致；运行 node scripts/sync-mcp-doc.mjs 同步后再校验。');
else if (rendered !== original) await writeFile(documentPath, rendered, 'utf8');
console.log(`${checking ? '一致性校验通过' : '同步完成'}：64工具（50读取/14写入）、129份Schema；契约SHA-256=${toolHash}；源码SHA-256=${sourceHash}`);
