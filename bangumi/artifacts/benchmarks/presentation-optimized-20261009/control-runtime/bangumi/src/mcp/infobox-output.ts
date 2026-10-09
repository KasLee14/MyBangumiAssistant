import { AppError } from '../support/errors.js';
import { object } from '../support/bangumi.js';
import { isDeepStrictEqual } from 'node:util';

export interface InfoboxPair { k?: string; v: string }
export interface InfoboxItem { key: string; value: string | InfoboxPair[] }

function invalid(path: string, expected: string): never {
  throw new AppError('INVALID_RESPONSE', `信息栏字段 ${path} 应为${expected}。`);
}

/** v0 的 value 和 p1 的 values 统一为固定 DTO；缺失与非法值不混为一谈。 */
export function normalizeInfobox(value: unknown): InfoboxItem[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) invalid('/infobox', '数组');
  return value.map((value, index) => {
    const path = `/infobox/${index}`;
    const item = object(value, `信息栏字段 ${path}`);
    if (typeof item.key !== 'string') invalid(`${path}/key`, '字符串');
    if (item.value != null && item.values != null && !isDeepStrictEqual(item.value, item.values)) invalid(`${path}/value`, '与 values 一致的唯一来源值');
    const data = item.value ?? item.values;
    if (typeof data === 'string') return { key: item.key, value: data };
    if (!Array.isArray(data)) invalid(`${path}/value`, '字符串或键值数组');
    const pairs: InfoboxPair[] = data.map((value, pairIndex) => {
      const pairPath = `${path}/value/${pairIndex}`;
      const pair = object(value, `信息栏字段 ${pairPath}`);
      if (typeof pair.v !== 'string') invalid(`${pairPath}/v`, '字符串');
      if (pair.k !== undefined && typeof pair.k !== 'string') invalid(`${pairPath}/k`, '字符串或省略');
      return { ...(pair.k === undefined ? {} : { k: pair.k }), v: pair.v };
    });
    return { key: item.key, value: pairs };
  });
}
