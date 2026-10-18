/** Web 后续手动同步按钮应复用 launcher 持有的协调器，不创建独立任务。 */
export { createAccountDataCoordinator, type AccountDataCoordinator, type AccountSyncResult } from './coordinator.js';
export { getAccountDatasetStatus, openAccountSnapshot } from './store.js';
