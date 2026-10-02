#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { preparePiEnvironment } from './isolation.js';

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  preparePiEnvironment(process.argv.slice(2), process.env);
  // Pi依赖的模块级缓存也必须处于隔离目录，不能提前静态import。
  const { launcherMain } = await import('./launcher.js');
  const { safeError } = await import('./support/errors.js');
  await launcherMain().then(code => { process.exitCode = code; }).catch(error => {
    const safe = safeError(error);
    process.stderr.write(`${safe.code}：${safe.message}\n`);
    process.exitCode = 1;
  });
}
