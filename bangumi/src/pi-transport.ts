import type { FetchFunction } from '@earendil-works/pi-ai';
import { fetch } from 'undici';
import { ProxyDispatchers } from './support/proxy-dispatcher.js';
import type { ProxyOptions } from './support/proxy.js';

/** 复用登录/MCP代理快照，不修改进程环境或 Pi 协议实现。 */
export function createPiTransport(proxy: ProxyOptions): { fetch: FetchFunction; close: () => Promise<void> } {
  const dispatchers = new ProxyDispatchers(proxy);
  const proxyFetch: FetchFunction = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return await fetch(input as Parameters<typeof fetch>[0], {
      ...init, dispatcher: dispatchers.forUrl(url),
    } as Parameters<typeof fetch>[1]) as unknown as Response;
  };
  return { fetch: proxyFetch, close: () => dispatchers.close() };
}
