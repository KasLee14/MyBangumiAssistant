import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { importArchive, type ImportProgress } from './archive.js';
import { getDatasetStatus, readCurrent } from './store.js';
import { rollbackArchive, shouldCheckForUpdate, updateArchive, verifySnapshot } from './update.js';
import { AppError } from '../support/errors.js';

export async function runKnowledgeCli(argv = process.argv.slice(2)): Promise<void> {
  const command = argv[0] ?? 'status', values = new Map<string, string>(), flags = new Set<string>();
  for (let i = 1; i < argv.length; i++) {
    const key = argv[i]!;
    if (['--force', '--direct', '--no-activate', '--scheduled'].includes(key)) { flags.add(key); continue; }
    if (!['--data-dir', '--source', '--snapshot', '--sha256', '--proxy'].includes(key) || !argv[i + 1] || argv[i + 1]!.startsWith('--')) throw new AppError('INVALID_INPUT', `无效数据管理参数：${key}`);
    values.set(key, argv[++i]!);
  }
  const appData = process.env.BANGUMI_PI_HOME ?? join(process.env.LOCALAPPDATA ?? join(homedir(), '.local', 'share'), 'MyBangumiAssistant-Pi');
  const root = resolve(values.get('--data-dir') ?? process.env.BANGUMI_KNOWLEDGE_DIR ?? join(appData, 'knowledge'));
  const onProgress = (progress: ImportProgress) => process.stderr.write(`${JSON.stringify({ event: 'knowledge-progress', at: new Date().toISOString(), ...progress })}\n`);
  let result: unknown;
  if (command === 'status') result = getDatasetStatus(root);
  else if (command === 'verify') result = await verifySnapshot(root, values.get('--snapshot'));
  else if (command === 'rollback') result = await rollbackArchive(root, values.get('--snapshot'));
  else if (command === 'import' || command === 'init' && values.has('--source')) {
    const source = values.get('--source');
    if (!source) throw new AppError('INVALID_INPUT', 'import 需要 --source ZIP文件或JSONL目录。');
    result = await importArchive({ root, source: resolve(source), activate: !flags.has('--no-activate'), onProgress,
      ...(values.has('--snapshot') ? { snapshotId: values.get('--snapshot')! } : {}), ...(values.has('--sha256') ? { expectedSha256: values.get('--sha256')! } : {}) });
  } else if (command === 'update' || command === 'init') {
    if (flags.has('--scheduled') && !shouldCheckForUpdate(root)) result = { skipped: true, reason: 'not_due' };
    else if (command === 'init' && readCurrent(root) && !flags.has('--force')) result = getDatasetStatus(root);
    else result = await updateArchive({ root, force: flags.has('--force'), onProgress,
      ...(flags.has('--direct') ? { proxy: false } : values.has('--proxy') ? { proxy: values.get('--proxy')! } : {}) });
  } else throw new AppError('INVALID_INPUT', '数据命令为 init、import、update、status、verify、rollback。');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runKnowledgeCli().catch(error => {
    process.stderr.write(`${JSON.stringify({ error: { code: error instanceof AppError ? error.code : 'KNOWLEDGE_OPERATION_FAILED', message: error instanceof Error ? error.message : '数据操作失败。' } })}\n`);
    process.exitCode = 1;
  });
}
