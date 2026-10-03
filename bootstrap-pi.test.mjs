import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectDir = dirname(fileURLToPath(import.meta.url));

function createFixture(t) {
  const rootDir = mkdtempSync(join(tmpdir(), 'bangumi-pi-bootstrap-'));
  t.after(() => {
    const target = resolve(rootDir);
    assert.ok(target.startsWith(`${resolve(tmpdir())}${sep}`));
    assert.ok(basename(target).startsWith('bangumi-pi-bootstrap-'));
    rmSync(target, { recursive: true, force: true });
  });
  const files = [
    'bootstrap-pi.mjs',
    'vendor-data/pi-model-catalog.json',
    'pi/nix/model-catalog.json',
    'pi/packages/ai/scripts/hydrate-model-catalog.ts',
    'pi/packages/ai/scripts/model-data.ts',
    'pi/packages/ai/scripts/check-model-data.ts',
    'pi/packages/ai/src/models.generated.ts',
    ...readdirSync(join(projectDir, 'pi/packages/ai/src/providers'))
      .filter(name => name.endsWith('.models.ts'))
      .map(name => `pi/packages/ai/src/providers/${name}`),
  ];
  for (const file of files) {
    const destination = join(rootDir, file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(projectDir, file), destination);
  }
  writeFileSync(join(rootDir, 'pi/package.json'), '{"type":"module"}\n');
  // 模拟自主定制的本地源码；目录中没有 .git、依赖或旧 artifacts 缓存。
  const modelsPath = join(rootDir, 'pi/packages/ai/src/models.generated.ts');
  writeFileSync(modelsPath, `${readFileSync(modelsPath, 'utf8')}\n// 本项目的本地定制。\n`);
  return rootDir;
}

function hydrate(rootDir) {
  return spawnSync(process.execPath, [join(rootDir, 'bootstrap-pi.mjs'), '--catalog-only'], {
    cwd: rootDir,
    // Git、curl 和 npm 都不在 PATH 中；构建必须只使用仓库内的目录。
    env: { ...process.env, PATH: '', npm_execpath: '' },
    windowsHide: true,
    encoding: 'utf8',
  });
}

test('没有 Git/curl/npm 和缓存时，可从内置目录生成真实 Pi 模型数据，并允许本地定制', t => {
  const rootDir = createFixture(t);
  assert.equal(existsSync(join(rootDir, '.git')), false);
  assert.equal(existsSync(join(rootDir, 'artifacts')), false);
  const result = hydrate(rootDir);
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Generated model data is valid/);
  const dataDir = join(rootDir, 'pi/packages/ai/src/providers/data');
  assert.ok(readdirSync(dataDir).length > 1);
  const snapshot = readdirSync(dataDir).map(name => [name, readFileSync(join(dataDir, name), 'utf8')]);
  const repeated = hydrate(rootDir);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.deepEqual(readdirSync(dataDir).map(name => [name, readFileSync(join(dataDir, name), 'utf8')]), snapshot);
});

test('内置目录被修改后，校验失败并停止生成数据', t => {
  const rootDir = createFixture(t);
  const catalogPath = join(rootDir, 'vendor-data/pi-model-catalog.json');
  writeFileSync(catalogPath, Buffer.concat([readFileSync(catalogPath), Buffer.from('\n')]));
  const result = hydrate(rootDir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SHA-256/);
  assert.equal(existsSync(join(rootDir, 'pi/packages/ai/src/providers/data')), false);
});

test('缺少内置目录时报告仓库不完整，不尝试远程下载', t => {
  const rootDir = createFixture(t);
  unlinkSync(join(rootDir, 'vendor-data/pi-model-catalog.json'));
  const result = hydrate(rootDir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /仓库缺少内置模型目录/);
});

test('缺少本地 Pi 源码时报告仓库不完整，不尝试初始化子模块', t => {
  const rootDir = createFixture(t);
  unlinkSync(join(rootDir, 'pi/package.json'));
  const result = hydrate(rootDir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /仓库缺少本地 Pi 源码/);
});

test('模型目录 pin 不匹配时停止构建', t => {
  const rootDir = createFixture(t);
  writeFileSync(join(rootDir, 'pi/nix/model-catalog.json'), '{"revision":"sha256-invalid"}\n');
  const result = hydrate(rootDir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /本地 Pi 模型目录 pin/);
});
