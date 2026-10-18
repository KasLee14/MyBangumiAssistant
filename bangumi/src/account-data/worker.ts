import { parentPort, workerData } from 'node:worker_threads';
import { safeError } from '../support/errors.js';
import { syncAccountData } from './sync.js';

const controller = new AbortController();
parentPort?.on('message', message => { if (message === 'abort') controller.abort(); });
try {
  const result = await syncAccountData({ ...workerData, signal: controller.signal });
  parentPort?.postMessage({ ok: true, result });
} catch (error) {
  const safe = safeError(error);
  parentPort?.postMessage({ ok: false, error: { code: safe.code, message: safe.message } });
} finally { parentPort?.close(); }
