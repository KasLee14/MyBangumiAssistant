import { isDeepStrictEqual } from 'node:util';
import { record, type Data } from './resource-output.js';

export interface ReadbackVerification {
  readbackCompleted: boolean;
  requestedStateMatched: boolean;
  protectedFieldsMatched: boolean;
  mismatchedFields: string[];
  parentProgress?: { subjectId: number; before: number; actual: number };
}
export function isEpisodeWrite(name: string): boolean {
  return name === 'update_single_episode_collection' || name === 'update_episode_collection';
}
function withoutDerivedProgress(value: Data): Data {
  const copy = { ...value }; delete copy.ep_status; return copy;
}

/** 章节写入只允许父ep_status汇总变化，其余父收藏字段仍完整验证。 */
export function verifyWrittenState(name: string, before: unknown, after: unknown, actual: unknown, target: Data): ReadbackVerification {
  if (!isEpisodeWrite(name)) {
    const matched = isDeepStrictEqual(actual, after);
    return { readbackCompleted: true, requestedStateMatched: matched, protectedFieldsMatched: matched, mismatchedFields: matched ? [] : ['result'] };
  }
  const expected = record(after); const observed = record(actual);
  const expectedParent = record(expected.parentCollection);
  const observedParent = observed.parentCollection === null ? null : record(observed.parentCollection);
  const requestedStateMatched = isDeepStrictEqual(observed.episodes, expected.episodes);
  const protectedFieldsMatched = observedParent !== null && isDeepStrictEqual(withoutDerivedProgress(observedParent), withoutDerivedProgress(expectedParent));
  const mismatchedFields = Object.keys(expectedParent).filter(key => key !== 'ep_status' && !isDeepStrictEqual(observedParent?.[key], expectedParent[key])).map(key => `parentCollection.${key}`);
  if (!requestedStateMatched) mismatchedFields.unshift('episodes');
  return { readbackCompleted: true, requestedStateMatched, protectedFieldsMatched, mismatchedFields,
    ...(observedParent === null ? {} : { parentProgress: { subjectId: Number(target.subjectId), before: Number(record(record(before).parentCollection).ep_status), actual: Number(observedParent.ep_status) } }) };
}
