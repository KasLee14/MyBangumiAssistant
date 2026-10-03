import { Agent, ProxyAgent, type Dispatcher } from 'undici';
import { proxyForUrl, type ProxyOptions } from './proxy.js';

/** 直连也明确指定 dispatcher，避免全局/启动参数让 null 意外走代理。 */
export class ProxyDispatchers {
  private readonly agents = new Map<string | null, Dispatcher>();
  private options: ProxyOptions;
  constructor(options: ProxyOptions) { this.options = options; }
  /**
   * 运行时切换线路。
   *
   * 已建的 agent 会把旧代理固化在连接池里，所以必须关掉再按新策略重建；
   * 关闭后 `forUrl` 会为下一次请求重建 agent，不需要重建宿主或 Pi 运行时。
   */
  async update(options: ProxyOptions): Promise<void> {
    await this.close();
    this.agents.clear();
    this.options = options;
  }
  forUrl(url: string): Dispatcher {
    const proxy = proxyForUrl(this.options, url);
    let agent = this.agents.get(proxy);
    if (!agent) { agent = proxy ? new ProxyAgent(proxy) : new Agent(); this.agents.set(proxy, agent); }
    return agent;
  }
  async close(): Promise<void> { await Promise.all([...this.agents.values()].map(agent => agent.close())); }
}
