import type { CommandOptionView } from '../../../bangumi/src/web/protocol';

/** 命令候选条目；本地命令带 action，后端命令只带 value。 */
export interface CommandHint {
  value: string;
  label: string;
  hint: string;
  /** 需要浏览器侧处理的动作；后端命令没有它，按原样提交给宿主。 */
  action?: 'help' | 'details' | 'exit' | 'model' | 'sessions' | 'new';
}

/**
 * 只有前端能做的事情才留在本地表：切换本地菜单、展开过程折叠块、提示关闭标签页。
 * 其余斜杠命令（登录、状态、扩展命令、提示模板、技能等）由宿主实现，
 * 名字与说明来自 CatalogView.commands，浏览器不维护副本。
 */
export const LOCAL_COMMANDS: CommandHint[] = [
  { value: '/help', label: '/help', hint: '查看可用命令', action: 'help' },
  { value: '/new', label: '/new', hint: '新建会话', action: 'new' },
  { value: '/model', label: '/model', hint: '打开设置里的模型与密钥', action: 'model' },
  { value: '/sessions', label: '/sessions', hint: '选择历史会话', action: 'sessions' },
  { value: '/details', label: '/details', hint: '展开或收起工具活动', action: 'details' },
  { value: '/exit', label: '/exit', hint: '关闭 Web 终端标签页', action: 'exit' },
];

/** 后端命令名转成斜杠写法；与本地命令同名时以本地实现为准（补全与执行都不重复）。 */
function backendCommand(command: CommandOptionView): CommandHint {
  const value = `/${command.name.replace(/^\/+/, '')}`;
  return { value, label: value, hint: command.description || command.source };
}

export function mergeCommands(commands: readonly CommandOptionView[]): CommandHint[] {
  const local = new Set(LOCAL_COMMANDS.map(command => command.value));
  const merged = [...LOCAL_COMMANDS];
  for (const command of commands) {
    const hint = backendCommand(command);
    if (!local.has(hint.value) && !merged.some(entry => entry.value === hint.value)) merged.push(hint);
  }
  return merged;
}

export function matchCommands(text: string, commands: readonly CommandHint[]): CommandHint[] {
  if (!/^\/[^\s]*$/.test(text)) return [];
  return commands.filter(command => command.value.startsWith(text));
}

/** 输入 /help 时的提示文本；命令清单随 catalog 动态变化。 */
export function helpText(commands: readonly CommandHint[]): string {
  const listed = commands.map(command => `${command.value}（${command.hint}）`).join('；');
  return `可用命令：${listed}。其它以 / 开头的输入会把原文交给宿主执行。`;
}
