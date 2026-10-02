import { Agent, ProxyAgent, type Dispatcher } from 'undici';
import { proxyForUrl, type ProxyOptions } from '../config/proxy.js';

/** 直连也明确指定 dispatcher，避免全局/启动参数让 null 意外走代理。 */
export class ProxyDispatchers {
  private readonly agents = new Map<string | null, Dispatcher>();
  constructor(private readonly options: ProxyOptions) {}
  forUrl(url: string): Dispatcher {
    const proxy = proxyForUrl(this.options, url);
    let agent = this.agents.get(proxy);
    if (!agent) { agent = proxy ? new ProxyAgent(proxy) : new Agent(); this.agents.set(proxy, agent); }
    return agent;
  }
  async close(): Promise<void> { await Promise.all([...this.agents.values()].map(agent => agent.close())); }
}
