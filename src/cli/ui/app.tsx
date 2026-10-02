import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Box, Static, Text, render, useApp, useInput, usePaste, useWindowSize } from 'ink';
import type { ChatController } from '../chat-controller.js';
import { displayText, wrapText } from './format.js';
import { Header, Transcript, headerDetails } from './transcript.js';
import { PromptEditor } from './editor.js';
import { Composer } from './composer.js';
import { CommandPicker, Picker, type MenuOption } from './candidate-picker.js';
import { OperationView } from './operation-view.js';

const COMMANDS: MenuOption[] = [
  { label: '/help      查看帮助', value: '/help' }, { label: '/login     登录 Bangumi 账号', value: '/login' },
  { label: '/status    查看登录、模型、会话及待处理操作', value: '/status' },
  { label: '/model     选择模型配置', value: '/model' }, { label: '/sessions  选择历史会话', value: '/sessions' },
  { label: '/new       新建会话', value: '/new' }, { label: '/details   展开本轮工具详情', value: '/details' },
  { label: '/exit      退出聊天', value: '/exit' },
];
const ARGUMENT_COMMANDS: Record<string,string> = {
  '/resume': '/resume 会话ID', '/select': '/select [清单ID] 编号',
  '/confirm': '/confirm 预览ID', '/reject': '/reject 预览ID',
};
interface Menu { title: string; options: MenuOption[]; selected: number }
export function ChatApp({controller}: {controller:ChatController}) {
  const state = useSyncExternalStore(controller.subscribe,controller.snapshot);
  const {columns,rows} = useWindowSize(); const width = Math.max(12,columns ?? 80); const height = Math.max(12,rows ?? 24);
  const {exit,waitUntilRenderFlush} = useApp();
  const editor = useRef(new PromptEditor()).current;
  const credential = useRef({ id:0, value:'' }).current;
  if(credential.id !== (state.credentialPrompt?.id ?? 0)) {credential.id=state.credentialPrompt?.id ?? 0;credential.value='';}
  const [,redraw] = useState(0); const [menu,setMenu] = useState<Menu|null>(null);
  const [details,setDetails] = useState(false); const [confirmation,setConfirmation] = useState(0);
  const [candidateIndex,setCandidateIndex] = useState(0); const [dismissedCandidate,setDismissedCandidate] = useState('');
  const [clock,setClock] = useState(Date.now()); const [quitHint,setQuitHint] = useState(false);
  const quitAt = useRef(0); const leaving = useRef(false); const dismissed = useRef<string|null>(null);
  const lastDraft = useRef(''); const selectedCommand = useRef('/help');
  useEffect(() => { if (!state.busy) return; const timer = setInterval(() => setClock(Date.now()),250); return () => clearInterval(timer); },[state.busy]);
  useEffect(() => { if (!quitHint) return; const timer = setTimeout(() => setQuitHint(false),1500); return () => clearTimeout(timer); },[quitHint]);
  useEffect(() => { setConfirmation(0); },[state.pending?.id]);
  useEffect(() => { setCandidateIndex(0); },[state.candidates?.id]);
  const candidateQuestion = state.ready && !state.busy && !state.pending && state.candidates && !state.focus
    && state.candidates.items.length > 1 && state.candidates.id !== dismissedCandidate ? state.candidates : null;
  useEffect(() => {
    const plan = state.pending; if (!plan || state.previewAcknowledged) return;
    let active = true;
    void waitUntilRenderFlush().then(() => { if (active) controller.acknowledgePlan(plan.id,plan.digest); }).catch(() => {});
    return () => { active = false; };
  },[state.pending?.id,state.pending?.digest,state.previewAcknowledged,controller,waitUntilRenderFlush]);
  const shutdown = () => {
    if (leaving.current) return; leaving.current = true;
    controller.cancel(); void controller.close().then(() => waitUntilRenderFlush()).then(() => exit()).catch(error => exit(error));
  };
  const openModels = () => setMenu({title:'选择模型配置',selected:0,options:controller.models().map(model => ({label:`${model.name} · ${model.label}`,value:`/model ${model.name}`}))});
  const execute = (input:string) => {
    if (input.trim() === '/exit') { shutdown(); return; }
    if (input.trim() === '/details') { setDetails(value => !value); return; }
    if (input.trim() === '/model') { openModels(); return; }
    if (input.trim() === '/sessions') {
      void controller.sessions().then(ids => ids.length ? setMenu({title:'恢复历史会话（旧授权失效）',selected:0,options:ids.map(id => ({label:id,value:`/resume ${id}`}))}) : controller.notify('暂无历史会话。'))
        .catch(() => controller.notify('无法列出历史会话。')); return;
    }
    void controller.submit(input);
  };
  const change = () => {
    if (lastDraft.current !== editor.text) {
      dismissed.current = null; lastDraft.current = editor.text;
      const matches = /^\/[^\s]*$/.test(editor.text) ? COMMANDS.filter(option => option.value.startsWith(editor.text)) : [];
      selectedCommand.current = matches.find(option => option.value === editor.text)?.value
        ?? matches.find(option => option.value === selectedCommand.current)?.value ?? matches[0]?.value ?? '/help';
    }
    redraw(value => value+1);
  };
  const submitDraft = (value = editor.text) => {
    const input = value.trim();
    // 仅单行命令在本地检查；参数完整保留，正文和多行草稿仍交给既有对话入口。
    if (!value.includes('\n') && input.startsWith('/')) {
      const command = input.split(/\s/,1)[0]!;
      if (!COMMANDS.some(option => option.value === command) && !Object.hasOwn(ARGUMENT_COMMANDS,command)) {
        controller.notify('没有匹配命令，请继续编辑；输入 / 查看命令列表。'); return;
      }
      if (Object.hasOwn(ARGUMENT_COMMANDS,command) && input === command) {
        controller.notify(`请补充参数：${ARGUMENT_COMMANDS[command]}`); return;
      }
    }
    editor.set(value); const submitted = editor.submit(); change(); execute(submitted);
  };
  const paste = (text:string) => {
    if(state.credentialPrompt) {if(!/[\x00-\x1f\x7f]/.test(text) && credential.value.length+text.length <= 4000)credential.value+=text;redraw(value=>value+1);return;}
    if (!editor.insert(text)) controller.notify('粘贴后超过8000字，未插入，请缩短内容。'); setMenu(null); change();
  };
  usePaste(paste);
  const commandPanel = state.ready && !state.busy && !menu && /^\/[^\s]*$/.test(editor.text) && dismissed.current !== editor.text;
  const suggestions = commandPanel ? COMMANDS.filter(option => option.value.startsWith(editor.text)) : [];
  const commandIndex = Math.max(0,suggestions.findIndex(option => option.value === selectedCommand.current));
  useInput((input,key) => {
    if (key.eventType === 'release') return;
    if(state.credentialPrompt) {
      if(key.escape || key.ctrl && input==='c') {credential.value='';controller.cancel();redraw(value=>value+1);return;}
      if(key.return) {if(credential.value){const value=credential.value;credential.value='';controller.submitLoginInput(state.credentialPrompt.id,value);}redraw(value=>value+1);return;}
      if(key.backspace || key.delete) {credential.value=Array.from(credential.value).slice(0,-1).join('');}
      else if(key.ctrl && input==='u')credential.value='';
      else if(!key.ctrl && !key.meta && input && !/[\x00-\x1f\x7f]/.test(input) && credential.value.length+input.length<=4000)credential.value+=input;
      redraw(value=>value+1);return;
    }
    if (key.ctrl && input === 'c') {
      if (menu) { setMenu(null); return; }
      if (state.busy) { controller.cancel(); return; }
      if (editor.text) { editor.set(''); change(); return; }
      if (Date.now()-quitAt.current < 1500) shutdown(); else { quitAt.current = Date.now(); setQuitHint(true); } return;
    }
    if (key.escape) {
      if (menu) setMenu(null);
      else if (commandPanel) { dismissed.current = editor.text; change(); }
      else if (state.busy) controller.cancel();
      else if (state.pending) execute(`/reject ${state.pending.id}`);
      else if (candidateQuestion) setDismissedCandidate(candidateQuestion.id);
      return;
    }
    if (leaving.current) return;
    if (!state.ready && key.return) { controller.notify('会话正在准备，草稿已保留；准备完成后再发送。'); return; }
    // 无 bracketed-paste 的多字输入仍按一次草稿插入，换行不能触发发送。
    if (input.length > 1 && !key.ctrl && !key.meta) { paste(input); return; }
    if (menu) {
      if (key.upArrow) setMenu({...menu,selected:Math.max(0,menu.selected-1)});
      else if (key.downArrow) setMenu({...menu,selected:Math.min(menu.options.length-1,menu.selected+1)});
      else if (key.return) { const option = menu.options[menu.selected]; setMenu(null); if (option) execute(option.value); }
      return;
    }
    if (key.ctrl && input === 'j' || key.return && key.shift || input === '\n' && !key.return) { editor.insert('\n'); change(); return; }
    if (suggestions.length && (key.upArrow || key.downArrow)) {
      const index = Math.max(0,Math.min(suggestions.length-1,commandIndex+(key.upArrow ? -1 : 1)));
      selectedCommand.current = suggestions[index]!.value; change(); return;
    }
    if (suggestions.length && key.tab) { editor.set(suggestions[commandIndex]!.value); change(); return; }
    if (key.tab && state.ready && !editor.text && !state.busy && state.candidates?.items.length) {
      const set = state.candidates;
      setMenu({title:'选择作品（回答后继续原任务）',selected:0,options:set.items.map((item,index) => ({label:`${index+1}. ${item.title} · #${item.id}`,value:`/select ${set.id} ${index+1}`}))}); return;
    }
    if (candidateQuestion && !menu && !editor.text && (key.upArrow || key.downArrow)) {
      setCandidateIndex(value => Math.max(0,Math.min(candidateQuestion.items.length-1,value+(key.upArrow ? -1 : 1)))); return;
    }
    if (state.pending && !state.busy && !editor.text && (key.leftArrow || key.rightArrow)) { setConfirmation(value => value === 0 ? 1 : 0); return; }
    if (key.return) {
      if (state.busy) { controller.notify('本轮尚未结束，草稿已保留；结束后再按 Enter 发送。'); return; }
      if (editor.text.trim()) submitDraft(suggestions[commandIndex]?.value ?? editor.text);
      else if (state.pending && state.previewAcknowledged) execute(`/${confirmation ? 'confirm' : 'reject'} ${state.pending.id}`);
      else if (candidateQuestion) execute(`/select ${candidateQuestion.id} ${candidateIndex+1}`);
      return;
    }
    if (key.leftArrow) editor.left(); else if (key.rightArrow) editor.right();
    else if (key.home || key.ctrl && input === 'a') editor.home();
    else if (key.end || key.ctrl && input === 'e') editor.end();
    else if (key.backspace || key.delete && input === '\u007f') editor.backspace();
    else if (key.delete) editor.delete();
    else if (key.upArrow || key.downArrow) {
      const direction = key.upArrow ? -1 : 1;
      if (editor.text.includes('\n')) editor.vertical(direction); else editor.recall(direction);
    } else if (key.ctrl && input === 'u') editor.set('');
    else if (!key.ctrl && !key.meta && input) editor.insert(input);
    change();
  });
  const composerRows = Math.min(5,Math.max(1,Math.floor(height/5)));
  const liveRows = Math.max(1,height-composerRows-(menu || commandPanel || state.pending || candidateQuestion ? 12 : 7));
  const liveLines = wrapText(state.liveText,width-2);
  const recentDetails = state.items.filter(item => item.kind === 'activity' || item.kind === 'plan').slice(-3);
  return <Box flexDirection="column" width={width}>
    <Static items={[...state.items]}>{item => <Transcript key={item.id} item={item} width={width} />}</Static>
    {!state.ready && <Header info={state} width={width} />}
    {state.liveText && <Box flexDirection="column"><Text dimColor>{liveLines.length > liveRows ? '较长回答正在生成，完成后保留全文。' : ''}</Text><Text>{displayText(liveLines.slice(-liveRows).join('\n'))}</Text></Box>}
    {details && <Box flexDirection="column"><Text dimColor>工具与计划详情</Text>{recentDetails.map(item => <Text key={item.id} dimColor>{displayText(item.kind === 'activity' ? `${item.name}：${item.detail}` : item.kind === 'plan' ? `预览 ${item.plan.id} · ${item.plan.state}` : '')}</Text>)}</Box>}
    {menu ? <Picker {...menu} height={Math.min(10,height-composerRows-6)} /> : commandPanel ? suggestions.length
      ? <CommandPicker options={suggestions} selected={commandIndex} width={width} height={Math.min(8,height-composerRows-6)} />
      : <Text dimColor>{ARGUMENT_COMMANDS[editor.text] ? `请补充参数：${ARGUMENT_COMMANDS[editor.text]}` : '没有匹配命令，请继续输入或修改。'}</Text> : null}
    {candidateQuestion && !menu && !commandPanel && <Picker title="你指哪一部作品？可直接输入自然语言回答" selected={candidateIndex}
      options={candidateQuestion.items.map(item => ({label:`${item.title} · #${item.id}`,value:String(item.id)}))} height={Math.min(10,height-composerRows-6)} />}
    {state.pending && !state.busy && !menu && <OperationView plan={state.pending} acknowledged={state.previewAcknowledged} selected={confirmation} />}
    <Text dimColor>{state.busy ? `${['◐','◓','◑','◒'][Math.floor(clock/200)%4]} ${state.status} · ${Math.max(0,Math.floor((clock-state.startedAt)/1000))}秒 · Esc 停止` : state.status}{state.focus ? ` · 当前作品：${displayText(state.focus)}` : ''}</Text>
    {state.unknownOperations > 0 && <Text color="yellow">有 {state.unknownOperations} 项结果未知，请先核对网站；不会自动重试。</Text>}
    {state.credentialPrompt ? <Box flexDirection="column"><Text>{state.credentialPrompt.kind==='email' ? 'Bangumi 登录邮箱：' : 'Bangumi 密码：'}{state.credentialPrompt.kind==='password' ? '•'.repeat(Math.min(40,Array.from(credential.value).length)) : displayText(credential.value)}▏</Text><Text dimColor>Enter 提交 · Esc 取消 · 输入不进入聊天记录</Text></Box>
      : <Composer editor={editor} width={width} height={composerRows} busy={state.busy} />}
    <Text dimColor>{wrapText(headerDetails(state),width).join('\n')}</Text>
    <Text dimColor>{quitHint ? '再按一次 Ctrl+C 退出' : commandPanel ? '继续输入可筛选命令' : width < 50 ? 'Enter 发送 · / 命令 · Tab 选择' : 'Enter 发送 · Ctrl+J 换行 · / 命令 · Tab 选择作品'}</Text>
  </Box>;
}
export async function runChatUi(controller:ChatController):Promise<void> {
  const app = render(<ChatApp controller={controller} />, {exitOnCtrlC:false,patchConsole:false,maxFps:24,incrementalRendering:true});
  try { await controller.initialize(); await app.waitUntilExit(); }
  finally { await controller.close(); app.unmount(); app.cleanup(); }
}
