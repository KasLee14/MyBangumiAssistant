import test from 'node:test';
import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';
import { renderToString } from 'ink';
import stringWidth from 'string-width';
import { PromptEditor } from '../../src/cli/ui/editor.js';
import { CommandPicker } from '../../src/cli/ui/candidate-picker.js';
import { headerText, headerDetails, Header, Transcript } from '../../src/cli/ui/transcript.js';
import { LOGO_LINES } from '../../src/cli/ui/logo.js';
import metadata from '../../package.json' with { type: 'json' };
import { Markdown } from '../../src/cli/ui/markdown.js';
import { displayText, planText } from '../../src/cli/ui/format.js';
import type { HeaderInfo } from '../../src/cli/chat-controller.js';
import type { OperationPlan } from '../../src/core/operations.js';

test('字素编辑不拆中文、组合字符或emoji，多行粘贴保留草稿且控制序列不生效', () => {
  const editor=new PromptEditor(); editor.insert('中👨‍👩‍👧‍👦é'); editor.left(); editor.backspace();
  assert.equal(String(editor.text),'中é'); editor.delete(); assert.equal(String(editor.text),'中');
  editor.insert('\n下一行'); editor.home(); editor.insert('开头'); assert.equal(String(editor.text),'中\n开头下一行');
  editor.insert('\u001b[2J\u0007文本'); assert.ok(!editor.text.includes('\u001b'));assert.ok(!editor.text.includes('\u0007'));
  editor.set('x'.repeat(8000)); assert.equal(editor.insert('中'),false);assert.equal(editor.text.length,8000);
});
test('输入历史可回到未提交草稿，多行移动不覆盖其他行', () => {
  const editor=new PromptEditor();editor.set('第一轮');editor.submit();editor.set('第二轮');editor.submit();editor.set('草稿');
  editor.recall(-1);assert.equal(editor.text,'第二轮');editor.recall(-1);assert.equal(editor.text,'第一轮');
  editor.recall(1);editor.recall(1);assert.equal(editor.text,'草稿');
  editor.set('甲乙\n丙丁戊');editor.vertical(-1);assert.equal(editor.before,'甲乙');editor.vertical(1);assert.equal(editor.before,'甲乙\n丙丁');
});
test('命令列表窄窗口保留完整命令名，说明裁剪、滚动选择且显示高度有界', () => {
  const commands=['/help','/login','/status','/model','/sessions','/new','/details','/exit'];
  const options=commands.map(value=>({value,label:`${value}  ${'很长的中文说明👨‍👩‍👧‍👦'.repeat(3)}`}));
  for(const width of [12,28,40,80]) {
    const text=stripVTControlCharacters(renderToString(<CommandPicker options={options} selected={7} width={width} height={8}/>,{columns:width}));
    assert.match(text,/› \/exit/);assert.match(text,/\/sessions/);assert.doesNotMatch(text,/\/help/);
    for(const line of text.split('\n'))assert.ok(stringWidth(line)<=width,`${width}: ${line}`);
    assert.ok(text.trimEnd().split('\n').length<=8);
    if(width===80)assert.match(text,/↑↓ 选择 · Tab 补全 · Enter 执行/);
  }
});

test('顶部横幅显示包版本、实际模型与username，普通文本和窄窗口保留完整信息', () => {
  const header:HeaderInfo={modelName:'deepseek',modelLabel:'deepseek-flash',sessionId:'12345678-abcd',login:{kind:'signed-in',accountId:7654321,username:'fixture-user'}};
  assert.equal(headerDetails(header),'当前模型：deepseek-flash 当前Bangumi用户：fixture-user');
  assert.equal(headerText(header,120),`MyBangumiAssistant v${metadata.version}\n当前模型：deepseek-flash\n当前Bangumi用户：fixture-user`);
  for(const width of [12,28,40,56,80,120]) {
    const text=headerText(header,width);assert.match(text.replace(/\n/g,''),/当前Bangumi用户：fixture-user/);
    assert.doesNotMatch(text,/会话|12345678/);
    for(const line of text.split('\n')) assert.ok(stringWidth(line)<=width,`${width}: ${line}`);
    const rendered=stripVTControlCharacters(renderToString(<Header info={header} width={width} />,{columns:width}));assert.match(rendered.replace(/[ \n\u2800-\u28ff]/g,''),/当前Bangumi用户：fixture-user/);
    for(const line of rendered.split('\n')) assert.ok(stringWidth(line)<=width,`${width}: ${line}`);
    if(width>=16) assert.ok(rendered.includes(LOGO_LINES[0]!.trimEnd()));
  }
  assert.match(headerText({...header,login:{kind:'signed-out'}},80),/当前未登录Bangumi账号/);
  assert.match(headerText({...header,login:{kind:'unverified',accountId:7,username:'saved-user',message:'断网'}},120),/当前Bangumi用户：saved-user（登录状态待核实）/);
  assert.ok(!headerText(header,120).includes(LOGO_LINES[0]!));
});
test('状态更新不重复Logo；超长及含控制序列的外部模型名和用户名安全换行', () => {
  const header:HeaderInfo={modelName:'fixture',modelLabel:'模型'.repeat(40)+'\u001b[2J',sessionId:'private-session',login:{kind:'signed-in',accountId:7,username:'用户名'.repeat(40)+'\u001b]0;title\u0007\n尾部'}};
  for(const width of [12,40,80]) {
    for(const compact of [false,true]) {
      const text=stripVTControlCharacters(renderToString(<Header info={header} width={width} compact={compact}/>,{columns:width}));
      for(const line of text.split('\n'))assert.ok(stringWidth(line)<=width,`${width}: ${line}`);
      assert.doesNotMatch(text,/private-session|\u001b|\u0007/);
      const flat=text.replace(/[ \n\u2800-\u28ff]/g,'');assert.ok(flat.includes('用户名'.repeat(40)+'尾部'));
      if(compact){assert.ok(!text.includes(LOGO_LINES[0]!.trimEnd()));assert.ok(!text.includes('MyBangumiAssistant'));}
    }
  }
});
test('Markdown表格在窄窗口转为逐项展示，数字、链接和完整长回答保留', () => {
  const source='**作品信息**\n\n| 作品 | 评分 |\n| --- | --- |\n| 很长的中文作品名称葬送的芙莉莲 | 8.71 |\n\n[条目来源](https://bgm.tv/subject/1)\n\n'+ '完整回答。'.repeat(120);
  const output=stripVTControlCharacters(renderToString(<Markdown text={source} width={28}/>,{columns:28}));
  assert.match(output,/评分：8\.71/);assert.match(output,/作品信息/);assert.ok(output.includes('https://bgm.tv/subject/1'));
  assert.equal(output.replace(/\n/g,'').match(/完整回答。/g)?.length,120);
  for(const line of output.split('\n'))assert.ok(stringWidth(line)<=28);
});
test('预览显示完整附带影响；成功、失败、未知和未开始分别展示', () => {
  const plan:OperationPlan={id:'hidden-id',digest:'digest',accountId:7,state:'pending',requiresConfirmation:true,reasons:['附带影响'],writeAvailable:true,
    actions:[{subjectId:1,title:'作品',kind:'collection',changes:[{field:'status',before:3,after:1}],effects:[{field:'rate',before:8,after:0}]}]};
  const text=planText(plan);assert.match(text,/在看 → 想看/);assert.match(text,/附带影响 评分：8 → 0/);assert.ok(!text.includes('hidden-id'));
  const results:OperationPlan={...plan,state:'finished',results:[{subjectId:1,state:'success'},{subjectId:2,state:'failed'},{subjectId:3,state:'unknown'},{subjectId:4,state:'not_started'}]};
  const output=stripVTControlCharacters(renderToString(<Transcript item={{id:1,kind:'plan',plan:results}} width={60}/>,{columns:60}));
  for(const label of ['回读验证成功','失败','结果未知','尚未开始'])assert.ok(output.includes(label));
});
test('外部文本的终端转义、凭据和动态令牌都被裁剪', () => {
  const output=displayText('\u001b[2J\u001b]0;改变标题\u0007正文 chii_auth=secretvalue123 https://bgm.tv/remove?gh=dynamictoken');
  assert.ok(!output.includes('\u001b'));assert.ok(!output.includes('secretvalue123'));assert.ok(!output.includes('dynamictoken'));assert.match(output,/正文/);
});
