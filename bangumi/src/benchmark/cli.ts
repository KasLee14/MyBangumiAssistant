import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { traceHash, traceRedact } from '../tracing/redact.js';
import { atomicJson } from './worker.js';
import { blankMetrics } from './metrics.js';
import { fixtureDefinition } from './fixtures.js';
import { readSuite, writeReport, type SuiteResult } from './report.js';
import { record, validateCases, type BenchmarkCase, type RunObservation, type WorkerConfig } from './schema.js';
import { selectCases, createExecutionPlan, estimatePlan } from './planning.js';

export const PROJECT_ROOT = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const flags = new Set(['model', 'thinking', 'suite', 'case', 'tag', 'repeats', 'label', 'out', 'root', 'control-root',
  'agent-dir', 'proxy', 'mode', 'cases', 'timeout-ms', 'max-model-requests', 'max-tools', 'max-total-requests', 'baseline', 'candidate',
  'baseline-variant', 'candidate-variant', 'recovery', 'knowledge-dir', 'area', 'subject-type', 'entity', 'component',
  'seed', 'history', 'max-total-tokens', 'prompt-variants', 'changed-files', 'base-ref']);
const switches = new Set(['dry-run', 'include-smoke']);
export function parseArguments(args: string[]): { command: string; values: Record<string, string>; offline: boolean; help: boolean } {
  const command = args[0]?.startsWith('--') ? 'run' : args.shift() ?? 'run', values: Record<string, string> = {};
  let offline = false, help = false;
  if (!['run', 'compare', 'list', 'local'].includes(command)) throw new Error('命令必须是 run、compare、list 或 local。');
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === '--offline') { offline = true; continue; }
    if (arg === '--help') { help = true; continue; }
    const name = arg.startsWith('--') ? arg.slice(2) : '';
    if (switches.has(name)) {
      if (values[name] !== undefined) throw new Error('重复的参数：' + arg);
      values[name] = 'true'; continue;
    }
    if (!flags.has(name) || values[name] !== undefined || !args[index + 1] || args[index + 1]!.startsWith('--')) throw new Error('未知、重复或缺值的参数：' + arg);
    values[name] = args[++index]!;
  }
  return { command, values, offline, help };
}
function positive(value: string | undefined, fallback: number, max: number): number {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) throw new Error('数值参数必须是1至' + max + '之间的整数。');
  return number;
}
function fileHashes(directory: string): Record<string, string> {
  if (!existsSync(directory)) return {};
  const hashes: Record<string, string> = {};
  const visit = (path: string, prefix: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = join(path, entry.name), name = prefix + entry.name;
      if (entry.isDirectory()) visit(child, name + '/');
      else if (entry.isFile() && /\.(?:ts|js|json|md)$/.test(entry.name)) hashes[name] = traceHash(readFileSync(child, 'utf8'));
    }
  };
  visit(directory, ''); return hashes;
}
export function versionFingerprint(root: string) {
  const files: Record<string, unknown> = {};
  for (const path of ['bangumi/src', 'bangumi/dist/src', 'pi/packages/ai/src', 'pi/packages/ai/dist',
    'pi/packages/agent/src', 'pi/packages/agent/dist', 'pi/packages/coding-agent/src', 'pi/packages/coding-agent/dist']) files[path] = fileHashes(join(root, path));
  for (const path of ['bangumi/package.json', 'bangumi/package-lock.json', 'package-lock.json',
    'pi/packages/ai/package.json', 'pi/packages/agent/package.json', 'pi/packages/coding-agent/package.json'])
    if (existsSync(join(root, path))) files[path] = traceHash(readFileSync(join(root, path), 'utf8'));
  // file:依赖或父目录node_modules可能被多个checkout复用，记录实际解析目标。
  for (const name of ['@earendil-works/pi-ai', '@earendil-works/pi-agent-core', '@earendil-works/pi-coding-agent',
    '@earendil-works/pi-tui', '@earendil-works/pi-protocol', '@earendil-works/chord', '@modelcontextprotocol/sdk']) {
    let directory = join(root, 'bangumi');
    while (true) {
      const candidate = join(directory, 'node_modules', name);
      if (existsSync(join(candidate, 'package.json'))) {
        const actual = realpathSync(candidate);
        files['resolved/' + name] = { path: actual, package: traceHash(readFileSync(join(actual, 'package.json'), 'utf8')),
          source: fileHashes(join(actual, 'src')), runtime: fileHashes(join(actual, 'dist')) };
        break;
      }
      const parent = dirname(directory); if (parent === directory) break; directory = parent;
    }
  }
  const git = (args: string[]) => { try { return execFileSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 100000 }).trim(); } catch { return null; } };
  return { hash: traceHash(files), files, git: { head: git(['rev-parse', 'HEAD']), branch: git(['branch', '--show-current']), dirty: Boolean(git(['status', '--porcelain'])) } };
}
export function createPlan(cases: BenchmarkCase[], repeats: number, paired: boolean) {
  const tasks: Array<{ test: BenchmarkCase; repeat: number; variant: string }> = [];
  for (const test of cases) for (let repeat = 1; repeat <= repeats; repeat++) {
    const variants = paired ? repeat % 2 === 1 ? ['control', 'candidate'] : ['candidate', 'control'] : ['candidate'];
    for (const variant of variants) tasks.push({ test, repeat, variant });
  }
  return tasks;
}
/** 显式登记的等义表达才可扩展，不能花模型 token 临时生成测试问题。 */
export function expandPromptVariants(cases: BenchmarkCase[], count: number): BenchmarkCase[] {
  const expanded = cases.flatMap(test => {
    if ((test.promptVariants?.length ?? 0) + 1 < count) throw new Error(test.id + ' 未登记足够的等义表达；请求 ' + count + ' 种。');
    return Array.from({ length: count }, (_, index) => ({ ...test,
      id: index === 0 ? test.id : test.id + '-v' + (index + 1),
      turns: index === 0 ? test.turns : test.promptVariants![index - 1]!,
      sampling: { baseCaseId: test.id, promptVariant: index + 1 },
    }));
  });
  if (new Set(expanded.map(test => test.id)).size !== expanded.length) throw new Error('等义表达展开后的案例 ID 冲突，请调整基础案例 ID。');
  if (expanded.some(test => test.id.length > 80)) throw new Error('等义表达展开后的案例 ID 超过 80 字符，请缩短基础案例 ID。');
  return expanded;
}
export function changedBenchmarkFiles(root: string, baseRef?: string): string[] {
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, windowsHide: true,
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4_000_000 }).split('\0').filter(Boolean);
  try {
    return [...new Set([...git(['diff', '--name-only', '-z', '--relative', baseRef ?? 'HEAD', '--']),
      ...git(['ls-files', '--others', '--exclude-standard', '-z'])])];
  } catch { throw new Error('无法读取改动范围；请检查 --base-ref，或使用 --changed-files 显式指定路径。'); }
}
/** 总量含缓存输入与输出；缺失 usage 保持未知，不能作为零成本继续调度。 */
export function observedBudgetTokens(run: RunObservation): number | null {
  const metrics = run.metrics;
  if (run.error === 'worker_failed_without_result' || run.error === 'worker_deadline_exceeded') return null;
  if (metrics.usageUnavailableRequests > 0) return null;
  const requests = metrics.requests;
  if (requests.length < Math.max(metrics.modelRequests, metrics.providerHttpRequests ?? 0)) return null;
  if (!requests.length) return 0;
  let total = 0;
  for (const request of requests) {
    const supplied = request.totalTokens;
    const context = request.contextInputTokens, output = request.outputTokens;
    const derived = typeof context === 'number' && typeof output === 'number' ? context + output : null;
    if (typeof supplied !== 'number' && derived === null) return null;
    const tokens = Math.max(supplied ?? 0, derived ?? 0);
    if (!Number.isFinite(tokens) || tokens < 0) return null;
    total += tokens;
  }
  return total;
}
export function schedulingStop(execution: { spentRequests: number; spentTokens: number | null },
  maxRequests: number, maxTokens: number | null): string | null {
  if (execution.spentRequests >= maxRequests) return 'global_model_request_budget_exhausted';
  if (maxTokens !== null && execution.spentTokens === null) return 'global_token_usage_unavailable';
  if (maxTokens !== null && execution.spentTokens! >= maxTokens) return 'global_token_budget_exhausted';
  return null;
}
function fallback(config: WorkerConfig, outcome: RunObservation['outcome'], error: string): RunObservation {
  return { schemaVersion: 1, caseId: config.case.id, family: config.case.family, variant: config.variant, repeat: config.repeat,
    protocolHash: config.protocolHash, versionHash: config.versionHash, model: config.model, thinking: config.thinking,
    mode: config.mode, outcome, error, turns: [], metrics: blankMetrics(),
    grade: { passed: false, checks: [], semanticReview: config.case.semanticRubric ? 'pending' : 'not_required', rubric: config.case.semanticRubric ?? null },
    confirmations: [], network: [], traceDirectories: [], captureIssues: [error],
    ...(config.sampling ? { sampling: config.sampling } : {}) };
}
export async function stopWorkerTree(pid: number): Promise<void> {
  if (process.platform === 'win32') await new Promise<void>(done => {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.once('error', () => done()); killer.once('exit', () => done());
  });
  else { try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* 已退出。 */ } } }
}
export async function runWorker(config: WorkerConfig): Promise<RunObservation> {
  mkdirSync(config.outputDir, { recursive: true });
  const configPath = join(config.outputDir, 'worker-config.json'); atomicJson(configPath, config);
  return new Promise(resolveResult => {
    const child = spawn(process.execPath, ['--experimental-import-meta-resolve', fileURLToPath(new URL('./worker.js', import.meta.url)), configPath],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'], detached: process.platform !== 'win32' });
    let timedOut = false, settled = false;
    const complete = () => {
      if (settled) return; settled = true; clearTimeout(timer);
      const path = join(config.outputDir, 'result.json');
      let result: RunObservation;
      try { result = JSON.parse(readFileSync(path, 'utf8')) as RunObservation; }
      catch {
        result = fallback(config, timedOut ? 'timeout' : 'errored', timedOut ? 'worker_deadline_exceeded' : 'worker_failed_without_result');
        try {
          const progress = record(JSON.parse(readFileSync(join(config.outputDir, 'progress.json'), 'utf8'))).metrics;
          if (progress && typeof progress === 'object') result.metrics = { ...blankMetrics(), ...record(progress) };
        } catch { /* 无进度正文时保留明确不可用值。 */ }
        atomicJson(path, result);
      }
      resolveResult(result);
    };
    const timer = setTimeout(() => { timedOut = true; if (child.pid) void stopWorkerTree(child.pid).then(complete); else complete(); }, config.case.budget.timeoutMs + 20000);
    child.once('error', complete); child.once('exit', complete);
  });
}
async function run(values: Record<string, string>, offline: boolean): Promise<void> {
  const dryRun = values['dry-run'] === 'true';
  const mode = values.mode ?? (offline ? 'fixture' : 'local-archive');
  if (!['fixture', 'live-read', 'local-archive'].includes(mode) || offline && mode !== 'fixture') throw new Error('运行模式必须是 fixture、live-read 或 local-archive；offline只能使用fixture。');
  const root = resolve(values.root ?? PROJECT_ROOT), controlRoot = values['control-root'] ? resolve(values['control-root']) : null;
  const knowledgeDir = values['knowledge-dir'] ? resolve(values['knowledge-dir']) : undefined;
  const casesPath = resolve(values.cases ?? join(PROJECT_ROOT, 'bangumi/benchmarks', mode === 'local-archive' ? 'local-archive-cases.json' : mode === 'fixture' ? 'component-tools-cases.json' : 'live-cases.json'));
  const catalog = validateCases(JSON.parse(await readFile(casesPath, 'utf8')));
  const explicitSelection = ['suite', 'case', 'tag', 'area', 'subject-type', 'entity', 'component'].some(key => values[key] !== undefined);
  const area = values.area ?? (explicitSelection ? undefined : 'smoke');
  const affected = area?.split(',').some(value => value.trim() === 'affected') === true;
  const changedFiles = values['changed-files'] !== undefined ? values['changed-files'].split(',').map(path => path.trim()).filter(Boolean)
    : affected ? changedBenchmarkFiles(root, values['base-ref']) : [];
  const selected = selectCases(catalog, {
    ...(values.suite ? { suite: values.suite } : {}), ...(area ? { area } : {}),
    ...(values.case !== undefined ? { case: values.case } : {}), ...(values.tag !== undefined ? { tag: values.tag } : {}),
    ...(values['subject-type'] !== undefined ? { subjectType: values['subject-type'] } : {}),
    ...(values.entity !== undefined ? { entity: values.entity } : {}), ...(values.component !== undefined ? { component: values.component } : {}),
    includeSmoke: values['include-smoke'] === 'true', changedFiles,
  });
  let cases = selected.cases;
  if (offline && cases.some(test => test.id !== 'facts-basic' && !test.offlineScript)) throw new Error('offline只能执行facts-basic或已登记offlineScript，不替代真实模型benchmark。');
  if (!offline && cases.some(test => test.offlineScript)) throw new Error('offlineScript只能在--offline中执行，不混入真实模型结果。');
  const recovery = values.recovery ?? 'disabled';
  if (!['enabled', 'disabled'].includes(recovery)) throw new Error('recovery必须是enabled或disabled。');
  if (mode !== 'fixture' && cases.some(test => test.tags.includes('write') || test.confirmation === 'approve')) throw new Error('只读数据模式不接受写入场景。');
  const model = values.model ?? (offline ? 'faux/faux-1' : '');
  if ((!dryRun || model) && !/^[^/\s]+\/\S+$/.test(model) || offline && model !== 'faux/faux-1') throw new Error('必须用 --model 显式指定 provider/model。');
  const thinking = values.thinking ?? 'off';
  if (!['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(thinking)) throw new Error('thinking级别无效。');
  const repeats = positive(values.repeats, 1, 100), maxRequests = positive(values['max-total-requests'], 500, 100000);
  const maxTokens = values['max-total-tokens'] === undefined ? null : positive(values['max-total-tokens'], 1, Number.MAX_SAFE_INTEGER);
  const promptVariants = positive(values['prompt-variants'], 1, 20), seed = values.seed ?? 'benchmark-v1';
  cases = cases.map(test => ({ ...test, budget: { ...test.budget,
    timeoutMs: positive(values['timeout-ms'], test.budget.timeoutMs, 3600000),
    modelRequests: positive(values['max-model-requests'], test.budget.modelRequests, 500),
    toolExecutions: positive(values['max-tools'], test.budget.toolExecutions, 1000) } }));
  const proxy = values.proxy === 'direct' ? null : values.proxy ?? 'http://127.0.0.1:7890';
  if (proxy !== null && proxy !== 'http://127.0.0.1:7890') throw new Error('本项目网络代理使用 http://127.0.0.1:7890；直连用 --proxy direct。');
  const history = values.history ? (await readSuite(resolve(values.history))).observations.filter(row =>
    row.model === model && row.thinking === thinking && row.mode === mode && row.outcome !== 'not_run' && row.outcome !== 'incomplete_capture') : [];
  const smokeOnly = new Set(cases.filter(test => selected.reasons[test.id]?.every(reason => reason === 'include-smoke')).map(test => test.id));
  const planCases = (definitions: BenchmarkCase[]) => {
    const expanded = definitions.flatMap(test => expandPromptVariants([test], smokeOnly.has(test.id) ? 1 : promptVariants));
    if (new Set(expanded.map(test => test.id)).size !== expanded.length) throw new Error('等义表达展开后的案例 ID 冲突，请调整基础案例 ID。');
    return createExecutionPlan(expanded, repeats, controlRoot !== null, seed)
      .filter(task => !smokeOnly.has(task.test.sampling!.baseCaseId) || task.repeat === 1);
  };
  const previewTasks = planCases(cases);
  const preflight = { catalogCases: catalog.length, selectedCases: cases.length, plannedRuns: previewTasks.length,
    repeats, promptVariants, smokeSupplementRepeats: 1, seed, scope: cases.length === catalog.length ? 'full' : 'selected',
    estimate: estimatePlan(previewTasks, history), budgets: { maxTotalRequests: maxRequests, maxTotalTokens: maxTokens },
    reasons: selected.reasons, unmappedFiles: selected.unmappedFiles,
    budgetPolicy: '调度边界阈值；进行中单例可超出 token 阈值；usage 缺失且启用 token 预算时停止后续案例。' };
  const preview = { dryRun, model: model || null, mode, thinking, selection: selected.selection, ...preflight,
    datasetVerified: false, runs: previewTasks.map(task => ({ caseId: task.test.id, family: task.test.family,
      variant: task.variant, repeat: task.repeat, sampling: task.test.sampling,
      coverage: task.test.coverage ?? null, reason: selected.reasons[task.test.sampling?.baseCaseId ?? task.test.id] ?? [] })) };
  if (dryRun) {
    if (values.out) { const directory = resolve(values.out); mkdirSync(directory, { recursive: true });
      if (['plan.json', 'manifest.json', 'results.json'].some(file => existsSync(join(directory, file)))) throw new Error('目录已有计划或评测，请选择新输出目录。');
      atomicJson(join(directory, 'plan.json'), preview); }
    process.stdout.write(JSON.stringify(preview, null, 2) + '\n'); return;
  }
  process.stdout.write('执行计划：' + cases.length + ' 个基础案例，' + previewTasks.length + ' 次运行；'
    + 'token 估计=' + (preflight.estimate.estimatedTotalTokens ?? '缺少匹配历史') + '，预算=' + (maxTokens ?? '未设置') + '\n');
  for (const test of cases) process.stdout.write('  ' + test.id + ' ×'
    + previewTasks.filter(task => task.test.sampling?.baseCaseId === test.id).length
    + ' [' + (selected.reasons[test.id] ?? []).join(', ') + ']\n');
  if (maxTokens !== null) process.stdout.write(preflight.budgetPolicy + '\n');
  if (selected.unmappedFiles.length) throw new Error('存在未映射改动：' + selected.unmappedFiles.join(', ')
    + '。请先预览并通过 --area 或 --case 显式选择测试，不能把自动推荐当成完整覆盖。');
  if (!cases.length) throw new Error('没有需要执行的案例；请使用 --dry-run 查看推荐，或显式选择能力入口。');
  if (mode === 'local-archive' && !knowledgeDir) throw new Error('local-archive 必须显式指定 --knowledge-dir，避免误用其他数据库；--dry-run 无需数据库。');
  const dataFingerprint = mode === 'local-archive' ? await (await import('./local.js')).datasetFingerprint(knowledgeDir!) : null;
  if (mode === 'local-archive') cases = await (await import('./local.js')).localCaseExpectations(root, knowledgeDir!, dataFingerprint!.snapshotId, cases);
  const tasks = planCases(cases);
  const effectiveCases = [...new Map(tasks.map(task => [task.test.id, task.test])).values()];
  const agentDir = resolve(values['agent-dir'] ?? join(process.env.BANGUMI_PI_HOME ?? join(process.env.LOCALAPPDATA ?? join(homedir(), '.local/share'), 'MyBangumiAssistant-Pi'), 'pi'));
  const output = resolve(values.out ?? join(PROJECT_ROOT, 'bangumi/artifacts/benchmarks', new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8)));
  if (existsSync(join(output, 'results.json')) || existsSync(join(output, 'manifest.json'))) throw new Error('输出目录已有评测，请选择新目录。');
  for (const runtimeRoot of [root, ...(controlRoot ? [controlRoot] : [])]) {
    if (!existsSync(join(runtimeRoot, 'bangumi/dist/src/pi-host.js')) || !existsSync(join(runtimeRoot, 'bangumi/dist/src/mcp/server.js'))) throw new Error('待测版本缺少构建产物，请先在其bangumi目录构建。');
  }
  if (mode === 'local-archive' && controlRoot) {
    const contracts = await Promise.all([root, controlRoot].map(async runtimeRoot => {
      const { TOOL_DEFINITIONS } = await import(pathToFileURL(join(runtimeRoot, 'bangumi/dist/src/mcp/catalog.js')).href);
      const definitions = TOOL_DEFINITIONS as Array<{ name: string; effect: string; inputSchema: unknown; outputSchema: unknown }>;
      const required = ['aggregate_entities', 'get_dataset_status', 'get_entities', 'query_entities', 'query_relations', 'read_cached_resource'];
      if (definitions.length !== 6 || definitions.some(tool => tool.effect !== 'read')
        || JSON.stringify(definitions.map(tool => tool.name).sort()) !== JSON.stringify(required))
        throw new Error('本地 A/B 两侧必须都是六工具只读 Archive 版本，不能与旧 HTTP 数据源配对。');
      return traceHash(definitions.map(tool => ({ name: tool.name, inputSchema: tool.inputSchema, outputSchema: tool.outputSchema })).sort((a, b) => a.name.localeCompare(b.name)));
    }));
    if (contracts[0] !== contracts[1]) throw new Error('本地 A/B 两侧工具契约不同，不能作为同协议性能配对。');
  }
  const versions = { candidate: versionFingerprint(root), ...(controlRoot ? { control: versionFingerprint(controlRoot) } : {}) };
  const fixtures = Object.fromEntries([...new Set(catalog.map(test => test.fixture))].map(id => [id, fixtureDefinition(id)]));
  const modelsPath = join(agentDir, 'models.json');
  const modelConfigHash = () => !offline && existsSync(modelsPath) ? traceHash(traceRedact(JSON.parse(readFileSync(modelsPath, 'utf8')))) : null;
  const protocol = { schemaVersion: 1, cases: catalog, effectiveCases, fixtures,
    harnessHash: traceHash(fileHashes(dirname(fileURLToPath(import.meta.url)))), model, thinking, mode, offline, dataFingerprint,
    modelConfigHash: modelConfigHash(),
    proxy, repeats, maxRequests, retry: recovery, sessions: 'fresh-per-case', cache: 'cold-application-cache', helperTitles: 'disabled',
    runtimeEnvironment: { node: process.version, platform: process.platform, arch: process.arch, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    budgetOverrides: { timeoutMs: values['timeout-ms'] ? Number(values['timeout-ms']) : null,
      modelRequests: values['max-model-requests'] ? Number(values['max-model-requests']) : null, tools: values['max-tools'] ? Number(values['max-tools']) : null } };
  // 筛选范围与重复次数不改变单案例协议；同套件可与此前全量基线按交集配对。
  const protocolHash = traceHash(Object.fromEntries(Object.entries(protocol).filter(([key]) => !['effectiveCases', 'repeats', 'maxRequests'].includes(key))));
  mkdirSync(output, { recursive: true });
  const execution = { stopReason: null as string | null, spentRequests: 0, spentTokens: 0 as number | null,
    knownSpentTokens: 0, usageUnavailableRuns: 0 };
  const manifest = { schemaVersion: 1, label: values.label ?? 'benchmark', startedAt: new Date().toISOString(), node: process.version,
    platform: process.platform, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, root, controlRoot, versions, protocol, protocolHash,
    selection: selected.selection, preflight, execution,
    plannedRuns: tasks.map(task => ({ caseId: task.test.id, family: task.test.family, repeat: task.repeat, variant: task.variant,
      sampling: { ...task.test.sampling!, block: task.repeat } })) };
  atomicJson(join(output, 'manifest.json'), manifest);
  const observations: RunObservation[] = [], runPaths: string[] = [];
  const save = async () => {
    atomicJson(join(output, 'manifest.json'), manifest);
    const result: SuiteResult = { schemaVersion: 1, startedAt: manifest.startedAt, protocolHash, manifest, observations, runPaths };
    atomicJson(join(output, 'results.json'), result); await writeReport(output, result);
  };
  await save();
  for (const [index, task] of tasks.entries()) {
    const runtimeRoot = task.variant === 'control' ? controlRoot! : root;
    const versionHash = task.variant === 'control' ? versions.control!.hash : versions.candidate.hash;
    const config: WorkerConfig = { runtimeRoot, outputDir: join(output, 'runs', task.variant, task.test.id, String(task.repeat)),
      case: task.test, fixture: fixtures[task.test.fixture]!, variant: task.variant, repeat: task.repeat,
      protocolHash, versionHash, model, thinking, mode: mode as WorkerConfig['mode'], agentDir, proxy, offline,
      recovery: recovery as 'enabled' | 'disabled', sampling: { ...task.test.sampling!, block: task.repeat },
      ...(knowledgeDir ? { knowledgeDir } : {}) };
    let result: RunObservation;
    execution.stopReason ??= schedulingStop(execution, maxRequests, maxTokens);
    if (execution.stopReason) { result = fallback(config, 'not_run', execution.stopReason);
      mkdirSync(config.outputDir, { recursive: true }); atomicJson(join(config.outputDir, 'result.json'), result); }
    else {
      config.case = { ...task.test, budget: { ...task.test.budget, modelRequests: Math.min(task.test.budget.modelRequests, maxRequests - execution.spentRequests) } };
      result = await runWorker(config); execution.spentRequests += Math.max(result.metrics.modelRequests, result.metrics.providerHttpRequests ?? 0);
      const tokens = observedBudgetTokens(result);
      if (tokens === null) { execution.spentTokens = null; execution.usageUnavailableRuns++; }
      else { execution.knownSpentTokens += tokens; if (execution.spentTokens !== null) execution.spentTokens += tokens; }
      if (config.case.budget.modelRequests < task.test.budget.modelRequests && result.outcome === 'budget_exceeded')
        result.error = 'global_model_request_budget_exhausted';
    }
    atomicJson(join(config.outputDir, 'result.json'), result);
    observations.push(result); runPaths.push(config.outputDir); await save();
    process.stdout.write('[' + (index + 1) + '/' + tasks.length + '] ' + task.variant + ' ' + task.test.id + ' #' + task.repeat + ' ' + result.outcome
      + ' model=' + result.metrics.modelRequests + ' mcp=' + result.metrics.mcpCalls + ' input=' + (result.metrics.contextInputTokensSum ?? 'N/A') + '\n');
  }
  for (const [variant, runtimeRoot] of [['candidate', root], ...(controlRoot ? [['control', controlRoot]] : [])]) {
    const expected = variant === 'control' ? versions.control!.hash : versions.candidate.hash;
    if (versionFingerprint(runtimeRoot!).hash !== expected) for (const observation of observations.filter(row => row.variant === variant)) {
      observation.outcome = 'incomplete_capture'; observation.captureIssues.push('runtime_version_changed');
      atomicJson(join(runPaths[observations.indexOf(observation)]!, 'result.json'), observation);
    }
  }
  if (modelConfigHash() !== protocol.modelConfigHash) for (const observation of observations) {
    observation.outcome = 'incomplete_capture'; observation.captureIssues.push('model_config_changed');
    atomicJson(join(runPaths[observations.indexOf(observation)]!, 'result.json'), observation);
  }
  if (mode === 'local-archive' && traceHash(await (await import('./local.js')).datasetFingerprint(knowledgeDir!)) !== traceHash(dataFingerprint)) {
    for (const observation of observations) {
      observation.outcome = 'incomplete_capture'; observation.captureIssues.push('dataset_version_changed');
      atomicJson(join(runPaths[observations.indexOf(observation)]!, 'result.json'), observation);
    }
  }
  await save();
  process.stdout.write('报告：' + join(output, 'report.html') + '\n');
  if (observations.some(run => run.outcome !== 'passed')) process.exitCode = 1;
}
export async function main(args = process.argv.slice(2)): Promise<void> {
  const { command, values, offline, help } = parseArguments([...args]);
  if (help) {
    process.stdout.write('benchmark run [--area smoke|query|relations|aggregate|components|resources|conversation|full|affected]\n'
      + '  [--subject-type book|anime|music|game|real] [--entity subject|person|character|episode] [--component StatsCard,DataTable]\n'
      + '  [--case id,id] [--tag tag] [--suite smoke|core|full] [--include-smoke] [--repeats 1] [--prompt-variants 1] [--seed benchmark-v1]\n'
      + '  [--dry-run] [--history RESULTS_JSON] [--changed-files path,path] [--base-ref REF]\n'
      + '  [--model provider/model] [--thinking off] [--mode local-archive|fixture|live-read] [--knowledge-dir PATH]\n'
      + '  [--max-total-requests 500] [--max-total-tokens N] [--control-root PATH] [--out PATH] [--recovery disabled|enabled]\n'
      + '默认冒烟、每例一次；预览不启动模型或读取数据库；token预算在单例完成后检查，进行中单例可能超出。\n'
      + 'benchmark local --knowledge-dir PATH [--repeats 10] [--out PATH]\n'
      + 'benchmark run --offline --cases benchmarks/presentation-cases.json --tag offline-script --suite full\n'
      + 'benchmark compare --baseline RESULTS_JSON --candidate RESULTS_JSON --out PATH\n'
      + 'benchmark list [--area AREA] [--subject-type TYPE] [--component NAME] [--cases PATH]\n'); return;
  }
  if (command === 'local') {
    if (offline || !values['knowledge-dir']) throw new Error('local 使用生产 stdio MCP 和真实本地数据库，必须指定 --knowledge-dir；不接收 --offline。');
    if (Object.keys(values).some(key => !['root', 'knowledge-dir', 'repeats', 'out'].includes(key))) throw new Error('local 仅接受 --root、--knowledge-dir、--repeats 和 --out；真实模型评测使用 run --mode local-archive。');
    await (await import('./local.js')).runLocalBenchmark({ root: resolve(values.root ?? PROJECT_ROOT), knowledgeDir: resolve(values['knowledge-dir']),
      repeats: positive(values.repeats, 10, 100), ...(values.out ? { output: resolve(values.out) } : {}) }); return;
  }
  if (command === 'list') {
    const cases = validateCases(JSON.parse(await readFile(resolve(values.cases ?? join(PROJECT_ROOT, 'bangumi/benchmarks/local-archive-cases.json')), 'utf8')));
    const { caseCoverage } = await import('./planning.js');
    const root = resolve(values.root ?? PROJECT_ROOT);
    const chosen = selectCases(cases, { suite: values.suite ?? 'full',
      ...(values.area ? { area: values.area } : {}), ...(values.case ? { case: values.case } : {}),
      ...(values.tag ? { tag: values.tag } : {}), ...(values['subject-type'] ? { subjectType: values['subject-type'] } : {}),
      ...(values.entity ? { entity: values.entity } : {}), ...(values.component ? { component: values.component } : {}),
      includeSmoke: values['include-smoke'] === 'true',
      changedFiles: values['changed-files']?.split(',') ?? (values.area?.includes('affected') ? changedBenchmarkFiles(root, values['base-ref']) : []),
    });
    for (const test of chosen.cases) process.stdout.write(test.id + '\t' + test.family + '\t' + JSON.stringify(caseCoverage(test)) + '\n');
    if (chosen.unmappedFiles.length) process.stdout.write('未映射改动：' + chosen.unmappedFiles.join(', ') + '\n');
    return;
  }
  if (command === 'compare') {
    if (!values.baseline || !values.candidate || !values.out) throw new Error('compare需要 --baseline、--candidate 和 --out。');
    const [baseline, candidate] = await Promise.all([readSuite(resolve(values.baseline)), readSuite(resolve(values.candidate))]);
    const output = resolve(values.out); mkdirSync(output, { recursive: true });
    await writeReport(output, candidate, baseline, {
      ...(values['baseline-variant'] ? { baselineVariant: values['baseline-variant'] } : {}),
      ...(values['candidate-variant'] ? { candidateVariant: values['candidate-variant'] } : {}),
    });
    process.stdout.write('报告：' + join(output, 'report.html') + '\n'); return;
  }
  await run(values, offline);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  process.stderr.write(String(traceRedact(error instanceof Error ? error.message : 'BENCHMARK_FAILED')) + '\n'); process.exitCode = 1;
});
