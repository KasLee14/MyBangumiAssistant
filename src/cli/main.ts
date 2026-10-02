#!/usr/bin/env node
import { stdin, stdout } from 'node:process';
import { loadConfig, pathsFor, ensurePaths, type AppConfig } from '../config/config.js';
import { proxySummary } from '../config/proxy.js';
import { BgmReadClient, createBgmRunner } from '../adapters/bgm-cli/client.js';
import { BgmWriteClient } from '../adapters/bgm-cli/write-client.js';
import { BgmOperationExecutor } from '../adapters/bgm-cli/executor.js';
import { fileURLToPath } from 'node:url';
import { ChatCompletionsModel } from '../adapters/llm/chat-completions.js';
import { ReadTools } from '../tools/read-tools.js';
import { DialogueTools } from '../tools/dialogue-tools.js';
import { OperationCoordinator } from '../core/operations.js';
import type { OperationPlan } from '../core/operations.js';
import { OperationJournal } from '../storage/operations.js';
import { DialogueCommands, showCandidates, showPlan } from './dialogue.js';
import { ReadAgent } from '../core/agent.js';
import { ScopedConversation } from '../core/scoped-conversation.js';
import { SessionLog } from '../storage/session.js';
import { AppError, safeError, redact, credentialValues } from '../domain/errors.js';
import { mediaType, pageLimit, pageOffset, positiveId, MEDIA_LABELS, type Subject } from '../domain/bangumi.js';
import type { Message } from '../core/types.js';
import { join } from 'node:path';
import { access } from 'node:fs/promises';
import { OAuthSessionStore } from '../storage/oauth-session.js';
import { login } from '../adapters/bangumi-oauth/login.js';
import { activeSession } from '../adapters/bangumi-oauth/session.js';
import { OAuthTransport } from '../adapters/bangumi-oauth/transport.js';
import { parseOAuthConfig } from '../config/oauth.js';
import { APP_NAME, APP_VERSION } from './version.js';
import { CollectionReader } from '../core/collection-reader.js';
import { collectionQuery, collectionStatus } from '../domain/collection-library.js';
import { showCollectionPage, showCollectionSummary } from './collections.js';

const HELP = `${APP_NAME} ${APP_VERSION} —— 查询、收藏与原生进度

用法：npm start -- <命令> [参数]
  ask "问题" [--resume 会话ID] [--model 名称] [--json]
  chat [--resume 会话ID] [--model 名称] [--plain]  终端对话，/exit 退出
  search "关键词" [--type anime] [--limit 5] [--json]
  subject <条目ID> [--json]            条目详情
  collection <条目ID> [--json]         当前账户收藏（需 Bangumi 认证）
  collections [--type anime] [--status completed] [--limit 20] [--offset 0] [--json]
  collection-summary [--type anime] [--json]  五类收藏数量、状态与个人评分统计（只读）
  episodes <条目ID> [--limit 20] [--offset 0] [--json]
  episodes <条目ID> --all [--json]     完整章节（最多2000项）
  progress <条目ID> [--json]           原生进度能力与个人记录
  preview <条目ID> '<字段JSON>' [--json] 收藏变更预览，不写入
  login [--force]                     默认浏览器 OAuth 授权（可复用已有登录）
  login-status                       仅查看本机登录元数据，不验证网站
  logout                             清除本机 OAuth 凭据，不注销网站其他会话
  auth-check                         在线只读验证 Bangumi 认证
  sessions                           列出已保存会话 ID
  config                             查看有效配置，不包含密钥
  doctor                             仅检查本地环境，不发起网络请求
  --help / --version

媒体类型：anime 动画、book 书籍、music 音乐、game 游戏、real 三次元
收藏状态：wish 想看等、completed 已完成、in_progress 进行中、on_hold 搁置、dropped 抛弃
chat 内 /help 查看候选选择和预览确认命令。
首次使用请阅读 README。明确单项直接执行；复杂项 chat 内确认。chat 中 Esc / Ctrl+C 停止本轮，空闲时两次 Ctrl+C 退出；未知结果先核对网站。`;

function parse(argv: string[]): { command: string; positional: string[]; flags: Record<string, string | boolean> } {
  const command = argv[0] ?? '--help'; const positional: string[] = []; const flags: Record<string, string | boolean> = {};
  const allowed: Record<string, string[]> = {
    collections: ['type','status','limit','offset','json'], 'collection-summary': ['type','json'],
    ask: ['model', 'resume', 'json'], chat: ['model', 'resume', 'plain'], search: ['type','limit','json'],
    subject: ['json'], collection: ['json'], episodes: ['limit','offset','all','json'], progress: ['json'], preview: ['json'], 'preview-delete':['json'], 'auth-check': [],
    login:['force'], 'login-status':[], logout:[],
    sessions: [], config: [], doctor: [], '--help': [], '--version': [],
  };
  if (!Object.hasOwn(allowed, command)) throw new AppError('INVALID_INPUT', '未知命令，使用 --help 查看。');
  for (let i=1; i<argv.length; i++) {
    const value = argv[i]!;
    if (!value.startsWith('--')) { positional.push(value); continue; }
    const name = value.slice(2);
    if (!allowed[command]!.includes(name) || name in flags) throw new AppError('INVALID_INPUT', '命令包含未知或重复选项。');
    if (name === 'json' || name === 'all' || name === 'force' || name === 'plain') flags[name] = true;
    else {
      const next = argv[++i];
      if (!next || next.startsWith('--')) throw new AppError('INVALID_INPUT', `--${name} 缺少参数。`);
      flags[name] = next;
    }
  }
  return { command, positional, flags };
}

function selectedModel(config: AppConfig, name?: string): string {
  const selected = name ?? config.activeModel;
  if (!Object.hasOwn(config.models, selected)) throw new AppError('INVALID_INPUT', '指定的模型配置不存在。');
  return selected;
}
function showSubject(item: Subject): string {
  return `#${item.id} ${item.nameCn || item.name} (${MEDIA_LABELS[item.type]})\n原名：${item.name}\n评分：${item.score ?? '未知'}　排名：${item.rank ?? '未知'}\n${item.url}`;
}
function dump(value: unknown): void { console.log(redact(JSON.stringify(value, null, 2), credentialValues())); }

export async function main(argv: string[]): Promise<void> {
  const { command, positional, flags } = parse(argv);
  if (command === 'preview-delete') throw new AppError('UNSUPPORTED_OPERATION', '条目取消收藏暂未开放，请在 Bangumi 网站操作。');
  if (command === '--help') { console.log(HELP); return; }
  if (command === '--version') { console.log('0.1.0'); return; }
  const expected = command === 'preview' ? 2 : ['ask','search','subject','collection','episodes','progress','preview-delete'].includes(command) ? 1 : 0;
  if (positional.length !== expected) throw new AppError('INVALID_INPUT', `此命令需要 ${expected} 个位置参数，多字问题请用引号包裹。`);
  const paths = pathsFor(); const config = await loadConfig(paths);
  const proxy = config.proxyPolicy ?? config.proxy;
  const store=new OAuthSessionStore(join(paths.root,'auth'));
  if (command === 'config') { dump({ configPath: paths.config, ...config }); return; }
  if (command === 'doctor') {
    dump({ node: process.version, userDirectory: paths.root, bgmConfigDirectory: paths.bgm,
      authentication:'oauth',savedOAuthSession:await access(store.file).then(()=>true,()=>false), collectionDeletionAvailable:false,
      oauth: { ...parseOAuthConfig(config.oauth), clientIdPresent: Boolean(process.env[parseOAuthConfig(config.oauth).clientIdEnv]), clientSecretPresent: Boolean(process.env[parseOAuthConfig(config.oauth).clientSecretEnv]) },
      models: Object.entries(config.models).map(([name, value]) => ({ name, model: value.model, baseUrl: value.baseUrl,
        apiKeyEnv: value.apiKeyEnv, credentialPresent: Boolean(process.env[value.apiKeyEnv]) })),
      proxy: config.proxy, proxyPolicy: config.proxyPolicy, proxyDescription: proxySummary(proxy), networkChecked: false, bangumiAuthenticationChecked: false, mode: 'authorized-writes' }); return;
  }
  if (command === 'sessions') { dump(await SessionLog.list(paths.sessions)); return; }
  const controller = new AbortController(); const cancel = (): void => controller.abort();
  process.on('SIGINT', cancel);
  let model: ChatCompletionsModel | undefined;
  try {
    await ensurePaths(paths);
    if(command === 'logout') { await store.clear(); dump({localAuthenticationCleared:true,serverSessionRevoked:false}); return; }
    if(command === 'login-status') {
      try { const saved=await store.load(); dump(saved ? {saved:true,source:'oauth',accountId:saved.accountId,username:saved.username,savedAt:saved.savedAt,expiresAt:saved.expiresAt,expired:saved.expiresAt <= Date.now(),refreshAvailable:Boolean(saved.refreshToken),networkChecked:false} : {saved:false,source:'oauth',networkChecked:false}); }
      catch(error) { dump({saved:false,error:safeError(error).code,networkChecked:false}); }
      return;
    }
    if(command === 'login') {
      if(!stdin.isTTY) throw new AppError('INVALID_INPUT','login 需要交互终端和用户在默认浏览器完成 OAuth 授权。');
      if(!flags.force) {
        const saved=await activeSession(store,proxy,config.requestTimeoutMs,controller.signal).catch(error => { if (controller.signal.aborted) throw error; return null; });
        if(saved) {
          const api = new OAuthTransport(saved,proxy,config.requestTimeoutMs);
          try { const user = await api.json('/p1/me',{auth:true},controller.signal) as {id?:number};
            if (user.id !== saved.accountId) throw new AppError('ACCOUNT_CHANGED','OAuth 账户改变，请重新授权。');
            dump({saved:true,accountId:saved.accountId,username:saved.username,networkChecked:true,message:'OAuth 登录有效；重新授权或切换账户请用 login --force。'}); return;
          } finally { await api.close(); }
        }
      }
      dump({authenticated:true,user:await login(store,{config:parseOAuthConfig(config.oauth),proxy,requestTimeoutMs:config.requestTimeoutMs,signal:controller.signal,notice:message=>process.stderr.write(`${message}\n`)}),source:'oauth'}); return;
    }
    // 只为日志/模型裁剪注册本地 Token；不读取旧网页登录 Cookie。
    if (command !== 'chat') await store.load().catch(error => { if (!['search', 'subject', 'episodes'].includes(command)) throw error; });
    const runnerOptions = { configDir: paths.bgm, authDir:join(paths.root,'auth'),timeoutMs: config.requestTimeoutMs, proxy, signal: controller.signal };
    const readClient = new BgmReadClient(createBgmRunner(runnerOptions));
    const client = new BgmWriteClient(readClient, createBgmRunner({ ...runnerOptions, entry: fileURLToPath(new URL('../adapters/bgm-cli/worker.js', import.meta.url)) }));
    if (command === 'chat') {
      if (!stdin.isTTY) throw new AppError('INVALID_INPUT', 'chat 需要交互终端；脚本请使用 ask。');
      const { ChatController } = await import('./chat-controller.js');
      const chat = new ChatController({ config, paths, client, signal: controller.signal,
        createModel: name => new ChatCompletionsModel(config.models[name]!, config.requestTimeoutMs, proxy),
        loadLogin: async () => { const saved = await store.load(); return saved ? { accountId: saved.accountId, username: saved.username } : null; },
        login: async (signal, notice) => {
          const user = await login(store, { config:parseOAuthConfig(config.oauth), proxy, requestTimeoutMs:config.requestTimeoutMs, signal, notice });
          return { id: user.id, username: user.username };
        },
      }, selectedModel(config, typeof flags.model === 'string' ? flags.model : undefined), typeof flags.resume === 'string' ? flags.resume : undefined);
      if (flags.plain || !stdout.isTTY || process.env.TERM === 'dumb') {
        const { runPlainChat } = await import('./ui/plain-renderer.js'); await runPlainChat(chat,controller.signal);
      } else {
        const { runChatUi } = await import('./ui/app.js'); await runChatUi(chat);
      }
      return;
    }
    if (command === 'collections') {
      const query = collectionQuery({ limit: flags.limit === undefined ? 20 : Number(flags.limit), offset: flags.offset === undefined ? 0 : Number(flags.offset),
        ...(flags.type === undefined ? {} : { type: mediaType(flags.type) }), ...(flags.status === undefined ? {} : { status: collectionStatus(flags.status) }) }, 20);
      const page = await client.collections(query, controller.signal);
      if (flags.json) dump(page); else console.log(showCollectionPage(page));
    } else if (command === 'collection-summary') {
      const summary = await new CollectionReader(client).summary(flags.type === undefined ? undefined : mediaType(flags.type), controller.signal);
      if (flags.json) dump(summary); else console.log(showCollectionSummary(summary));
    } else if (command === 'search') {
      const result = await client.search(positional[0]!, typeof flags.type === 'string' ? mediaType(flags.type) : undefined,
        flags.limit === undefined ? 5 : pageLimit(flags.limit));
      if (flags.json) dump(result); else console.log(result.data.length ? result.data.map(showSubject).join('\n\n') : '没有找到作品。');
    } else if (command === 'subject') {
      const item = await client.subject(positiveId(positional[0]));
      if (flags.json) dump(item); else console.log(`${showSubject(item)}\n\n${item.summary}`);
    } else if (command === 'collection') dump(await client.collection(positiveId(positional[0])));
    else if (command === 'episodes') {
      if (flags.all && (flags.limit !== undefined || flags.offset !== undefined)) throw new AppError('INVALID_INPUT', '--all 不能与 --limit 或 --offset 同用。');
      dump(flags.all ? await client.allEpisodes(positiveId(positional[0]))
        : await client.episodes(positiveId(positional[0]), flags.limit === undefined ? 20 : pageLimit(flags.limit), pageOffset(flags.offset ?? 0)));
    }
    else if (command === 'auth-check') dump({ authenticated: true, user: await client.currentUser(), source: 'bangumi' });
    else if (command === 'progress') dump(await new ReadTools(client).execute('get_progress', { subjectId: positiveId(positional[0]) }));
    else if (command === 'preview') {
      let patch: unknown;
      try { patch = JSON.parse(redact(positional[1]!, credentialValues())); }
      catch { throw new AppError('INVALID_INPUT', '修改字段不是有效 JSON。'); }
      const log = new SessionLog(paths.sessions);
      const tools = new DialogueTools(client, new OperationCoordinator(new OperationJournal(paths.sessions, log.id)));
      const plan = await tools.execute('preview_collection_changes', { operations: [{ subjectId: positiveId(positional[0]), patch }] }, { signal: controller.signal });
      if (flags.json) dump(plan); else console.log(redact(showPlan(plan as OperationPlan), credentialValues()));
    }
    else {
      const name = selectedModel(config, typeof flags.model === 'string' ? flags.model : undefined);
      model = new ChatCompletionsModel(config.models[name]!, config.requestTimeoutMs, proxy);
      const log = new SessionLog(paths.sessions, typeof flags.resume === 'string' ? flags.resume : undefined);
      const journal = new OperationJournal(paths.sessions, log.id);
      const recorded = flags.resume ? await journal.states() : new Map();
      const operationRecovery = { success: [...recorded.values()].filter(state => state === 'success').length,
        failed: [...recorded.values()].filter(state => state === 'failed').length,
        unknown: [...recorded.values()].filter(state => state === 'started' || state === 'unknown').length };
      if (flags.resume && !flags.json) process.stderr.write(`恢复仅采用已完成对话，旧授权已失效；操作记录：成功${operationRecovery.success}，失败${operationRecovery.failed}，未知${operationRecovery.unknown}。未知项先核对网站状态，不自动重试。\n`);
      let commands: DialogueCommands;
      const previewOutputs: OperationPlan[] = [];
      const tools = new DialogueTools(client, new OperationCoordinator(journal, new BgmOperationExecutor(client)), {
        ...(flags.json ? {} : { candidates: set => process.stderr.write(redact(showCandidates(set), credentialValues())) }),
        plan: plan => {
          const index = previewOutputs.findIndex(value => value.id === plan.id);
          if (index < 0) previewOutputs.push(plan); else previewOutputs[index] = plan;
          if (plan.state === 'pending') commands.presented(plan);
          if (!flags.json) process.stderr.write(redact(showPlan(plan), credentialValues()));
        },
      });
      commands = new DialogueCommands(tools, log);
      const agent = new ReadAgent(model, tools, log, config.maxSteps);
      const conversation = new ScopedConversation(model, agent, tools, commands, log);
      let history: Message[] = flags.resume ? await log.messages() : [];
      const run = async (input: string): Promise<void> => {
        previewOutputs.length = 0;
        let printed = false;
        const result = await conversation.run(input, history, { signal: controller.signal,
          ...(flags.json ? {} : { onText: (text: string) => { printed = true; stdout.write(text); },
            onTool: (tool: string) => { process.stderr.write(`\n[工具] ${tool}\n`); } }),
        });
        history = result.messages;
        if (flags.json) {
          const answer = history.at(-1);
          dump({ sessionId: log.id, answer: { role: 'assistant', content: answer?.role === 'assistant' ? answer.content : null },
            boundary: { code: result.boundary.code }, candidates: tools.candidates.snapshot(), plans: previewOutputs.map(plan => tools.operations.get(plan.id)), ...(flags.resume ? { operationRecovery } : {}) });
        }
        else { if (printed) stdout.write('\n'); process.stderr.write(`会话：${log.id}\n`); }
      };
      await run(positional[0]!);
    }
  } finally { process.off('SIGINT', cancel); await model?.close(); }
}

main(process.argv.slice(2)).catch(error => {
  const info = safeError(error); console.error(`[${info.code}] ${info.message}`);
  process.exitCode = info.code === 'CANCELLED' ? 130 : 1;
});
