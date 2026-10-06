#!/usr/bin/env node
/**
 * 一条命令启动 Web 终端，并保证用到的产物都是当前源码编译出来的。
 *
 * 为什么需要它：这个仓库有四层产物，各自有独立的构建命令，漏掉任何一层都会
 * 静默跑旧代码（`npm run web` 只读产物，自己不构建）：
 *
 *   1. Pi 上游产物 `pi/packages/<包名>/dist`             ← `@earendil-works/pi-*` 经 junction 直接 import
 *   2. Pi 模型数据 `pi/packages/ai/src/providers/data`   ← 由 vendor-data 的目录 hydrate，
 *                                                          再被原样拷进该包的 `dist/providers/data`
 *   3. 宿主产物   `bangumi/dist/src`                    ← `tsc`
 *   4. 前端产物   `bangumi/dist/web`                    ← `vite build`
 *
 * 判定方式是**时间戳增量**：只重建「源码比产物新」的层，源码没动时启动只要几秒。
 * 想无条件全量重建用 `--force`；想走官方完整初始化（含 `npm ci` 重装依赖、模型目录哈希校验）
 * 用 `--bootstrap`。
 *
 * 用法（仓库根目录）：
 *   node start.mjs [--force] [--bootstrap] [--dry-run] [宿主参数...]
 *
 *   node start.mjs --no-open --port 9000      # 宿主参数直接透传
 *   node start.mjs --dry-run                  # 只报告哪一层需要重建，不构建也不启动
 *
 * 不做热更新：构建完就以产物形态启动。需要 HMR 用 `bangumi/` 下的 `npm run dev:web`
 * （注意那条路径的宿主进程同样读 `dist/src`，改宿主源码仍需先构建）。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const piDir = join(root, 'pi');
const appDir = join(root, 'bangumi');
const webDir = join(root, 'web');
const hostEntry = join(appDir, 'dist', 'src', 'main.js');
const catalogPath = join(root, 'vendor-data', 'pi-model-catalog.json');

/** 参与新鲜度判定的源码后缀；`.d.ts` 与 `.json` 都不算源码。 */
const SOURCE_EXT = new Set(['.ts', '.tsx', '.css', '.html']);
/** 默认认哪些文件为产物：`.js`（宿主与 Pi）、`.css`（前端样式）。 */
const isRuntimeArtifact = name => name.endsWith('.js') || name.endsWith('.css');
/** Pi 构建在受限环境下会因并行 emit 耗尽内存；限制并行度让 tsc 稳定通过。 */
const PI_BUILD_ENV = { GOMAXPROCS: '4' };

const usage = `用法：node start.mjs [选项] [宿主参数...]

  --force        无条件重建全部产物
  --bootstrap    改为运行 bootstrap-pi.mjs（含 npm ci 重装依赖与模型目录哈希校验），然后启动
  --dry-run      只报告哪一层需要重建，不构建也不启动
  -h, --help     显示本帮助

其余参数原样传给宿主，例如：node start.mjs --no-open --port 9000
`;

function parseArgv(argv) {
  const options = { force: false, bootstrap: false, dryRun: false, passthrough: [] };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--') { options.passthrough.push(...argv.slice(index + 1)); break; }
    if (arg === '--force') { options.force = true; continue; }
    if (arg === '--bootstrap') { options.bootstrap = true; continue; }
    if (arg === '--dry-run') { options.dryRun = true; continue; }
    if (arg === '-h' || arg === '--help') { options.help = true; continue; }
    options.passthrough.push(arg);
  }
  return options;
}

/** 收集源码文件，跳过 node_modules / dist / 点开头目录（.vite 等）。 */
function walk(dir, out = []) {
  let items;
  try { items = readdirSync(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const item of items) {
    const full = join(dir, item.name);
    if (item.isDirectory()) {
      if (item.name === 'node_modules' || item.name === 'dist' || item.name.startsWith('.')) continue;
      walk(full, out);
    } else if (SOURCE_EXT.has(item.name.slice(item.name.lastIndexOf('.')))) {
      out.push(full);
    }
  }
  return out;
}

function mtimeOf(path) {
  return statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? 0;
}

/**
 * 产物目录里最新的运行时文件 mtime，充当「上次构建时间」的基准。
 *
 * 用它做基准而不是「源码最新 mtime」，是为了让判别**幂等**：产物刚构建完时必然晚于
 * 全部源码，于是立刻重跑会得到「无需构建」。`tsc` / `vite` 不改源码 mtime，不会自激。
 *
 * `accept` 决定认哪些文件为产物：宿主/Pi/前端认 `.js`、`.css`；模型数据是纯 `.json`。
 */
function newestArtifact(dir, accept = isRuntimeArtifact) {
  let newest = 0;
  let exists = false;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let items;
    try { items = readdirSync(current, { withFileTypes: true }); }
    catch { continue; }
    for (const item of items) {
      const full = join(current, item.name);
      if (item.isDirectory()) { stack.push(full); continue; }
      if (!accept(item.name)) continue;
      exists = true;
      const mtime = mtimeOf(full);
      if (mtime > newest) newest = mtime;
    }
  }
  return { newest, exists };
}

/** 列出比基准时间新的源码；产物缺失（基准 0）时，任何源码都算新。 */
function newerThan(files, baselineMs) {
  return files.filter(file => mtimeOf(file) > baselineMs);
}

/** pi 依赖是否与 package.json / lockfile 脱节（node_modules 比清单旧）。 */
function piDepsStale() {
  const manifest = Math.max(mtimeOf(join(piDir, 'package.json')), mtimeOf(join(piDir, 'package-lock.json')));
  const installed = mtimeOf(join(piDir, 'node_modules'));
  return installed > 0 && manifest > installed;
}

/** 模型数据：catalog 比已 hydrate 的 providers/data 新。 */
function modelDataStale() {
  if (!existsSync(catalogPath)) return ['缺少 vendor-data/pi-model-catalog.json'];
  const dataDir = join(piDir, 'packages', 'ai', 'src', 'providers', 'data');
  const { newest, exists } = newestArtifact(dataDir, name => name.endsWith('.json'));
  if (!exists) return ['pi/packages/ai/src/providers/data 缺失，需要 hydrate'];
  return mtimeOf(catalogPath) > newest ? ['模型目录比已 hydrate 的数据新'] : [];
}

/** Pi 各包产物。evals 不参与运行时构建，其 dist 缺失不算过期。 */
function piBuildStale() {
  const reasons = [];
  let packages;
  try { packages = readdirSync(join(piDir, 'packages'), { withFileTypes: true }); }
  catch { return ['pi/packages 不可读']; }
  for (const entry of packages) {
    if (!entry.isDirectory() || entry.name === 'evals') continue;
    const pkgDir = join(piDir, 'packages', entry.name);
    const srcDir = join(pkgDir, 'src');
    if (!existsSync(srcDir)) continue;
    const { newest, exists } = newestArtifact(join(pkgDir, 'dist'));
    if (!exists) { reasons.push(`${entry.name} 产物缺失`); continue; }
    const stale = newerThan(walk(srcDir), newest);
    if (stale.length > 0) reasons.push(`${entry.name}（${stale.length} 个源文件较新）`);
  }
  return reasons;
}

/** 宿主与前端产物。两者都由 `npm run build` 覆盖，因此合并成一步重建。 */
function appBuildStale() {
  const reasons = [];

  const host = newestArtifact(join(appDir, 'dist', 'src'));
  if (!host.exists) reasons.push('宿主产物缺失');
  else {
    const stale = newerThan(walk(join(appDir, 'src')), host.newest);
    if (stale.length > 0) reasons.push(`宿主（${stale.length} 个源文件较新）`);
  }

  const web = newestArtifact(join(appDir, 'dist', 'web'));
  if (!web.exists) reasons.push('前端产物缺失');
  else {
    const stale = newerThan(walk(webDir), web.newest);
    if (stale.length > 0) reasons.push(`前端（${stale.length} 个源文件较新）`);
  }

  return reasons;
}

/**
 * 定位 npm 的 JS 入口，以便用 `node npm-cli.js …` 调用。
 *
 * 不直接执行 `npm` / `npm.cmd`：Windows 上它们是批处理，`spawn` 不套 shell 会 EINVAL，
 * 套 shell（`shell: true`）则触发 Node 的 DEP0190 弃用告警——参数只做拼接、不转义。
 * 走 JS 入口两条问题都不存在，参数仍按数组原样传递。
 */
function npmCliPath() {
  const execDir = dirname(process.execPath);
  const candidates = [
    process.env.npm_execpath,
    join(execDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(execDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ...(process.env.PATH ?? '').split(delimiter).map(dir => join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js')),
  ];
  const found = candidates.find(path => path && path.endsWith('npm-cli.js') && existsSync(path));
  if (!found) {
    throw new Error('无法定位 npm-cli.js；请确认 npm 已安装，或改用 node bootstrap-pi.mjs 初始化。');
  }
  return found;
}

/** 构造「用 node 执行 npm 脚本」的命令与参数。 */
function npmRun(script, cwd, note, label = script, env) {
  return {
    label, cmd: process.execPath, args: [npmCliPath(), 'run', script], cwd, note, env,
  };
}

function run(step) {
  process.stdout.write(`\n[构建] ${step.label}\n`);
  const result = spawnSync(step.cmd, step.args, {
    cwd: step.cwd, stdio: 'inherit', windowsHide: true,
    ...(step.env ? { env: { ...process.env, ...step.env } } : {}),
  });
  if (result.error) throw new Error(`${step.label} 无法启动：${result.error.message}`);
  if (result.status !== 0) throw new Error(`${step.label} 失败（退出码 ${result.status}），已停止启动。`);
}

/** 生成重建计划：步骤按依赖顺序排列（模型数据 → Pi → 宿主与前端）。 */
function buildPlan(options) {
  if (options.bootstrap) {
    return [{
      label: 'bootstrap-pi.mjs（完整初始化）',
      cmd: process.execPath, args: [join(root, 'bootstrap-pi.mjs')], cwd: root,
      note: '含 npm ci 重装依赖、模型目录哈希校验、Pi 与应用的完整构建',
      env: PI_BUILD_ENV,
    }];
  }
  if (options.force) {
    // 全量就要覆盖四层：Pi 与模型数据也重建，否则 --force 会有盲区。
    return [
      npmRun('build:offline', piDir, '--force：重建 Pi 上游产物', '构建 Pi 产物', PI_BUILD_ENV),
      npmRun('build', appDir, '--force：重建宿主与前端', '构建宿主与前端'),
    ];
  }

  const steps = [];
  if (piDepsStale()) {
    // 依赖变了就交给官方 bootstrap，它已包含后面全部构建步骤。
    return [{
      label: 'pi 依赖安装 + 全量构建（bootstrap-pi.mjs）',
      cmd: process.execPath, args: [join(root, 'bootstrap-pi.mjs')], cwd: root,
      note: 'pi/package.json 或 lockfile 比 node_modules 新',
      env: PI_BUILD_ENV,
    }];
  }

  const modelReasons = modelDataStale();
  const piReasons = piBuildStale();

  if (modelReasons.length > 0) {
    steps.push({
      label: 'hydrate 模型数据',
      // 该脚本用 Node 24 原生 TS stripping 直接执行 .ts，不需要 tsx。
      cmd: process.execPath,
      args: [join(piDir, 'packages', 'ai', 'scripts', 'hydrate-model-catalog.ts'), catalogPath],
      cwd: piDir, note: modelReasons.join('；'),
    });
  }
  if (piReasons.length > 0 || modelReasons.length > 0) {
    steps.push(npmRun('build:offline', piDir, piReasons.length > 0
      ? `${piReasons.join('；')}（已设 GOMAXPROCS=4 规避 tsc 并行 emit 崩溃）`
      // build:offline 自带 check:model-data 与 dist/providers/data 的重新拷贝，
      // 所以 hydrate 之后必须走它，不能只跑 tsc。
      : '模型数据已更新，需重新拷贝进 dist', '构建 Pi 产物', PI_BUILD_ENV));
  }

  const appReasons = appBuildStale();
  if (appReasons.length > 0) {
    steps.push(npmRun('build', appDir, appReasons.join('；'), '构建宿主与前端'));
  }
  return steps;
}

function main() {
  const options = parseArgv(process.argv.slice(2));
  if (options.help) { process.stdout.write(usage); return 0; }

  const steps = buildPlan(options);

  if (steps.length === 0) {
    process.stdout.write('产物已是最新，无需构建。\n');
  } else {
    process.stdout.write(`需要重建 ${steps.length} 步：\n`);
    for (const step of steps) process.stdout.write(`  - ${step.label}（${step.note}）\n`);
  }

  if (options.dryRun) {
    process.stdout.write('\n--dry-run：未构建、未启动。\n');
    return 0;
  }

  for (const step of steps) run(step);

  if (!existsSync(hostEntry)) {
    throw new Error(`宿主产物仍不存在：${hostEntry}\n请先运行 node bootstrap-pi.mjs 完成初始化。`);
  }

  // 启动走 node 直接执行产物：不经过 shell，参数原样传递，Ctrl+C 也能正常到达子进程。
  const args = [hostEntry, 'web', ...options.passthrough];
  process.stdout.write(`\n[启动] node ${args.join(' ')}\n\n`);
  const child = spawn(process.execPath, args, { cwd: appDir, stdio: 'inherit', windowsHide: true });
  child.on('exit', (code, signal) => {
    if (signal) process.stdout.write(`\n宿主被信号 ${signal} 结束。\n`);
    process.exitCode = code ?? (signal ? 1 : 0);
  });
  return null;
}

try {
  const outcome = main();
  if (outcome !== null) process.exitCode = outcome;
} catch (error) {
  process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
