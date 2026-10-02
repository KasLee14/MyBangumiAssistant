import type { ReactNode } from 'react';
import { Box, Text } from 'ink';
import type { PromptEditor } from './editor.js';
import { wrapText } from './format.js';
export function Composer({editor,width,height,busy}: {editor:PromptEditor;width:number;height:number;busy:boolean}):ReactNode {
  const lines = wrapText(editor.before+'▏'+editor.after,Math.max(1,width-6));
  const cursorLine = wrapText(editor.before+'▏',Math.max(1,width-6)).length-1;
  const count = Math.max(1,height); const start = Math.max(0,Math.min(cursorLine-Math.floor(count/2),lines.length-count));
  return <Box flexDirection="column" borderStyle="round" borderColor={busy ? 'gray' : 'cyan'} paddingX={1}>
    <Text>{lines.slice(start,start+count).map((line,index) => `${index === 0 ? '› ' : '  '}${line}`).join('\n')}</Text>
  </Box>;
}
