import { spawn } from 'node:child_process';
import { AppError } from '../support/errors.js';
export function openDefaultBrowser(url:string):Promise<void> {
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler',url] : [url];
  return new Promise((resolve,reject) => {
    const child = spawn(command,args,{shell:false,windowsHide:true,stdio:'ignore'});
    child.once('error',()=>reject(new AppError('BGM_LOGIN_BROWSER','无法打开默认浏览器，请检查系统设置后重试。')));
    child.once('spawn',()=>{child.unref();resolve();});
  });
}
