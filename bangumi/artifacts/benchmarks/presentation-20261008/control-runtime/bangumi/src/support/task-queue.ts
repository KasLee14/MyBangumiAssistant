import { AppError } from './errors.js';

/** 同一宿主的账户变更串行执行；排队期间取消不会执行任务，也不会提前放行后续任务。 */
export class TaskQueue {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    const slot = new Promise<void>(resolve => { release = resolve; });
    this.tail = previous.then(() => slot);
    let onAbort: (() => void) | undefined;
    try {
      if (signal?.aborted) throw new AppError('CANCELLED', '操作已取消。');
      await (signal ? Promise.race([previous, new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new AppError('CANCELLED', '操作已取消。'));
        signal.addEventListener('abort', onAbort, { once: true });
      })]) : previous);
      if (signal?.aborted) throw new AppError('CANCELLED', '操作已取消。');
      return await task();
    } finally {
      if (onAbort) signal?.removeEventListener('abort', onAbort);
      release();
    }
  }
}
