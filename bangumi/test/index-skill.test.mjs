import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadApplicationSkills } from '../dist/src/strategies/native-skills.js';

test('目录 Skill 由 Pi 原生加载器自动发现，构建产物保持源说明', async () => {
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const result = loadApplicationSkills(cwd, fileURLToPath(new URL('./nonexistent-agent-data/', import.meta.url)));
  const skill = result.skills.find(item => item.name === 'bangumi-index');
  assert.ok(skill, JSON.stringify(result.diagnostics));
  assert.equal(skill.disableModelInvocation, false);
  assert.equal(await readFile(skill.filePath, 'utf8'), await readFile(new URL('../src/strategies/skills/bangumi-index/SKILL.md', import.meta.url), 'utf8'));
});
