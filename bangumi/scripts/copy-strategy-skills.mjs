import { cpSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(appDir, 'dist');
const target = join(distDir, 'src', 'strategies', 'skills');
const withinDist = relative(distDir, target);
if (withinDist.startsWith('..') || isAbsolute(withinDist)) throw new Error('策略构建目录越界。');
// 清除本应用生成的策略副本，避免移除的 skill 仍在下次构建中被发现。
rmSync(target, { recursive: true, force: true });
cpSync(join(appDir, 'src', 'strategies', 'skills'), target, { recursive: true });
