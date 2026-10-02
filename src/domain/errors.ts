export class AppError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AppError';
  }
}
export interface InputIssue { path: string; rule: string; hint: string; allowed?: readonly unknown[] }
/** 仅本地固定契约生成的反馈；不包含原始参数值或服务端正文。 */
export class SchemaInputError extends AppError {
  readonly networkAttempted = false;
  constructor(readonly issues: readonly InputIssue[]) {
    super('INVALID_INPUT', issues.map(issue => `${issue.path || '/'}：${issue.hint}`).join('；'));
  }
}
export interface SafeError { code: string; message: string; issues?: readonly InputIssue[]; networkAttempted?: false }
const localSecrets = new Set<string>();
/** 本地凭据也参与模型、日志和终端的统一裁剪，原值不进入配置或会话。 */
export function registerCredentials(values: readonly string[]): void { for (const value of values) if (value) localSecrets.add(value); }

export function redact(text: string, secrets: readonly string[] = []): string {
  let result = text;
  for (const secret of secrets) {
    if (secret) {
      result = result.split(secret).join('[REDACTED]');
      result = result.split(JSON.stringify(secret).slice(1, -1)).join('[REDACTED]');
    }
  }
  return result
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/\b(sk-[a-zA-Z0-9_-]{8,})\b/g, '[REDACTED]')
    .replace(/((?:chiiNextSessionID|chii_auth|chii_sid|chii_sec_id|cf_clearance)=)[^\s;"']+/gi, '$1[REDACTED]')
    .replace(/([?&]gh=)[^\s&"']+/gi, '$1[REDACTED]');
}

/** 保留可能跨流式片段的凭据尾部，避免逐片段脱敏漏掉完整值。 */
export class StreamingRedactor {
  private pending = '';
  private readonly reserve: number;
  constructor(private readonly secrets: readonly string[]) {
    this.reserve = Math.max(1, ...secrets.map(secret => secret.length)) - 1;
  }
  push(chunk: string): string {
    this.pending += chunk;
    let cut = Math.max(0, this.pending.length - this.reserve);
    for (const secret of this.secrets) {
      if (!secret) continue;
      let index = this.pending.indexOf(secret);
      while (index >= 0 && index < cut) {
        if (index + secret.length > cut) { cut = index; break; }
        index = this.pending.indexOf(secret, index + secret.length);
      }
    }
    const output = redact(this.pending.slice(0,cut), this.secrets);
    this.pending = this.pending.slice(cut);
    return output;
  }
  finish(): string { const output = redact(this.pending, this.secrets); this.pending = ''; return output; }
}

export function credentialValues(env: NodeJS.ProcessEnv = process.env): string[] {
  return [...localSecrets, ...Object.entries(env)
    .filter(([name, value]) => value && /(TOKEN|API_KEY|PASSWORD|SECRET|COOKIE|SESSION_ID)/i.test(name))
    .map(([, value]) => value!)];
}

export function safeError(error: unknown): SafeError {
  if (error instanceof SchemaInputError) return { code: error.code, message: redact(error.message, credentialValues()), issues: error.issues, networkAttempted: false };
  if (error instanceof AppError) return { code: error.code, message: redact(error.message, credentialValues()) };
  if (error instanceof Error && error.name === 'AbortError') return { code: 'CANCELLED', message: '操作已取消。' };
  return { code: 'INTERNAL_ERROR', message: '操作失败；请检查配置、网络或输入。' };
}
