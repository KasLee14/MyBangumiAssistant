import { parse2 } from '@bgm38/wiki';

export const WIKI_PARSER_VERSION = '@bgm38/wiki@0.3.3';
export interface InfoboxValue { k?: string; v: string }
export interface InfoboxEntry { key: string; value: string | InfoboxValue[] }
export interface ParsedWiki { fields: InfoboxEntry[]; aliases: string[]; nameCn: string; status: 'empty' | 'parsed' | 'failed' }

export function parseWiki(raw: unknown): ParsedWiki {
  if (typeof raw !== 'string' || !raw.trim()) return { fields: [], aliases: [], nameCn: '', status: 'empty' };
  const [error, wiki] = parse2(raw);
  // 不用正则臆测坏语法的别名；原文仍在 raw_json，缺口可审计且不会误合并实体。
  if (error || !wiki) return { fields: [], aliases: [], nameCn: '', status: 'failed' };
  const fields = wiki.data.map(item => ({ key: item.key, value: item.array
    ? (item.values ?? []).filter(value => typeof value.v === 'string').map(value => ({ ...(value.k ? { k: value.k } : {}), v: value.v! }))
    : item.value ?? '' }));
  const aliases: string[] = [];
  let nameCn = '';
  for (const field of fields) {
    if (!/别名|中文名|中文名称|原名|英文名|日文名|罗马字|罗马音|外文名/u.test(field.key)) continue;
    const values = typeof field.value === 'string' ? [field.value] : field.value.map(value => value.v);
    aliases.push(...values.map(value => value.trim()).filter(Boolean));
    if (!nameCn && /^(简体)?中文名(称)?$/u.test(field.key)) nameCn = values[0]?.trim() ?? '';
  }
  return { fields, aliases: [...new Set(aliases)], nameCn, status: 'parsed' };
}
