import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cpus, totalmem } from 'node:os';
import { traceHash } from '../tracing/redact.js';
import { blankMetrics } from './metrics.js';
import { versionFingerprint } from './cli.js';
import { atomicJson } from './worker.js';
import { median, writeReport, type SuiteResult } from './report.js';
import { record, type BenchmarkCase, type RunObservation, type WorkerConfig } from './schema.js';

async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/** 验证实际数据库内容，不能仅以清单宣称的摘要替代本次证据。 */
export async function datasetFingerprint(root: string) {
  const pointer = record(JSON.parse(readFileSync(join(root, 'current.json'), 'utf8')));
  const id = String(pointer.snapshotId);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}$/.test(id) || id.includes('..')) throw new Error('评测快照标识无效。');
  const directory = join(root, 'snapshots', id), manifest = record(JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')));
  const database = record(manifest.database), path = join(directory, 'catalog.sqlite');
  if (manifest.snapshotId !== id || database.file !== 'catalog.sqlite') throw new Error('评测数据清单与当前快照不一致。');
  const actualSha256 = await fileSha256(path), bytes = statSync(path).size;
  if (actualSha256 !== String(database.sha256).toLowerCase() || bytes !== database.bytes) throw new Error('实际 SQLite 与快照清单摘要不一致。');
  return { snapshotId: id, manifestHash: traceHash(manifest), databaseSha256: actualSha256, bytes,
    source: manifest.source, counts: manifest.counts, capabilities: manifest.capabilities };
}

/** 预期事实只写入评分配置，用户prompt和实际模型上下文始终不含答案。 */
export async function localCaseExpectations(root: string, knowledgeDir: string, snapshotId: string, cases: BenchmarkCase[]): Promise<BenchmarkCase[]> {
  const needsFacts = cases.some(test => test.id === 'local-facts'), needsRelations = cases.some(test => test.id === 'local-relations');
  const needsAlignment = cases.some(test => ['local-score-card', 'local-page-cards', 'local-capability-limits'].includes(test.id));
  if (!needsFacts && !needsRelations && !needsAlignment) return cases;
  const { openSnapshot } = await import(pathToFileURL(join(root, 'bangumi/dist/src/knowledge/store.js')).href);
  const snapshot = openSnapshot(knowledgeDir, snapshotId);
  try {
    const subject = record(snapshot.db.prepare("SELECT name,name_cn,score,date FROM entities WHERE kind='subject' AND id=253").get());
    if (!subject.name) throw new Error('本地事实案例缺少条目 253。');
    const escape = (value: unknown) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expectations = [String(subject.name), ...(subject.name_cn ? [String(subject.name_cn)] : [])].map(pattern => ({ kind: 'text' as const, pattern: escape(pattern) }));
    if (typeof subject.score === 'number') expectations.push({ kind: 'text', pattern: escape(subject.score) + '(?:0)*(?![0-9])' });
    if (typeof subject.date === 'string') {
      const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(subject.date);
      expectations.push({ kind: 'text', pattern: date ? date[1] + '[-年/]' + Number(date[2]).toString().replace(/^/, '0?')
        + '[-月/]' + Number(date[3]).toString().replace(/^/, '0?') : escape(subject.date) });
    }
    const relationPeople = needsRelations ? snapshot.db.prepare("SELECT id FROM entities WHERE kind='person' AND nsfw=0 AND id IN (SELECT target_id FROM relations WHERE source_kind='subject' AND source_id=253 AND target_kind='person' UNION SELECT source_id FROM relations WHERE target_kind='subject' AND target_id=253 AND source_kind='person') ORDER BY id LIMIT 10").all() as Array<{ id: number }> : [];
    if (needsRelations && relationPeople.length !== 10) throw new Error('制作人员案例缺少可验证的前 10 人窗口。');
    // text 检查最终 canonical 的可见文字，包含表格单元与 LinkList URL；工具仅查到链接不能通过。
    const relationLinks = relationPeople.map(row => ({ kind: 'text' as const,
      pattern: escape(`https://bgm.tv/person/${row.id}`) + '/?(?=$|[\\s?#)\\]>，。；、！!;:,（])' }));
    const scoreRows = needsAlignment ? snapshot.db.prepare('SELECT score,count FROM subject_scores WHERE subject_id=253 ORDER BY score DESC').all().map(record) : [];
    const scoreTotal = scoreRows.reduce((total: number, row: Record<string, unknown>) => total + Number(row.count), 0);
    if (cases.some(test => test.id === 'local-score-card') && (scoreRows.length !== 10 || scoreTotal <= 0 || typeof subject.score !== 'number'))
      throw new Error('真实评分卡案例缺少完整有票分布或原评分，不能生成无效字段 oracle。');
    const pageIds = needsAlignment ? snapshot.db.prepare("SELECT id FROM entities WHERE kind='subject' AND nsfw=0 AND subject_type=2 AND year=2024 ORDER BY id LIMIT 5").all().map((row: { id: number }) => row.id) : [];
    const pageTotal = needsAlignment ? Number(snapshot.db.prepare("SELECT count(*) AS count FROM entities WHERE kind='subject' AND nsfw=0 AND subject_type=2 AND year=2024").get().count) : 0;
    const alignmentRules = (test: BenchmarkCase): BenchmarkCase['rules'] => test.id === 'local-score-card'
      ? [{ kind: 'component_props', type: 'StatsCard', expected: { headline: { value: String(subject.score) }, mode: 'histogram',
        entries: scoreRows.map((row: Record<string, unknown>) => ({ label: String(row.score), value: String(row.count), ratio: Number(row.count) / scoreTotal })) } }]
      : test.id === 'local-page-cards' ? [{ kind: 'subjects', exact: pageIds }, { kind: 'component_props', type: 'SubjectCards', expected: {
        total: pageTotal, layout: 'list', items: pageIds.map((id: number) => ({ id })) } }]
      : [];
    return cases.map(test => test.id === 'local-facts' ? { ...test, rules: [...test.rules.filter(rule => rule.kind !== 'evidence'), ...expectations] }
      : test.id === 'local-relations' ? { ...test, rules: [...test.rules, ...relationLinks] }
      : needsAlignment && ['local-score-card', 'local-page-cards'].includes(test.id) ? { ...test, rules: [...test.rules, ...alignmentRules(test)] } : test);
  } finally { snapshot.close(); }
}

type Measurements = { timingsMs: Record<string, number>; bytes: Record<string, number>; checks: Array<{ name: string; passed: boolean; detail: string }> };
type LocalObservation = RunObservation & { localMeasurements: Measurements };
const byteLength = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const rows = (value: unknown) => Array.isArray(record(value).data) ? (record(value).data as unknown[]).map(record) : [];
const ids = (value: unknown) => rows(value).map(row => Number(row.id));
const percentile95 = (values: number[]) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]! : null;

/** 无模型的真实性能层：真实全量库、生产 stdio、字段投影、任务缓存及 PresentationStore。 */
export async function runLocalBenchmark(options: { root: string; knowledgeDir: string; repeats: number; output?: string }): Promise<void> {
  const root = resolve(options.root), knowledgeDir = resolve(options.knowledgeDir);
  const output = resolve(options.output ?? join(root, 'bangumi/artifacts/benchmarks', 'local-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8)));
  if (existsSync(join(output, 'manifest.json')) || existsSync(join(output, 'results.json'))) throw new Error('输出目录已有评测，拒绝覆盖。');
  mkdirSync(output, { recursive: true });
  const data = await datasetFingerprint(knowledgeDir), version = versionFingerprint(root);
  const module = (name: string) => import(pathToFileURL(join(root, 'bangumi/dist/src', name + '.js')).href);
  const [{ LocalMcpClient }, { PresentationStore }, { openSnapshot }, { buildFtsQuery }, { TOOL_DEFINITIONS }, { COMPONENT_DATA_PROFILES }] = await Promise.all([
    module('mcp/client'), module('output/presentation-store'), module('knowledge/store'), module('knowledge/schema'), module('mcp/catalog'), module('output/component-data-profile'),
  ]);
  const oracle = openSnapshot(knowledgeDir, data.snapshotId);
  const subject = record(oracle.db.prepare("SELECT id,name,name_cn,score,date FROM entities WHERE kind='subject' AND id=253 AND nsfw=0").get());
  if (subject.id !== 253) { oracle.close(); throw new Error('真实 Archive 中缺少用于本次基准的条目 253。'); }
  const longSubject = record(oracle.db.prepare("SELECT id,summary FROM entities WHERE kind='subject' AND nsfw=0 AND length(summary)>600 ORDER BY id LIMIT 1").get());
  if (!longSubject.id) { oracle.close(); throw new Error('真实 Archive 缺少长简介，不能跳过缓存正文窗口验证。'); }
  const grouped: Record<string, unknown>[] = oracle.db.prepare("SELECT subject_type AS subjectType,count(*) AS count FROM entities WHERE kind='subject' AND nsfw=0 GROUP BY subject_type ORDER BY subject_type").all().map(record);
  const fulltextCount = Number(oracle.db.prepare("SELECT count(*) AS count FROM entity_fts JOIN entities e ON e.kind=entity_fts.kind AND e.id=entity_fts.entity_id WHERE entity_fts MATCH ? AND e.kind='subject' AND e.nsfw=0").get(buildFtsQuery('宇宙')).count);
  const cjkNameCount = Number(oracle.db.prepare("SELECT count(*) AS count FROM entities WHERE kind='subject' AND nsfw=0 AND (instr(name,'葬送')>0 OR instr(name_cn,'葬送')>0 OR id IN (SELECT entity_id FROM aliases WHERE kind='subject' AND instr(normalized,'葬送')>0))").get().count);
  const staffEdges: Record<string, unknown>[] = oracle.db.prepare("SELECT r.id,r.target_id,r.relation_type FROM relations r JOIN entities e ON e.kind=r.target_kind AND e.id=r.target_id WHERE r.source_kind='subject' AND r.source_id=253 AND r.target_kind='person' AND e.nsfw=0 ORDER BY r.target_id,r.id").all().map(record);
  const staffIds = [...new Set(staffEdges.map(edge => Number(edge.target_id)))].slice(0, 100);
  const multipleRoleId = staffIds.find(id => new Set(staffEdges.filter(edge => Number(edge.target_id) === id).map(edge => Number(edge.relation_type))).size > 1);
  if (!multipleRoleId) { oracle.close(); throw new Error('真实 Archive 测量样本中没有多职务人员，不能跳过关系正确性检查。'); }
  const expectedRoles = staffEdges.filter(edge => Number(edge.target_id) === multipleRoleId);
  // 以下期望直接读 SQLite 规范化列与原始字段，不调用被测查询/组件适配实现。
  const componentSubject = record(oracle.db.prepare("SELECT score,rating_total,summary,infobox_json FROM entities WHERE kind='subject' AND id=253").get());
  const distribution = oracle.db.prepare('SELECT score,count FROM subject_scores WHERE subject_id=253 ORDER BY score DESC').all().map(record);
  const distributionTotal = distribution.reduce((total: number, row: Record<string, unknown>) => total + Number(row.count), 0);
  const zeroSubject = record(oracle.db.prepare("SELECT e.id,e.score,e.rating_total FROM entities e WHERE e.kind='subject' AND e.nsfw=0 AND e.rating_total=0 AND EXISTS(SELECT 1 FROM subject_scores s WHERE s.subject_id=e.id) AND NOT EXISTS(SELECT 1 FROM subject_scores s WHERE s.subject_id=e.id AND s.count<>0) ORDER BY e.id LIMIT 1").get());
  const wiki = JSON.parse(String(componentSubject.infobox_json)) as Array<{ key: string; value: string | Array<{ k?: string; v: string }> }>;
  const expectedInfo = wiki.map(item => ({ label: item.key, value: typeof item.value === 'string' ? item.value : item.value.map(value => `${value.k ?? ''}${value.v}`).join('；') }));
  const expectedTags = oracle.db.prepare("SELECT name,count FROM tags WHERE kind='subject' AND entity_id=253 AND source<>'meta' ORDER BY name").all().map(record);
  const expectedEpisodes = oracle.db.prepare("SELECT id,name,date,sort FROM entities WHERE kind='episode' AND nsfw=0 AND subject_id=253 AND entity_type=0 AND date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' ORDER BY sort,id LIMIT 3").all().map(record);
  const expectedCharacters = oracle.db.prepare("SELECT DISTINCT e.id,e.name FROM relations r JOIN entities e ON e.kind='character' AND e.id=r.target_id WHERE r.source_kind='subject' AND r.source_id=253 AND r.target_kind='character' AND e.nsfw=0 ORDER BY e.id LIMIT 5").all().map(record);
  const expectedDetails = oracle.db.prepare("SELECT id,name,name_cn,score,rating_total,date FROM entities WHERE kind='subject' AND nsfw=0 AND id IN (253,2782,160209) ORDER BY CASE id WHEN 253 THEN 0 WHEN 2782 THEN 1 ELSE 2 END").all().map(record);
  const expectedYearTotal = Number(oracle.db.prepare("SELECT count(*) AS count FROM entities WHERE kind='subject' AND nsfw=0 AND subject_type=2 AND year=2024").get().count);
  if (distribution.length !== 10 || distributionTotal <= 0 || !zeroSubject.id || !expectedInfo.length || !expectedTags.length || expectedEpisodes.length !== 3 || expectedCharacters.length !== 5 || expectedDetails.length !== 3)
    throw new Error('真实数据库缺少组件验收样本，不能静默跳过字段或降级检查。');
  oracle.close();
  const expectedChecks = ['identityProjection', 'snapshotBinding', 'onDemandFields', 'hostSupplementation', 'identitySmallerThanHostData',
    'sixReadOnlyTools', 'warmFreshResult', 'expiredTurnRejected', 'cjkNameOracleCount', 'fulltextOracleCount', 'stablePagination', 'dateFilter',
    'relationResult', 'multipleStaffRoles', 'relationArrayPresentation', 'aggregateOracleCounts', 'aggregateMemberPresentation', 'longTextWindows',
    'emptyResult', 'statusSnapshot', 'noDataFetch', 'statsRatingFields', 'statsZeroVote', 'cardsPageMetadata', 'cardsSelectedMetadata',
    'cardsMultiSourceMetadata', 'infoBoxWiki', 'dataTableFieldOracle', 'tagCloudFacts', 'timelinePublicDates', 'galleryNoFabricatedImage',
    'linkListIdentityLinks', 'quoteExactReadText', 'calloutAvailableLimitations', 'progressUnavailable', 'compareUnavailable', 'componentCapabilities'];
  const protocol = { schemaVersion: 2, engine: 'direct-tools', mode: 'local-archive', offline: false, dataFingerprint: data,
    toolDefinitionsHash: traceHash(TOOL_DEFINITIONS), toolCount: TOOL_DEFINITIONS.length, repeats: options.repeats,
    connection: 'new stdio process per repeat; warm calls use new read contexts', model: 'none/local-archive',
    osCache: 'uncontrolled; cold means application/connection, not disk cache',
    checks: expectedChecks, componentCoverage: { rendered: ['SubjectCards', 'StatsCard', 'InfoBox', 'DataTable', 'TagCloud', 'Timeline', 'Gallery', 'LinkList', 'QuoteBlock', 'Callout'],
      unavailable: ['ProgressView', 'CompareTable'], oracle: 'independent read-only SQL and unchanged frontend contract; no expected values sent to model' } };
  const protocolHash = traceHash(protocol), startedAt = new Date().toISOString();
  const manifest = { schemaVersion: 1, label: '真实 Archive 本地工具性能', startedAt, root, knowledgeDir,
    versions: { candidate: version }, protocol, protocolHash,
    environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem() },
    plannedRuns: Array.from({ length: options.repeats }, (_, index) => ({ caseId: 'local-archive-pipeline', family: 'local-data', repeat: index + 1, variant: 'candidate' })) };
  atomicJson(join(output, 'manifest.json'), manifest);
  const observations: LocalObservation[] = [], runPaths: string[] = [];
  const save = async () => {
    const suite: SuiteResult = { schemaVersion: 1, startedAt, protocolHash, manifest, observations, runPaths };
    atomicJson(join(output, 'results.json'), suite); await writeReport(output, suite);
    const passed = observations.filter(row => row.outcome === 'passed');
    const summarize = (field: 'timingsMs' | 'bytes') => Object.fromEntries([...new Set(observations.flatMap(row => Object.keys(row.localMeasurements[field])))].map(key => {
      const values = passed.map(row => row.localMeasurements[field][key]).filter((value): value is number => typeof value === 'number');
      return [key, { availableRuns: values.length, median: median(values), p95: percentile95(values), min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null }];
    }));
    atomicJson(join(output, 'local-performance.json'), { schemaVersion: 1, plannedRuns: options.repeats, completedRuns: observations.length,
      passedRuns: passed.length, evidence: protocol, timingsMs: summarize('timingsMs'), bytes: summarize('bytes'),
      limitations: ['无模型运行不证明自然语言调度质量或 token 消耗。', '应用冷连接不等于清空操作系统磁盘缓存。', '与旧 HTTP 数据源不同，不作为同数据端到端加速对照。', '完整 Web 显示需单独浏览器验收。'] });
  };
  await save();
  for (let repeat = 1; repeat <= options.repeats; repeat++) {
    const directory = join(output, 'runs/candidate/local-archive-pipeline', String(repeat)), authDir = join(directory, 'auth');
    mkdirSync(authDir, { recursive: true }); runPaths.push(directory);
    atomicJson(join(authDir, 'benchmark-config.json'), { mode: 'local-archive', runtimeRoot: root, knowledgeDir, outputDir: directory } as Partial<WorkerConfig>);
    const metrics = blankMetrics(), measurements: Measurements = { timingsMs: {}, bytes: {}, checks: [] }, started = performance.now();
    let initializationStart = 0, turn = 0;
    let read = { turnId: 'local-benchmark-' + repeat + '-' + turn, nsfw: 'exclude' as const };
    const client = new LocalMcpClient({ knowledgeDir, authDir, proxy: null, timeoutMs: 30000,
      entry: fileURLToPath(new URL('./fixture-server.js', import.meta.url)),
      onTrace(event: string) {
        if (event === 'initializing') initializationStart = performance.now();
        if (event === 'initialized') metrics.mcpInitializationMs = performance.now() - initializationStart;
        if (event === 'dispatch') metrics.rpcDispatches++;
      } });
    const check = (name: string, passed: boolean, detail: unknown) => {
      measurements.checks.push({ name, passed, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) });
    };
    const call = async (stage: string, name: string, args: Record<string, unknown>) => {
      atomicJson(join(directory, 'progress.json'), { stage, state: 'running', timingsMs: measurements.timingsMs, checks: measurements.checks });
      const begin = performance.now(); metrics.mcpCalls++;
      try {
        const value = await client.call(name, args, undefined, undefined, undefined, read);
        measurements.bytes[stage] = byteLength(value); metrics.modelToolResultBytes += byteLength(value);
        return value;
      } finally {
        const duration = performance.now() - begin; measurements.timingsMs[stage] = duration; metrics.mcpMs += duration;
        atomicJson(join(directory, 'progress.json'), { stage, state: 'finished', timingsMs: measurements.timingsMs, checks: measurements.checks });
      }
    };
    const nextTurn = async () => { await client.endReadContext(read.turnId); read = { ...read, turnId: 'local-benchmark-' + repeat + '-' + ++turn }; };
    let error: string | null = null;
    try {
      const first = await call('coldIdentity', 'get_entities', { entity: 'subject', ids: [253] });
      measurements.timingsMs.initialization = metrics.mcpInitializationMs;
      measurements.timingsMs.firstToolAfterInitialization = Math.max(0, measurements.timingsMs.coldIdentity! - metrics.mcpInitializationMs);
      const ref = String(record(first).resourceRef), item = rows(first)[0] ?? {};
      check('identityProjection', ids(first).join() === '253' && Object.keys(item).every(key => ['id', 'entity', 'resourceRef', 'snapshotId'].includes(key)), item);
      check('snapshotBinding', record(first).snapshotId === data.snapshotId, record(first).snapshotId);
      const fields = await call('cachedFields', 'read_cached_resource', { resource_ref: ref, fields: ['name', 'nameCn', 'score', 'date'], keys: [253] });
      const requested = rows(record(fields).value)[0] ?? {};
      check('onDemandFields', requested.id === 253 && requested.name === subject.name && requested.score === subject.score
        && requested.date === subject.date && !Object.hasOwn(requested, 'summary') && !Object.hasOwn(requested, 'infobox'), requested);
      const hostStart = performance.now();
      const canonical = await client.readCachedResource(ref, undefined, read, { subjectIds: [253] }); metrics.cacheRpcCalls++;
      measurements.timingsMs.hostCache = performance.now() - hostStart; measurements.bytes.hostCache = byteLength(canonical);
      const store = new PresentationStore(async (reference: string, signal?: AbortSignal, selection?: unknown) => {
        metrics.cacheRpcCalls++; return client.readCachedResource(reference, signal, read, selection);
      });
      store.begin();
      const presentationStart = performance.now();
      const part = await store.materialize('SubjectCards', { resourceRef: ref, subjectIds: [253] });
      measurements.timingsMs.hostPresentation = performance.now() - presentationStart; measurements.bytes.hostPresentation = byteLength(part);
      const card = record(record(part).props).items;
      check('hostSupplementation', Array.isArray(card) && record(card[0]).id === 253 && record(card[0]).name === subject.name
        && record(card[0]).score === subject.score && record(card[0]).date === subject.date, card);
      const statsStart = performance.now();
      const stats = record((await store.materialize('StatsCard', { resourceRef: ref, subjectIds: [253] })).props);
      const statEntries = Array.isArray(stats.entries) ? stats.entries.map(record) : [];
      check('statsRatingFields', record(stats.headline).value === String(componentSubject.score)
        && statEntries.length === distribution.length && distribution.every((row: Record<string, unknown>, index: number) => {
          const actual = statEntries[index]!;
          return actual.label === String(row.score) && actual.value === String(row.count)
            && typeof actual.ratio === 'number' && Math.abs(actual.ratio - Number(row.count) / distributionTotal) < 1e-12;
        }) && String(stats.note).includes(String(componentSubject.rating_total)) && stats.mode === 'histogram', stats);
      const zeroIdentity = await call('zeroVoteIdentity', 'get_entities', { entity: 'subject', ids: [Number(zeroSubject.id)] });
      const zeroStats = record((await store.materialize('StatsCard', { resourceRef: String(record(zeroIdentity).resourceRef) })).props);
      const zeroEntries = Array.isArray(zeroStats.entries) ? zeroStats.entries.map(record) : [];
      check('statsZeroVote', zeroSubject.score === null && zeroSubject.rating_total === 0 && zeroEntries.length === 10
        && zeroEntries.every(entry => entry.value === '0' && entry.ratio === 0)
        && !/^0(?:\.0+)?$/.test(String(record(zeroStats.headline).value)) && /暂无|未知|未评分/.test(String(record(zeroStats.headline).value))
        && !JSON.stringify(zeroStats).includes('NaN'), { subjectId: zeroSubject.id, zeroStats });
      measurements.timingsMs.statsPresentation = performance.now() - statsStart;
      measurements.bytes.statsPresentation = byteLength(stats) + byteLength(zeroStats);
      check('identitySmallerThanHostData', measurements.bytes.coldIdentity! < measurements.bytes.hostCache!, measurements.bytes);
      const definitions = await client.listTools();
      check('sixReadOnlyTools', definitions.length === 6 && definitions.every((tool: Record<string, unknown>) => tool.effect === 'read'), definitions.map((tool: Record<string, unknown>) => tool.name));
      metrics.initialToolCount = definitions.length; metrics.initialToolSchemaBytes = byteLength(definitions.map((tool: Record<string, unknown>) => tool.inputSchema));
      await nextTurn();
      const warm = await call('warmIdentityNewTurn', 'get_entities', { entity: 'subject', ids: [253] });
      check('warmFreshResult', ids(warm).join() === '253' && record(warm).resourceRef !== ref && record(warm).snapshotId === data.snapshotId, record(warm).resourceRef);
      let staleRejected = false;
      try { await client.readCachedResource(ref, undefined, read); } catch { staleRejected = true; }
      check('expiredTurnRejected', staleRejected, '新轮次不可读取上一轮资源');
      await nextTurn();
      const cjkName = await call('cjkName', 'query_entities', { entity: 'subject', keyword: '葬送', match: 'name', limit: 20, fields: ['name', 'nameCn'] });
      check('cjkNameOracleCount', Number(record(record(cjkName).page).total) === cjkNameCount && cjkNameCount > 0, { actual: record(cjkName).page, expected: cjkNameCount });
      const fulltext = await call('fulltext', 'query_entities', { entity: 'subject', keyword: '宇宙', match: 'fulltext', sort: 'match', limit: 20, fields: ['name', 'nameCn'] });
      check('fulltextOracleCount', Number(record(record(fulltext).page).total) === fulltextCount && rows(fulltext).length > 0, { actual: record(fulltext).page, expected: fulltextCount });
      const query = { entity: 'subject', filter: { subject_type: 2, year: { min: 2024, max: 2024 } }, sort: 'id', limit: 5, fields: ['name', 'score', 'date'] };
      const page1 = await call('filteredPage', 'query_entities', query), cursor = record(record(page1).page).nextCursor;
      const page2 = await call('nextPage', 'query_entities', { ...query, cursor });
      const whole = await call('matchingTen', 'query_entities', { ...query, limit: 10 });
      check('stablePagination', JSON.stringify([...ids(page1), ...ids(page2)]) === JSON.stringify(ids(whole)) && new Set([...ids(page1), ...ids(page2)]).size === 10, { page1: ids(page1), page2: ids(page2), whole: ids(whole) });
      check('dateFilter', rows(whole).every(row => String(row.date).startsWith('2024')), rows(whole).map(row => row.date));
      const cardStore = new PresentationStore(async (reference: string, signal?: AbortSignal, selection?: unknown) => {
        metrics.cacheRpcCalls++; return client.readCachedResource(reference, signal, read, selection);
      });
      cardStore.begin();
      const cardStart = performance.now(), pageRef = String(record(page1).resourceRef);
      const pageCards = record((await cardStore.materialize('SubjectCards', { resourceRef: pageRef, layout: 'list' })).props);
      check('cardsPageMetadata', pageCards.total === expectedYearTotal && Array.isArray(pageCards.items) && pageCards.items.length === 5
        && String(pageCards.hint).includes(String(expectedYearTotal)) && /1\D+5/.test(String(pageCards.hint)), pageCards);
      const chosenIds = ids(page1).slice(0, 2);
      const selectedCards = record((await cardStore.materialize('SubjectCards', { resourceRef: pageRef, subjectIds: chosenIds, layout: 'list' })).props);
      check('cardsSelectedMetadata', selectedCards.total === chosenIds.length && Array.isArray(selectedCards.items)
        && JSON.stringify(selectedCards.items.map(item => Number(record(item).id))) === JSON.stringify(chosenIds)
        && String(selectedCards.hint).includes(String(expectedYearTotal)) && /选|成员/.test(String(selectedCards.hint)), selectedCards);
      const combinedCards = record((await cardStore.materialize('SubjectCards', { sources: [
        { resourceRef: pageRef }, { resourceRef: String(record(page2).resourceRef) }], layout: 'list' })).props);
      check('cardsMultiSourceMetadata', combinedCards.total === 10 && Array.isArray(combinedCards.items)
        && JSON.stringify(combinedCards.items.map(item => Number(record(item).id))) === JSON.stringify(ids(whole))
        && /来源|组合|合并/.test(String(combinedCards.hint)), combinedCards);
      measurements.timingsMs.cardsMetadataPresentation = performance.now() - cardStart;
      measurements.bytes.cardsMetadataPresentation = byteLength(pageCards) + byteLength(selectedCards) + byteLength(combinedCards);
      await nextTurn();
      const relations = await call('relations', 'query_relations', { source: { entity: 'subject', id: 253 }, target_entity: 'person', limit: 100, fields: ['name', 'relations', 'relationTypes'] });
      check('relationResult', rows(relations).length > 0 && record(relations).snapshotId === data.snapshotId, { count: rows(relations).length, page: record(relations).page });
      const staff = rows(relations).find(row => Number(row.id) === multipleRoleId) ?? {};
      const edges = Array.isArray(staff.relations) ? staff.relations.map(record) : [];
      check('multipleStaffRoles', expectedRoles.every(expected => edges.some(actual => Number(actual.relationId) === Number(expected.id)
        && Number(actual.relationType) === Number(expected.relation_type))) && new Set(staff.relationTypes as number[] ?? []).size > 1,
      { personId: multipleRoleId, expected: expectedRoles, actual: staff });
      const arrayRelations = await call('relationArrayQuery', 'query_relations', { source: { entity: 'subject', id: 253 },
        target_entity: 'person', direction: 'outgoing', limit: 10, fields: ['name', 'relationTypes', 'relations'] });
      const arrayStore = new PresentationStore(async (reference: string, signal?: AbortSignal, selection?: unknown) => {
        metrics.cacheRpcCalls++; return client.readCachedResource(reference, signal, read, selection);
      });
      arrayStore.begin();
      const arrayRef = String(record(arrayRelations).resourceRef), arrayMembers = [100, 101].map(id => ({ entity: 'person', id }));
      const arrayPresentationStart = performance.now();
      const arrayTable = await arrayStore.materialize('DataTable', { resourceRef: arrayRef, members: arrayMembers,
        columns: [{ key: 'name', label: '人物' }, { key: 'relationTypes', label: '职务代码' }] });
      let objectArrayRejected = false, outsideMemberRejected = false;
      try { await arrayStore.materialize('DataTable', { resourceRef: arrayRef, members: [arrayMembers[0]], columns: [{ key: 'relations', label: '原边对象' }] }); }
      catch { objectArrayRejected = true; }
      const arrayIds = new Set(ids(arrayRelations)), outsidePersonId = staffIds.find(id => !arrayIds.has(id));
      if (outsidePersonId !== undefined) {
        try { await arrayStore.materialize('DataTable', { resourceRef: arrayRef, members: [{ entity: 'person', id: outsidePersonId }],
          columns: [{ key: 'relationTypes', label: '职务代码' }] }); }
        catch { outsideMemberRejected = true; }
      }
      measurements.timingsMs.relationArrayPresentation = performance.now() - arrayPresentationStart;
      measurements.bytes.relationArrayPresentation = byteLength(arrayTable);
      const arrayRows = record(record(arrayTable).props).rows;
      check('relationArrayPresentation', Array.isArray(arrayRows) && arrayRows.length === 2
        && record(arrayRows[0]).relationTypes === '2、3、4、128' && record(arrayRows[1]).relationTypes === '6、30、31、34'
        && objectArrayRejected && outsideMemberRejected,
      { arrayRows, objectArrayRejected, outsideMemberRejected, outsidePersonId });
      const aggregate = await call('aggregate', 'aggregate_entities', { entity: 'subject', group_by: 'subjectType', metrics: ['count'], limit: 100 });
      const groups = rows(aggregate);
      check('aggregateOracleCounts', grouped.every(expected => groups.some(actual => Number(actual.count) === Number(expected.count)
        && Number(actual.subjectType ?? actual.key ?? actual.group ?? actual.value) === Number(expected.subjectType))), { actual: aggregate, expected: grouped });
      const aggregateStore = new PresentationStore(async (reference: string, signal?: AbortSignal, selection?: unknown) => {
        metrics.cacheRpcCalls++; return client.readCachedResource(reference, signal, read, selection);
      });
      aggregateStore.begin();
      const aggregateRef = String(record(aggregate).resourceRef), selectedGroups = groups.slice(0, 2);
      const aggregateInput = { resourceRef: aggregateRef, members: selectedGroups.map(row => ({ entity: 'aggregate', id: Number(row.id) })),
        columns: [{ key: 'group', label: '类型' }, { key: 'count', label: '数量' }] };
      const aggregatePresentationStart = performance.now();
      const selectedTable = await aggregateStore.materialize('DataTable', aggregateInput);
      const preparedTable = await aggregateStore.prepareSelected('DataTable', aggregateInput);
      const preparedBlock = await aggregateStore.block(preparedTable.resourceRef, 0);
      const aggregateInfoBox = await aggregateStore.materialize('InfoBox', { resourceRef: aggregateRef,
        members: [{ entity: 'aggregate', id: Number(selectedGroups[0]?.id) }], fields: ['group', 'count'] });
      let invalidAggregateRejected = false;
      try { await aggregateStore.materialize('DataTable', { ...aggregateInput, members: [{ entity: 'aggregate', id: 999999999 }] }); }
      catch { invalidAggregateRejected = true; }
      measurements.timingsMs.aggregatePresentation = performance.now() - aggregatePresentationStart;
      measurements.bytes.aggregatePresentation = byteLength(selectedTable);
      const selectedTableRows = record(record(selectedTable).props).rows;
      const preparedTableRows = record(record(preparedBlock).props).rows;
      const infoRows = record(record(aggregateInfoBox).props).rows;
      const expectedTableRows = selectedGroups.map(row => ({ group: String(row.group), count: String(row.count) }));
      check('aggregateMemberPresentation', JSON.stringify(selectedTableRows) === JSON.stringify(expectedTableRows)
        && JSON.stringify(preparedTableRows) === JSON.stringify(expectedTableRows) && preparedTable.blocks[0]?.itemCount === 2
        && Array.isArray(infoRows) && infoRows.length === 2 && record(infoRows[0]).value === String(selectedGroups[0]?.group)
        && record(infoRows[1]).value === String(selectedGroups[0]?.count) && invalidAggregateRejected,
      { selectedTableRows, preparedTableRows, infoRows, invalidAggregateRejected });
      await nextTurn();
      const detailIdentity = await call('componentIdentity', 'get_entities', { entity: 'subject', ids: [253, 2782, 160209] });
      const detailRef = String(record(detailIdentity).resourceRef);
      const componentStore = new PresentationStore(async (reference: string, signal?: AbortSignal, selection?: unknown) => {
        metrics.cacheRpcCalls++; return client.readCachedResource(reference, signal, read, selection);
      });
      componentStore.begin();
      const componentsStart = performance.now();
      const infoBox = record((await componentStore.materialize('InfoBox', { resourceRef: detailRef, subjectIds: [253] })).props);
      check('infoBoxWiki', JSON.stringify(infoBox.rows) === JSON.stringify(expectedInfo), { actual: infoBox.rows, expected: expectedInfo });
      const detailColumns = ['name', 'nameCn', 'score', 'ratingCount', 'date', 'url'].map(key => ({ key, label: key }));
      const detailTable = record((await componentStore.materialize('DataTable', { resourceRef: detailRef, columns: detailColumns })).props);
      const expectedDetailRows = expectedDetails.map((row: Record<string, unknown>) => ({ name: String(row.name), nameCn: String(row.name_cn),
        score: row.score == null ? '' : String(row.score), ratingCount: row.rating_total == null ? '' : String(row.rating_total),
        date: row.date == null ? '' : String(row.date), url: `https://bgm.tv/subject/${row.id}` }));
      check('dataTableFieldOracle', JSON.stringify(detailTable.rows) === JSON.stringify(expectedDetailRows), { actual: detailTable.rows, expected: expectedDetailRows });
      const tagCloud = (await componentStore.materialize('TagCloud', { resourceRef: detailRef, subjectIds: [253] })).props;
      const normalizedTags = (Array.isArray(tagCloud) ? tagCloud.map(record) : []).sort((a, b) => String(a.name).localeCompare(String(b.name)));
      const tagOracle = expectedTags.map((row: Record<string, unknown>) => ({ name: String(row.name), ...(row.count == null ? {} : { count: Number(row.count) }) }))
        .sort((a: Record<string, unknown>, b: Record<string, unknown>) => String(a.name).localeCompare(String(b.name)));
      check('tagCloudFacts', JSON.stringify(normalizedTags) === JSON.stringify(tagOracle)
        && normalizedTags.every(tag => !Object.hasOwn(tag, 'selected')), { actual: normalizedTags, expected: tagOracle });
      const episodeIdentity = await call('episodeComponentIdentity', 'get_entities', { entity: 'episode', ids: expectedEpisodes.map((row: Record<string, unknown>) => Number(row.id)) });
      const episodeRef = String(record(episodeIdentity).resourceRef);
      const timeline = record((await componentStore.materialize('Timeline', { resourceRef: episodeRef })).props);
      const timelineOracle = expectedEpisodes.map((row: Record<string, unknown>) => ({ time: String(row.date), text: String(row.name) }));
      check('timelinePublicDates', JSON.stringify(timeline.entries) === JSON.stringify(timelineOracle), { actual: timeline.entries, expected: timelineOracle });
      const characters = await call('galleryRelations', 'query_relations', { source: { entity: 'subject', id: 253 }, target_entity: 'character', direction: 'outgoing', limit: 5 });
      const gallery = record((await componentStore.materialize('Gallery', { resourceRef: String(record(characters).resourceRef) })).props);
      const galleryItems = Array.isArray(gallery.items) ? gallery.items.map(record) : [];
      check('galleryNoFabricatedImage', galleryItems.length === expectedCharacters.length && expectedCharacters.every((row: Record<string, unknown>, index: number) => {
        const actual = galleryItems[index]!;
        return actual.id === row.id && actual.name === row.name && actual.url === `https://bgm.tv/character/${row.id}` && !Object.hasOwn(actual, 'image');
      }), { actual: galleryItems, expected: expectedCharacters });
      const linkList = record((await componentStore.materialize('LinkList', { resourceRef: detailRef })).props);
      const linkOracle = expectedDetails.map((row: Record<string, unknown>) => ({ label: String(row.name_cn || row.name), url: `https://bgm.tv/subject/${row.id}` }));
      check('linkListIdentityLinks', JSON.stringify(linkList.links) === JSON.stringify(linkOracle), { actual: linkList.links, expected: linkOracle });
      const quoteRead = await call('quoteRead', 'read_cached_resource', { resource_ref: detailRef, fields: ['summary'], keys: [253], range: { offset: 0, limit: 120 } });
      const quoteText = String(rows(record(quoteRead).value)[0]?.summary ?? '');
      const quote = record((await componentStore.materialize('QuoteBlock', { title: '本地简介摘录', text: quoteText, mono: false })).props);
      const quoteOracle = Array.from(String(componentSubject.summary)).slice(0, 120).join('');
      check('quoteExactReadText', quote.text === quoteOracle && quote.mono === false && Array.from(String(quote.text)).length === 120,
        { actual: quote, expected: quoteOracle });
      const callout = record((await componentStore.materialize('Callout', { tone: 'warning', text: '当前为公共 Archive 本地资料',
        detail: `${data.snapshotId}；封面、个人观看状态、评论正文不可用。` })).props);
      check('calloutAvailableLimitations', callout.tone === 'warning' && String(callout.detail).includes(data.snapshotId)
        && String(callout.detail).includes('不可用'), callout);
      let progressError: Record<string, unknown> = {}, compareError: Record<string, unknown> = {};
      try { await componentStore.materialize('ProgressView', { resourceRef: episodeRef }); } catch (error) { progressError = record(error); }
      try { await componentStore.materialize('CompareTable', { resourceRef: detailRef, fields: ['score'] }); } catch (error) { compareError = record(error); }
      check('progressUnavailable', progressError.code === 'COMPONENT_SOURCE_UNAVAILABLE', { code: progressError.code, message: progressError.message });
      check('compareUnavailable', compareError.code === 'COMPONENT_SOURCE_UNAVAILABLE', { code: compareError.code, message: compareError.message });
      const capabilities = record(COMPONENT_DATA_PROFILES);
      const componentNames = ['SubjectCards', 'StatsCard', 'ProgressView', 'InfoBox', 'DataTable', 'Timeline', 'TagCloud', 'Gallery', 'CompareTable', 'QuoteBlock', 'Callout', 'LinkList'];
      check('componentCapabilities', Object.keys(capabilities).length === 12 && componentNames.every(name => {
        const profile = record(capabilities[name]);
        return ['ProgressView', 'CompareTable'].includes(name) ? profile.sourceCapability === 'unavailable' && typeof profile.unavailableReason === 'string'
          : ['QuoteBlock', 'Callout'].includes(name) ? profile.sourceCapability === 'text' : ['available', 'limited'].includes(String(profile.sourceCapability));
      }), Object.fromEntries(componentNames.map(name => [name, record(capabilities[name]).sourceCapability])));
      measurements.timingsMs.remainingComponentPresentation = performance.now() - componentsStart;
      measurements.bytes.remainingComponentPresentation = byteLength([infoBox, detailTable, tagCloud, timeline, gallery, linkList, quote, callout]);
      await nextTurn();
      const longIdentity = await call('longIdentity', 'get_entities', { entity: 'subject', ids: [Number(longSubject.id)] });
      const longRef = String(record(longIdentity).resourceRef);
      const firstWindow = await call('textWindow', 'read_cached_resource', { resource_ref: longRef, fields: ['summary'], keys: [Number(longSubject.id)], range: { offset: 0, limit: 200 } });
      const secondWindow = await call('textContinuation', 'read_cached_resource', { resource_ref: longRef, fields: ['summary'], keys: [Number(longSubject.id)], range: { offset: 200, limit: 200 } });
      const text = Array.from(String(longSubject.summary));
      const ranges = record(record(firstWindow).range).fields;
      const firstRange = Array.isArray(ranges) ? record(ranges[0]) : {};
      check('longTextWindows', rows(record(firstWindow).value)[0]?.summary === text.slice(0, 200).join('')
        && rows(record(secondWindow).value)[0]?.summary === text.slice(200, 400).join('')
        && firstRange.total === text.length && firstRange.offset === 0 && firstRange.nextOffset === 200 && firstRange.complete === false,
      { subjectId: longSubject.id, first: record(firstWindow).range, second: record(secondWindow).range });
      const empty = await call('empty', 'query_entities', { entity: 'subject', keyword: 'benchmark-absent-' + protocolHash, match: 'name', limit: 10 });
      check('emptyResult', rows(empty).length === 0 && Number(record(record(empty).page).total) === 0, record(empty).page);
      const status = await call('datasetStatus', 'get_dataset_status', {});
      check('statusSnapshot', JSON.stringify(status).includes(data.snapshotId), status);
      check('noDataFetch', !existsSync(join(directory, 'local-network-attempts.jsonl')), '子进程全局 fetch 已阻断并记录尝试');
    } catch (caught) { error = caught instanceof Error ? caught.message : 'LOCAL_BENCHMARK_FAILED'; }
    finally {
      try { await client.endReadContext(read.turnId); await client.close(); }
      catch { error ??= 'LOCAL_BENCHMARK_CLEANUP_FAILED'; }
      metrics.totalMs = performance.now() - started;
    }
    metrics.upstreamRequests = existsSync(join(directory, 'local-network-attempts.jsonl')) ? readFileSync(join(directory, 'local-network-attempts.jsonl'), 'utf8').trim().split('\n').length : 0;
    metrics.upstreamWriteRequests = 0; metrics.providerHttpRequests = 0;
    const passed = !error && measurements.checks.length === expectedChecks.length
      && expectedChecks.every(name => measurements.checks.some(check => check.name === name && check.passed));
    const observation: LocalObservation = { schemaVersion: 1, caseId: 'local-archive-pipeline', family: 'local-data', variant: 'candidate', repeat,
      protocolHash, versionHash: version.hash, model: 'none/local-archive', thinking: 'off', mode: 'local-archive', outcome: error ? 'errored' : passed ? 'passed' : 'failed', error,
      turns: [], metrics, grade: { passed, checks: measurements.checks.map(check => ({ rule: { kind: 'text', pattern: check.name }, passed: check.passed, detail: check.detail })),
        semanticReview: 'not_required', rubric: null }, confirmations: [], network: [], traceDirectories: [], captureIssues: [], localMeasurements: measurements };
    observations.push(observation); atomicJson(join(directory, 'result.json'), observation); await save();
    process.stdout.write(`[${repeat}/${options.repeats}] ${observation.outcome} cold=${measurements.timingsMs.coldIdentity?.toFixed(1) ?? 'N/A'}ms init=${metrics.mcpInitializationMs.toFixed(1)}ms warm=${measurements.timingsMs.warmIdentityNewTurn?.toFixed(1) ?? 'N/A'}ms\n`);
  }
  const datasetAfter = await datasetFingerprint(knowledgeDir), versionAfter = versionFingerprint(root);
  if (versionAfter.hash !== version.hash || traceHash(datasetAfter) !== traceHash(data)) {
    for (const observation of observations) {
      observation.outcome = 'incomplete_capture'; observation.captureIssues.push(versionAfter.hash !== version.hash ? 'runtime_version_changed' : 'dataset_version_changed');
      atomicJson(join(output, 'runs/candidate/local-archive-pipeline', String(observation.repeat), 'result.json'), observation);
    }
  }
  await save();
  process.stdout.write('报告：' + join(output, 'report.html') + '\n详细性能：' + join(output, 'local-performance.json') + '\n');
  if (observations.some(row => row.outcome !== 'passed')) process.exitCode = 1;
}
