import type {
  ApiErrorView, CatalogView, ClearCredentialPayload, ConfirmPayload, CredentialPayload,
  LoginInputPayload, ModelPayload, ProxyPayload, ServerEvent, SessionPayload, SubmitPayload,
  ThinkingPayload,
} from '../../../bangumi/src/web/protocol';

/**
 * 宿主命令接口。
 *
 * 所有授权判定仍在宿主：浏览器只负责发起请求与呈现结果；非 2xx 时后端返回
 * ApiErrorView，这里只把 message 抛给调用方展示。
 */
/** 每次页面加载生成独立身份，复制标签页也不会共享查看对象。 */
const clientId = crypto.randomUUID();
let selectedSessionId = '';

export function rememberSession(id: string): void { selectedSessionId = id; }

function headers(): Record<string, string> {
  return { 'x-bgm-client': clientId, 'x-bgm-session': selectedSessionId };
}

async function post<T, R = void>(path: string, body: T): Promise<R> {
  const response = await fetch(`./api${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers() },
    body: JSON.stringify(body),
  });
  if (response.ok) return await response.json() as R;
  const info = await response.json().catch(() => null) as ApiErrorView | null;
  throw new Error(info?.message ?? `请求失败（HTTP ${response.status}）。`);
}

export function submitInput(input: string): Promise<void> {
  const payload: SubmitPayload = { input };
  return post('/submit', payload);
}

export function cancelRound(): Promise<void> {
  return post('/cancel', {});
}

/** accepted 为 false 即拒绝，宿主按默认取消处理。 */
export function answerConfirmation(id: string, accepted: boolean): Promise<void> {
  const payload: ConfirmPayload = { id, accepted };
  return post('/confirm', payload);
}

/** 取消时只发 id 与 cancelled，邮箱与密码不会出现在其它请求里。 */
export function submitLoginInput(payload: LoginInputPayload): Promise<void> {
  return post('/login-input', payload);
}

/**
 * 设置弹窗里的显式登录：邮箱与密码一次提交，宿主直接执行登录流程。
 *
 * 这个请求会一直挂到登录结束（人机验证在系统默认浏览器里完成），期间的进度由
 * 状态帧的 `loginStatus` 下发。
 */
export function startLogin(email: string, password: string): Promise<void> {
  return post('/login', { email, password });
}

/** 中止进行中的显式登录；弹窗关闭时调用，避免留下挂起的请求。 */
export function cancelLogin(): Promise<void> {
  return post('/login-cancel', {});
}

/** 清除本应用保存的 Bangumi 会话；不影响网站上的登录状态。 */
export function logout(): Promise<void> {
  return post('/logout', {});
}

/** 切换当前模型；宿主同时把它写成本机 Pi 的默认模型，重启后沿用。 */
export function selectModel(provider: string, model: string): Promise<void> {
  const payload: ModelPayload = { provider, model };
  return post('/model', payload);
}

/**
 * 切换思考强度：级别必须来自宿主下发的可用列表。
 *
 * 与模型切换不同，宿主会把这次选择写成本机 Pi 的默认思考强度（隔离目录的
 * `settings.json`），因此重启后仍然生效；当前那一轮的请求参数不受影响。
 */
export function selectThinkingLevel(level: ThinkingPayload['level']): Promise<void> {
  const payload: ThinkingPayload = { level };
  return post('/thinking', payload);
}

export function selectSession(session?: { id: string; path: string }): Promise<Extract<ServerEvent, { type: 'state' }>> {
  const payload: SessionPayload = session === undefined ? { action: 'new' }
    : { action: 'resume', sessionId: session.id, ...(session.path ? { path: session.path } : {}) };
  return post<SessionPayload, Extract<ServerEvent, { type: 'state' }>>('/session', payload);
}

/**
 * 注入模型密钥：`persist` 为 true 时保存到本机 Pi 凭据存储（重启后仍然生效），
 * 否则只在本进程内生效。
 *
 * 密钥只出现在这一次请求里，不写 localStorage，也不回显。
 */
export function submitCredential(provider: string, key: string, persist: boolean): Promise<void> {
  const payload: CredentialPayload = { provider, key, persist };
  return post('/credentials', payload);
}

/** 清除本机保存的密钥；环境变量与 `models.json` 内联密钥不受影响。 */
export function clearCredential(provider: string): Promise<void> {
  const payload: ClearCredentialPayload = { provider };
  return post('/credentials/clear', payload);
}

/**
 * 切换本机网络线路：只在本次运行内生效，宿主不写入磁盘。
 *
 * `auto` 重新自动发现，`direct` 强制直连，`manual` 用给定地址。
 */
export function submitProxy(mode: ProxyPayload['mode'], url?: string): Promise<void> {
  const payload: ProxyPayload = url === undefined ? { mode } : { mode, url };
  return post('/proxy', payload);
}

export async function fetchCatalog(): Promise<CatalogView> {
  const response = await fetch('./api/catalog', { headers: { accept: 'application/json', ...headers() } });
  if (!response.ok) throw new Error(`无法读取模型、会话或命令列表（HTTP ${response.status}）。`);
  return await response.json() as CatalogView;
}

export interface StreamHandlers {
  onFrame(frame: ServerEvent): void;
  onStatus(connected: boolean): void;
}

/** 会话状态事件流；帧走默认事件名，EventSource 自带重连，宿主重启后会自动接回。 */
export function openStream(handlers: StreamHandlers): () => void {
  const source = new EventSource(`./api/events?clientId=${encodeURIComponent(clientId)}`);
  source.onopen = () => handlers.onStatus(true);
  source.onerror = () => handlers.onStatus(false);
  source.onmessage = event => {
    try { handlers.onFrame(JSON.parse(event.data as string) as ServerEvent); }
    catch { /* 单帧解析失败不影响后续帧。 */ }
  };
  return () => source.close();
}
