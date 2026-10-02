import { chineseNumber, mutationFrom } from './dialogue-intent.js';
import type { MediaType } from './bangumi.js';

const MEDIA: Record<string, MediaType> = { 动画: 'anime', 动漫: 'anime', 漫画: 'book', 小说: 'book', 书籍: 'book', 音乐: 'music', 游戏: 'game', 电视剧: 'real', 三次元: 'real' };
const mediaNames = Object.keys(MEDIA).join('|');
const readPrefix = /^(?:请\s*)?(?:我(?:想|要)(?:看|查|了解|知道)|帮我(?:查|搜|找)|查|搜|找一下|看看|看一下)/;
const FIELD_NAMES: Record<string, string> = { 评分人数: 'ratingCount', 打分人数: 'ratingCount', 评分: 'score', 分数: 'score', 得分: 'score', 排名: 'rank', 集数: 'totalEpisodes', 放送日期: 'date', 收藏状态: 'collectionStatus', 进度: 'progress', 详情: 'details', 详细信息: 'details', 资料: 'details', 介绍: 'details' };
const fields = Object.keys(FIELD_NAMES).join('|');

/** 读取/比较请求不能被“评分”结尾的旧补值规则误认为修改。 */
export function isSubjectReadRequest(input: string): boolean {
  if (mutationFrom(input)) return false;
  const outer = input.replace(/《[^》]*》|[“"][\s\S]*?[”"]/g, '正文');
  if (/[，,；;]\s*(?:顺便|再|然后|并且)?\s*(?:把|将|给).*?(?:改|设|打|保存|加入)/.test(outer)) return false;
  return readPrefix.test(input.trim()) || /^(?:请\s*)?(?:对比|比较|分别|推荐)/.test(input.trim())
    || Boolean(subjectQuery(input)?.fields.length);
}

/** 只提取完整单作品查询；多对象、比较、推荐和修改不推断成单项选择。 */
export function subjectQuery(input: string): { name: string; type?: MediaType; fields: string[] } | null {
  if (mutationFrom(input) || /^(?:请\s*)?(?:对比|比较|推荐|分别)/.test(input.trim())) return null;
  let text = input.trim().replace(/[？?。！!]+$/, '').replace(/^请\s*/, '');
  text = text.replace(/^(?:我(?:想|要)(?:看|查|了解|知道)(?:一下)?|帮我(?:查|搜|找)(?:一下)?|查(?:询|一下|查)?|搜(?:索|一下)?|找一下|看(?:看|一下))\s*/, '');
  const attributes = new RegExp(`^(.*?)(?:的)?(?:当前|目前|现在|最新)?((?:${fields})(?:\\s*(?:以及|和|与|及|、|[/／]|[，,])\\s*(?:当前|目前|现在|最新)?(?:${fields}))*)(?:是|有|为)?(?:多少|几分|怎么样|是什么)?(?:啊|呀|呢|吗)?$`).exec(text);
  let requested: string[] = [];
  if (attributes) {
    text = attributes[1]!.trim();
    requested = [...new Set([...attributes[2]!.matchAll(new RegExp(fields, 'g'))].map(match => FIELD_NAMES[match[0]]!))];
  } else {
    const score = /^(.*?)(?:的)?(?:当前|目前|现在|最新)?多少分(?:啊|呀|呢|吗)?$/.exec(text);
    if (score) { text = score[1]!.trim(); requested = ['score']; }
  }
  // 书名号内的完整名称可包含连接词；普通查询的多个名称保持未绑定。
  if (!/^[《“"].+[》”"]$/.test(text) && /和|与|或|及|[、,，；;\n]/.test(text)) return null;
  let type: MediaType | undefined;
  const prefix = new RegExp(`^(${mediaNames})(?:版)?[：:\\s]*`).exec(text);
  if (prefix) { type = MEDIA[prefix[1]!]; text = text.slice(prefix[0].length); }
  const suffix = new RegExp(`(?:这部|这本|的)?(${mediaNames})(?:版)?$`).exec(text);
  if (suffix) {
    const suffixType = MEDIA[suffix[1]!];
    if (type && type !== suffixType) return null;
    type = suffixType; text = text.slice(0, -suffix[0].length);
  }
  text = text.trim().replace(/^[《“"]|[》”"]$/g, '').trim();
  if (!text || text.length > 300 || /^(?:这部|这本|这个|它|作品|动画)$/.test(text)) return null;
  return { name: text, fields: requested, ...(type ? { type } : {}) };
}

export function normalizeSubjectName(value: string): string {
  return value.normalize('NFKC').replace(/\s/g, '').toLocaleLowerCase()
    .replace(/第([零一二两三四五六七八九十\d]+)[季期]/g, (text, number: string) => {
      const parsed = chineseNumber(number); return parsed === null ? text : `第${parsed}季`;
    });
}
