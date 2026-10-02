import type { ChangeValue } from './permissions.js';
import type { ProgressRequest } from './progress-plan.js';

export type Reference = { kind: 'id'; id: number } | { kind: 'index'; index: number }
  | { kind: 'current' } | { kind: 'name'; name: string };
export type Mutation = { kind: 'collection'; patch: Record<string, ChangeValue> }
  | { kind: 'progress'; progress: ProgressRequest } | { kind: 'delete' };
export interface RequestDraft {
  reference: Reference; mutation: Mutation | null;
  missing: 'rate' | 'status' | null;
}
const STATUSES: Record<string, number> = { 想看: 1, 想读: 1, 想听: 1, 想玩: 1, 看过: 2, 读过: 2, 听过: 2, 玩过: 2,
  在看: 3, 在读: 3, 在听: 3, 在玩: 3, 搁置: 4, 抛弃: 5 };
const NUMBER = '(?:\\d+|[零一二两三四五六七八九十]+)';
export function chineseNumber(text: string): number | null {
  if (/^\d+$/.test(text)) return Number.isSafeInteger(Number(text)) ? Number(text) : null;
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (text in digits) return digits[text]!;
  const match = /^([一二三四五六七八九])?十([一二三四五六七八九])?$/.exec(text);
  return match ? (match[1] ? digits[match[1]]! : 1) * 10 + (match[2] ? digits[match[2]]! : 0) : null;
}
export function referenceFrom(text: string): Reference {
  const value = text.trim().replace(/^(?:把|将|给)\s*/, '').replace(/的$/, '').trim();
  if (!value || /^(?:这部|这本书|这本|这个|这个结果|这项|它|他|那部|那个|刚才那部|刚才那个)$/.test(value)) return { kind: 'current' };
  const id = /^(?:#|条目\s*#?)?(\d+)$/.exec(value) ?? /^(?:https?:\/\/)?(?:bgm\.tv|bangumi\.tv|chii\.in)\/subject\/(\d+)\/?$/.exec(value);
  if (id && Number.isSafeInteger(Number(id[1])) && Number(id[1]) > 0) return { kind: 'id', id: Number(id[1]) };
  const ordinal = new RegExp(`^(?:刚才)?第(${NUMBER})[部个项本]$`).exec(value);
  if (ordinal) { const index = chineseNumber(ordinal[1]!); if (index !== null) return { kind: 'index', index }; }
  return { kind: 'name', name: value.replace(/^(?:名字是|名为|叫)/, '').replace(/的那个$/, '').replace(/^[《“"]|[》”"]$/g, '').trim() };
}
export function selectionFrom(input: string): Reference | null {
  if (/^(?:这个|它|他|就是这个|是这个|就是它|是它|对[，,]就是这个)[。！!]?$/.test(input.trim())) return { kind: 'current' };
  const text = input.trim().replace(/[。！!]$/, '').replace(/^(?:对[，,]\s*)?(?:就是|是|我选|选择|选|就选|就)\s*/, '');
  if (/[，,。！？?；;]/.test(text)) return null;
  const ref = referenceFrom(text);
  return ref.kind === 'index' || ref.kind === 'id' && /^(?:#|条目|https?:\/\/|bgm\.tv\/|bangumi\.tv\/|chii\.in\/)/.test(text)
    || /^[《“"]/.test(text) || /^(?:名字是|名为|叫)/.test(text) ? ref : null;
}
export function selectionCommand(input: string): { reference: Reference; setId?: string } | null {
  const match = /^\/select\s+(.+)$/.exec(input.trim());
  if (!match) return null;
  const numbered = /^(?:(c[1-9]\d*)\s+)?([1-9]\d*)$/.exec(match[1]!);
  return numbered ? { reference: { kind: 'index', index: Number(numbered[2]) }, ...(numbered[1] ? { setId: numbered[1] } : {}) }
    : { reference: referenceFrom(match[1]!) };
}
/** 否定、假设、问句、引述不生成直接意图。引号内的最终短评不参与语气判断。 */
export function unsafeMutationText(input: string): boolean {
  const outer = input.replace(/[“"][\s\S]*?[”"]/g, '正文').replace(/《[^》]*》/g, '作品');
  return /[？?]|(?:不要|别|不想|不需要|暂不|先不|如果|假如|假设|要是|是否|建议|觉得|合适|会怎样|怎么样|能否|能不能|可以吗|吗[。！!]?\s*$|介绍|系统|提示词|指令|说过|说：|说:)/.test(outer);
}
export function decisionFrom(input: string): { kind: 'confirm' | 'reject'; scope: 'clear' | 'delete' | 'rollback' | null } | null {
  const text = input.trim().replace(/[。！!]$/, '').replace(/\s/g, '');
  if (/^(?:取消|取消吧|取消修改|取消操作|拒绝|不确认|别改了|不要改了|先不改|算了|先不做了)$/.test(text)) return { kind: 'reject', scope: null };
  if (/^(?:确认|确认执行|确认修改|确认这些修改|确认清空|确认删除|确认回退|确认这个预览|就按这个执行|就按这个改|按预览执行|执行吧|(?:好的|是的)[，,]?(?:确认|就这样执行|就按这个执行)|(?:没问题|可以)[，,]?执行吧|确认[，,]?就按这个(?:执行|清空|删除))$/.test(text)) {
    return { kind: 'confirm', scope: text.includes('清空') ? 'clear' : text.includes('删除') ? 'delete' : text.includes('回退') ? 'rollback' : null };
  }
  return null;
}
export function rateAnswer(input: string): number | null {
  const match = new RegExp(`^(?:就|改成|改为|设为)?\\s*(${NUMBER})\\s*分?[。！!]?$`).exec(input.trim());
  const rate = match ? chineseNumber(match[1]!) : null;
  return rate !== null && rate >= 0 && rate <= 10 ? rate : null;
}
export function looksLikeRateAnswer(input: string): boolean {
  return new RegExp(`^(?:就|改成|改为|设为)?\\s*(${NUMBER})\\s*分?[。！!]?$`).test(input.trim());
}
export function statusAnswer(input: string): number | null {
  const text = input.trim().replace(/[。！!]$/, '').replace(/^(?:那就|就|设为|选|选择|加入|改成|改为)/, '');
  return STATUSES[text] ?? null;
}
/** 完整句式解析；未覆盖的表达可由模型提出待确认的结构化请求，不能自行获得授权。 */
export function mutationFrom(input: string): RequestDraft | null {
  if (unsafeMutationText(input)) return null;
  // 角色、人物和目录使用各自MCP权限链路，不被旧作品取消收藏规则拦截或误当作品焦点。
  if (/^(?:请)?(?:帮我|给我|把|将)?\s*(?:(?:取消|删除|移除|收藏|新增|加入)\s*)?(?:(?:角色|人物|目录)\s*(?:#|ID|编号)?\s*[1-9]\d*|(?:https?:\/\/)?(?:bgm\.tv|bangumi\.tv|chii\.in)\/(?:character|person|index)\/[1-9]\d*)/i.test(input.trim())) return null;
  const text = input.trim().replace(/[。！!]$/, '')
    .replace(/^确认[，,]\s*(?:不过|但是|但)\s*/, '')
    .replace(/^(?:这个结果是对的|这个结果对|结果是对的|对[，,]?就是这个|对|没错)[，,]\s*/, '')
    .replace(/^(?:请帮我|请|麻烦你|麻烦|帮我)\s*/, '')
    .replace(/^(?:我|昨晚|昨天|今天|刚刚|刚才)(?=看到第|看到了第|已看到第|读到第)/, '');
  const ready = (target: string, mutation: Mutation): RequestDraft => ({ reference: referenceFrom(target), mutation, missing: null });
  let match = new RegExp(`^(.*?)(?:的)?(?:评分|分数)(?:改成|改为|设为|设置为|调整到)\\s*(${NUMBER})\\s*分?$`).exec(text)
    ?? new RegExp(`^(?:给)?(.*?)(?:打|评|改成|改为|设为)\\s*(${NUMBER})\\s*分$`).exec(text);
  if (match) { const rate = chineseNumber(match[2]!); if (rate !== null && rate >= 0 && rate <= 10) return ready(match[1]!, { kind: 'collection', patch: { rate } }); return null; }
  match = /^(?:给)?(.*?)(?:打(?:个)?分|评个分|评分(?:改成|改为|设为))$/.exec(text) ?? /^给(.*?)评分$/.exec(text);
  if (match) {
    const outer = text.replace(/《[^》]*》|[“"][\s\S]*?[”"]/g, '作品');
    if (!/^(?:我(?:想|要)(?:看|查|了解|知道)|帮我(?:查|搜|找)|查|搜|看一下|看看|找一下)/.test(outer)
      && !/多少人|几个人|评分人数|打分人数/.test(outer)) return { reference: referenceFrom(match[1]!), mutation: null, missing: 'rate' };
  }
  match = /^(.*?)(?:的)?(?:(?:收藏状态|状态)(?:改成|改为|设为|设置为)|加入|标记为|设为)(想看|想读|想听|想玩|看过|读过|听过|玩过|在看|在读|在听|在玩|搁置|抛弃)$/.exec(text);
  if (match) return ready(match[1]!, { kind: 'collection', patch: { status: STATUSES[match[2]!]! } });
  match = /^(.*?)(?:的)?(?:收藏状态|状态)(?:改成|改为|设为)$/.exec(text);
  if (match) return { reference: referenceFrom(match[1]!), mutation: null, missing: 'status' };
  match = /^(.*?)(?:的)?短评(?:改成|改为|保存为)[“"]([\s\S]*)[”"]$/.exec(text);
  if (match) return ready(match[1]!, { kind: 'collection', patch: { comment: match[2]! } });
  match = /^(.*?)(?:的)?标签(?:改成|改为|设为)\s*(\[[\s\S]*\])$/.exec(text);
  if (match) { try { const tags: unknown = JSON.parse(match[2]!); if (Array.isArray(tags) && tags.every(value => typeof value === 'string')) return ready(match[1]!, { kind: 'collection', patch: { tags } }); } catch { /* 由预览解析后确认。 */ } return null; }
  match = /^(.*?)(?:的)?(?:可见性|收藏)?(?:改成|改为|设为)(公开|私密)$/.exec(text);
  if (match) return ready(match[1]!, { kind: 'collection', patch: { private: match[2] === '私密' } });
  match = new RegExp(`^(.*?)(?:的)?(?:进度)?(?:看到第|看到了第|已看到第)\\s*(${NUMBER})\\s*集(?:了)?$`).exec(text);
  if (match) { const number = chineseNumber(match[2]!); if (number !== null && number > 0) return ready(match[1]!, { kind: 'progress', progress: { mode: 'through', number } }); }
  match = new RegExp(`^(.*?)第\\s*(${NUMBER})\\s*集看过(?:了)?$`).exec(text);
  if (match) { const number = chineseNumber(match[2]!); if (number !== null && number > 0) return ready(match[1]!, { kind: 'progress', progress: { mode: 'single', number } }); }
  match = /^(.*?)章节\s*#?([1-9]\d*)\s*看过(?:了)?$/.exec(text);
  if (match) return ready(match[1]!, { kind: 'progress', progress: { mode: 'explicit', episodeId: Number(match[2]) } });
  match = new RegExp(`^(.*?)(?:的)?(?:进度)?(?:退回第|回退到第|退回到第)\\s*(${NUMBER})\\s*集$`).exec(text);
  if (match) { const number = chineseNumber(match[2]!); if (number !== null) return ready(match[1]!, { kind: 'progress', progress: { mode: 'rollback', number } }); }
  match = new RegExp(`^(.*?)(?:的)?(?:读到第|(?:阅读进度|进度)改为)\\s*(${NUMBER})\\s*(章|卷)(?:了)?$`).exec(text);
  if (match) { const number = chineseNumber(match[2]!); if (number !== null) return ready(match[1]!, { kind: 'progress', progress: { mode: 'book', [match[3] === '章' ? 'chapters' : 'volumes']: number } }); }
  match = /^(?:清空|清除)(.*?)的?进度$/.exec(text) ?? /^(.*?)(?:的)?进度(?:清空|清零)$/.exec(text);
  if (match) return ready(match[1]!, { kind: 'progress', progress: { mode: 'clear' } });
  match = /^(?:删除|移除|取消)(.*?)的?收藏$/.exec(text);
  if (match) return ready(match[1]!, { kind: 'delete' });
  return null;
}
