/** 查询桥接保留上游输出形状，所有账户请求统一使用本应用加密保存的p1会话。 */
import { unifiedUpstream } from './upstream.js';
import { mediaType, object, pageLimit, pageOffset, positiveId, keyword } from '../../domain/bangumi.js';
import { AppError, safeError } from '../../domain/errors.js';
import { collectionQuery, collectionStatus, STATUS_IDS } from '../../domain/collection-library.js';
import { collectionEntryFrom } from './normalize.js';
async function main(): Promise<unknown> {
  const args = process.argv.slice(2); if(args.shift() !== '--json') throw new AppError('INVALID_INPUT','查询入口需要结构化输出。');
  const {client,transport,session} = await unifiedUpstream(args[0] === 'user' || args[0] === 'collection');
  try {
    if(args[0] === 'collection' && args[1] === 'list') {
      const values: Record<string,string> = {};
      for(let i=2;i<args.length;i+=2) {
        const key=args[i]!; const value=args[i+1];
        if(!['--type','--status','--limit','--offset'].includes(key) || values[key] !== undefined || value === undefined) throw new AppError('INVALID_INPUT','收藏查询参数无效。');
        values[key]=value;
      }
      const query=collectionQuery({limit:Number(values['--limit'] ?? 20),offset:Number(values['--offset'] ?? 0),
        ...(values['--type'] === undefined ? {} : {type:mediaType(values['--type'])}),
        ...(values['--status'] === undefined ? {} : {status:collectionStatus(values['--status'])})});
      if(!session) throw new AppError('BGM_AUTH_REQUIRED','请先运行 login 或在 chat 中使用 /login。');
      const user=object(await client.getMe());
      if(user.id !== session.accountId) throw new AppError('ACCOUNT_CHANGED','收藏查询账户与保存登录不一致。');
      const types={anime:2,book:1,music:3,game:4,real:6};
      const page=object(await client.listMyCollections({limit:query.limit,offset:query.offset,
        ...(query.type ? {subjectType:types[query.type]} : {}),...(query.status ? {type:STATUS_IDS[query.status]} : {})}));
      if(!Array.isArray(page.data)) throw new AppError('INVALID_RESPONSE','收藏列表缺少data数组。');
      if(object(await client.getMe()).id !== user.id) throw new AppError('ACCOUNT_CHANGED','收藏查询期间账户改变。');
      return {account:{id:positiveId(user.id),username:user.username},data:page.data.map(collectionEntryFrom),total:page.total,
        ...(page.offset === undefined ? {} : {offset:page.offset}),...(page.limit === undefined ? {} : {limit:page.limit})};
    }
    const [resource,command,target,...rest] = args;
    const flags: Record<string,string> = {};
    for(let i=0;i<rest.length;i++) {
      const key=rest[i]!; if(key === '--verbose') continue;
      if(!['--limit','--offset','--type'].includes(key) || flags[key] !== undefined || !rest[i+1]) throw new AppError('INVALID_INPUT','查询参数无效。');
      flags[key]=rest[++i]!;
    }
    if(resource === 'user' && command === 'me' && args.length === 2) {
      const user=object(await client.getMe()); if(session && user.id !== session.accountId) throw new AppError('ACCOUNT_CHANGED','登录账户改变，请重新登录。'); return user;
    }
    if(resource === 'subject' && command === 'get' && rest.every(arg=>arg === '--verbose')) return await client.getSubject(positiveId(target));
    if(resource === 'subject' && command === 'search') {
      const types={anime:2,book:1,music:3,game:4,real:6};
      return await client.searchSubjects({keyword:keyword(target),limit:pageLimit(flags['--limit'] ?? 5),offset:0,sort:'match',filter:flags['--type'] ? {type:[types[mediaType(flags['--type'])]]} : {}});
    }
    if(resource === 'episode' && command === 'list') return await client.listEpisodes({subject_id:positiveId(target),limit:pageLimit(flags['--limit'] ?? 20),offset:pageOffset(flags['--offset'] ?? 0)});
    if(resource === 'collection' && command === 'get' && rest.length === 0) {
      const user=object(await client.getMe()); if(session && user.id !== session.accountId) throw new AppError('ACCOUNT_CHANGED','登录账户改变。');
      return {collection:await client.getUserCollection(String(user.username),positiveId(target))};
    }
    throw new AppError('INVALID_INPUT','不支持的查询入口。');
  } finally { await transport.close(); }
}
main().then(value=>process.stdout.write(JSON.stringify(value))).catch(error=>{const info=typeof error?.status === 'number' ? {code:`BGM_HTTP_${error.status}`,message:'Bangumi 请求失败，请核对认证或资源状态。'} : safeError(error); process.stderr.write(`${info.code}: ${info.message}`); process.exitCode=1;});
