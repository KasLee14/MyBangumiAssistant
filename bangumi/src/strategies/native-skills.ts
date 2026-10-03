import { readFile, realpath } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadToolDefinition, loadSkills } from '@earendil-works/pi-coding-agent';

export const APPLICATION_SKILLS_DIR = fileURLToPath(new URL('./skills/', import.meta.url));

/** 使用 Pi 原生解析与目录描述，只向会话提供应用自身的 skills。 */
export function loadApplicationSkills(cwd: string, agentDir: string) {
  return loadSkills({ cwd, agentDir, skillPaths: [APPLICATION_SKILLS_DIR], includeDefaults: false });
}

/** 保留 Pi 原生读取、分页与渲染，仅用公开 operations 接口限制文件范围。 */
export function createSkillReadTool(cwd: string, skillsDir = APPLICATION_SKILLS_DIR): ReturnType<typeof createReadToolDefinition> {
  const denied = () => new Error('只能读取应用策略目录内的 Markdown 文件。');
  const inside = (root: string, path: string) => {
    const child = relative(root, path);
    return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
  };
  const checkedPath = async (path: string) => {
    const root = resolve(skillsDir);
    if (!inside(root, resolve(path)) || extname(path).toLowerCase() !== '.md') throw denied();
    try {
      const [actualRoot, actualPath] = await Promise.all([realpath(root), realpath(path)]);
      if (!inside(actualRoot, actualPath) || extname(actualPath).toLowerCase() !== '.md') throw denied();
      return actualPath;
    } catch { throw denied(); }
  };
  const native = createReadToolDefinition(cwd, { operations: {
    access: async path => { await checkedPath(path); },
    readFile: async path => readFile(await checkedPath(path)),
  } });
  return {
    ...native,
    description: '读取已列出的应用 Skill 或其 Markdown 参考文件，仅限应用策略目录。支持原生 offset/limit 分页；不支持其他文件、图片或凭据。',
    promptGuidelines: ['任务匹配可用 Skill 时先用 read 读取说明；只读取策略目录内的 Markdown 文件。'],
  };
}
