import type { BenchmarkCase, RunObservation } from './schema.js';

export const BENCHMARK_AREAS = ['smoke', 'query', 'relations', 'aggregate', 'components', 'resources', 'conversation', 'full', 'affected'] as const;
export const BENCHMARK_COMPONENTS = ['SubjectCards', 'StatsCard', 'InfoBox', 'DataTable', 'Timeline', 'TagCloud', 'Gallery', 'LinkList', 'QuoteBlock', 'Callout', 'ProgressView', 'CompareTable'] as const;
export interface SelectionOptions {
  suite?: string; area?: string; subjectType?: string; entity?: string; component?: string;
  case?: string; tag?: string; includeSmoke?: boolean; changedFiles?: string[];
}
export interface CaseCoverage { areas: string[]; subjectTypes?: string[]; entities?: string[]; components?: string[]; conditions?: string[] }
export interface SelectionSummary {
  suite: string | null; areas: string[]; subjectTypes: string[]; entities: string[]; components: string[];
  caseIds: string[]; tags: string[]; includeSmoke: boolean; changedFiles: string[];
}
export interface ExecutionTask { test: BenchmarkCase; repeat: number; variant: string }
const values = (value?: string): string[] => value === undefined ? [] : [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))];
const unique = (items: string[]): string[] => [...new Set(items)];
const subjectAliases: Record<string, string> = { '1': 'book', '2': 'anime', '3': 'music', '4': 'game', '6': 'real', realworld: 'real', 'real-world': 'real', 'live-action': 'real', '书籍': 'book', '动画': 'anime', '音乐': 'music', '游戏': 'game', '三次元': 'real' };
const entityAliases: Record<string, string> = { '作品': 'subject', '人物': 'person', '角色': 'character', '章节': 'episode' };
function normalized(items: string[], aliases: Record<string, string>): string[] { return unique(items.map(item => aliases[item.toLowerCase()] ?? item.toLowerCase())); }
function ensureKnown(items: string[], known: readonly string[], dimension: string): void {
  const unknown = items.filter(item => !known.includes(item));
  if (unknown.length) throw new Error('未知' + dimension + '：' + unknown.join(', ') + '。可用值：' + known.join(', '));
}

/** Explicit coverage wins over inference. Legacy cases remain selectable without changing their prompts. */
export function caseCoverage(test: BenchmarkCase): CaseCoverage {
  const explicit = (test as BenchmarkCase & { coverage?: CaseCoverage }).coverage;
  const text = [test.id, test.family, ...test.tags].join(' ').toLowerCase();
  const components = unique(test.rules.flatMap(rule => 'type' in rule && BENCHMARK_COMPONENTS.includes(rule.type as typeof BENCHMARK_COMPONENTS[number]) ? [rule.type] : rule.kind === 'sequence' ? rule.types.filter(type => BENCHMARK_COMPONENTS.includes(type as typeof BENCHMARK_COMPONENTS[number])) : []));
  const tools = test.rules.flatMap(rule => rule.kind === 'called' ? rule.names : []);
  const areas: string[] = [];
  if (/facts|search|query|retrieval|filter|fulltext|pagination/.test(text) || tools.some(tool => /^(?:query_entities|get_entities|search_subjects|get_subject_details)$/.test(tool))) areas.push('query');
  if (/relation|appearances|person.character/.test(text) || tools.some(tool => /relation|person_characters/.test(tool))) areas.push('relations');
  if (/aggregat/.test(text) || tools.some(tool => /^aggregate_/.test(tool))) areas.push('aggregate');
  if (components.length || /component|presentation|capabilit/.test(text)) areas.push('components');
  if (/resource|cache|evidence/.test(text) || tools.includes('read_cached_resource')) areas.push('resources');
  if (test.turns.length > 1 || /conversation|recovery|history|cancel|terminal|stream|followup/.test(text)) areas.push('conversation');
  const subjectTypes = normalized(test.tags.filter(tag => ['book', 'anime', 'music', 'game', 'real', 'real-world'].includes(tag.toLowerCase())), subjectAliases);
  const entities = normalized(test.tags.filter(tag => ['subject', 'person', 'character', 'episode'].includes(tag.toLowerCase())), entityAliases);
  if (test.rules.some(rule => rule.kind === 'subjects') && !entities.includes('subject')) entities.push('subject');
  return { areas: explicit?.areas ?? unique(areas), subjectTypes: explicit?.subjectTypes ?? subjectTypes,
    entities: explicit?.entities ?? entities, components: explicit?.components ?? components, conditions: explicit?.conditions ?? [] };
}

function smokeCases(catalog: BenchmarkCase[]): BenchmarkCase[] {
  const explicit = catalog.filter(test => (test as BenchmarkCase & { smoke?: boolean }).smoke === true);
  return explicit.length ? explicit : catalog.filter(test => test.id === 'local-facts' || test.id === 'facts-basic');
}
function affectedFiles(files: string[]): { areas: string[]; components: string[]; unmappedFiles: string[]; all: boolean } {
  const areas: string[] = [], components: string[] = [], unmappedFiles: string[] = [];
  let all = false;
  for (const raw of files) {
    const path = raw.replace(/\\/g, '/').replace(/^\.\//, '');
    const component = BENCHMARK_COMPONENTS.find(name => new RegExp('(?:^|/)' + name + '(?:[./]|$)', 'i').test(path));
    if (component) { components.push(component); continue; }
    // Shared runtime, data contracts and query planner can affect every capability.
    if (/^(?:.*\/)?pi\/packages\//.test(path) || /(?:^|\/)(?:package(?:-lock)?\.json|tsconfig\.json)$/.test(path)
      || /(?:^|\/)bangumi\/src\/(?:pi-host|pi-transport|extension|interaction|isolation|main)\.ts$/.test(path)
      || /(?:^|\/)bangumi\/src\/(?:output|strategies)\//.test(path)
      || /(?:^|\/)bangumi\/src\/knowledge\/(?:query|schema|store|archive|update)\.ts$/.test(path)) { all = true; continue; }
    if (/\/mcp\/[^/]*(?:relation|person-character|person-candidate)/.test(path)) { areas.push('relations'); continue; }
    if (/\/mcp\/[^/]*(?:resource|cache)/.test(path)) { areas.push('resources'); continue; }
    if (/\/mcp\/[^/]*(?:aggregate)/.test(path)) { areas.push('aggregate'); continue; }
    if (/\/mcp\/[^/]*(?:subject|query|search|facts|local)/.test(path)) { areas.push('query'); continue; }
    if (/\/mcp\/[^/]*(?:presentation|display|component)/.test(path)) { areas.push('components'); continue; }
    if (/\/mcp\//.test(path) || /(?:^|\/)web\//.test(path)) { all = true; continue; }
    if (/\/benchmark\//.test(path) || /\/benchmarks\//.test(path)) { all = true; continue; }
    // Documentation and test-only edits do not alter production behavior. Unknown source files remain visible.
    if (/(?:^|\/)(?:test|tests)\//.test(path) || /\.(?:md|png|jpe?g|svg)$/.test(path)) continue;
    unmappedFiles.push(raw);
  }
  return { areas: unique(areas), components: unique(components), unmappedFiles: unique(unmappedFiles), all };
}

export function selectCases(catalog: BenchmarkCase[], options: SelectionOptions = {}) {
  const areas = values(options.area);
  ensureKnown(areas, BENCHMARK_AREAS, '能力入口');
  const hasFilter = ['area', 'subjectType', 'entity', 'component', 'case', 'tag'].some(key => options[key as keyof SelectionOptions] !== undefined);
  const suite = options.suite ?? (hasFilter ? null : 'core');
  if (suite !== null) ensureKnown([suite], ['core', 'full', 'smoke'], '套件');
  const subjectTypes = normalized(values(options.subjectType), subjectAliases), entities = normalized(values(options.entity), entityAliases);
  ensureKnown(subjectTypes, ['book', 'anime', 'music', 'game', 'real'], '作品类型');
  ensureKnown(entities, ['subject', 'person', 'character', 'episode'], '实体类型');
  const components = values(options.component).map(name => BENCHMARK_COMPONENTS.find(component => component.toLowerCase() === name.toLowerCase()) ?? name);
  ensureKnown(components, BENCHMARK_COMPONENTS, '组件');
  const caseIds = values(options.case), tags = values(options.tag);
  ensureKnown(caseIds, catalog.map(test => test.id), '案例');
  ensureKnown(tags, unique(catalog.flatMap(test => test.tags)), '标签');
  for (const key of ['area', 'subjectType', 'entity', 'component', 'case', 'tag'] as const) if (options[key] !== undefined && !values(options[key]).length) throw new Error('筛选参数不能为空：' + key);
  const changedFiles = options.changedFiles ?? [], affected = affectedFiles(changedFiles);
  if (areas.includes('affected') && !changedFiles.length) throw new Error('affected 入口需要变更文件；请提供 changedFiles 或由 CLI 读取 Git 变更。');
  const smokeIds = new Set(smokeCases(catalog).map(test => test.id)), reasons: Record<string, string[]> = {};
  const selected = catalog.filter(test => {
    const coverage = caseCoverage(test), why: string[] = [];
    if (suite === 'core' && !test.core || suite === 'smoke' && !smokeIds.has(test.id)) return false;
    if (suite) why.push('suite:' + suite);
    const matchingAreas = areas.filter(area => area === 'full' || area === 'smoke' && smokeIds.has(test.id)
      || area === 'affected' && (affected.all || coverage.areas.some(value => affected.areas.includes(value)) || (coverage.components ?? []).some(value => affected.components.includes(value)))
      || coverage.areas.includes(area));
    if (areas.length && !matchingAreas.length) return false;
    why.push(...matchingAreas.map(area => 'area:' + area));
    for (const [name, wanted, present] of [['subject-type', subjectTypes, normalized(coverage.subjectTypes ?? [], subjectAliases)], ['entity', entities, coverage.entities ?? []], ['component', components, coverage.components ?? []], ['case', caseIds, [test.id]], ['tag', tags, test.tags]] as Array<[string, string[], string[]]>) {
      if (wanted.length && !wanted.some(value => present.includes(value))) return false;
      if (wanted.length) why.push(name + ':' + wanted.filter(value => present.includes(value)).join(','));
    }
    reasons[test.id] = why;
    return true;
  });
  if (options.includeSmoke) for (const test of smokeCases(catalog)) {
    if (!selected.some(row => row.id === test.id)) selected.push(test);
    (reasons[test.id] ??= []).push('include-smoke');
  }
  if (!selected.length && !areas.includes('affected')) throw new Error('筛选没有匹配案例；请检查入口及类型、组件等条件。');
  const selection: SelectionSummary = { suite, areas, subjectTypes, entities, components, caseIds, tags, includeSmoke: options.includeSmoke ?? false, changedFiles };
  return { cases: selected, reasons, unmappedFiles: areas.includes('affected') ? affected.unmappedFiles : [], selection };
}

export function createExecutionPlan(cases: BenchmarkCase[], repeats: number, paired: boolean, seed: string | number = 'benchmark'): ExecutionTask[] {
  if (!Number.isSafeInteger(repeats) || repeats < 1) throw new Error('重复次数必须是正整数。');
  let state = 2166136261;
  for (const character of String(seed)) state = Math.imul(state ^ character.charCodeAt(0), 16777619) >>> 0;
  const random = () => { state += 0x6D2B79F5; let value = Math.imul(state ^ state >>> 15, 1 | state); value ^= value + Math.imul(value ^ value >>> 7, 61 | value); return ((value ^ value >>> 14) >>> 0) / 4294967296; };
  const tasks: ExecutionTask[] = [];
  for (let repeat = 1; repeat <= repeats; repeat++) {
    const block = [...cases];
    for (let index = block.length - 1; index > 0; index--) { const other = Math.floor(random() * (index + 1)); [block[index], block[other]] = [block[other]!, block[index]!]; }
    for (const test of block) for (const variant of paired ? repeat % 2 ? ['control', 'candidate'] : ['candidate', 'control'] : ['candidate']) tasks.push({ test, repeat, variant });
  }
  return tasks;
}

export function estimatePlan(tasks: ExecutionTask[], observations: Pick<RunObservation, 'caseId' | 'variant' | 'metrics'>[]) {
  let matchedRuns = 0, tokenRuns = 0, timeRuns = 0, knownTotalTokens = 0, knownTotalMs = 0;
  const usedObservations = new Set<Pick<RunObservation, 'caseId' | 'variant' | 'metrics'>>();
  const mean = (items: number[]) => items.reduce((sum, item) => sum + item, 0) / items.length;
  for (const task of tasks) {
    const history = observations.filter(row => row.caseId === task.test.id && row.variant === task.variant);
    if (history.length) matchedRuns++;
    history.forEach(row => usedObservations.add(row));
    const tokens = history.flatMap(row => row.metrics.totalTokensSum !== null && Number.isFinite(row.metrics.totalTokensSum) && row.metrics.totalTokensSum >= 0 ? [row.metrics.totalTokensSum] : []);
    const durations = history.flatMap(row => Number.isFinite(row.metrics.totalMs) && row.metrics.totalMs >= 0 ? [row.metrics.totalMs] : []);
    if (tokens.length) { tokenRuns++; knownTotalTokens += mean(tokens); }
    if (durations.length) { timeRuns++; knownTotalMs += mean(durations); }
  }
  return { plannedRuns: tasks.length, matchedRuns, missingRuns: tasks.length - matchedRuns, historySamples: usedObservations.size,
    tokenMissingRuns: tasks.length - tokenRuns, timeMissingRuns: tasks.length - timeRuns,
    knownTotalTokens: tokenRuns ? Math.round(knownTotalTokens) : null, knownTotalMs: timeRuns ? Math.round(knownTotalMs) : null,
    estimatedTotalTokens: tokenRuns === tasks.length && tasks.length > 0 ? Math.round(knownTotalTokens) : null,
    estimatedTotalMs: timeRuns === tasks.length && tasks.length > 0 ? Math.round(knownTotalMs) : null };
}
