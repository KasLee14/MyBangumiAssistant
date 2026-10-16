import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { policyFor, type ProxyOptions } from '../support/proxy.js';
import { shouldCheckForUpdate } from './update.js';

/** 宿主只检查调度状态；下载、解压与建库始终在独立进程，不能阻塞SSE。 */
export function startArchiveUpdateScheduler(root: string, proxy: () => ProxyOptions,
  notice: (message: string) => void = () => {}): () => void {
  let running: ChildProcess | undefined;
  let stopped = false;
  let retryAfter = 0;
  const pointer = () => {
    try { return String((JSON.parse(readFileSync(join(root, 'current.json'), 'utf8')) as { snapshotId?: string }).snapshotId ?? ''); }
    catch { return ''; }
  };
  const check = () => {
    if (stopped || running || Date.now() < retryAfter || !existsSync(join(root, 'current.json'))) return;
    try { if (!shouldCheckForUpdate(root)) return; }
    catch { return; }
    const before = pointer();
    const args = [fileURLToPath(new URL('./cli.js', import.meta.url)), 'update', '--data-dir', root, '--scheduled'];
    const policy = policyFor(proxy());
    const address = policy?.https ?? policy?.http;
    if (address) args.push('--proxy', address);
    else args.push('--direct');
    const child = spawn(process.execPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    running = child;
    // 日志有界消费，后台任务不能因缓冲区积满而挂起，也不把原始资料写进聊天。
    child.stdout?.on('data', () => {});
    child.stderr?.on('data', () => {});
    child.once('error', () => {
      if (running === child) running = undefined;
      retryAfter = Date.now() + 6 * 60 * 60_000;
      if (!stopped) notice('Archive后台更新未能启动；继续使用当前数据快照。');
    });
    child.once('exit', code => {
      if (running === child) running = undefined;
      if (stopped) return;
      if (code !== 0) { retryAfter = Date.now() + 6 * 60 * 60_000; notice('Archive后台更新失败；继续使用当前数据快照，可运行data:status查看原因。'); }
      else if (pointer() !== before) notice('Archive本地快照已更新；正在进行的查询继续使用原版本。');
    });
  };
  const timer = setInterval(check, 60_000);
  timer.unref();
  check();
  return () => { stopped = true; clearInterval(timer); running?.kill(); running = undefined; };
}
