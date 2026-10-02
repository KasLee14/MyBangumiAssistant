import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { ChatController } from '../chat-controller.js';
import { headerText } from './transcript.js';
import { displayText, planText, toolLabel } from './format.js';
import { showCandidates } from '../dialogue.js';
import { terminalLoginPrompt } from '../login-input.js';

/** 保留普通文本模式；不产生 ANSI 菜单，不改变脚本 JSON 输出。 */
export async function runPlainChat(controller: ChatController, signal: AbortSignal): Promise<void> {
  let lastId = 0; let writing = Promise.resolve();
  const unsubscribe = controller.subscribe(() => {
    for (const item of controller.snapshot().items) {
      if (item.id <= lastId) continue; lastId = item.id;
      const text = item.kind === 'header' ? headerText(item.header,stdout.columns || 80,item.compact ?? false)
        : item.kind === 'candidates' ? showCandidates(item.set)
          : item.kind === 'plan' ? planText(item.plan)
            : item.kind === 'activity' ? `${item.ok ? '✓' : '×'} ${toolLabel(item.name)}：${item.detail}`
              : `${item.kind === 'user' ? '你> ' : item.kind === 'assistant' ? '助手> ' : ''}${item.text}`;
      writing = writing.then(() => new Promise<void>((resolve,reject) => stdout.write(displayText(text)+'\n',error => error ? reject(error) : resolve())));
      if (item.kind === 'plan' && item.plan.state === 'pending') writing = writing.then(() => controller.acknowledgePlan(item.plan.id,item.plan.digest));
    }
  });
  const stop = new AbortController(); let quitAt = 0;
  let readline: ReturnType<typeof createInterface> | undefined;
  const queue: string[] = []; let ended = false; let wake: (() => void) | undefined;
  const resumeInput = () => {
    if (ended || signal.aborted || stop.signal.aborted || readline) return;
    const reader = createInterface({input:stdin,output:stdout}); readline = reader;
    reader.on('line', value => { queue.push(value); wake?.(); });
    reader.on('SIGINT', () => { interrupt(); wake?.(); });
    reader.once('close', () => { if (readline === reader) { readline = undefined; ended = true; wake?.(); } });
  };
  const suspendInput = () => { const reader = readline; readline = undefined; reader?.close(); };
  const loginPrompt = terminalLoginPrompt();
  controller.setLoginPrompt(async (kind, loginSignal) => {
    // 整个登录输入期间关闭普通 readline，密码只进入独立的隐藏输入通道。
    suspendInput();
    return loginPrompt(kind, loginSignal);
  });
  const interrupt=()=>{if(controller.snapshot().busy)controller.cancel();else if(Date.now()-quitAt<1500)stop.abort();else{quitAt=Date.now();stdout.write('再按一次 Ctrl+C 退出\n');}};
  process.on('SIGINT',interrupt);
  try {
    await controller.initialize();
    await writing;
    const close=()=>{suspendInput();wake?.();};signal.addEventListener('abort',close,{once:true});stop.signal.addEventListener('abort',close,{once:true});
    resumeInput();
    try { while(!signal.aborted && !stop.signal.aborted) {
      await writing;
      stdout.write('\n你> ');
      while (!queue.length && !ended && !signal.aborted && !stop.signal.aborted) {
        await new Promise<void>(resolve => { wake = resolve; }); wake = undefined;
      }
      const input = queue.shift();
      if(signal.aborted || stop.signal.aborted || input === undefined)break;
      if (input.trim() === '/exit') break;
      if (input.trim() === '/details') { stdout.write('普通文本模式已显示活动记录；用 /status 查看会话 ID。\n'); continue; }
      try { await controller.submit(input); } finally { resumeInput(); }
    } } finally {signal.removeEventListener('abort',close);stop.signal.removeEventListener('abort',close);}
  } finally { process.off('SIGINT',interrupt);await controller.close(); await writing; unsubscribe(); readline?.close(); }
}
