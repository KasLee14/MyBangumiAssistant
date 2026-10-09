import {
  environmentProxy, policyFor, proxyAddresses, proxySummary, readWindowsProxy, windowsProxy,
  type ProxyOptions, type ProxyPolicy,
} from './proxy.js';

/** 自动发现：显式参数 > 应用环境变量 > 标准环境变量 > Windows 系统代理 > 直连。 */
export async function discoverProxy(explicit?: ProxyOptions): Promise<ProxyPolicy> {
  if (explicit !== undefined) return policyFor(explicit);
  if (process.env.BANGUMI_AGENT_PROXY !== undefined) return policyFor(process.env.BANGUMI_AGENT_PROXY, 'app-env');
  const environment = environmentProxy(process.env);
  if (environment) return environment;
  if (process.platform === 'win32') {
    const system = windowsProxy(await readWindowsProxy());
    if (system) return system;
  }
  return policyFor(null, 'direct');
}

export type ProxyListener = (policy: ProxyPolicy) => Promise<void> | void;

/**
 * 界面上的「配置项」：自动发现 / 直连 / 手动指定。
 *
 * 它和 `ProxyPolicy.source`（线路实际来自哪里）不是一回事：选了自动发现之后，
 * source 会落到 windows / environment / direct，模式仍然是 `auto`。
 */
export type ProxyMode = 'auto' | 'direct' | 'manual';

/**
 * 运行时的代理开关。
 *
 * 代理的消费者分散在三处，而且各自都在构造时把线路固化了下来：Pi 的模型请求
 * 走 undici dispatcher、Bangumi 工具请求走本地 MCP **子进程**（线路写在子进程
 * 的环境变量里）、登录走自己的 dispatcher。所以这里只维护「当前策略」并广播
 * 变更，每个消费者按自己的方式重建——dispatcher 换 agent、MCP 重启子进程。
 *
 * 策略只存在内存里：进程重启后回到启动时的自动发现结果。
 */
export class ProxyController {
  private policy: ProxyPolicy;
  private currentMode: ProxyMode;
  private readonly listeners = new Set<ProxyListener>();

  constructor(initial: ProxyPolicy, mode: ProxyMode = 'auto') {
    this.policy = initial;
    this.currentMode = mode;
  }

  get current(): ProxyPolicy { return this.policy; }

  /** 当前选中的配置项，供设置弹窗回显；与线路实际来源无关。 */
  get mode(): ProxyMode { return this.currentMode; }

  /** 只含地址的描述；直连或未发现代理时为空串。 */
  get addresses(): string { return proxyAddresses(this.policy); }

  /** 给界面看的描述，例如「系统代理：http://127.0.0.1:7890」或「直连」。 */
  get summary(): string { return proxySummary(this.policy); }

  onChange(listener: ProxyListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /**
   * 切换线路并通知所有消费者。
   *
   * 逐个 await：MCP 要重启子进程、dispatcher 要换 agent，这些必须在返回前完成，
   * 否则界面上「已切换」的提示会先于线路实际生效。
   */
  async set(policy: ProxyPolicy, mode: ProxyMode = this.currentMode): Promise<void> {
    this.policy = policy;
    this.currentMode = mode;
    for (const listener of this.listeners) await listener(policy);
  }
}
