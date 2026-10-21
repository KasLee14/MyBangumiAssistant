import { LOCAL_ENTITY_KINDS, entityFields, type LocalEntityKind } from './local-contract.js';

const kindLabels: Readonly<Record<LocalEntityKind, string>> = {
  subject: 'subject（作品）',
  person: 'person（人物）',
  character: 'character（角色）',
  episode: 'episode（章节）',
};

/** 字段指引文本：合法字段清单只从 local-contract 的 entityFields 派生，不在提示里手抄。 */
export function entityFieldGuide(): string {
  const subjectPublic = entityFields('subject');
  const personal = entityFields('subject', true).filter(field => !subjectPublic.includes(field));
  const lines = ['字段指引：下列是各实体在本快照中的合法字段。省略 fields 只返回身份与资源引用，其他资料用 fields 或 read_cached_resource 显式读取；清单之外的字段名不可用。'];
  for (const kind of LOCAL_ENTITY_KINDS) {
    lines.push(`- ${kindLabels[kind]}：${entityFields(kind).join(', ')}`);
    if (kind === 'subject') lines.push(`- subject 个人字段（仅 data_scope=self 的本人收藏查询可用，公共范围不可用）：${personal.join(', ')}`);
  }
  return lines.join('\n');
}

export const ENTITY_FIELD_GUIDE = entityFieldGuide();
