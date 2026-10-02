// OAuth认证端到端测试：仅允许固定假端点，禁止真实网络；状态只在临时目录。
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const undici=createRequire(import.meta.url)('undici');
const file=join(process.env.BANGUMI_AUTH_DIRECTORY,'offline-state.json');
undici.fetch=async(raw,init)=>{
  const url=new URL(raw);const headers=init.headers;
  if(headers.Cookie || headers.Authorization !== (process.env.FIXTURE_ANONYMOUS === '1' ? undefined : 'Bearer offline-access-token-123456'))throw new Error('Unexpected OAuth authentication');
  if(init.redirect!=='manual')throw new Error('Unexpected redirect mode');
  let interest={type:3,rate:7,comment:'',tags:[],private:false,epStatus:0,volStatus:0};
  try{interest=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const subject={id:1,type:2,name:'离线测试',nameCN:'离线测试',eps:1,...(interest?{interest}:{})};
  const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
  if(url.origin==='https://next.bgm.tv'){
    if(url.pathname==='/p1/me')return json({id:7,username:'fixture'});
    if(url.pathname==='/p1/subjects/1')return json(subject);
    if(url.pathname==='/p1/search/subjects')return json({data:[subject],total:1});
    if(url.pathname==='/p1/collections/subjects')return json({data:interest?[subject]:[],total:interest?1:0});
    if(url.pathname==='/p1/subjects/1/episodes')return json({data:[{id:11,type:0,sort:1,name:'章',collection:{type:interest?2:0}}],total:1});
    if(url.pathname==='/p1/episodes/11')return json({id:11,subjectID:1,type:0,sort:1,collection:{type:interest?2:0}});
    if(url.pathname==='/p1/collections/subjects/1' && init.method==='PUT'){
      interest={...interest,...JSON.parse(init.body)};await writeFile(file,JSON.stringify(interest));return json({});
    }
  }
  throw new Error('测试禁止访问真实或未声明的服务');
};
