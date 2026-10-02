import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AccountSessionStore } from '../../storage/account-session.js';
import { AccountTransport } from '../bangumi-login/transport.js';
import { activeSession } from '../bangumi-login/session.js';
import { decodeProxyPolicy } from '../../config/proxy.js';

export interface UnifiedUpstream {
  getMe(): Promise<unknown>; getSubject(id:number): Promise<unknown>; getEpisode(id:number): Promise<unknown>;
  searchSubjects(value:object): Promise<unknown>; listEpisodes(value:object): Promise<unknown>;
  listCollections(user:string,value:object): Promise<unknown>;
  listMyCollections(value:object): Promise<unknown>;
  getUserCollection(user:string,id:number): Promise<unknown>;
  upsertMyCollection(id:number,value:object): Promise<unknown>; patchMyCollection(id:number,value:object): Promise<unknown>;
  updateMyEpisodeCollection(id:number,value:object): Promise<unknown>;
}
export async function unifiedUpstream(authenticated = true): Promise<{client:UnifiedUpstream; transport:AccountTransport; session:Awaited<ReturnType<AccountSessionStore['load']>>}> {
  const root = dirname(createRequire(import.meta.url).resolve('@aronnaxlin/bgm-cli/package.json'));
  const { BangumiClient } = await import(pathToFileURL(join(root,'src/core/client.js')).href);
  const directory = process.env.BANGUMI_AUTH_DIRECTORY ?? join(process.env.BGM_CONFIG_DIR ?? '.', '..','auth');
  const timeout=Number(process.env.BANGUMI_REQUEST_TIMEOUT_MS ?? 60000);
  const proxy = process.env.BANGUMI_PROXY_POLICY ? decodeProxyPolicy(process.env.BANGUMI_PROXY_POLICY) : process.env.BGM_PROXY ?? null;
  const requestTimeout = Number.isFinite(timeout) && timeout >= 1000 && timeout <= 300000 ? timeout : 60000;
  const store = new AccountSessionStore(directory);
  const saved = authenticated ? await activeSession(store) : await store.load().catch(() => null);
  // 无需账户的公开请求不因旧会话到期而要求重新登录。
  const session = saved && saved.expiresAt > Date.now() ? saved : null;
  const transport = new AccountTransport(session,proxy,requestTimeout);
  // 复用锁定版本的转换逻辑；认证和请求封装属于本项目，不修改 node_modules。
  class UnifiedClient extends BangumiClient {
    // 固定本人端点，避免上游listCollections身份探测失败后退化为公开列表。
    async listMyCollections(query: object) { return this.request('/p1/collections/subjects', { auth: true, query: query as Record<string, unknown> }); }
    async request(path:string, options:Parameters<AccountTransport['json']>[1] = {}) { return transport.json(path,options); }
  }
  return {client:new UnifiedClient() as unknown as UnifiedUpstream,transport,session};
}
