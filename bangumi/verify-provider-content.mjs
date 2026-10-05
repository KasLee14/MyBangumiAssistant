/** 真实 provider 的只读格式验收：本地凭据仅交给 Pi，不打印请求头或模型原文。 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { createBangumiRuntime } from './dist/src/pi-host.js';
import { createPiTransport } from './dist/src/pi-transport.js';
import { policyFor } from './dist/src/support/proxy.js';
import { CONTENT_OUTPUT_INSTRUCTION, validateMixedContent } from './dist/src/output/content-schema.js';
import { COMPONENT_SELECTION_INSTRUCTION } from './dist/src/output/component-selection.js';

const args = process.argv.slice(2);
const dataDir = args[0] ? resolve(args[0]) : process.env.BANGUMI_PI_HOME
  ?? join(process.env.LOCALAPPDATA ?? join(homedir(), '.local', 'share'), 'MyBangumiAssistant-Pi');
const agentDir = join(dataDir, 'pi');
let settings = {};
try { settings = JSON.parse(readFileSync(join(agentDir, 'settings.json'), 'utf8')); } catch {}
const transport = createPiTransport(policyFor('http://127.0.0.1:7890'));
let runtime;
let requestCount = 0;
let schemaRequests = 0;
let jsonObjectRequests = 0;
let incrementalTextEvents = 0;
let incrementalComponentEvents = 0;
let placeholderSeen = false;
let nextTypeSeen = false;
let answer;
const timer = setTimeout(() => { void runtime?.session.abort(); }, 120_000);
try {
  runtime = await createBangumiRuntime({ cwd: process.cwd(), agentDir,
    sessionManager: SessionManager.inMemory(process.cwd()), fetch: transport.fetch,
    ...(settings.defaultProvider ? { provider: settings.defaultProvider } : {}),
    ...(settings.defaultModel ? { model: settings.defaultModel } : {}),
    extension: pi => {
      pi.on('before_agent_start', event => {
        event.systemPromptOptions.sections.bangumi_content_output = `${CONTENT_OUTPUT_INSTRUCTION}\n${COMPONENT_SELECTION_INSTRUCTION}`;
      });
      pi.on('before_provider_request', event => {
        requestCount++;
        if (event.payload?.text?.format?.type === 'json_schema' || event.payload?.response_format?.type === 'json_schema') schemaRequests++;
        if (event.payload?.response_format?.type === 'json_object') jsonObjectRequests++;
      });
    },
  });
  runtime.session.subscribe(event => {
    if (event.type === 'message_update') {
      if (event.assistantMessageEvent.type === 'text_delta') incrementalTextEvents++;
      if (event.assistantMessageEvent.type === 'content_update') incrementalComponentEvents++;
      const parts = event.message.content ?? [];
      placeholderSeen ||= parts.some(part => part.type === 'subjects' && part.pending === true && Object.keys(part.props).length === 0);
      nextTypeSeen ||= parts.some(part => part.type === 'text' && part.nextType === 'subjects');
    } else if (event.type === 'message_end' && event.message.role === 'assistant') {
      answer = event.message;
    }
  });
  await runtime.session.prompt('这是只读格式验收，全部数据是下列模拟事实，不需要工具。请给我一份作品推荐列表，先一句文字说明，再给作品列表，最后一句解释。已知：示例作品甲，ID1001，动画，评分8.2；示例作品乙，ID1002，动画，评分7.5。只使用这些模拟事实，不编造其他字段。');
  const model = runtime.session.model;
  const base = { provider: model?.provider, model: model?.id, api: model?.api,
    requestCount, schemaRequests, jsonObjectRequests, incrementalTextEvents, incrementalComponentEvents, placeholderSeen, nextTypeSeen, stopReason: answer?.stopReason };
  if (answer?.stopReason !== 'stop') {
    console.log(JSON.stringify({ ...base, valid: false, failure: '模型服务未完成受约束的混合内容输出。' }, null, 2));
    process.exitCode = 1;
  } else {
    const content = answer.content.filter(part => part.type !== 'thinking' && part.type !== 'toolCall').map(part =>
      part.type === 'text' ? { type: 'text', nextType: part.nextType, text: part.text } : part);
    const decoded = validateMixedContent({ content });
    const types = decoded.content.map(part => part.type);
    const valid = JSON.stringify(types) === JSON.stringify(['text', 'subjects', 'text'])
      && decoded.content.filter(part => part.type !== 'text').every(part => part.pending === false);
    console.log(JSON.stringify({ ...base, valid, types, noSidecar: answer.contentOutput === undefined,
      completedComponents: decoded.content.filter(part => part.type !== 'text' && part.pending === false).length,
      toolCalls: answer.content.filter(part => part.type === 'toolCall').length }, null, 2));
    if (!valid) process.exitCode = 1;
  }
} catch {
  console.log(JSON.stringify({ valid: false, requestCount, schemaRequests, failure: 'provider 验收未完成，请在本地检查模型配置与服务能力。' }, null, 2));
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  await runtime?.dispose();
  await transport.close();
}
