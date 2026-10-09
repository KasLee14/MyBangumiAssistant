import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** 必须在加载Pi之前指定目录：上游工具缓存模块在import时读取全局路径。 */
export function preparePiEnvironment(argv: readonly string[], env: NodeJS.ProcessEnv): string {
  let dataDir = env.BANGUMI_PI_HOME ?? join(env.LOCALAPPDATA ?? join(homedir(), '.local', 'share'), 'MyBangumiAssistant-Pi');
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--') break;
    if (argv[index] === '--data-dir' && argv[index + 1] && !argv[index + 1]!.startsWith('-')) dataDir = argv[++index]!;
  }
  dataDir = resolve(dataDir);
  env.PI_CODING_AGENT_DIR = join(dataDir, 'pi');
  // 禁止启动时的工具下载/更新检查；不影响已配置模型或Bangumi请求。
  env.PI_OFFLINE ??= '1';
  return dataDir;
}
