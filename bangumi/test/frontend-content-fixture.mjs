import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const root = new URL('../../', import.meta.url);
const dataModule = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const transpile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ES2022,
} }).outputText;
const registrySource = await readFile(new URL('web/src/components/content/registry.tsx', root), 'utf8');
export const registry = Object.fromEntries([...registrySource.matchAll(/  (\w+): \{(?:\s*limit: \{ field: '(\w+)', max: (\d+) \},)?/g)]
  .map(([, kind, limitField, max]) => [kind, { ...(max ? { limit: { field: limitField, max: Number(max) } } : {}) }]));
export const sectionsModule = await import(dataModule(transpile(await readFile(new URL('web/src/page/library/samples.ts', root), 'utf8'))));
// base 条目清单也**从 registry.tsx 提取**，不再在 fixture 里维护第二份副本：
// 这份副本曾经随协议改动漂移（`activity` 改名为 `reasoning`/`tool`/`turn` 后没跟上），
// 而 `BASE_KINDS` 的注释明确写着「清单只此一份」。
const baseKinds = [...(registrySource.match(/export const BASE_KINDS = \[([\s\S]*?)\]/)?.[1] ?? '')
  .matchAll(/'([^']+)'/g)].map(([, kind]) => kind);
const frontendRegistryModule = dataModule(`export const CONTENT_RENDERERS=${JSON.stringify(registry)};
export function isContentKind(kind){return Object.hasOwn(CONTENT_RENDERERS,kind)}
export function isBaseTranscriptKind(kind){return ${JSON.stringify(baseKinds)}.includes(kind)}`);
const frontendValidatorCode = transpile(await readFile(new URL('web/src/components/content/validate.ts', root), 'utf8'))
  .replace(/from ['"]\.\/registry['"]/, `from '${frontendRegistryModule}'`);
export const { validateMessageBlock } = await import(dataModule(frontendValidatorCode));

export function providerPart(part) {
  return structuredClone(part);
}
