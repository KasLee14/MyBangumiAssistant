import type { InfoboxItem } from './infobox-output.js';

/** 候选日期只保留来源已有的年月日精度；零值占位和非法日期是未知，不能补造月日。 */
export function normalizeCandidateDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim(), match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(text);
  if (!match || Number(match[1]) === 0) return null;
  const year = Number(match[1]), month = match[2] === undefined ? undefined : Number(match[2]),
    day = match[3] === undefined ? undefined : Number(match[3]);
  if (month === undefined || month === 0 && (day === undefined || day === 0)) return match[1]!;
  if (month < 1 || month > 12) return null;
  if (day === undefined || day === 0) return `${match[1]}-${match[2]}`;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0),
    days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1]! ? text : null;
}

const durationKeys = new Set(['每集时长', '单集时长', '每话时长', '时长', '片长', '长度', 'Duration']);
function strings(value: InfoboxItem['value']): string[] { return typeof value === 'string' ? [value] : value.map(pair => pair.v); }
/** 只解析单一明确时长，不把范围、总播放量或缺失分钟猜成单集时长。 */
export function durationMinutes(value: string): number | null {
  const text = value.trim();
  const minutes = /^(?:每(?:集|话)\s*)?(\d+(?:\.\d+)?)\s*(?:分钟|分|mins?|minutes?)(?:\s*(\d+(?:\.\d+)?)\s*(?:秒|s|seconds?))?$/i.exec(text);
  if (minutes) { const result = Number(minutes[1]) + Number(minutes[2] ?? 0) / 60; return result > 0 && Number.isFinite(result) ? result : null; }
  const seconds = /^(\d+(?:\.\d+)?)\s*(?:秒|s|seconds?)$/i.exec(text);
  if (seconds) { const result = Number(seconds[1]) / 60; return result > 0 && Number.isFinite(result) ? result : null; }
  return null;
}
/** 标准化明确时长；题材、体验和通俗类别由模型依据原始证据判断。 */
export function durationFacts(value: { infobox?: unknown }): { durationMinutes: number | null } {
  const durations = new Set<number>();
  if (Array.isArray(value.infobox)) for (const row of value.infobox as InfoboxItem[]) {
    for (const entry of strings(row.value)) {
      if (durationKeys.has(row.key)) { const minutes = durationMinutes(entry); if (minutes !== null) durations.add(minutes); }
    }
  }
  return { durationMinutes: durations.size === 1 ? [...durations][0]! : null };
}
