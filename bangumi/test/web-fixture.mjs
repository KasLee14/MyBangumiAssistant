import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import { fauxProvider, fauxAssistantMessage, fauxText, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createBangumiRuntime } from '../dist/src/pi-host.js';
import { TaskQueue } from '../dist/src/support/task-queue.js';
import { ProxyController } from '../dist/src/support/proxy-controller.js';
import { policyFor } from '../dist/src/support/proxy.js';
import { WebInteractionChannel } from '../dist/src/web/session.js';
import { WebSessionManager } from '../dist/src/web/session-manager.js';
import { startWebTerminal } from '../dist/src/web/server.js';

export function deferred() {
  let resolve;
  const promise = new Promise(settle => { resolve = settle; });
  return { promise, resolve };
}

export async function eventually(check) {
  const end = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > end) throw new Error('等待会话状态超时');
    await delay(5);
  }
}

function text(content) {
  return typeof content === 'string' ? content : content.filter(part => part.type === 'text').map(part => part.text).join('');
}

export async function fixture(t, { persisted = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bangumi-web-sessions-'));
  const gates = new Map();
  const runtimes = new Map();
  const shutdowns = [];
  const creation = { count: 0, before: async () => {} };
  const faux = fauxProvider();
  faux.setResponses(Array.from({ length: 100 }, () => context => {
    const last = context.messages.at(-1);
    if (last?.role === 'toolResult') return fauxAssistantMessage(`完成：${text(last.content)}`);
    const key = text(context.messages.findLast(message => message.role === 'user').content);
    return fauxAssistantMessage([fauxText(`开始：${key}`), fauxToolCall('hold', { key })], { stopReason: 'toolUse' });
  }));
  const modelRuntime = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: null, allowModelNetwork: false });
  modelRuntime.registerNativeProvider(faux.provider);
  await modelRuntime.setRuntimeApiKey('faux', 'offline-placeholder');
  const sessionDir = join(root, 'sessions');
  const createRuntime = async sessionManager => {
    creation.count++;
    await creation.before(sessionManager);
    const runtime = await createBangumiRuntime({ cwd: root, agentDir: root, sessionManager, modelRuntime,
      provider: 'faux', model: 'faux-1', extension: pi => {
        pi.on('session_shutdown', () => { shutdowns.push(sessionManager.getSessionId()); });
        pi.registerTool({ name: 'hold', label: 'Hold', description: 'Controlled offline tool',
          parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'], additionalProperties: false },
          execute: async (_id, { key }, signal) => {
            const gate = gates.get(key);
            assert.ok(gate, `缺少 ${key} 的控制点`);
            gate.signal = signal;
            gate.started.resolve();
            const onAbort = () => { gate.aborted = true; gate.release.resolve(); };
            signal.addEventListener('abort', onAbort, { once: true });
            if (signal.aborted) onAbort();
            await gate.release.promise;
            signal.removeEventListener('abort', onAbort);
            return { content: [{ type: 'text', text: key }], details: {} };
          },
        });
      } });
    runtimes.set(runtime.session.sessionId, runtime);
    return runtime;
  };
  const initial = await createRuntime(persisted ? SessionManager.create(root, sessionDir) : SessionManager.inMemory(root));
  const initialChannel = new WebInteractionChannel();
  const manager = new WebSessionManager({ initial: { runtime: initial, channel: initialChannel }, createRuntime,
    cwd: root, sessionDir, store: { load: async () => null },
    proxy: new ProxyController(policyFor(null), 'direct'), timeoutMs: 1000, accountQueue: new TaskQueue() });
  await manager.start();
  const terminal = await startWebTerminal({ sessions: manager, port: 19020, open: false });
  const base = `http://127.0.0.1:${terminal.port}`;
  const token = new URL(terminal.url).searchParams.get('token');
  const streams = [];
  t.after(async () => {
    for (const stream of streams) stream.stop();
    await terminal.close();
    await manager.dispose();
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    rmSync(root, { recursive: true, force: true });
  });
  const request = async (clientId, endpoint, body, sessionId, method = 'POST') => {
    const response = await fetch(`${base}/api/${endpoint}`, { method,
      headers: { 'content-type': 'application/json', 'x-bgm-token': token, 'x-bgm-client': clientId,
        ...(sessionId === undefined ? {} : { 'x-bgm-session': sessionId }) },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, value: await response.json() };
  };
  const post = async (client, endpoint, body, sessionId) => {
    const result = await request(client, endpoint, body, sessionId);
    assert.equal(result.status, 200, JSON.stringify(result.value));
    return result.value;
  };
  const state = async (clientId, sessionId) => {
    const result = await request(clientId, 'state', undefined, sessionId, 'GET');
    assert.equal(result.status, 200, JSON.stringify(result.value));
    return result.value;
  };
  const stream = async clientId => {
    const abort = new AbortController();
    const response = await fetch(`${base}/api/events?clientId=${clientId}`, { headers: { 'x-bgm-token': token }, signal: abort.signal });
    assert.equal(response.status, 200);
    const frames = [];
    const reader = response.body.getReader();
    const pump = (async () => {
      let buffer = '';
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const event = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (event.startsWith('data: ')) frames.push(JSON.parse(event.slice(6)));
        }
      }
    })().catch(error => { if (!abort.signal.aborted) throw error; });
    const result = { frames, stop: () => { abort.abort(); }, pump };
    streams.push(result);
    await eventually(() => frames.some(frame => frame.type === 'state'));
    return result;
  };
  const begin = async (clientId, sessionId, key) => {
    const gate = { started: deferred(), release: deferred(), aborted: false };
    gates.set(key, gate);
    await post(clientId, 'submit', { input: key }, sessionId);
    await eventually(() => gate.signal !== undefined);
    return gate;
  };
  return { manager, initial, runtimes, shutdowns, post, request, state, stream, begin, root, sessionDir, creation, gates, terminal };
}


