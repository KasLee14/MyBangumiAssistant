import type { BenchmarkCase, Data, FixtureDefinition, Grade, NetworkEvent, Rule, TurnObservation, RunMetrics } from './schema.js';
import { record, walk } from './schema.js';
import { accountSubject } from './fixtures.js';

function visibleValues(turn: TurnObservation | undefined): unknown[] {
  return (turn?.tools ?? []).filter(tool => !tool.error).map(tool => tool.value);
}
export function selectedSubjects(turn: TurnObservation | undefined, fixture: FixtureDefinition): number[] {
  const ids = new Set<number>(), known = new Set(fixture.subjects.map(subject => subject.id));
  walk(turn?.final, row => {
    for (const key of ['subjectId', 'subject_id']) if (Number.isSafeInteger(row[key]) && Number(row[key]) > 0) ids.add(Number(row[key]));
    if (row.type === 'SubjectCards') for (const item of Array.isArray(record(row.props).items) ? record(row.props).items as unknown[] : []) {
      const id = Number(record(item).id); if (Number.isSafeInteger(id) && id > 0) ids.add(id);
    }
    if ((row.entity === 'subject' || row.name !== undefined || row.nameCn !== undefined || row.name_cn !== undefined) && known.has(Number(row.id))) ids.add(Number(row.id));
  });
  for (const match of (turn?.text ?? '').matchAll(/https?:\/\/(?:bgm\.tv|bangumi\.tv|chii\.in)\/subject\/(\d+)/g)) ids.add(Number(match[1]));
  if (!ids.size) {
    let text = turn?.text ?? '';
    for (const subject of [...fixture.subjects].sort((a, b) => b.name.length - a.name.length)) {
      if (text.includes(subject.name)) { ids.add(subject.id); text = text.replaceAll(subject.name, ''); }
    }
  }
  return [...ids].sort((a, b) => a - b);
}
export function gradeCase(test: BenchmarkCase, turns: TurnObservation[], fixture: FixtureDefinition,
  network: NetworkEvent[], confirmations: Array<{ accepted: boolean; timestampMs?: number }>, state: unknown, metrics?: RunMetrics): Grade {
  const checks = test.rules.map(rule => {
    const turn = turns[('turn' in rule ? rule.turn : undefined) ?? turns.length - 1], values = visibleValues(turn);
    let passed = false, detail = '';
    switch (rule.kind) {
      case 'subjects': {
        const ids = selectedSubjects(turn, fixture);
        passed = (rule.exact === undefined || JSON.stringify(ids) === JSON.stringify([...rule.exact].sort((a, b) => a - b)))
          && (rule.allowed === undefined || ids.every(id => rule.allowed!.includes(id)))
          && (rule.required === undefined || rule.required.every(id => ids.includes(id)))
          && (rule.min === undefined || ids.length >= rule.min) && (rule.max === undefined || ids.length <= rule.max);
        detail = '交付作品ID：' + ids.join(','); break;
      }
      case 'text':
        passed = new RegExp(rule.pattern, 'u').test(turn?.text ?? '') !== (rule.absent === true);
        detail = passed ? '文本断言通过' : '文本断言未通过'; break;
      case 'component':
        walk(turn?.final, row => { if (row.type === rule.type && row.pending === false) passed = true; });
        detail = '完整组件：' + rule.type; break;
      case 'visible_text':
        passed = values.some(value => JSON.stringify(value).includes(rule.text));
        detail = '模型可见资料应含：' + rule.text; break;
      case 'evidence': {
        const subjectIds = rule.selected ? selectedSubjects(turn, fixture) : rule.subjectIds;
        const fields = new Map<number, Set<string>>();
        values.forEach(value => walk(value, row => {
          const id = Number(row.subjectId ?? row.subject_id ?? row.id);
          if (!subjectIds.includes(id)) return;
          const found = fields.get(id) ?? new Set<string>();
          for (const field of rule.fields) if (row[field] !== undefined && row[field] !== null && row[field] !== '') found.add(field);
          fields.set(id, found);
        }));
        passed = subjectIds.length > 0 && subjectIds.every(id => rule.fields.every(field => fields.get(id)?.has(field)));
        detail = '实际模型可见字段：' + JSON.stringify([...fields].map(([id, fields]) => [id, [...fields]])); break;
      }
      case 'called':
        passed = (turn?.tools ?? []).some(tool => rule.names.includes(tool.name) && (rule.successful !== true || !tool.error));
        detail = '允许的调用入口：' + rule.names.join(','); break;
      case 'coverage':
        (turn?.tools ?? []).filter(tool => tool.name === rule.tool && !tool.error).forEach(tool => walk(tool.value, row => {
          const coverage = record(row.coverage);
          if (coverage.complete === true) passed = true;
          if (rule.scope === 'source' && (coverage.sourceComplete === true
            || Number(coverage.sourceCount) > 0 && coverage.incompleteSourceCount === 0 && coverage.completeSourceCount === coverage.sourceCount
            || coverage.stopReason === 'exhausted' && coverage.collectionTotal !== undefined && coverage.scannedCount === coverage.collectionTotal)) passed = true;
        }));
        detail = '已取得来源覆盖完成证据：' + rule.tool; break;
      case 'confirmations':
        passed = confirmations.length === rule.count && confirmations.every(item => item.accepted === rule.accepted);
        detail = '宿主授权次数：' + confirmations.length; break;
      case 'writes': {
        const writes = network.filter(event => event.write);
        const ids = writes.map(event => event.subjectId).filter((id): id is number => id !== null).sort((a, b) => a - b);
        passed = writes.length === rule.count && JSON.stringify([...new Set(ids)]) === JSON.stringify([...rule.subjectIds].sort((a, b) => a - b));
        const rows = Array.isArray(state) ? state.map(record) : [];
        if (rule.collectionType !== undefined || rule.comment !== undefined) passed &&= rule.subjectIds.every(id => {
          const interest = record(rows.find(row => row.id === id)?.interest);
          return (rule.collectionType === undefined || interest.type === rule.collectionType)
            && (rule.comment === undefined || interest.comment === rule.comment);
        });
        if (rule.preserveOtherFields !== false) passed &&= rule.subjectIds.every(id => {
          const before = record(accountSubject(fixture.subjects.find(subject => subject.id === id)!).interest);
          const after = record(rows.find(row => row.id === id)?.interest);
          const fields = ['type', 'rate', 'comment', 'tags', 'private', 'epStatus', 'volStatus']
            .filter(field => !(field === 'type' && rule.collectionType !== undefined || field === 'comment' && rule.comment !== undefined));
          return fields.every(field => JSON.stringify(before[field]) === JSON.stringify(after[field]));
        });
        if (rule.verify === true) passed &&= writes.every(write => network.some(read =>
          !read.write && read.seq > write.seq && read.path === '/p1/subjects/' + write.subjectId && read.status === 200));
        if (test.rules.some(item => item.kind === 'confirmations' && item.count > 0 && item.accepted)) passed &&= writes.every(write =>
          confirmations.some(confirmation => confirmation.accepted && typeof confirmation.timestampMs === 'number' && confirmation.timestampMs <= write.timestampMs));
        detail = '固定上游写入次数/对象：' + writes.length + '/' + ids.join(','); break;
      }
      case 'no_write_retry': {
        const keys = network.filter(event => event.write).map(event => event.method + ':' + event.path);
        passed = new Set(keys).size === keys.length; detail = '未知提交不得重发'; break;
      }
      case 'recovery': {
        const prefixCopies = rule.prefix ? (turn?.text ?? '').split(rule.prefix).length - 1 : 0;
        passed = metrics !== undefined && metrics.outputErrors > 0 && metrics.recoveryScheduled > 0 && metrics.prefixMonotonic
          && (rule.expectedTerminal === 'error' ? metrics.terminalModelErrors > 0 && metrics.recoveryStopped > 0
            : metrics.recoveryRecovered > 0 && metrics.terminalModelErrors === 0 && metrics.validatedFinals === test.turns.length)
          && (rule.prefix === undefined || prefixCopies === 1);
        detail = '宿主恢复：预期终态=' + rule.expectedTerminal + '；中间输出错误=' + (metrics?.outputErrors ?? '不可用')
          + '；终态错误=' + (metrics?.terminalModelErrors ?? '不可用') + '；前缀次数=' + prefixCopies + '。runtime证据不替代浏览器SSE验证。';
        break;
      }
    }
    return { rule, passed, detail };
  });
  return { passed: checks.every(check => check.passed), checks, semanticReview: test.semanticRubric ? 'pending' : 'not_required', rubric: test.semanticRubric ?? null };
}
/** Pi 的原生 text 签名属于协议元数据；组件对象仍按原值交给闭合契约校验。 */
export function canonicalBenchmarkContent(parts: readonly unknown[]): unknown[] {
  return parts.filter(part => !['thinking', 'toolCall'].includes(String(record(part).type))).map(part => {
    const row = record(part);
    return row.type === 'text' ? { type: 'text', text: row.text,
      ...(Object.hasOwn(row, 'nextType') ? { nextType: row.nextType } : {}) } : part;
  });
}
/** 自动硬判与人工语义评审分开；工具结果不能替代最终交付。 */
export function outputText(value: unknown): string {
  const chunks: string[] = [];
  const hidden = new Set(['type', 'nextType', 'pending', 'resourceRef', 'resource_ref', 'entity', 'layout', 'tone',
    'image', 'images', 'fit', 'mono', 'keyColumn', 'currentRow', 'textSignature']);
  const visit = (item: unknown, key = ''): void => {
    if (hidden.has(key)) return;
    if (typeof item === 'string' || typeof item === 'number') chunks.push(String(item));
    else if (Array.isArray(item)) item.forEach(child => visit(child, key));
    else if (item !== null && typeof item === 'object') Object.entries(record(item)).forEach(([field, child]) => visit(child, field));
  };
  visit(value);
  return chunks.join('\n');
}
export function ruleLabel(rule: Rule): string { return rule.kind; }
