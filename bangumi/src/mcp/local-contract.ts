import type { JsonSchema } from '../support/tool-schema.js';

/** 业务字段只有这一份白名单，模型投影、SQLite读取和字段文档共同使用。 */
export const LOCAL_ENTITY_KINDS = ['subject', 'person', 'character', 'episode'] as const;
export type LocalEntityKind = typeof LOCAL_ENTITY_KINDS[number];
export const PERSONAL_FIELDS = ['collectionState','collectionType','personalRating','personalTags','personalComment','collectionPrivate','epStatus','volStatus','collectionUpdatedAt'] as const;
export const LOCAL_FIELDS = ['name', 'nameCn', 'summary', 'date', 'year', 'platform', 'score', 'rank', 'ratingCount',
  'nsfw', 'url', 'tags', 'metaTags', 'tagStats', 'infobox', 'infoboxRaw', 'aliases', 'ratingDistribution',
  'totalEpisodes', 'totalVolumes', 'subjectType', 'personType', 'characterType', 'episodeType', 'subjectId',
  'sort', 'disc', 'duration', 'airDate', 'career', 'comments', 'collects', 'collectionCounts', 'series', 'relation', 'relationType', 'relationTypes', 'relations', 'relationId', 'staff', 'appearanceRole', 'fieldStates', ...PERSONAL_FIELDS] as const;
export const ENTITY_FIELDS: Readonly<Record<LocalEntityKind, readonly string[]>> = {
  subject: ['name','nameCn','summary','date','year','platform','score','rank','ratingCount','nsfw','url','tags','metaTags','tagStats','infobox','infoboxRaw','aliases','ratingDistribution','totalEpisodes','totalVolumes','subjectType','collectionCounts','series','relation','relationType','relationTypes','relations','relationId','staff','appearanceRole','fieldStates'],
  person: ['name','nameCn','summary','nsfw','url','infobox','infoboxRaw','aliases','personType','career','comments','collects','relation','relationType','relationTypes','relations','relationId','staff','appearanceRole','subjectId','fieldStates'],
  character: ['name','nameCn','summary','nsfw','url','infobox','infoboxRaw','aliases','characterType','comments','collects','relation','relationType','relationTypes','relations','relationId','appearanceRole','subjectId','fieldStates'],
  episode: ['name','nameCn','summary','date','year','url','episodeType','subjectId','sort','disc','duration','airDate','relation','relationType','relationTypes','relations','relationId','fieldStates'],
};
export function entityFields(kind:LocalEntityKind,self=false):readonly string[]{return self&&kind==='subject'?[...ENTITY_FIELDS[kind],...PERSONAL_FIELDS]:ENTITY_FIELDS[kind];}
export const closed = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({ type: 'object', additionalProperties: false, properties, required });
export const integer = (minimum = 0, maximum = Number.MAX_SAFE_INTEGER): JsonSchema => ({ type: 'integer', minimum, maximum });
export const nullable = (schema: JsonSchema): JsonSchema => ({ anyOf: [schema, { type: 'null' }] });
const text = (maxLength = 50_000): JsonSchema => ({ type: 'string', maxLength });
const strings = { type: 'array', maxItems: 1000, items: text(1000) };
export const localEntitySchema = closed({
  schemaVersion: { const: 1 }, entity: { enum: LOCAL_ENTITY_KINDS }, id: integer(1),
  ...Object.fromEntries(['name','nameCn','summary','date','platform','url','duration','airDate','relation','staff','infoboxRaw'].map(key => [key, nullable(text())])),
  ...Object.fromEntries(['year','rank','ratingCount','totalEpisodes','totalVolumes','subjectType','personType','characterType','episodeType','subjectId','relationId','relationType','appearanceRole'].map(key => [key, nullable(integer())])),
  disc: { ...nullable(integer()), description: '仅章节：Archive 原始盘号；0 原样保留，不推断其含义，缺失为 null。' },
  sort: nullable({ type: 'number' }), score: nullable({ type: 'number', minimum: 0, maximum: 10 }), nsfw: nullable({ type: 'boolean' }),
  tags: nullable(strings), metaTags: nullable(strings), aliases: nullable(strings),
  career:nullable(strings),comments:nullable(integer()),collects:nullable(integer()),series:nullable({type:'boolean'}),
  collectionCounts:nullable(closed(Object.fromEntries(['wish','done','doing','on_hold','dropped'].map(key=>[key,nullable(integer())])))),
  tagStats: nullable({ type: 'array', maxItems: 1000, items: closed({ name: text(1000), count: nullable(integer()), totalCount: nullable(integer()) }, ['name','count','totalCount']) }),
  infobox: nullable({ type: 'array', maxItems: 1000, items: closed({ key: text(1000), value: { anyOf: [text(), { type:'array', items:closed({k:text(1000),v:text()},['v']) }] } }, ['key','value']) }),
  ratingDistribution: nullable(closed(Object.fromEntries(Array.from({length:10},(_,i)=>[String(i+1),nullable(integer())])))),
  relationTypes: nullable({type:'array',uniqueItems:true,items:integer()}),
  relations: nullable({type:'array',items:closed({relationId:integer(1),relationType:integer(),sourceEntity:{enum:LOCAL_ENTITY_KINDS},sourceId:integer(1),targetEntity:{enum:LOCAL_ENTITY_KINDS},targetId:integer(1),subjectId:nullable(integer(1)),viaCharacterId:nullable(integer(1)),appearanceRole:nullable(integer()),appearanceRelationId:nullable(integer(1))},['relationId','relationType','sourceEntity','sourceId','targetEntity','targetId','subjectId','viaCharacterId','appearanceRole','appearanceRelationId'])}),
  collectionState: {enum:['collected','not_collected','unknown']},
  collectionType: nullable(integer(1,5)), personalRating: nullable(integer(0,10)), personalTags: nullable(strings),
  personalComment: nullable(text()), collectionPrivate: nullable({type:'boolean'}), epStatus: nullable(integer()), volStatus: nullable(integer()), collectionUpdatedAt: nullable(integer()),
  fieldStates: { type: 'object', additionalProperties: { enum: ['known','unknown','failed'] } },
  fieldRanges: closed(Object.fromEntries(['summary','infoboxRaw','personalComment'].map(field=>[field,closed({offset:integer(),limit:integer(1,5000),total:integer(),nextOffset:nullable(integer()),complete:{type:'boolean'}},['offset','limit','total','nextOffset','complete'])]))),
  included: { type:'array',items:{type:'string'} }, resourceFieldStates: {type:'object',additionalProperties:{enum:['known','unknown','failed']}},
}, ['entity','id']);

export const fieldsSchema: JsonSchema = { type: 'array', uniqueItems: true, maxItems: LOCAL_FIELDS.length, items: { type: 'string', enum: LOCAL_FIELDS }, default: [], description: '省略只返回身份与引用；正文等长字段按需读取，宿主展示直接补全。' };
const numericRange = (number = false, min = 0, max = Number.MAX_SAFE_INTEGER): JsonSchema => closed({ min: { type: number ? 'number':'integer',minimum:min,maximum:max },max:{type:number?'number':'integer',minimum:min,maximum:max} });
export const collectionFilterSchema = closed({
  membership:{type:'string',enum:['any','collected','not_collected'],default:'any',description:'本地收藏快照中的成员关系；missing及可见范围之外为未知，不视作未收藏。'},
  types:{type:'array',minItems:1,maxItems:5,uniqueItems:true,items:integer(1,5),description:'已收藏条目状态：1想看/读/玩/听、2看/读/玩/听过、3在看/读/玩/听、4搁置、5抛弃。'},
  exclude_types:{type:'array',minItems:1,maxItems:5,uniqueItems:true,items:integer(1,5),description:'限定已收藏且状态不在所列集合；不包含未收藏及状态未知条目。'},
  rating:{...numericRange(false,0,10),description:'个人评分闭区间；0表示未评分。'},rated:{type:'boolean',description:'true仅个人评分1至10，false仅未评分0；与rating范围不得矛盾。'},
  tags_all:{type:'array',minItems:1,maxItems:20,uniqueItems:true,items:{type:'string',minLength:1,maxLength:100}},
  tags_any:{type:'array',minItems:1,maxItems:20,uniqueItems:true,items:{type:'string',minLength:1,maxLength:100}},
  private:{type:'boolean'},updated_at:{...numericRange(),description:'上游收藏更新时间，Unix秒；不代表观看完成日期。'},
});
export const localFilterSchema = closed({
  collection:collectionFilterSchema,
  subject_type: { type:'integer',enum:[1,2,3,4,6],description:'作品媒体类型：1书籍、2动画、3音乐、4游戏、6三次元。' }, year: {...numericRange(false,1,9999),description:'作品发行/开播或章节放送年份；不代表人物生日。'},
  date: {...closed({min:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},max:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'}}),description:'作品或章节完整日期，含边界；日期不完整记录列入未知。'},
  score: numericRange(true,0,10), rating_count: numericRange(), rank: numericRange(false,1), platform: integer(),
  tags: {type:'array',minItems:1,maxItems:20,uniqueItems:true,items:{type:'string',minLength:1,maxLength:100}},
  subject_id: integer(1), episode_type: integer(0,6),
  career:{type:'array',minItems:1,maxItems:7,uniqueItems:true,items:{type:'string',enum:['writer','producer','mangaka','artist','seiyu','illustrator','actor']},description:'仅人物；职业符合所列任一项。'},
});
export const localPageSchema = closed({ total:integer(),limit:integer(1,100),offset:integer(),returnedCount:integer(0,100),nextCursor:nullable(text(2000)),complete:{type:'boolean'} },['total','limit','offset','returnedCount','nextCursor','complete']);
