import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatController } from '../../src/cli/chat-controller.js';
import { pathsFor, parseConfig } from '../../src/config/config.js';
import { subjectFrom } from '../../src/adapters/bgm-cli/normalize.js';
import type { BangumiWriteClient } from '../../src/adapters/bgm-cli/write-client.js';
import type { LanguageModel, Message } from '../../src/core/types.js';
import type { Collection } from '../../src/domain/bangumi.js';

type ModelHandler = (messages:readonly Message[], options:{signal:AbortSignal;onText?:(text:string)=>void}) => Promise<Extract<Message,{role:'assistant'}>>;
export async function chatFixture(t:{after(fn:()=>Promise<void>):void}, saved: {accountId:number;username?:string}|null = null) {
  const directory = await mkdtemp(join(tmpdir(),'bangumi-chat-'));
  const paths = pathsFor({BANGUMI_AGENT_HOME:directory});
  const config = parseConfig({activeModel:'first',models:{
    first:{baseUrl:'https://offline.invalid',model:'fixture-first',apiKeyEnv:'TEST_CHAT_KEY'},
    second:{baseUrl:'https://offline.invalid',model:'fixture-second',apiKeyEnv:'TEST_CHAT_KEY'},
  }});
  const subjects = [subjectFrom({id:1,type:2,name:'葬送的芙莉莲',eps:3}),subjectFrom({id:2,type:2,name:'续作',eps:3})];
  const collections = new Map<number,Collection>(subjects.map(subject => [subject.id,{subjectId:subject.id,status:3,rate:7,tags:['原标签'],comment:'原短评',private:false,chapters:0,volumes:0}]));
  const writes: number[] = []; const closed: string[] = []; let calls = 0; let account = 7; let login = saved;
  const client: BangumiWriteClient = {
    collections: async () => { throw new Error('此修改用例夹具不提供全收藏列表'); },
    currentUser:async () => ({id:account,username:'fixture'}),
    search:async () => ({data:structuredClone(subjects),total:subjects.length}),
    subject:async id => structuredClone(subjects.find(subject => subject.id === id)!),
    collection:async id => structuredClone(collections.get(id)!),
    collectionSnapshot:async id => structuredClone(collections.get(id) ?? null),
    episodes:async () => ({data:[],total:0,offset:0,limit:20,nextOffset:null,complete:true}),
    allEpisodes:async () => ({data:[],total:0,complete:true}),
    progressEpisodes:async () => ({data:[],total:0,complete:true}),
    mutate:async (id, bound, request, signal) => {
      signal.throwIfAborted(); if (bound !== account) throw new Error('account mismatch');
      writes.push(id); const patch = (request as {patch:Partial<Collection>}).patch;
      collections.set(id,{...collections.get(id)!,...patch});
    },
  };
  let handler: ModelHandler = async (messages,options) => {
    if (messages.at(-1)?.role === 'user') return {role:'assistant',content:null,tool_calls:[{id:`search-${++calls}`,type:'function',function:{name:'search_subjects',arguments:'{"keyword":"芙莉莲"}'}}]};
    options.onText?.('已展示搜索结果。'); return {role:'assistant',content:'已展示搜索结果。'};
  };
  const modelRequests: string[] = [];
  const createModel = (name:string):LanguageModel & {close():Promise<void>} => ({
    complete:async (messages,_tools,options) => {
      modelRequests.push(name);
      if (messages[0]?.content?.startsWith('你是 Bangumi 助手的任务边界分类器')) return {role:'assistant',content:'{"kind":"in_scope","reason":"bangumi","goal":"作品任务","allowedParts":[]}'};
      return handler(messages,options);
    }, close:async () => {closed.push(name);},
  });
  let loginHandler = async (_signal:AbortSignal, notice:(message:string)=>void):Promise<{id:number;username:string}> => {
    notice('离线模拟：等待 OAuth 授权'); login={accountId:account,username:'fixture'}; return {id:account,username:'fixture'};
  };
  const controller = new ChatController({config,paths,client,createModel,loadLogin:async()=>login ? {...login,username:login.username ?? 'fixture'} : null,
    login:(signal,notice)=>loginHandler(signal,notice),signal:new AbortController().signal},'first');
  t.after(async () => {await controller.close(); await rm(directory,{recursive:true,force:true});});
  return {controller,client,collections,writes,closed,paths,config,createModel,modelRequests,
    set handler(value:ModelHandler){handler=value;},set account(value:number){account=value;},set login(value:{accountId:number;username?:string}|null){login=value;},
    set loginHandler(value:typeof loginHandler){loginHandler=value;}};
}
