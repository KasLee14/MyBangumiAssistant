import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const base = 'artifacts/benchmarks/presentation-20261008/model-paired-final-r3';
const rows = JSON.parse(readFileSync(join(base, 'results.json'), 'utf8')).observations;
const median = xs => { const v = [...xs].sort((a, b) => a - b), n = v.length; return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2; };
const index = new Map(rows.filter(r => r.variant === 'candidate').map(r => [r.caseId + ':' + r.repeat, r]));
const pairs = rows.filter(r => r.variant === 'control').map(a => [a, index.get(a.caseId + ':' + a.repeat)])
  .filter(([a, b]) => a.outcome === 'passed' && b?.outcome === 'passed');
const ratios = key => median(pairs.map(([a, b]) => (b.metrics[key] - a.metrics[key]) / a.metrics[key]));
const summary = { eligible: pairs.length, sumInputGrowth: ratios('contextInputTokensSum'), peakInputGrowth: ratios('contextInputTokensMax'),
  averageRequestInputGrowth: median(pairs.map(([a, b]) => (b.metrics.contextInputTokensSum / b.metrics.modelRequests) / (a.metrics.contextInputTokensSum / a.metrics.modelRequests) - 1)),
  schema: Object.fromEntries(['control', 'candidate'].map(variant => [variant, rows.find(r => r.variant === variant).metrics.initialToolSchemaBytes])) };
const size = value => Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
function payloads(run) {
  const list = [];
  for (const dir of run.traceDirectories) {
    if (!existsSync(join(dir, 'events.jsonl'))) continue;
    for (const e of readFileSync(join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)) {
      if (e.event !== 'llm.provider_request' || !e.data?.payload_ref?.path) continue;
      const p = JSON.parse(readFileSync(join(dir, e.data.payload_ref.path), 'utf8'));
      const messages = p.messages ?? p.input ?? [];
      list.push({ seq: e.seq, tools: (p.tools ?? []).map(t => { const f = t.function ?? t; return { name: f.name, bytes: size(t), schemaBytes: size(f.parameters), branches: f.parameters?.anyOf?.length }; }),
        messages: messages.map(m => {
          const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
          const start = content.indexOf('历史已展示回答摘要');
          return { role: m.role, name: m.name, bytes: size(m), contentBytes: size(m.content), reasoningBytes: size(m.reasoning_content),
            callNames: (m.tool_calls ?? []).map(t => t.function?.name), publishedSummaryBytes: start < 0 ? 0 : Buffer.byteLength(content.slice(start), 'utf8') };
        }),
        roles: messages.reduce((a, m) => { a[m.role] = (a[m.role] ?? 0) + size(m); return a; }, {}) });
    }
  }
  return list;
}
const examples = ['native-plain-text', 'resource-card', 'selection-text-interleave', 'card-style-followup'].map(id => {
  const pair = pairs.find(([a]) => a.caseId === id);
  if (!pair) return null;
  return { case: id, variants: Object.fromEntries(pair.map(run => [run.variant, { requests: run.metrics.modelRequests,
    totalInput: run.metrics.contextInputTokensSum, maxInput: run.metrics.contextInputTokensMax, toolResultBytes: run.metrics.modelToolResultBytes,
    requestTokens: run.metrics.requests.map(r => r.contextInputTokens), toolNames: run.turns.flatMap(t => t.tools.map(v => v.name)), payloads: payloads(run) }])) };
}).filter(Boolean);
const analysis = { summary, examples };
writeFileSync(join(base, 'context-growth-analysis.json'), JSON.stringify(analysis, null, 2) + '\n');
console.log(JSON.stringify({ summary, examples: examples.map(e => ({ case: e.case, variants: Object.fromEntries(Object.entries(e.variants).map(([v, r]) => [v, {
  requests: r.requests, totalInput: r.totalInput, maxInput: r.maxInput, toolResultBytes: r.toolResultBytes, requestTokens: r.requestTokens,
  toolNames: r.toolNames, firstTools: r.payloads[0]?.tools, firstRoles: r.payloads[0]?.roles, lastRoles: r.payloads.at(-1)?.roles,
  lastSummaryBytes: r.payloads.at(-1)?.messages.reduce((n, m) => n + m.publishedSummaryBytes, 0),
}])) })) }, null, 2));
