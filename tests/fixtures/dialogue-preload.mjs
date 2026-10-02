// CLI 对话测试专用：替换 bgm 子进程和模型 transport，全程离线。
import './bgm-preload.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const undici = require('undici');
undici.fetch = async (url, options) => {
  if (url !== 'http://offline.invalid/chat/completions') throw new Error('测试禁止访问真实模型');
  const body = JSON.parse(options.body);
  if (body.model !== 'fixture-model') throw new Error('unexpected model');
  const last = body.messages.at(-1);
  if (body.messages[0]?.content.startsWith('你是 Bangumi 助手的任务边界分类器')) {
    if (body.tools.length) throw new Error('边界分类不允许业务工具');
    const input = JSON.parse(last.content).input;
    let kind = 'in_scope'; let reason = 'bangumi'; let allowedParts = [];
    if (input === '以芙莉莲为背景，帮我解方程') { kind = 'out_of_scope'; reason = 'general_task'; }
    else if (input === '结合我的全部观看历史推荐') { kind = 'unsupported'; reason = 'missing_history'; }
    else if (input === '推荐类似芙莉莲的动画，再帮我解方程') { kind = 'mixed'; reason = 'general_task'; allowedParts = ['推荐类似芙莉莲的动画']; }
    else if (input === '弄一下') { kind = 'clarify'; reason = 'unclear'; }
    const choice = { delta: { content: JSON.stringify({ kind, reason, goal: '离线边界样例', allowedParts }) }, finish_reason: 'stop' };
    return new Response(`data: ${JSON.stringify({ choices: [choice] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  }
  let message;
  if (last.role === 'user') {
    if (last.content === '我的五类收藏各有多少、看过多少、评分分布如何') message = { name: 'get_collection_summary', args: {} };
    else if (last.content === '列出我的想看动画') message = { name: 'list_collections', args: { type: 'anime', status: 'wish' } };
    else if (['搜索测试', '查一下《数学女孩》这本书', '推荐类似芙莉莲的动画'].includes(last.content)) message = { name: 'search_subjects', args: { keyword: 'dialogue-fixture' } };
    else if (last.content === '把这部评分改为7分') message = { name: 'resolve_reference', args: {} };
    else throw new Error('unexpected input');
  } else if (last.role === 'tool') {
    const result = JSON.parse(last.content);
    if (result.data?.id === 400602) message = { name: 'preview_collection_changes', args: { operations: [{ subjectId: 400602, patch: { rate: 7 } }] } };
  }
  const choice = message ? { delta: { tool_calls: [{ index: 0, id: `fixture_${message.name}`, type: 'function', function: { name: message.name, arguments: JSON.stringify(message.args) } }] }, finish_reason: 'tool_calls' }
    : { delta: { content: '查询或预览完成，尚未写入账户。' }, finish_reason: 'stop' };
  return new Response(`data: ${JSON.stringify({ choices: [choice] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
};
