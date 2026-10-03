#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PI_COMMIT = '9fba660cf1caca0ade5bea72269352416e595a19';
export const CATALOG_REVISION = 'sha256-d28b6de6985826060b6e2ccf589d16800d9fdbc40681ae4c698421c92d2ff86f';
export const CATALOG_URL = `https://pi.dev/api/models/revisions/${CATALOG_REVISION}?types=chat,image,classifier`;

export function verifyCatalog(bytes) {
  const actual = `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
  if (actual !== CATALOG_REVISION) throw new Error('Pi 模型目录 SHA-256 与固定 revision 不符，停止构建。');
}

function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, { cwd, windowsHide: true, shell: false,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`构建步骤失败：${command} ${args[0] ?? ''}`);
  return result.stdout?.trim() ?? '';
}

function findNpmCli() {
  const candidates = [process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ...(process.env.PATH ?? '').split(delimiter).map(path => join(path, 'node_modules', 'npm', 'bin', 'npm-cli.js')),
  ];
  const found = candidates.find(path => path && path.endsWith('npm-cli.js') && existsSync(path));
  if (!found) throw new Error('无法定位 npm-cli.js；请在已安装 Node/npm 的终端运行，或通过 npm exec 启动本脚本。');
  return found;
}

export function bootstrapPi(argv = process.argv.slice(2)) {
  let proxy;
  let catalogOnly = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--catalog-only') { catalogOnly = true; continue; }
    if (arg === '--proxy') {
      const raw = argv[++index];
      if (!raw) throw new Error('--proxy 需要 HTTP/HTTPS 地址。');
      const parsed = new URL(raw);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
        throw new Error('--proxy 仅接受不含凭据的 HTTP/HTTPS 地址。');
      }
      proxy = parsed.href;
      continue;
    }
    throw new Error('用法：node bangumi/scripts/bootstrap-pi.mjs [--proxy http://127.0.0.1:7890] [--catalog-only]');
  }
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major !== 24 || minor < 14) throw new Error('本工程需要 Node.js >=24.14.0 <25。');
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const rootDir = existsSync(join(scriptDir, 'bangumi', 'package.json')) ? scriptDir : resolve(scriptDir, '../..');
  const appDir = join(rootDir, 'bangumi');
  const piDir = join(rootDir, 'pi');
  if (!existsSync(join(piDir, 'package.json'))) {
    run('git', [...(proxy ? ['-c', `http.proxy=${proxy}`] : []), 'submodule', 'update', '--init', '--', 'pi'], rootDir);
  }
  if (run('git', ['rev-parse', 'HEAD'], piDir, true) !== PI_COMMIT) throw new Error('Pi checkout 不是约定的固定提交。');
  run('git', ['diff', '--quiet', 'HEAD', '--'], piDir);
  const pin = JSON.parse(readFileSync(join(piDir, 'nix', 'model-catalog.json'), 'utf8'));
  if (pin.revision !== CATALOG_REVISION) throw new Error('上游模型目录 pin 与约定值不符。');
  const npmCli = catalogOnly ? undefined : findNpmCli();
  const installArgs = ['ci', '--ignore-scripts', '--no-audit', '--no-fund', ...(proxy ? [`--proxy=${proxy}`] : [])];
  if (npmCli) run(process.execPath, [npmCli, ...installArgs], piDir);
  const artifactDir = join(rootDir, 'artifacts');
  mkdirSync(artifactDir, { recursive: true });
  const catalogPath = join(artifactDir, 'pi-model-catalog.json');
  if (!existsSync(catalogPath)) {
    run(process.platform === 'win32' ? 'curl.exe' : 'curl', [
      '--fail', '--silent', '--show-error', '--location', '--max-time', '120',
      '--proto', '=https', '--proto-redir', '=https',
      ...(proxy ? ['--proxy', proxy, '--noproxy', ''] : []),
      CATALOG_URL, '--output', catalogPath,
    ], rootDir);
  }
  verifyCatalog(readFileSync(catalogPath));
  console.log(`固定模型目录校验通过：${CATALOG_REVISION}`);
  // 官方脚本使用 Node 24 原生 TypeScript stripping；不需要 tsx。
  run(process.execPath, ['packages/ai/scripts/hydrate-model-catalog.ts', catalogPath], piDir);
  run(process.execPath, ['packages/ai/scripts/check-model-data.ts'], piDir);
  if (npmCli) {
    run(process.execPath, [npmCli, 'run', 'build:offline'], piDir);
    run(process.execPath, [npmCli, ...installArgs], appDir);
    run(process.execPath, [npmCli, 'run', 'typecheck'], appDir);
    run(process.execPath, [npmCli, 'run', 'build'], appDir);
  }
  run('git', ['diff', '--quiet', 'HEAD', '--'], piDir);
  console.log(catalogOnly ? '固定目录已验证并填充；未安装依赖或重新构建。' : 'Pi 与 Bangumi 应用构建完成。');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { bootstrapPi(); } catch (error) { console.error(error instanceof Error ? error.message : '初始化失败。'); process.exitCode = 1; }
}
