import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { traceHash, traceRedact } from '../tracing/redact.js';
import { atomicJson } from './worker.js';
import { blankMetrics } from './metrics.js';
import { fixtureDefinition } from './fixtures.js';
import { readSuite, writeReport, type SuiteResult } from './report.js';
import { record, validateCases, type BenchmarkCase, type RunObservation, type WorkerConfig } from './schema.js';

export const PROJECT_ROOT = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const flags = new Set(['model', 'thinking', 'suite', 'case', 'tag', 'repeats', 'label', 'out', 'root', 'control-root',
  'agent-dir', 'proxy', 'mode', 'cases', 'timeout-ms', 'max-model-requests', 'max-tools', 'max-total-requests', 'baseline', 'candidate',
  'baseline-variant', 'candidate-variant', 'recovery']);
export function parseArguments(args: string[]): { command: string; values: Record<string, string>; offline: boolean; help: boolean } {
  const command = args[0]?.startsWith('--') ? 'run' : args.shift() ?? 'run', values: Record<string, string> = {};
  let offline = false, help = false;
  if (!['run', 'compare', 'list'].includes(command)) throw new Error('命令必须是 run、compare 或 list。');
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === '--offline') { offline = true; continue; }
    if (arg === '--help') { help = true; continue; }
    const name = arg.startsWith('--') ? arg.slice(2) : '';
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
function fallback(config: WorkerConfig, outcome: RunObservation['outcome'], error: string): RunObservation {
  return { schemaVersion: 1, caseId: config.case.id, family: config.case.family, variant: config.variant, repeat: config.repeat,
    protocolHash: config.protocolHash, versionHash: config.versionHash, model: config.model, thinking: config.thinking,
    mode: config.mode, outcome, error, turns: [], metrics: blankMetrics(),
    grade: { passed: false, checks: [], semanticReview: config.case.semanticRubric ? 'pending' : 'not_required', rubric: config.case.semanticRubric ?? null },
    confirmations: [], network: [], traceDirectories: [], captureIssues: [error] };
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
  const mode = values.mode ?? 'fixture';
  if (!['fixture', 'live-read'].includes(mode) || offline && mode !== 'fixture') throw new Error('运行模式必须是 fixture 或 live-read；offline只能使用fixture。');
  const root = resolve(values.root ?? PROJECT_ROOT), controlRoot = values['control-root'] ? resolve(values['control-root']) : null;
  const casesPath = resolve(values.cases ?? join(PROJECT_ROOT, 'bangumi/benchmarks', mode === 'fixture' ? 'cases.json' : 'live-cases.json'));
  const catalog = validateCases(JSON.parse(await readFile(casesPath, 'utf8')));
  const suite = values.suite ?? (offline ? 'smoke' : 'core');
  if (!['smoke', 'core', 'full'].includes(suite)) throw new Error('suite必须是 smoke、core 或 full。');
  const ids = values.case?.split(','), tags = values.tag?.split(',');
  if (ids?.some(id => !catalog.some(test => test.id === id))) throw new Error('case包含未登记案例。');
  let cases = catalog.filter(test => ids ? ids.includes(test.id) : suite === 'smoke' ? test.id === 'facts-basic' : suite === 'core' ? test.core : true);
  if (tags) cases = cases.filter(test => tags.some(tag => test.tags.includes(tag)));
  if (!cases.length) throw new Error('案例筛选结果为空。');
  if (offline && cases.some(test => test.id !== 'facts-basic' && !test.offlineScript)) throw new Error('offline只能执行facts-basic或已登记offlineScript，不替代真实模型benchmark。');
  if (!offline && cases.some(test => test.offlineScript)) throw new Error('offlineScript只能在--offline中执行，不混入真实模型结果。');
  const recovery = values.recovery ?? 'disabled';
  if (!['enabled', 'disabled'].includes(recovery)) throw new Error('recovery必须是enabled或disabled。');
  if (mode === 'live-read' && cases.some(test => test.tags.includes('write') || test.confirmation === 'approve')) throw new Error('live-read不接受写入场景。');
  const model = values.model ?? (offline ? 'faux/faux-1' : '');
  if (!/^[^/\s]+\/\S+$/.test(model) || offline && model !== 'faux/faux-1') throw new Error('必须用 --model 显式指定 provider/model。');
  const thinking = values.thinking ?? 'off';
  if (!['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(thinking)) throw new Error('thinking级别无效。');
  const repeats = positive(values.repeats, offline ? 1 : 3, 100), maxRequests = positive(values['max-total-requests'], 500, 100000);
  cases = cases.map(test => ({ ...test, budget: { ...test.budget,
    timeoutMs: positive(values['timeout-ms'], test.budget.timeoutMs, 3600000),
    modelRequests: positive(values['max-model-requests'], test.budget.modelRequests, 500),
    toolExecutions: positive(values['max-tools'], test.budget.toolExecutions, 1000) } }));
  const proxy = values.proxy === 'direct' ? null : values.proxy ?? 'http://127.0.0.1:7890';
  if (proxy !== null && proxy !== 'http://127.0.0.1:7890') throw new Error('本项目网络代理使用 http://127.0.0.1:7890；直连用 --proxy direct。');
  const agentDir = resolve(values['agent-dir'] ?? join(process.env.BANGUMI_PI_HOME ?? join(process.env.LOCALAPPDATA ?? join(homedir(), '.local/share'), 'MyBangumiAssistant-Pi'), 'pi'));
  const output = resolve(values.out ?? join(PROJECT_ROOT, 'bangumi/artifacts/benchmarks', new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8)));
  if (existsSync(join(output, 'results.json')) || existsSync(join(output, 'manifest.json'))) throw new Error('输出目录已有评测，请选择新目录。');
  for (const runtimeRoot of [root, ...(controlRoot ? [controlRoot] : [])]) {
    if (!existsSync(join(runtimeRoot, 'bangumi/dist/src/pi-host.js')) || !existsSync(join(runtimeRoot, 'bangumi/dist/src/mcp/server.js'))) throw new Error('待测版本缺少构建产物，请先在其bangumi目录构建。');
  }
  const versions = { candidate: versionFingerprint(root), ...(controlRoot ? { control: versionFingerprint(controlRoot) } : {}) };
  const fixtures = Object.fromEntries([...new Set(catalog.map(test => test.fixture))].map(id => [id, fixtureDefinition(id)]));
  const modelsPath = join(agentDir, 'models.json');
  const protocol = { schemaVersion: 1, cases: catalog, effectiveCases: cases, fixtures,
    harnessHash: traceHash(fileHashes(dirname(fileURLToPath(import.meta.url)))), model, thinking, mode, offline,
    modelConfigHash: !offline && existsSync(modelsPath) ? traceHash(traceRedact(JSON.parse(readFileSync(modelsPath, 'utf8')))) : null,
    proxy, repeats, maxRequests, retry: recovery, sessions: 'fresh-per-case', cache: 'cold-application-cache', helperTitles: 'disabled',
    runtimeEnvironment: { node: process.version, platform: process.platform, arch: process.arch, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    budgetOverrides: { timeoutMs: values['timeout-ms'] ? Number(values['timeout-ms']) : null,
      modelRequests: values['max-model-requests'] ? Number(values['max-model-requests']) : null, tools: values['max-tools'] ? Number(values['max-tools']) : null } };
  // 筛选范围与重复次数不改变单案例协议；同套件可与此前全量基线按交集配对。
  const protocolHash = traceHash(Object.fromEntries(Object.entries(protocol).filter(([key]) => !['effectiveCases', 'repeats', 'maxRequests'].includes(key))));
  const tasks = createPlan(cases, repeats, controlRoot !== null);
  mkdirSync(output, { recursive: true });
  const manifest = { schemaVersion: 1, label: values.label ?? 'benchmark', startedAt: new Date().toISOString(), node: process.version,
    platform: process.platform, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, root, controlRoot, versions, protocol, protocolHash,
    plannedRuns: tasks.map(task => ({ caseId: task.test.id, family: task.test.family, repeat: task.repeat, variant: task.variant })) };
  atomicJson(join(output, 'manifest.json'), manifest);
  const observations: RunObservation[] = [], runPaths: string[] = [];
  let spent = 0;
  const save = async () => {
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
      recovery: recovery as 'enabled' | 'disabled' };
    let result: RunObservation;
    if (spent >= maxRequests) { result = fallback(config, 'not_run', 'global_model_request_budget_exhausted');
      mkdirSync(config.outputDir, { recursive: true }); atomicJson(join(config.outputDir, 'result.json'), result); }
    else {
      config.case = { ...task.test, budget: { ...task.test.budget, modelRequests: Math.min(task.test.budget.modelRequests, maxRequests - spent) } };
      result = await runWorker(config); spent += Math.max(result.metrics.modelRequests, result.metrics.providerHttpRequests ?? 0);
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
  await save();
  process.stdout.write('报告：' + join(output, 'report.html') + '\n');
  if (observations.some(run => run.outcome !== 'passed')) process.exitCode = 1;
}
export async function main(args = process.argv.slice(2)): Promise<void> {
  const { command, values, offline, help } = parseArguments([...args]);
  if (help) {
    process.stdout.write('benchmark run --model provider/model [--thinking off] [--suite core|full] [--case id,id] [--tag tag] [--repeats 3] [--control-root PATH] [--out PATH] [--agent-dir PATH] [--mode fixture|live-read] [--proxy direct] [--recovery disabled|enabled] [--max-total-requests 500]\nbenchmark run --offline [--cases benchmarks/component-tools-cases.json --suite full --tag offline-script --recovery enabled]\nbenchmark compare --baseline RESULTS_JSON --candidate RESULTS_JSON --out PATH\nbenchmark list [--cases PATH]\n'); return;
  }
  if (command === 'list') {
    const cases = validateCases(JSON.parse(await readFile(resolve(values.cases ?? join(PROJECT_ROOT, 'bangumi/benchmarks/cases.json')), 'utf8')));
    for (const test of cases) process.stdout.write(test.id + '\t' + test.family + '\t' + (test.core ? 'core' : 'extended') + '\t' + test.tags.join(',') + '\n');
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
