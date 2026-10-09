import { analyzeTrace } from './analyze.js';
import { AppError } from '../support/errors.js';

/** 独立诊断入口不加载模型、MCP目录或账户运行时。 */
export async function runTraceAnalyze(argv: readonly string[]): Promise<number> {
  if (argv.length !== 2 || !argv[1]) throw new AppError('INVALID_ARGUMENT', '用法：my-bangumi-assistant trace-analyze <某次 trace 目录>。');
  process.stdout.write(JSON.stringify(await analyzeTrace(argv[1]), null, 2) + '\n');
  return 0;
}
