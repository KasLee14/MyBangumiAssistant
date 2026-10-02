import type { ReactNode } from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';
import { displayText, wrapText } from './format.js';
export interface MenuOption { label: string; value: string; selection?: { setId: string; subjectId: number } }
/** 命令候选始终与输入框同时可用；窄窗口先保留完整命令名。 */
export function CommandPicker({options,selected,width,height}: {options:readonly MenuOption[];selected:number;width:number;height:number}):ReactNode {
  const hint = wrapText(width < 38 ? '↑↓ · Tab · Enter' : '↑↓ 选择 · Tab 补全 · Enter 执行',width);
  const count = Math.max(1,Math.min(6,height-1-hint.length));
  const start = Math.max(0,Math.min(selected-Math.floor(count/2),options.length-count));
  return <Box flexDirection="column">
    <Text bold>聊天命令{width >= 24 && options.length > count ? ` · ${selected+1}/${options.length}` : ''}</Text>
    {options.slice(start,start+count).map((option,index) => {
      const prefix = `${start+index === selected ? '›' : ' '} ${option.value}`;
      const remaining = width-stringWidth(prefix)-2;
      const description = displayText(option.label.slice(option.value.length).trim());
      let summary = '';
      if (remaining > 1) {
        if (stringWidth(description) <= remaining) summary = description;
        else {
          let size = 0;
          for (const {segment} of new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(description)) {
            const next = stringWidth(segment); if (size+next > remaining-1) break;
            summary += segment; size += next;
          }
          summary += '…';
        }
      }
      return <Text key={option.value} {...(start+index === selected ? {color:'cyan'} : {})}>{prefix}{summary ? `  ${summary}` : ''}</Text>;
    })}
    <Text dimColor>{hint.join('\n')}</Text>
  </Box>;
}
export function Picker({title,options,selected,height}: {title:string;options:readonly MenuOption[];selected:number;height:number}):ReactNode {
  const count = Math.max(1,height-4); const start = Math.max(0,Math.min(selected-Math.floor(count/2),options.length-count));
  return <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
    <Text bold>{title}</Text>
    {options.slice(start,start+count).map((option,index) => <Text key={index} {...(start+index === selected ? {color:'cyan'} : {})}>{start+index === selected ? '› ' : '  '}{displayText(option.label)}</Text>)}
    <Text dimColor>↑↓ 选择 · Enter 确定 · Esc 返回{options.length > count ? ` · ${selected+1}/${options.length}` : ''}</Text>
  </Box>;
}
