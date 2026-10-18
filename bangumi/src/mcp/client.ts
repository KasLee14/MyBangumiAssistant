import * as z from 'zod/v4';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join } from 'node:path';
import { AppError } from '../support/errors.js';
import { compileSchema } from '../support/tool-schema.js';
import type { ProxyOptions } from '../support/proxy.js';
import { TOOL_DEFINITIONS, validateToolArguments } from './catalog.js';
import type { PreparedBaseline } from './prepared.js';
import type { BatchPreparation, McpBatchScope } from './batch-context.js';
import { checkAccessResponse } from './access-context.js';
import { readContext, type McpReadContext } from './read-context.js';
import { checkCachedResourceRpcResult, cachedResourceSelection, RESOURCE_REF_PATTERN, type CachedResource, type CachedResourceSelection } from './resource-contract.js';

// 旧未装配模块仍引用这些类型；业务目录中没有写入入口。
export interface McpWriteGuard { accountId:number;subjectId?:number;expectedStatus?:number;prepared?:PreparedBaseline;batchPreparation?:BatchPreparation }
export interface McpCallClient {
  call(name:string,args:Record<string,unknown>,signal?:AbortSignal,guard?:McpWriteGuard,batch?:McpBatchScope,read?:McpReadContext):Promise<unknown>;
  readCachedResource?(ref:string,signal?:AbortSignal,read?:McpReadContext,selection?:CachedResourceSelection):Promise<CachedResource>;
  endReadContext?(turnId:string):Promise<void>;close():Promise<void>;
}
const SAFE_ENVIRONMENT=['APPDATA','HOMEDRIVE','HOMEPATH','LOCALAPPDATA','PATH','PROCESSOR_ARCHITECTURE','SYSTEMDRIVE','SYSTEMROOT','TEMP','TMP','USERNAME','USERPROFILE','PROGRAMFILES','HOME','LANG','LC_ALL'];
function childEnvironment(source:NodeJS.ProcessEnv):Record<string,string>{
  const output:Record<string,string>={};for(const key of SAFE_ENVIRONMENT){const value=source[key]??source[Object.keys(source).find(name=>name.toUpperCase()===key)??''];if(value!==undefined&&!value.startsWith('()'))output[key]=value;}return output;
}
function interrupted(signal?:AbortSignal):void{if(signal?.aborted)throw new AppError('CANCELLED','本地读取已取消。');}
async function cancelable<T>(promise:Promise<T>,signal?:AbortSignal):Promise<T>{
  interrupted(signal);if(!signal)return promise;
  return new Promise((resolve,reject)=>{const abort=()=>reject(new AppError('CANCELLED','本地读取已取消。'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();promise.then(value=>signal.aborted?abort():resolve(value),reject).finally(()=>signal.removeEventListener('abort',abort));});
}
type LocalOptions={knowledgeDir?:string;accountDataDir?:string;authDir?:string;proxy?:ProxyOptions;timeoutMs:number;entry?:string;env?:NodeJS.ProcessEnv;onTrace?:(event:'initializing'|'initialized'|'dispatch')=>void};
/** stdio子进程只打开本地SQLite；初始化始终完整核对六工具目录，无网络回退。 */
export class LocalMcpClient implements McpCallClient {
  private readonly client=new Client({name:'MyBangumiAssistant',version:'0.2.0'},{capabilities:{}});
  private readonly transport:StdioClientTransport;
  private initialization:Promise<void>|undefined;
  private closed=false;private broken=false;
  constructor(private readonly options:LocalOptions){
    if(!Number.isInteger(options.timeoutMs)||options.timeoutMs<1000||options.timeoutMs>300000)throw new AppError('INVALID_INPUT','MCP超时须为1000～300000毫秒。');
    const entry=options.entry??fileURLToPath(new URL('./server.js',import.meta.url));
    const knowledgeDir=options.knowledgeDir??(options.authDir?join(dirname(options.authDir),'knowledge'):undefined);
    if(!knowledgeDir||!isAbsolute(entry)||!isAbsolute(knowledgeDir))throw new AppError('INVALID_INPUT','本地MCP服务与数据目录须为绝对路径。');
    const env=childEnvironment(options.env??process.env);env.BANGUMI_KNOWLEDGE_DIRECTORY=knowledgeDir;env.BANGUMI_REQUEST_TIMEOUT_MS=String(options.timeoutMs);
    const accountDataDir=options.accountDataDir??(options.authDir?join(dirname(options.authDir),'account-data'):undefined);
    if(accountDataDir){if(!isAbsolute(accountDataDir))throw new AppError('INVALID_INPUT','个人数据库目录须为绝对路径。');env.BANGUMI_ACCOUNT_DATA_DIRECTORY=accountDataDir;}
    // 保留benchmark配置定位目录；它不被生产server当作账户入口。
    if(options.authDir)env.BANGUMI_AUTH_DIRECTORY=options.authDir;
    this.transport=new StdioClientTransport({command:process.execPath,args:[entry],env,stderr:'pipe',maxBufferSize:2_000_000});
    let stderrBytes=0;this.transport.stderr?.on('data',(chunk:Buffer|string)=>{stderrBytes+=Buffer.byteLength(chunk);if(stderrBytes>100_000){this.broken=true;void this.transport.close();}});
    this.client.onclose=()=>{this.broken=true;};this.client.onerror=()=>{this.broken=true;};
  }
  private usable():void{if(this.closed||this.broken)throw new AppError('MCP_CONNECTION_CLOSED','本地MCP连接已关闭，请重新启动助手。');}
  private trace(event:'initializing'|'initialized'|'dispatch'):void{try{this.options.onTrace?.(event);}catch{/* 追踪不改变业务结果。 */}}
  private ready():Promise<void>{this.usable();this.initialization??=this.initialize();return this.initialization;}
  private async initialize():Promise<void>{
    this.trace('initializing');
    try{
      await this.client.connect(this.transport,{timeout:this.options.timeoutMs});this.usable();
      const expected=new Map(TOOL_DEFINITIONS.map(tool=>[tool.name,tool])),seen=new Set<string>(),cursors=new Set<string>();let cursor:string|undefined;
      for(let page=0;page<10;page++){
        const result=await this.client.listTools(cursor?{cursor}:{},{timeout:this.options.timeoutMs});
        for(const tool of result.tools){const locked=expected.get(tool.name);if(!locked||seen.has(tool.name)||!isDeepStrictEqual(tool.inputSchema,locked.inputSchema)||!isDeepStrictEqual(tool.outputSchema,locked.outputSchema))throw new AppError('MCP_CATALOG_MISMATCH','本地工具目录与固定六工具契约不一致。');seen.add(tool.name);}
        if(!result.nextCursor){if(seen.size!==TOOL_DEFINITIONS.length)throw new AppError('MCP_CATALOG_MISMATCH','本地MCP目录不完整。');this.trace('initialized');return;}
        if(!result.tools.length||cursors.has(result.nextCursor))throw new AppError('MCP_CATALOG_MISMATCH','工具目录分页没有推进。');cursors.add(result.nextCursor);cursor=result.nextCursor;
      }
      throw new AppError('MCP_CATALOG_MISMATCH','工具目录分页超过上限。');
    }catch(error){this.broken=true;await this.transport.close();if(error instanceof AppError)throw error;throw new AppError('MCP_START_FAILED','本地MCP初始化失败，请检查宿主构建和数据目录。');}
  }
  async listTools(signal?:AbortSignal){await cancelable(this.ready(),signal);interrupted(signal);return TOOL_DEFINITIONS.map(tool=>structuredClone(tool));}
  async call(name:string,args:Record<string,unknown>,signal?:AbortSignal,guard?:McpWriteGuard,batch?:McpBatchScope,read?:McpReadContext):Promise<unknown>{
    const parameters=validateToolArguments(name,args),definition=TOOL_DEFINITIONS.find(tool=>tool.name===name)!;
    if(guard||batch)throw new AppError('INVALID_INPUT','本地公共查询不接受账户写入或批量授权元数据。');
    const context=read===undefined?undefined:readContext(read);await cancelable(this.ready(),signal);interrupted(signal);this.usable();
    this.trace('dispatch');let raw:unknown;
    try{raw=await this.client.callTool({name,arguments:parameters,...(context?{_meta:{'bangumi/readContext':context}}:{})},undefined,{timeout:this.options.timeoutMs,...(signal?{signal}:{})});}
    catch(error){interrupted(signal);throw error instanceof AppError?error:new AppError('MCP_PROTOCOL_ERROR','本地MCP读取未完成；没有自动重连或重发。');}
    const response=raw as {structuredContent?:Record<string,unknown>;isError?:boolean},structured=response.structuredContent;
    if(!structured||Buffer.byteLength(JSON.stringify(structured))>2_000_000||!compileSchema(definition.outputSchema!)(structured))throw new AppError('MCP_INVALID_RESULT','本地MCP结果不符合固定输出契约。');
    if(Boolean(response.isError)!==Object.hasOwn(structured,'error'))throw new AppError('MCP_INVALID_RESULT','本地MCP成功标记与内容不一致。');
    if(response.isError){const remote=structured.error as {code:string;message:string};throw new AppError(remote.code,remote.message);}
    checkAccessResponse(name,structured.value);return structured.value;
  }
  async readCachedResource(ref:string,signal?:AbortSignal,read?:McpReadContext,selection?:CachedResourceSelection):Promise<CachedResource>{
    if(!new RegExp(RESOURCE_REF_PATTERN).test(ref))throw new AppError('INVALID_INPUT','缓存引用格式无效。');
    const context=read===undefined?undefined:readContext(read),selected=selection===undefined?undefined:cachedResourceSelection(selection);
    await cancelable(this.ready(),signal);interrupted(signal);this.usable();this.trace('dispatch');
    const result=await this.client.request({method:'bangumi/readCachedResource',params:{resourceRef:ref,...(context?{readContext:context}:{}),...(selected?{selection:selected}:{})}},z.unknown(),{timeout:this.options.timeoutMs,...(signal?{signal}:{})});
    checkCachedResourceRpcResult(result);if('error'in result)throw new AppError(result.error.code,result.error.message);
    if(result.resource.resourceRef!==ref||!TOOL_DEFINITIONS.some(tool=>tool.name===result.resource.sourceTool))throw new AppError('MCP_INVALID_RESULT','缓存来源或引用不一致。');
    checkAccessResponse(result.resource.sourceTool,result.resource.value);return result.resource;
  }
  async endReadContext(turnId:string):Promise<void>{
    readContext({turnId});if(!this.initialization||this.closed||this.broken)return;
    try{await this.initialization;if(!this.closed&&!this.broken)await this.client.notification({method:'bangumi/readContextEnded',params:{turnId}});}catch{/* 清理不重新连接。 */}
  }
  async close():Promise<void>{if(this.closed)return;this.closed=true;await this.client.close();}
}
