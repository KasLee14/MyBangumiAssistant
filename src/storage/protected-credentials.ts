import { spawn } from 'node:child_process';
import { AppError } from '../domain/errors.js';
export interface Protector { protect(value: string): Promise<string>; unprotect(value: string): Promise<string> }
function dpapi(value: string, decrypt: boolean): Promise<string> {
  if (process.platform !== 'win32') throw new AppError('BGM_AUTH_PLATFORM', '当前凭据保护使用 Windows DPAPI；此登录入口仅支持 Windows。');
  // 数据只经 stdin 传递，命令参数与错误输出均不携带凭据。
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::${decrypt ? 'Unprotect' : 'Protect'}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  return new Promise((resolve,reject) => {
    const child = spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{ windowsHide:true,shell:false,stdio:['pipe','pipe','pipe'] });
    let output = ''; const timer = setTimeout(() => { child.kill(); reject(new AppError('BGM_AUTH_STORAGE','凭据保护超时。')); },10000);
    child.stdout.setEncoding('utf8'); child.stdout.on('data',(part:string) => { output += part; if(output.length > 200000) child.kill(); });
    child.stderr.resume(); child.stdin.on('error',() => {});
    child.once('error',() => { clearTimeout(timer); reject(new AppError('BGM_AUTH_STORAGE','无法启动 Windows 凭据保护。')); });
    child.once('close',code => { clearTimeout(timer); if(code !== 0 || !/^[A-Za-z0-9+/=]+$/.test(output)) reject(new AppError('BGM_AUTH_STORAGE','无法保护或读取登录凭据，请重新登录。')); else resolve(decrypt ? Buffer.from(output,'base64').toString('utf8') : output); });
    child.stdin.end(decrypt ? value : Buffer.from(value,'utf8').toString('base64'));
  });
}
export const windowsProtector: Protector = { protect: value => dpapi(value,false), unprotect: value => dpapi(value,true) };
