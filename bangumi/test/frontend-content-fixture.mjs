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
const frontendRegistryModule = dataModule(`export const CONTENT_RENDERERS=${JSON.stringify(registry)};
export function isContentKind(kind){return Object.hasOwn(CONTENT_RENDERERS,kind)}
export function isBaseTranscriptKind(kind){return ['header','user','assistant','notice','error','activity','confirmation'].includes(kind)}`);
const frontendValidatorCode = transpile(await readFile(new URL('web/src/components/content/validate.ts', root), 'utf8'))
  .replace(/from ['"]\.\/registry['"]/, `from '${frontendRegistryModule}'`);
export const { validateMessageBlock } = await import(dataModule(frontendValidatorCode));

export function providerPart(part) {
  return structuredClone(part);
}
