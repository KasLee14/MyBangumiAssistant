import * as z from 'zod/v4';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { RequestSchema, CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { fileURLToPath } from 'node:url';
import { resolve,isAbsolute } from 'node:path';
import { AppError,safeError } from '../support/errors.js';
import { compileSchema } from '../support/tool-schema.js';
import { TOOL_DEFINITIONS,validateToolArguments } from './catalog.js';
import { BangumiMcpService } from './service.js';
import { checkAccessResponse } from './access-context.js';
import { readContext } from './read-context.js';
import { RESOURCE_REF_PATTERN,cachedResourceSelection,checkCachedResourceRpcResult } from './resource-contract.js';

/** stdout仅有JSON-RPC。唯一宿主RPC只读缓存；没有账户、写入或联网适配器。 */
export function createBangumiMcpServer(service:BangumiMcpService):Server{
  const server=new Server({name:'MyBangumiAssistant-Archive',version:'0.2.0'},{capabilities:{tools:{}}});
  server.fallbackNotificationHandler=async notification=>{if(notification.method==='bangumi/readContextEnded')try{service.endReadContext(readContext(notification.params).turnId);}catch{/* 迟到清理不改变结果。 */}};
  server.setRequestHandler(RequestSchema.extend({method:z.literal('bangumi/readCachedResource'),params:z.looseObject({resourceRef:z.unknown(),readContext:z.unknown().optional(),selection:z.unknown().optional()})}),async(request,extra)=>{
    try{
      const p=request.params;
      if(Object.keys(p).some(key=>!['resourceRef','readContext','selection'].includes(key))||typeof p.resourceRef!=='string'||!new RegExp(RESOURCE_REF_PATTERN).test(p.resourceRef))throw new AppError('INVALID_INPUT','缓存RPC引用或参数无效。');
      const result={resource:await service.readCachedResource(p.resourceRef,p.readContext===undefined?undefined:readContext(p.readContext),extra.signal,p.selection===undefined?undefined:cachedResourceSelection(p.selection))};
      checkCachedResourceRpcResult(result);checkAccessResponse(result.resource.sourceTool,result.resource.value);
      if(Buffer.byteLength(JSON.stringify(result))>1_900_000)throw new AppError('MCP_OUTPUT_LIMIT','缓存展示过大，请缩小成员范围。');
      return result;
    }catch(error){return {error:safeError(error)};}
  });
  server.setRequestHandler(ListToolsRequestSchema,async request=>{
    if(request.params?.cursor!==undefined)throw new AppError('INVALID_INPUT','六工具目录不使用分页游标。');
    return {tools:TOOL_DEFINITIONS.map(tool=>({name:tool.name,description:tool.description,inputSchema:structuredClone(tool.inputSchema),outputSchema:structuredClone(tool.outputSchema!),annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}}))};
  });
  server.setRequestHandler(CallToolRequestSchema,async(request,extra)=>{
    const definition=TOOL_DEFINITIONS.find(tool=>tool.name===request.params.name);
    try{
      const args=validateToolArguments(request.params.name,request.params.arguments??{}),meta=request.params._meta;
      if(meta?.['bangumi/guard']!==undefined||meta?.['bangumi/batch']!==undefined)throw new AppError('INVALID_INPUT','本地只读查询不接受账户授权元数据。');
      const reading=meta?.['bangumi/readContext'];
      const value=await service.call(request.params.name,args,extra.signal,undefined,undefined,reading===undefined?undefined:readContext(reading));
      const structuredContent={value};
      if(Buffer.byteLength(JSON.stringify(structuredContent))>1_900_000)throw new AppError('MCP_OUTPUT_LIMIT','本次字段结果过大，请分页或通过缓存分段读取。');
      if(!compileSchema(definition!.outputSchema!)(structuredContent))throw new AppError('MCP_INVALID_RESULT','本地工具结果不符合固定契约。');
      checkAccessResponse(request.params.name,value);return {content:[],structuredContent};
    }catch(error){
      let structuredContent={error:safeError(error)};
      if(definition&&!compileSchema(definition.outputSchema!)(structuredContent))structuredContent={error:safeError(new AppError('MCP_INVALID_RESULT','本地错误不符合固定契约。'))};
      return {isError:true,content:[],structuredContent};
    }
  });
  return server;
}
async function main():Promise<void>{
  const knowledgeDir=process.env.BANGUMI_KNOWLEDGE_DIRECTORY;
  if(!knowledgeDir||!isAbsolute(knowledgeDir))throw new AppError('INVALID_INPUT','MCP必须指定本地知识库绝对路径。');
  const service=new BangumiMcpService({knowledgeDir}),server=createBangumiMcpServer(service);let stopping=false;
  const close=async()=>{if(stopping)return;stopping=true;try{await service.close();await server.close();}finally{process.exitCode=0;}};
  server.onclose=()=>{void close();};process.once('SIGTERM',()=>{void close();});process.once('SIGINT',()=>{void close();});
  await server.connect(new StdioServerTransport());process.stdin.once('end',()=>{void close();});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{process.stderr.write('MCP_START_FAILED: 本地Archive MCP服务无法启动。\n');process.exitCode=1;});
