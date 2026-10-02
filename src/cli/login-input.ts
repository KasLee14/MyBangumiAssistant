import { emitKeypressEvents } from 'node:readline';
import { stdin, stderr } from 'node:process';
import { AppError } from '../domain/errors.js';
import type { LoginPrompt } from '../adapters/bangumi-login/login.js';

/** 单独的原始输入通道：密码不回显，不使用命令行参数或聊天历史。 */
export function terminalLoginPrompt(input:NodeJS.ReadStream=stdin,output:NodeJS.WriteStream=stderr):LoginPrompt {
  return (kind,signal)=>new Promise<string>((resolve,reject)=>{
    if(!input.isTTY || typeof input.setRawMode !== 'function') {reject(new AppError('INVALID_INPUT','登录需要交互终端，密码不能通过管道或命令参数传入。'));return;}
    if(signal.aborted){reject(new AppError('CANCELLED','登录已取消。'));return;}
    let value='';const wasRaw=input.isRaw;emitKeypressEvents(input);input.setRawMode(true);input.resume();
    output.write(kind==='email' ? 'Bangumi 登录邮箱：' : 'Bangumi 密码（不回显）：');
    const cleanup=()=>{input.off('keypress',key);signal.removeEventListener('abort',abort);input.setRawMode(Boolean(wasRaw));input.pause();value='';output.write('\n');};
    const abort=()=>{cleanup();reject(new AppError('CANCELLED','登录已取消。'));};
    const key=(text:string,k:{name?:string;ctrl?:boolean;meta?:boolean;sequence?:string})=>{
      if(k.name==='escape' || k.ctrl && k.name==='c'){abort();return;}
      if(k.name==='return' || k.name==='enter'){if(!value)return;const result=value;cleanup();resolve(result);return;}
      if(k.name==='backspace'){const chars=Array.from(value);chars.pop();value=chars.join('');if(kind==='email')output.write('\b \b');return;}
      if(k.ctrl && k.name==='u'){if(kind==='email')output.write('\b \b'.repeat(Array.from(value).length));value='';return;}
      if(!k.ctrl && !k.meta && text && !/[\x00-\x1f\x7f]/.test(text) && value.length+text.length<=4000){value+=text;if(kind==='email')output.write(text);}
    };
    input.on('keypress',key);signal.addEventListener('abort',abort,{once:true});
  });
}
