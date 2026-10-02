// 仅用于 CLI 离线测试：将固定 bgm-cli 子进程入口替换为假子进程，不读取真实配置或发网络请求。
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';

const spawn = childProcess.spawn;
const fixture = fileURLToPath(new URL('./bgm-child.mjs', import.meta.url));
const worker = fileURLToPath(new URL('./bgm-write-child.mjs', import.meta.url));
childProcess.spawn = (command, args, options) => {
  if (args?.[0]?.replaceAll('\\', '/').endsWith('/@aronnaxlin/bgm-cli/src/cli.js') || args?.[0]?.replaceAll('\\', '/').endsWith('/adapters/bgm-cli/read-worker.js')) {
    return spawn(command, [fixture, ...args.slice(1)], options);
  }
  if (args?.[0]?.replaceAll('\\', '/').endsWith('/adapters/bgm-cli/worker.js')) return spawn(command, [worker, ...args.slice(1)], options);
  return spawn(command, args, options);
};
syncBuiltinESMExports();
