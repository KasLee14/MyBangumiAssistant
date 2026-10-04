import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { INITIAL_SCALARS } from '../../web/src/store/reducers/stream.ts';

const browserPath = [process.env.BGM_WEB_TEST_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(path => path && existsSync(path));
const webRoot = fileURLToPath(new URL('../dist/web/', import.meta.url));

/** 仅提供离线 HTTP/SSE 数据；确认与发送端点不会调用真实模型或 Bangumi。 */
async function fixture(t, { pending = null } = {}) {
  let revision = 0;
  let current = 'a';
  let state = { ...INITIAL_SCALARS, ready: true, sessionId: current, sessionName: '会话 A',
    status: pending === null ? '就绪' : '等待授权', startedAt: Date.now(), busy: pending !== null, pending };
  let items = pending === null ? [] : [
    { id: 1, version: 1, kind: 'user', text: '把两部作品评分改为 8 分' },
    { id: 2, version: 1, kind: 'confirmation', confirmation: pending },
  ];
  const streams = new Set();
  const confirmations = [];
  const submissions = [];
  const pageErrors = [];
  let eventConnections = 0;
  let confirmationResponse;
  let submissionResponse;
  const sessions = () => ['a', 'b', 'c'].map(id => ({ id, path: `${id}.jsonl`,
    name: `会话 ${id.toUpperCase()}`, modified: '2026-10-04T00:00:00.000Z', messageCount: 2,
    current: id === current, busy: id === 'b', awaitingLogin: id === 'c',
    awaitingConfirmation: id === current && state.pending !== null }));
  const frame = () => ({ type: 'state', instanceId: 'offline-ui-fixture', revision, full: true,
    state, items });
  const broadcast = () => {
    for (const stream of streams) stream.write(`data: ${JSON.stringify(frame())}\n\n`);
  };
  const json = (response, value, status = 200) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/api/events') {
        eventConnections++;
        response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        response.flushHeaders();
        streams.add(response);
        response.write(`data: ${JSON.stringify(frame())}\n\n`);
        request.on('close', () => streams.delete(response));
        return;
      }
      if (url.pathname === '/api/catalog') {
        json(response, { models: [], providers: [], commands: [], sessions: sessions(), canPersistCredentials: false });
        return;
      }
      if (request.method === 'POST') {
        let raw = '';
        for await (const chunk of request) raw += chunk;
        const body = JSON.parse(raw || '{}');
        if (url.pathname === '/api/session') {
          current = body.sessionId ?? 'b';
          revision++;
          state = { ...state, sessionId: current, sessionName: `会话 ${current.toUpperCase()}`,
            busy: false, pending: null };
          items = [];
          broadcast();
          json(response, frame());
          return;
        }
        if (url.pathname === '/api/confirm') {
          confirmations.push(body);
          confirmationResponse = response;
          return;
        }
        if (url.pathname === '/api/submit') {
          submissions.push({ ...body, sessionId: request.headers['x-bgm-session'] });
          submissionResponse = response;
          return;
        }
        json(response, {});
        return;
      }
      const path = resolve(webRoot, `.${url.pathname === '/' ? '/index.html' : url.pathname}`);
      if (!path.startsWith(resolve(webRoot) + sep)) { response.writeHead(404).end(); return; }
      const mime = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html';
      response.writeHead(200, { 'content-type': mime });
      response.end(readFileSync(path));
    } catch {
      if (!response.headersSent) response.writeHead(404);
      response.end();
    }
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => pageErrors.push(error.message));
  t.after(async () => {
    await browser.close();
    for (const stream of streams) stream.end();
    server.closeAllConnections();
    await new Promise(resolveClose => server.close(resolveClose));
    assert.deepEqual(pageErrors, [], '页面出现未捕获的 JavaScript 错误');
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('.v2Frame').waitFor();
  await page.getByText('已连接', { exact: true }).waitFor();
  await page.locator('.v2SessionRow').first().waitFor();
  const screenshot = async name => {
    const directory = process.env.BGM_WEB_TEST_SCREENSHOT_DIR;
    if (!directory) return;
    mkdirSync(directory, { recursive: true });
    await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
  };
  return { page, screenshot, confirmations, submissions, get eventConnections() { return eventConnections; },
    showActivities(activities, busy = false) {
      revision++;
      state = { ...state, busy, pending: null, status: busy ? '正在等待写入额度' : '就绪' };
      items = [{ id: 1, version: 1, kind: 'user', text: '离线批次反馈' }, ...activities];
      broadcast();
    },
    finishConfirmation() {
      assert.ok(confirmationResponse);
      revision++;
      const confirmed = { ...state.pending, state: 'accepted' };
      state = { ...state, pending: null, busy: false };
      items = items.map(item => item.kind === 'confirmation'
        ? { ...item, version: item.version + 1, confirmation: confirmed } : item);
      broadcast();
      json(confirmationResponse, {});
    },
    failSubmission() {
      assert.ok(submissionResponse);
      json(submissionResponse, { message: '离线测试：提交失败' }, 400);
    },
  };
}

const options = { skip: browserPath === undefined ? '未找到可用的 Chromium 浏览器' : false };

test('新旧两版待授权只呈现一张卡，busy 时仍可确认，结果只保留一条历史记录', options, async t => {
  const pending = { id: 'offline-plan', title: '操作授权', state: 'pending', confirmLabel: '确认授权',
    preview: '需要将以下 2 部作品的评分改为 8 分。\n\n使用账户：测试账户\n\n操作范围：\n• 《作品甲》：评分 7 分 → 8 分\n• 《作品乙》：评分 6 分 → 8 分\n\n请确认是否授权本次操作。',
    hint: '授权仅用于本次列出的操作。' };
  const f = await fixture(t, { pending });
  const { page } = f;
  await page.locator('.planCard[data-state="pending"]').waitFor();
  const connections = f.eventConnections;
  for (const [label, shell] of [['新版', '.v2Frame'], ['旧版', '.frame'], ['新版', '.v2Frame']]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.locator(shell).waitFor();
    await page.waitForFunction(() => {
      const card = document.querySelector('.planCard');
      if (!card) return false;
      for (let node = card; node; node = node.parentElement) {
        if (Number(getComputedStyle(node).opacity) < 0.99) return false;
      }
      return true;
    });
    assert.equal(await page.locator('.planCard').count(), 1);
    assert.equal(await page.locator('.planPreview').textContent(), pending.preview);
    assert.equal(await page.getByRole('button', { name: '确认授权', exact: true }).isEnabled(), true);
    await f.screenshot(label === '新版' ? 'authorization-v2' : 'authorization-v1');
  }
  assert.equal(f.eventConnections, connections, '外观切换重建了 SSE 连接');
  const answerRequest = page.waitForRequest('**/api/confirm');
  await page.getByRole('button', { name: '确认授权', exact: true }).click();
  await answerRequest;
  assert.equal(await page.getByRole('button', { name: '确认授权', exact: true }).isDisabled(), true);
  f.finishConfirmation();
  await page.locator('.planCard[data-state="accepted"]').waitFor();
  assert.equal(await page.locator('.planCard').count(), 1);
  assert.equal(await page.locator('.planCard[data-state="pending"]').count(), 0);
  assert.equal(await page.getByRole('button', { name: '确认授权', exact: true }).count(), 0);
  assert.deepEqual(f.confirmations, [{ id: pending.id, accepted: true }]);
});

test('外观和会话切换保留各自草稿，迟到的发送失败只恢复原会话', options, async t => {
  const f = await fixture(t);
  const { page } = f;
  const input = page.locator('#composer-input');
  await input.fill('A 的草稿');
  for (const label of ['旧版', '新版']) {
    await page.getByRole('button', { name: label, exact: true }).click();
    assert.equal(await input.inputValue(), 'A 的草稿');
  }
  assert.equal(await page.locator('.v2SessionRow').filter({ hasText: '会话 B' }).textContent(), '会话 B运行中');
  assert.equal(await page.locator('.v2SessionRow').filter({ hasText: '会话 C' }).textContent(), '会话 C待登录');
  await page.locator('.v2SessionRow').filter({ hasText: '会话 B' }).click();
  await page.waitForFunction(() => document.querySelector('.v2SessionRow[data-current="true"]')?.textContent?.startsWith('会话 B'));
  assert.equal(await input.inputValue(), '');
  await input.fill('B 的草稿');
  await page.locator('.v2SessionRow').filter({ hasText: '会话 A' }).click();
  await page.waitForFunction(() => document.querySelector('#composer-input')?.value === 'A 的草稿');
  await input.fill('失败的 A');
  const submitRequest = page.waitForRequest('**/api/submit');
  await input.press('Enter');
  await submitRequest;
  assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true);
  await page.locator('.v2SessionRow').filter({ hasText: '会话 B' }).click();
  await page.waitForFunction(() => document.querySelector('#composer-input')?.value === 'B 的草稿');
  await input.fill('B 的新草稿');
  f.failSubmission();
  await page.getByText('离线测试：提交失败', { exact: true }).waitFor();
  assert.equal(await input.inputValue(), 'B 的新草稿');
  await page.locator('.v2SessionRow').filter({ hasText: '会话 A' }).click();
  await page.waitForFunction(() => document.querySelector('#composer-input')?.value === '失败的 A');
  assert.deepEqual(f.submissions, [{ input: '失败的 A', sessionId: 'a' }]);
  assert.equal(f.eventConnections, 1);
});

test('两版活动行展示批次部分完成、未知与额度等待，成功计数仍可见', options, async t => {
  const f = await fixture(t);
  const { page } = f;
  const rows = [
    { id: 2, version: 1, kind: 'activity', label: '执行修改计划', state: 'partial', showDetail: true,
      detail: '已核实 2 项，已跳过 1 项，依赖阻塞 1 项\n第 2 步 《不可见作品》：已跳过；当前可见范围未取得资源' },
    { id: 3, version: 1, kind: 'activity', label: '执行修改计划', state: 'unknown', showDetail: true,
      detail: '已核实 1 项，结果待核实 1 项' },
    { id: 4, version: 1, kind: 'activity', label: '执行修改计划', state: 'ok', showDetail: true,
      detail: '已核实 3 项' },
  ];
  f.showActivities(rows, true);
  for (const label of ['新版', '旧版']) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.locator('.activityRow[data-state="partial"]').waitFor();
    assert.match(await page.locator('.activityRow[data-state="partial"]').textContent(), /未全部完成.*已跳过 1 项.*不可见作品/u);
    assert.match(await page.locator('.activityRow[data-state="unknown"]').textContent(), /结果待核实/u);
    assert.match(await page.locator('.activityRow[data-state="ok"]').textContent(), /已核实 3 项/u);
    assert.equal(await page.locator('.activityRow[data-state="error"]').count(), 0);
    assert.equal(await page.locator('.activityRow[data-state="partial"] br').count(), 1);
  }
  f.showActivities([{ id: 2, version: 2, kind: 'activity', label: '执行修改计划', state: 'waiting', showDetail: true,
    detail: '目录编辑额度等待，预计 10/04 20:05:00 恢复（香港时间）；已提交待核实 15 项。可按 Esc 停止。' }], true);
  await page.locator('.activityRow[data-state="waiting"]').waitFor();
  assert.match(await page.locator('.activityRow[data-state="waiting"]').textContent(), /额度等待.*20:05:00.*Esc/u);
  assert.equal(f.eventConnections, 1);
});
