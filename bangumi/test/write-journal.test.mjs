import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WriteJournal } from '../dist/src/mcp/write-journal.js';
import { registerCredentials } from '../dist/src/support/errors.js';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'bangumi-write-journal-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'writes', 'operations.jsonl');
  return { directory, path, journal: new WriteJournal(path) };
}

test('写入事实同步落盘，重建实例立即读取完整行，entries 副本不修改账本', t => {
  const { path, journal } = fixture(t);
  assert.deepEqual(journal.entries(), []);
  const fact = { kind: 'bangumi-write', phase: 'started', operationId: 'operation-a', stageId: 'stage-a', accountId: 1, tool: 'create_index', recordedAt: '2026-10-04T11:15:00.000Z' };
  journal.append(fact);
  assert.equal(readFileSync(path, 'utf8'), JSON.stringify(fact) + '\n');
  const restarted = new WriteJournal(path);
  assert.deepEqual(restarted.entries(), [fact]);
  const copy = restarted.entries(); copy[0].phase = 'changed';
  assert.equal(restarted.entries()[0].phase, 'started');
  restarted.append({ ...fact, phase: 'submission', writeNetworkAttempted: true });
  assert.equal(journal.entries().length, 2);
});

test('坏尾行不能跳过，明确阻塞并保留原始账本供核实', t => {
  const { path, journal } = fixture(t);
  journal.append({ kind: 'bangumi-write', phase: 'started', operationId: 'operation-a' });
  const broken = readFileSync(path, 'utf8') + '{"kind":"bangumi-write","phase":"submission"';
  writeFileSync(path, broken, 'utf8');
  assert.throws(() => new WriteJournal(path).entries(), error => error.code === 'WRITE_JOURNAL_INVALID' && error.message.includes('第2行'));
  assert.equal(readFileSync(path, 'utf8'), broken);
});

test('授权和凭据字段不得落盘，注册秘密在事实正文中脱敏', t => {
  const { path, journal } = fixture(t);
  for (const field of ['guard', 'permit', 'token', 'input', 'cookie', 'sessionId']) {
    assert.throws(() => journal.append({ kind: 'bangumi-write', [field]: 'forbidden' }), error => error.code === 'WRITE_RECORD_INVALID');
  }
  const secret = 'offline-only-test-private-credential-7453';
  registerCredentials([secret]);
  journal.append({ kind: 'bangumi-write', note: secret });
  assert.equal(readFileSync(path, 'utf8').includes(secret), false);
  assert.equal(journal.entries()[0].note, '[REDACTED]');
});

test('账本不接受 JSON 数组或标量，空尾行允许', t => {
  const { path, journal } = fixture(t); journal.append({ kind: 'bangumi-write' });
  writeFileSync(path, '{"kind":"bangumi-write"}\n\n', 'utf8'); assert.equal(journal.entries().length, 1);
  for (const value of ['[]', 'null', '3']) {
    writeFileSync(path, value + '\n', 'utf8');
    assert.throws(() => journal.entries(), error => error.code === 'WRITE_JOURNAL_INVALID');
  }
});
