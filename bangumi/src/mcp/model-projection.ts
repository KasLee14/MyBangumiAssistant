type Data = Record<string, unknown>;
function record(value: unknown): value is Data { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function pick(value: Data, keys: readonly string[]): Data {
  return Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
}
const coverageKeys = ['complete', 'coverageRef', 'sourceCount', 'completeSourceCount', 'incompleteSourceCount', 'unknownTotalSourceCount',
  'pendingCount', 'remainingCount', 'unknownFieldCount', 'failedFieldCount', 'dependencyIncompleteCount', 'dependencyPendingCount',
  'dependencyRemainingCount', 'dependencyUnknownCount', 'dependencyFailedCount'];
/** 模型读取的是宿主已验证结果的投影；完整契约仍留在structuredContent/details。 */
export function projectModelResult(value: Data): Data {
  if (value.kind === 'candidate_continuation' && record(value.result)) {
    return { ...pick(value, ['schemaVersion', 'kind', 'tool']), result: projectModelResult(value.result) };
  }
  if (!['candidate_page', 'candidate_coverage', 'candidate_lineage'].includes(String(value.kind))) return value;
  const projected = pick(value, ['schemaVersion', 'kind', 'entity', 'candidateRef', 'resultRef', 'collectionRef', 'collectionScope',
    'coverageRef', 'responseView', 'fields', 'data', 'pending', 'set', 'stage', 'page', 'sourcePage', 'relationStage', 'appearanceStage', 'visibility']);
  if (record(value.coverage)) projected.coverage = pick(value.coverage, coverageKeys);
  if (record(value.accessContext)) projected.accessContext = pick(value.accessContext, ['mode', 'source', 'nsfw', 'nsfwApplied', 'queryCoverage']);
  // 显式审计读取保留所请求的来源/父边；普通候选页不重复附带整份来源或lineage。
  if (value.kind === 'candidate_coverage') Object.assign(projected, pick(value, ['sources', 'dependencies']));
  return projected;
}
