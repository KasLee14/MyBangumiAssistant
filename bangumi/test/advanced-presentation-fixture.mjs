// 显式验收上一版高级两步兼容接口；不能作为生产初始loadout证据。
import { createBangumiExtension } from '../dist/src/extension.js';
export function createAdvancedBangumiExtension(config) {
  return pi => {
    createBangumiExtension(config)(pi);
    pi.on('before_agent_start', () => pi.setActiveTools([...new Set([...pi.getActiveTools(), 'prepare_component', 'present_component', 'present_text'])]));
  };
}
