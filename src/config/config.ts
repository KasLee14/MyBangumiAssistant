import { readFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { AppError } from '../domain/errors.js';
import { object } from '../domain/bangumi.js';
import { environmentProxy, policyFor, readWindowsProxy, windowsProxy, type ProxyPolicy, type WindowsProxy } from './proxy.js';

export interface ModelConfig {
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  thinking: 'enabled' | 'disabled';
}
export interface AppConfig {
  activeModel: string;
  models: Record<string, ModelConfig>;
  proxy: string | null;
  proxyPolicy?: ProxyPolicy;
  requestTimeoutMs: number;
  maxSteps: number;
}
export interface AppPaths { root: string; config: string; bgm: string; sessions: string }

export function pathsFor(env: NodeJS.ProcessEnv = process.env): AppPaths {
  const root = resolve(env.BANGUMI_AGENT_HOME || (process.platform === 'win32'
    ? join(env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'BangumiAgent')
    : join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'bangumi-agent')));
  return { root, config: join(root, 'config.json'), bgm: join(root, 'bgm-cli'), sessions: join(root, 'sessions') };
}

function url(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new AppError('INVALID_CONFIG', `${field} 必须为 URL。`);
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new AppError('INVALID_CONFIG', `${field} 不是有效 URL。`); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new AppError('INVALID_CONFIG', `${field} 只允许无凭据、无查询参数的 HTTP/HTTPS 地址。`);
  }
  return value.replace(/\/$/, '');
}
function bounded(value: unknown, fallback: number, min: number, max: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new AppError('INVALID_CONFIG', `${field} 超出允许范围。`);
  return value;
}

export function parseConfig(value: unknown, env: NodeJS.ProcessEnv = process.env): AppConfig {
  const item = object(value, '配置');
  const rawModels = object(item.models ?? { deepseek: {
    baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash',
    apiKeyEnv: env.DEEPSEEK_API_KEY ? 'DEEPSEEK_API_KEY' : 'ANTHROPIC_AUTH_TOKEN', thinking: 'disabled',
  } }, '模型配置');
  const models: Record<string, ModelConfig> = Object.create(null) as Record<string, ModelConfig>;
  for (const [name, value] of Object.entries(rawModels)) {
    const model = object(value, '模型配置');
    if (typeof model.model !== 'string' || !model.model.trim() || model.model.length > 200) throw new AppError('INVALID_CONFIG', '模型名无效。');
    if (typeof model.apiKeyEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(model.apiKeyEnv)) throw new AppError('INVALID_CONFIG', 'apiKeyEnv 必须为环境变量名。');
    const thinking = model.thinking ?? 'disabled';
    if (thinking !== 'enabled' && thinking !== 'disabled') throw new AppError('INVALID_CONFIG', 'thinking 必须为 enabled 或 disabled。');
    const baseUrl = url(model.baseUrl, '模型 baseUrl');
    if (/\/anthropic(?:\/|$)/.test(new URL(baseUrl).pathname)) throw new AppError('INVALID_CONFIG', '当前只实现 Chat Completions 协议，不能使用 /anthropic 地址。');
    if (model.model.endsWith('[1m]')) throw new AppError('INVALID_CONFIG', '请使用提供方的真实模型名，不包含 Claude Code 的 [1m] 后缀。');
    models[name] = { baseUrl, model: model.model, apiKeyEnv: model.apiKeyEnv, thinking };
  }
  const activeModel = item.activeModel ?? 'deepseek';
  if (typeof activeModel !== 'string' || !models[activeModel]) throw new AppError('INVALID_CONFIG', 'activeModel 没有对应的模型配置。');
  if (item.proxy !== undefined && item.proxy !== null && typeof item.proxy !== 'string') throw new AppError('INVALID_CONFIG', 'proxy 必须为 HTTP/HTTPS 地址或 null。');
  const proxyPolicy = item.proxy !== undefined ? policyFor(item.proxy as string | null, 'config')
    : env.BANGUMI_AGENT_PROXY !== undefined ? policyFor(env.BANGUMI_AGENT_PROXY, 'app-env')
      : environmentProxy(env) ?? policyFor(null, 'direct');
  return {
    activeModel, models, proxy: proxyPolicy.https, proxyPolicy,
    requestTimeoutMs: bounded(item.requestTimeoutMs, 60000, 1000, 300000, 'requestTimeoutMs'),
    maxSteps: bounded(item.maxSteps, 8, 1, 20, 'maxSteps'),
  };
}

export async function loadConfig(paths: AppPaths, env: NodeJS.ProcessEnv = process.env,
  discovery: { platform: NodeJS.Platform; read: () => Promise<WindowsProxy> } = { platform: process.platform, read: readWindowsProxy }): Promise<AppConfig> {
  let value: unknown;
  try { value = JSON.parse(await readFile(paths.config, 'utf8')); }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') value = {};
    else throw new AppError('INVALID_CONFIG', '读取配置失败，请检查用户目录下 config.json 的 JSON 格式。');
  }
  const config = parseConfig(value, env);
  if (config.proxyPolicy?.source === 'direct' && discovery.platform === 'win32') {
    config.proxyPolicy = windowsProxy(await discovery.read()) ?? config.proxyPolicy;
    config.proxy = config.proxyPolicy.https;
  }
  return config;
}

export async function ensurePaths(paths: AppPaths): Promise<void> {
  await mkdir(paths.bgm, { recursive: true });
  await mkdir(paths.sessions, { recursive: true });
}
