import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { AppError } from './errors.js';

export type ProxySource = 'config' | 'app-env' | 'environment' | 'windows' | 'direct';
export interface ProxyPolicy { source: ProxySource; http: string | null; https: string | null; bypass: string[] }
export type ProxyOptions = string | null | ProxyPolicy;
export interface WindowsProxy { enabled: boolean; server: string; bypass: string; pac: boolean; autoDetect: boolean }
const invalid = (): never => { throw new AppError('INVALID_PROXY', '代理配置无效；仅支持不含凭据的 HTTP/HTTPS 代理地址，请检查配置来源。'); };
export function proxyAddress(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || /[\r\n\0]/.test(value)) return invalid();
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') return invalid();
    return url.href.replace(/\/$/, '');
  } catch { return invalid(); }
}
function bypassList(value: string, windows = false): string[] {
  if (value.length > 10000 || /[\r\n\0]/.test(value)) return invalid();
  const entries = value.toLowerCase().split(/[,;\s]+/).filter(Boolean);
  if (entries.some(entry => !(windows ? /^(?:<local>|[a-z0-9*_[\].:-]+)$/ : /^(?:\*|<local>|(?:\*\.)?\.?[a-z0-9_[\].:-]+)$/).test(entry))) return invalid();
  return entries;
}
export function policyFor(value: ProxyOptions, source: ProxySource = 'config'): ProxyPolicy {
  if (typeof value === 'object' && value !== null) return value;
  const address = value === null || value === '' ? null : proxyAddress(value);
  return { source, http: address, https: address, bypass: [] };
}
export function environmentProxy(env: NodeJS.ProcessEnv): ProxyPolicy | null {
  const http = env.http_proxy ?? env.HTTP_PROXY;
  const https = env.https_proxy ?? env.HTTPS_PROXY;
  if (!http?.trim() && !https?.trim()) return null;
  const httpAddress = http?.trim() ? proxyAddress(http) : null;
  return { source: 'environment', http: httpAddress, https: https?.trim() ? proxyAddress(https) : httpAddress,
    bypass: bypassList(env.no_proxy ?? env.NO_PROXY ?? '') };
}
export function windowsProxy(value: WindowsProxy): ProxyPolicy | null {
  if (value.pac || value.autoDetect) throw new AppError('PROXY_AUTO_UNSUPPORTED', '检测到 Windows PAC/WPAD 自动代理，本应用暂不执行代理脚本；请用 proxy 或 BANGUMI_AGENT_PROXY 指定固定 HTTP/HTTPS 代理。');
  if (!value.enabled) return null;
  if (!value.server.trim()) return invalid();
  const address = (text: string): string => proxyAddress(text.includes('://') ? text : `http://${text}`);
  let http: string | null = null; let https: string | null = null;
  if (!value.server.includes('=')) http = https = address(value.server);
  else {
    const entries = new Map<string, string>();
    for (const entry of value.server.split(';').filter(Boolean)) {
      const match = /^([a-z]+)=(.+)$/i.exec(entry.trim()); if (!match || entries.has(match[1]!.toLowerCase())) return invalid();
      entries.set(match[1]!.toLowerCase(), match[2]!);
    }
    if (entries.has('http')) http = address(entries.get('http')!);
    if (entries.has('https')) https = address(entries.get('https')!);
    if (!http && !https) return invalid();
  }
  return { source: 'windows', http, https, bypass: bypassList(value.bypass, true) };
}
/** 有界、只读、隐藏窗口；不运行 PAC，不改注册表或系统代理。 */
export async function readWindowsProxy(): Promise<WindowsProxy> {
  const script = "$ErrorActionPreference='Stop'; $p=Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; $c=Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\\Connections' -ErrorAction SilentlyContinue; $wpad=[bool]($p.AutoDetect -or ($c.DefaultConnectionSettings.Length -gt 8 -and ($c.DefaultConnectionSettings[8] -band 8))); [pscustomobject]@{enabled=[bool]$p.ProxyEnable;server=[string]$p.ProxyServer;bypass=[string]$p.ProxyOverride;pac=[bool]$p.AutoConfigURL;autoDetect=$wpad}|ConvertTo-Json -Compress";
  const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => {
    execFile(executable, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 3000, maxBuffer: 20000, encoding: 'utf8' }, (error, stdout) => {
      if (error) { reject(new AppError('PROXY_DISCOVERY_FAILED', '无法读取 Windows 系统代理；请用 proxy 或 BANGUMI_AGENT_PROXY 明确指定代理或直连。')); return; }
      try { const value = JSON.parse(stdout.replace(/^\uFEFF/, '')); if (typeof value.enabled !== 'boolean' || typeof value.server !== 'string' || typeof value.bypass !== 'string' || typeof value.pac !== 'boolean' || typeof value.autoDetect !== 'boolean') throw new Error(); resolve(value); }
      catch { reject(new AppError('PROXY_DISCOVERY_FAILED', 'Windows 系统代理返回无效配置；请明确设置应用代理。')); }
    });
  });
}
export function proxyForUrl(options: ProxyOptions, target: string): string | null {
  const policy = policyFor(options); const url = new URL(target);
  const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, ''); const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  for (const entry of policy.bypass) {
    if (entry === '*' || (entry === '<local>' && !host.includes('.') && !host.includes(':'))) return null;
    const parts = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(entry);
    if (parts && Number(parts[2]) !== port) continue;
    if (policy.source === 'windows') {
      const pattern = (parts?.[1] ?? entry).replace(/^\[|\]$/g, '').replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      if (new RegExp(`^${pattern}$`, 'i').test(host)) return null;
      continue;
    }
    const name = (parts?.[1] ?? entry).replace(/^\*?\./, '').replace(/\.$/, '').replace(/^\[|\]$/g, '');
    if (host === name || host.endsWith(`.${name}`)) return null;
  }
  return url.protocol === 'https:' ? policy.https : url.protocol === 'http:' ? policy.http : null;
}
/** 子进程只接收宿主解析后的快照，禁止自行再次发现或继承另一套代理。 */
export function decodeProxyPolicy(raw: string): ProxyPolicy {
  try {
    const value = JSON.parse(raw);
    if (!['config', 'app-env', 'environment', 'windows', 'direct'].includes(value.source) || !Array.isArray(value.bypass) || value.bypass.some((entry: unknown) => typeof entry !== 'string')) return invalid();
    return { source: value.source, http: value.http === null ? null : proxyAddress(value.http), https: value.https === null ? null : proxyAddress(value.https), bypass: bypassList(value.bypass.join(','), value.source === 'windows') };
  } catch { return invalid(); }
}
/** 只描述地址部分（不含来源），供界面上「配置项 + 地址」两段式展示；直连时为空串。 */
export function proxyAddresses(options: ProxyOptions): string {
  const p = policyFor(options);
  return p.http === p.https ? p.https ?? "" : `HTTPS ${p.https ?? '直连'}；HTTP ${p.http ?? '直连'}`;
}
export function proxySummary(options: ProxyOptions): string {
  const p = policyFor(options); const labels: Record<ProxySource, string> = { config: '应用配置', 'app-env': '应用环境变量', environment: '标准环境变量', windows: 'Windows 系统代理', direct: '未发现代理' };
  return `${proxyAddresses(p) || '直连'}（来源：${labels[p.source]}${p.bypass.length ? `；绕过规则 ${p.bypass.length} 条` : ''}）`;
}
