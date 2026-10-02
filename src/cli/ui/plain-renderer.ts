import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { ChatController } from '../chat-controller.js';
import { headerText } from './transcript.js';
import { displayText, planText, toolLabel } from './format.js';
import { showCandidates } from '../dialogue.js';

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
  try {
    await controller.initialize();
    await writing;
    readline=createInterface({input:stdin,output:stdout});
    stdout.write('\n你> ');
    const close=()=>readline?.close();signal.addEventListener('abort',close,{once:true});stop.signal.addEventListener('abort',close,{once:true});
    readline.on('SIGINT',() => {
      if (controller.snapshot().busy) { controller.cancel(); return; }
      if (Date.now()-quitAt < 1500) stop.abort(); else { quitAt = Date.now(); stdout.write('再按一次 Ctrl+C 退出\n'); }
    });
    try { for await (const input of readline) {
      await writing;
      if(signal.aborted || stop.signal.aborted)break;
      if (input.trim() === '/exit') break;
      if (input.trim() === '/details') { stdout.write('普通文本模式已显示活动记录；用 /status 查看会话 ID。\n'); continue; }
      await controller.submit(input);
      if(!signal.aborted && !stop.signal.aborted)stdout.write('\n你> ');
    } } finally {signal.removeEventListener('abort',close);stop.signal.removeEventListener('abort',close);}
  } finally { await controller.close(); await writing; unsubscribe(); readline?.close(); }
}
