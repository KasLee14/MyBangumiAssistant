import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { TOOL_DEFINITIONS } from '../dist/src/mcp/catalog.js';
import { BATCH_INPUT_SCHEMA } from '../dist/src/mcp/batch-write.js';
import { PRESENTATION_TOOL_DEFINITIONS } from '../dist/src/output/presentation-contract.js';
import { COMPONENT_READ_TOOL_DEFINITIONS } from '../dist/src/output/component-tools.js';
import { renderMcpDocument, inputRows } from '../scripts/sync-mcp-doc.mjs';

const hostTools = [...COMPONENT_READ_TOOL_DEFINITIONS, ...PRESENTATION_TOOL_DEFINITIONS];

test('MCP文档只包含字段表，各底层工具和宿主工具各出现一次', () => {
  const rendered = renderMcpDocument(TOOL_DEFINITIONS, BATCH_INPUT_SCHEMA, hostTools);
  assert.equal(rendered.includes('```'), false);
  assert.equal(rendered.endsWith('\n'), true); assert.equal(rendered.endsWith('\n\n'), false);
  assert.equal(rendered.includes('JSON Schema'), false);
  const names = [...rendered.matchAll(/^## `([A-Za-z0-9_]+)`$/gm)].map(match => match[1]);
  const expectedNames = [...TOOL_DEFINITIONS.map(tool => tool.name), 'execute_write_batch', ...hostTools.map(tool => tool.name)];
  assert.equal(names.length, expectedNames.length); assert.equal(new Set(names).size, expectedNames.length);
  assert.deepEqual(names, expectedNames);
  assert.match(rendered, /subjectIds/);
  assert.match(rendered, /blockIndex/);
  assert.ok(rendered.includes('## 公共输出结构'));
  assert.ok(Buffer.byteLength(rendered) < 500_000, '引用结构应去重，不能重新生成巨量全文');
});
test('字段递归保留类型、必填、默认、枚举与边界', () => {
  const rows = inputRows({ type: 'object', properties: { filter: { type: 'object', properties: {
    status: { type: 'integer', enum: [1, 2], default: 1 }, rating: { type: 'number', minimum: 0, maximum: 10 },
    tags: { type: 'array', minItems: 1, maxItems: 10, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 100 } },
  }, required: ['status'], additionalProperties: false } }, required: ['filter'], additionalProperties: false });
  const status = rows.find(row => row[0] === 'filter.status');
  assert.equal(status[1], 'integer'); assert.equal(status[2], '是'); assert.equal(status[3], '1'); assert.match(status[4], /1、2/);
  assert.match(rows.find(row => row[0] === 'filter.rating')[4], /≥ 0；≤ 10/);
  assert.match(rows.find(row => row[0] === 'filter.tags[]')[4], /最短字符数 1；最长字符数 100/);
});
test('宿主共享输入结构只声明一次，保留来源必填与成员边界', () => {
  const selection = { type: 'object', additionalProperties: false, required: ['resourceRef'], properties: {
    resourceRef: { type: 'string', pattern: '^rr_' },
    subjectIds: { type: 'array', minItems: 1, maxItems: 12, uniqueItems: true, items: { type: 'integer', minimum: 1 } },
  } };
  const tools = ['render_First', 'prepare_Second'].map(name => ({ name,
    inputSchema: { type: 'object', additionalProperties: false, required: ['sources'], properties: {
      sources: { type: 'array', minItems: 1, maxItems: 2, items: structuredClone(selection) },
    } }, outputSchema: { type: 'object', properties: { replyId: { type: 'string' } }, required: ['replyId'] },
  }));
  const rendered = renderMcpDocument(TOOL_DEFINITIONS, BATCH_INPUT_SCHEMA, tools);
  const input = rendered.slice(rendered.indexOf('## 公共输入结构'), rendered.indexOf('## 公共输出结构'));
  assert.equal([...input.matchAll(/^### `/gm)].length, 1, '相同嵌套契约应引用同一结构');
  assert.match(input, /\| resourceRef \| string \| 是 \|.*正则 \^rr_/);
  assert.match(input, /\| subjectIds \| array<integer> \| 否 \|.*最多项 12.*元素不重复/);
  assert.match(input, /元素：≥ 1/);
  assert.match(rendered, /\| sources \| array<Input_render_First_sourcesItem> \| 是 \|.*最多项 2/);
});
test('同一目录重复生成幂等，已保存文档与最终字段声明一致', async () => {
  const first = renderMcpDocument(TOOL_DEFINITIONS, BATCH_INPUT_SCHEMA, hostTools);
  const second = renderMcpDocument(structuredClone(TOOL_DEFINITIONS), structuredClone(BATCH_INPUT_SCHEMA), structuredClone(hostTools));
  assert.equal(second, first);
  const digest = text => createHash('sha256').update(text).digest('hex');
  assert.equal(digest((await readFile(new URL('../mcp.md', import.meta.url), 'utf8')).replace(/\r\n/g, '\n')), digest(first), '文档须在最终统一构建后重新同步');
});
