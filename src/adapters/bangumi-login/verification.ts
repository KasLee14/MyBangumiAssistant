import { createServer, type IncomingMessage } from 'node:http';
import { randomBytes } from 'node:crypto';
import { AppError, registerCredentials } from '../../domain/errors.js';
import { object } from '../../domain/bangumi.js';
import { AccountTransport, VERIFICATION_ORIGIN } from './transport.js';
import { openDefaultBrowser } from './browser.js';

function validToken(value:unknown):value is string { return typeof value === 'string' && /^[A-Za-z0-9._~-]{8,16000}$/.test(value); }
async function body(req:IncomingMessage):Promise<unknown> {
  const chunks:Buffer[] = []; let size = 0;
  for await (const part of req) { size += part.length; if (size > 20000) throw new Error(); chunks.push(part); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function manualPage(relay:string):string {
  // 在官方页面由用户运行验证脚本；只取得验证码，不读取网页 Cookie 或密码。
  const script = `(()=>{const send=token=>fetch(${JSON.stringify(relay)},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({turnstileToken:token})}).then(r=>{if(!r.ok)throw Error('callback failed');alert('验证完成，请返回 MyBangumiAssistant');});const mount=()=>{const box=document.createElement('div');box.style='position:fixed;top:20px;right:20px;z-index:2147483647;background:white;padding:20px';document.body.appendChild(box);window.turnstile.render(box,{sitekey:'0x4AAAAAAABkMYinukE8nzYS',callback:send});};if(window.turnstile)mount();else{const s=document.createElement('script');s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';s.onload=mount;document.head.appendChild(s);}})()`;
  const escaped = script.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>MyBangumiAssistant 人机验证辅助</title><style>body{font:16px system-ui;max-width:850px;margin:40px auto;padding:20px;line-height:1.8}textarea{width:100%;min-height:130px}button{padding:10px;margin:10px 0}</style><h1>本地人机验证辅助</h1><p>此模式不使用上游托管验证服务。不在本页输入邮箱或密码。</p><ol><li>打开 <a href="https://next.bgm.tv/" target="_blank" rel="noreferrer">Bangumi 官方页面</a>。</li><li>打开该页面开发者工具的 Console，粘贴下方脚本。</li><li>完成出现的人机验证，成功后自动返回终端。验证码不进入聊天。</li></ol><textarea id="script" readonly>${escaped}</textarea><button id="copy">复制验证脚本</button><p>若浏览器阻止自动回传，可将取得的验证令牌粘贴在本地框中：</p><textarea id="token"></textarea><button id="submit">提交验证令牌</button><p id="status">等待验证；终端 Ctrl+C 取消。</p><script>const relay=${JSON.stringify(relay)};document.getElementById('copy').onclick=()=>navigator.clipboard.writeText(document.getElementById('script').value);document.getElementById('submit').onclick=async()=>{try{const r=await fetch(relay,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({turnstileToken:document.getElementById('token').value.trim()})});document.getElementById('status').textContent=r.ok?'验证完成，请返回终端。':'验证令牌无效，请重新获取。';document.getElementById('token').value='';}catch{document.getElementById('status').textContent='无法回传，请返回终端重试。';}};</script></html>`;
}

/** 与 bgm-cli 的无状态验证中转协议一致；回环使用随机端口和一次性路径。 */
export async function acquireVerification(transport:AccountTransport,options:{signal:AbortSignal;manual:boolean;notice?:((message:string)=>void)|undefined;openBrowser?:((url:string)=>Promise<void>)|undefined}):Promise<string> {
  options.signal.throwIfAborted();
  const nonce = randomBytes(32).toString('hex'); registerCredentials([nonce]);
  let origin = ''; let settled = false;
  let resolve!: (value:string)=>void; let reject!: (reason:unknown)=>void;
  const completion = new Promise<string>((ok,fail)=>{resolve=ok;reject=fail;}); completion.catch(()=>{});
  const callbackPath = `/callback/${nonce}`; const helperPath = `/verify/${nonce}`;
  const server = createServer((req,res)=>{
    void (async()=>{
      res.setHeader('Cache-Control','no-store'); res.setHeader('Referrer-Policy','no-referrer');
      res.setHeader('Content-Type','text/plain; charset=utf-8');
      if (req.headers.host !== new URL(origin).host) { res.writeHead(400);res.end('无效请求。');return; }
      if (options.manual && req.method === 'GET' && req.url === helperPath) { res.setHeader('Content-Type','text/html; charset=utf-8');res.end(manualPage(origin+callbackPath));return; }
      if (req.url !== callbackPath) { res.writeHead(404);res.end('未找到。');return; }
      const requestOrigin = req.headers.origin;
      const allowed = options.manual ? ['https://next.bgm.tv',origin] : [VERIFICATION_ORIGIN];
      if (!requestOrigin || !allowed.includes(requestOrigin)) { res.writeHead(403);res.end('请求来源无效。');return; }
      res.setHeader('Access-Control-Allow-Origin',requestOrigin);res.setHeader('Vary','Origin');
      res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');
      res.setHeader('Access-Control-Allow-Private-Network','true');
      if (req.method === 'OPTIONS') { res.writeHead(204);res.end();return; }
      if (req.method !== 'POST') { res.writeHead(405);res.end('仅接受验证回传。');return; }
      if (settled) { res.writeHead(409);res.end('验证已处理。');return; }
      try {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new Error();
        const data = object(await body(req));
        if (settled) { res.writeHead(409);res.end('验证已处理。');return; }
        if (!validToken(data.turnstileToken)) throw new Error();
        registerCredentials([data.turnstileToken]); settled=true;res.end('验证已收到，请返回终端。');resolve(data.turnstileToken);
      } catch { res.writeHead(400);res.end('验证令牌无效。'); }
    })().catch(()=>{if(!res.headersSent)res.writeHead(400);res.end('验证未完成。');});
  });
  server.requestTimeout=10000;server.headersTimeout=10000;
  const abort = ()=>reject(new AppError('CANCELLED','人机验证已取消。'));
  options.signal.addEventListener('abort',abort,{once:true});
  try {
    await new Promise<void>((ok,fail)=>{server.once('error',()=>fail(new AppError('BGM_LOGIN_CALLBACK','无法启动本机人机验证回调。')));server.listen(0,'127.0.0.1',ok);});
    const address=server.address();if(!address || typeof address === 'string')throw new AppError('BGM_LOGIN_CALLBACK','无法取得回调端口。');
    origin=`http://127.0.0.1:${address.port}`;options.signal.throwIfAborted();
    let authorization:string;
    if(options.manual) {
      authorization=origin+helperPath;options.notice?.('正在打开本地人机验证辅助页，请按页面步骤操作；不使用上游托管服务。');
    } else {
      options.notice?.('正在准备官方人机验证；使用 bgm-cli 上游托管回传服务，邮箱和密码仅发送到 Bangumi。');
      const data=object(await transport.verificationSession(origin+callbackPath,options.signal));
      if(typeof data.authorize_url !== 'string' || data.relay_url !== origin+callbackPath)throw new AppError('INVALID_RESPONSE','验证服务响应不匹配本次登录。');
      let url:URL;let redirect:URL;
      try {url=new URL(data.authorize_url);redirect=new URL(url.searchParams.get('redirect_uri') ?? '');}catch{throw new AppError('INVALID_RESPONSE','验证地址无效。');}
      if(url.origin !== 'https://next.bgm.tv' || url.pathname !== '/p1/turnstile' || url.username || url.password || url.hash
        || redirect.origin !== VERIFICATION_ORIGIN || redirect.pathname !== '/api/turnstile/callback' || redirect.username || redirect.password || !redirect.searchParams.get('relay'))throw new AppError('INVALID_RESPONSE','验证地址不是固定官方流程，未打开浏览器。');
      authorization=url.href;
      options.notice?.('请在默认浏览器完成 Bangumi 人机验证；成功后自动返回。Ctrl+C 取消。');
    }
    await (options.openBrowser ?? openDefaultBrowser)(authorization);options.signal.throwIfAborted();
    return await completion;
  } catch(error) {
    if(options.signal.aborted)throw new AppError('CANCELLED','人机验证已取消。');
    throw error;
  } finally {
    settled=true;options.signal.removeEventListener('abort',abort);server.closeAllConnections();await new Promise<void>(ok=>server.close(()=>ok()));
  }
}
