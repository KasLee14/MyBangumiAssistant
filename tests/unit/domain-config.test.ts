import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig, pathsFor } from '../../src/config/config.js';
import { progressCapability, keyword } from '../../src/domain/bangumi.js';
import { subjectFrom } from '../../src/adapters/bgm-cli/normalize.js';
import { redact, StreamingRedactor } from '../../src/domain/errors.js';

test('五类条目类型正确映射；缺失字段保留未知', () => {
  for (const [id,type] of [[1,'book'],[2,'anime'],[3,'music'],[4,'game'],[6,'real']] as const) {
    const item = subjectFrom({ id: 123, type: id, name: '测试', nameCN: '中文' });
    assert.equal(item.type, type); assert.equal(item.nameCn, '中文'); assert.equal(item.score, null);
  }
  assert.throws(() => subjectFrom({ id: 0, type: 2 }));
  assert.throws(() => subjectFrom({ id: 1, type: 99 }));
});

test('原生进度支持范围与服务端限制一致', () => {
  assert.deepEqual(progressCapability('book').units, ['chapter','volume']);
  assert.equal(progressCapability('anime').supported, true);
  assert.equal(progressCapability('real').supported, true);
  assert.equal(progressCapability('game').supported, false);
  assert.equal(progressCapability('music').supported, false);
});

test('关键词不允许选项注入，普通 shell 字符作为数据保留', () => {
  assert.throws(() => keyword('--help'));
  assert.throws(() => keyword('x\u0000y'));
  assert.equal(keyword('作品; $HOME'), '作品; $HOME');
});

test('默认引用现有环境变量；配置不包含密钥值；显式 null 关闭代理', () => {
  const config = parseConfig({}, { ANTHROPIC_AUTH_TOKEN: 'test-secret' });
  assert.equal(config.models.deepseek?.apiKeyEnv, 'ANTHROPIC_AUTH_TOKEN');
  assert.ok(!JSON.stringify(config).includes('test-secret'));
  assert.equal(parseConfig({}, { DEEPSEEK_API_KEY: 'test-secret' }).models.deepseek?.apiKeyEnv, 'DEEPSEEK_API_KEY');
  assert.equal(parseConfig({ proxy: null }, { BANGUMI_AGENT_PROXY: 'http://127.0.0.1:7890' }).proxy, null);
  assert.equal(parseConfig({}, { BANGUMI_AGENT_PROXY: 'http://127.0.0.1:7890' }).proxy, 'http://127.0.0.1:7890');
});

test('拒绝凭据 URL、协议地址混用、Claude 后缀和无效配置', () => {
  for (const value of [
    { models: { deepseek: { baseUrl: 'https://api.deepseek.com/anthropic', model: 'deepseek-flash', apiKeyEnv: 'KEY' } } },
    { models: { deepseek: { baseUrl: 'https://x.test', model: 'deepseek-flash[1m]', apiKeyEnv: 'KEY' } } },
    { proxy: 'http://user:password@localhost:7890' },
    { maxSteps: 1000 }, { activeModel: 'missing' },
  ]) assert.throws(() => parseConfig(value, {}));
  const paths = pathsFor({ BANGUMI_AGENT_HOME: 'E:/Project/BangumiAgent/test-user' });
  assert.ok(paths.sessions.endsWith('sessions'));
});

test('错误信息脱敏覆盖已知凭据与 Cookie', () => {
  const result = redact('known-secret Bearer unknown-secret chiiNextSessionID=cookie-value;', ['known-secret']);
  assert.ok(!result.includes('known-secret')); assert.ok(!result.includes('unknown-secret')); assert.ok(!result.includes('cookie-value'));
});

test('跨流式片段的凭据和 JSON 转义凭据同样脱敏', () => {
  const stream = new StreamingRedactor(['test-secret']);
  const output = stream.push('普通文本 test-') + stream.push('secret 更多文本') + stream.finish();
  assert.ok(!output.includes('test-secret')); assert.match(output,/REDACTED/);
  assert.ok(!redact(JSON.stringify({ value: 'secret\nvalue' }),['secret\nvalue']).includes('secret'));
});
