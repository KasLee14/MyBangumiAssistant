import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import type { ExtensionToolContext,ToolDefinition } from '@earendil-works/pi-coding-agent';
import { AppError,safeError } from '../support/errors.js';
import { compileSchema,schemaArguments } from '../support/tool-schema.js';
import { TOOL_DEFINITIONS,validateToolArguments } from './catalog.js';
import type { McpCallClient } from './client.js';
import { checkAccessResponse } from './access-context.js';
import { projectModelResult } from './model-projection.js';
import type { CollectionQueryInputState } from './collection-query-input.js';
import { normalizeStrictOptionalNulls,toolConstraintState,type ToolProviderModel } from '../support/provider-tool-arguments.js';

// 保留旧宿主类型入口，不装配旧收藏查询或写入行为。
export interface ReadToolInputContext {collectionQueries:CollectionQueryInputState;owner:()=>string|undefined}
export interface McpToolOptions {model?:()=>ToolProviderModel|undefined}
export type McpWriteHandler=(name:string,args:Record<string,unknown>,signal:AbortSignal|undefined,ctx:ExtensionToolContext,toolCallId:string)=>Promise<AgentToolResult<unknown>>;
export function prepareModelToolArguments(name:string,raw:unknown,model?:ToolProviderModel):Record<string,unknown>{
  const definition=TOOL_DEFINITIONS.find(tool=>tool.name===name);if(!definition)throw new AppError('UNKNOWN_TOOL','未登记的本地只读工具。');
  const schema=definition.modelInputSchema??definition.inputSchema,normalized=normalizeStrictOptionalNulls(schema,raw,toolConstraintState(schema,model).provider==='enabled');
  const args=schemaArguments(schema,normalized);validateToolArguments(name,args);return args;
}
export function createMcpTools(client:McpCallClient,_writeHandler?:McpWriteHandler,_context?:ReadToolInputContext,options:McpToolOptions={}):ToolDefinition[]{
  return TOOL_DEFINITIONS.map(definition=>({
    name:definition.name,label:definition.name,description:definition.description,exposure:'direct' as const,defaultActive:true,
    constrainedSampling:{type:'json_schema' as const,strict:'prefer' as const},executionMode:'sequential' as const,
    parameters:structuredClone(definition.modelInputSchema??definition.inputSchema) as ToolDefinition['parameters'],
    outputSchema:structuredClone(definition.modelOutputSchema!) as ToolDefinition['parameters'],
    prepareArguments:(raw:unknown)=>{try{return prepareModelToolArguments(definition.name,raw,options.model?.());}catch(error){throw new AppError('INVALID_INPUT',JSON.stringify({error:safeError(error)}));}},
    async execute(_id,raw,signal){
      try{
        const args=validateToolArguments(definition.name,raw),value=await client.call(definition.name,args,signal);
        const structuredContent={value};if(!compileSchema(definition.outputSchema!)(structuredContent))throw new AppError('MCP_INVALID_RESULT','本地查询结果与公开契约不一致。');
        checkAccessResponse(definition.name,value);
        const content={value:projectModelResult(value as Record<string,unknown>,definition.name,args)},serialized=JSON.stringify(content);
        if(Buffer.byteLength(serialized)>200_000)throw new AppError('MCP_OUTPUT_LIMIT','本次模型字段结果过大，请减少字段或分页。');
        return {content:[{type:'text',text:serialized}],details:structuredContent,structuredContent:JSON.parse(JSON.stringify(structuredContent))};
      }catch(error){const result={error:safeError(error)};return {content:[{type:'text',text:JSON.stringify(result)}],details:result,structuredContent:JSON.parse(JSON.stringify(result)),isError:true};}
    },
  }));
}
export function createReadTools(client:McpCallClient,context?:ReadToolInputContext,options?:McpToolOptions):ToolDefinition[]{return createMcpTools(client,undefined,context,options);}
