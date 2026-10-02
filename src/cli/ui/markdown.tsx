import type { ReactNode } from 'react';
import { Box, Text } from 'ink';
import { marked, type Token, type Tokens } from 'marked';
import stringWidth from 'string-width';
import { displayText, wrapText } from './format.js';

function inline(tokens: readonly Token[]): ReactNode[] {
  return tokens.map((token, index) => {
    if (token.type === 'strong') return <Text key={index} bold>{inline((token as Tokens.Strong).tokens)}</Text>;
    if (token.type === 'em') return <Text key={index} italic>{inline((token as Tokens.Em).tokens)}</Text>;
    if (token.type === 'codespan') return <Text key={index} color="cyan">{displayText(token.text)}</Text>;
    if (token.type === 'link') {
      const link = token as Tokens.Link;
      const href = displayText(link.href);
      return <Text key={index} color="cyan">{inline(link.tokens)}{href !== link.text && /^https?:\/\//.test(href) ? ` (${href})` : ''}</Text>;
    }
    if (token.type === 'br') return '\n';
    if ('tokens' in token && Array.isArray(token.tokens)) return <Text key={index}>{inline(token.tokens)}</Text>;
    return displayText('text' in token && typeof token.text === 'string' ? token.text : token.raw);
  });
}
export function tableText(table: Tokens.Table, width: number): string {
  const headers = table.header.map(cell => displayText(cell.text));
  const rows = table.rows.map(row => row.map(cell => displayText(cell.text)));
  const widths = headers.map((header, col) => Math.max(stringWidth(header), ...rows.map(row => stringWidth(row[col] ?? ''))));
  if (widths.reduce((a,b) => a+b,0) + Math.max(0,widths.length-1)*3 > width) {
    return rows.map((row, index) => [`${index + 1}.`, ...headers.map((header,col) => `  ${header}：${row[col] ?? ''}`)].join('\n')).join('\n\n');
  }
  const format = (row: string[]) => row.map((cell,col) => cell + ' '.repeat(Math.max(0,widths[col]! - stringWidth(cell)))).join(' │ ');
  return [format(headers), widths.map(size => '─'.repeat(size)).join('─┼─'), ...rows.map(format)].join('\n');
}
/** 只渲染文本与样式；链接不执行，HTML 和外部控制序列没有终端语义。 */
export function Markdown({ text, width }: { text: string; width: number }): ReactNode {
  const tokens = marked.lexer(displayText(text));
  return <Box flexDirection="column">{tokens.map((token,index) => {
    if (token.type === 'space') return <Text key={index}> </Text>;
    if (token.type === 'heading') return <Text key={index} bold>{inline((token as Tokens.Heading).tokens)}</Text>;
    if (token.type === 'paragraph') return <Text key={index}>{inline((token as Tokens.Paragraph).tokens)}</Text>;
    if (token.type === 'table') return <Text key={index}>{tableText(token as Tokens.Table, width)}</Text>;
    if (token.type === 'list') {
      const list = token as Tokens.List;
      return <Box key={index} flexDirection="column">{list.items.map((item,i) => <Text key={i}>{list.ordered ? `${Number(list.start || 1)+i}. ` : '• '}{inline(marked.Lexer.lexInline(item.text))}</Text>)}</Box>;
    }
    if (token.type === 'code') return <Text key={index} dimColor>{wrapText((token as Tokens.Code).text,width).join('\n')}</Text>;
    if (token.type === 'blockquote') return <Box key={index} paddingLeft={1} borderLeft borderStyle="single" borderColor="gray"><Markdown text={(token as Tokens.Blockquote).text} width={Math.max(1,width-2)} /></Box>;
    if (token.type === 'hr') return <Text key={index} dimColor>{'─'.repeat(Math.max(1,width))}</Text>;
    return <Text key={index}>{displayText('text' in token && typeof token.text === 'string' ? token.text : token.raw)}</Text>;
  })}</Box>;
}
