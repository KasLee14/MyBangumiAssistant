import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { TOOL_DEFINITIONS } from '../dist/src/mcp/catalog.js';
import { BATCH_INPUT_SCHEMA } from '../dist/src/mcp/batch-write.js';
import { renderMcpDocument, inputRows } from '../scripts/sync-mcp-doc.mjs';

test('MCP文档只包含字段表，64底层工具和宿主工具各出现一次', () => {
  const rendered = renderMcpDocument(TOOL_DEFINITIONS, BATCH_INPUT_SCHEMA);
  assert.equal(rendered.includes('```'), false);
  assert.equal(rendered.endsWith('\n'), true); assert.equal(rendered.endsWith('\n\n'), false);
  assert.equal(rendered.includes('JSON Schema'), false);
  const names = [...rendered.matchAll(/^## `([a-z0-9_]+)`$/gm)].map(match => match[1]);
  assert.equal(names.length, 65); assert.equal(new Set(names).size, 65);
  assert.deepEqual(names, [...TOOL_DEFINITIONS.map(tool => tool.name), 'execute_write_batch']);
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
test('同一目录重复生成幂等，已保存文档与最终字段声明一致', async () => {
  const first = renderMcpDocument(TOOL_DEFINITIONS, BATCH_INPUT_SCHEMA);
  const second = renderMcpDocument(structuredClone(TOOL_DEFINITIONS), structuredClone(BATCH_INPUT_SCHEMA));
  assert.equal(second, first);
  const digest = text => createHash('sha256').update(text).digest('hex');
  assert.equal(digest((await readFile(new URL('../mcp.md', import.meta.url), 'utf8')).replace(/\r\n/g, '\n')), digest(first), '文档须在最终统一构建后重新同步');
});
