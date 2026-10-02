import type { ReactNode } from 'react';
import { Box, Text } from 'ink';
import type { HeaderInfo, TranscriptItem } from '../chat-controller.js';
import { loginText } from '../chat-controller.js';
import { MEDIA_LABELS } from '../../domain/bangumi.js';
import { displayText, planText, toolLabel, wrapText } from './format.js';
import { Markdown } from './markdown.js';
import { APP_NAME, APP_VERSION } from '../version.js';
import { LOGO_COLOR, LOGO_COLUMNS, LOGO_LINES } from './logo.js';

function headerFields(info: HeaderInfo): string[] {
  return [`当前模型：${info.modelLabel}`, loginText(info.login)]
    .map(text => displayText(text).replace(/[\r\n\t]+/g, ' '));
}
export function headerDetails(info: HeaderInfo): string {
  return headerFields(info).join(' ');
}
/** 普通文本输出只保留信息，避免盲文字符图或 ANSI 混入重定向输出。 */
export function headerText(info: HeaderInfo, width: number, compact = false): string {
  return (compact ? [headerDetails(info)] : [`${APP_NAME} v${APP_VERSION}`, ...headerFields(info)])
    .flatMap(row => wrapText(row, Math.max(2, width))).join('\n');
}
export function Header({info,width,compact = false}: { info: HeaderInfo; width: number; compact?: boolean }): ReactNode {
  const size = Math.max(2, width);
  const showLogo = !compact && size >= LOGO_COLUMNS;
  const horizontal = showLogo && size >= 48;
  const textWidth = horizontal ? size - LOGO_COLUMNS - 3 : size;
  return <Box flexDirection={horizontal ? 'row' : 'column'} width={size} alignItems={horizontal ? 'center' : 'flex-start'} marginBottom={1}>
    {showLogo && <Box width={LOGO_COLUMNS} flexShrink={0}><Text color={LOGO_COLOR}>{LOGO_LINES.join('\n')}</Text></Box>}
    <Box flexDirection="column" width={textWidth} marginLeft={horizontal ? 3 : 0} marginTop={showLogo && !horizontal ? 1 : 0}>
      {!compact && <Text bold>{APP_NAME}<Text bold={false} dimColor>{` v${APP_VERSION}`}</Text></Text>}
      {(compact ? [headerDetails(info)] : headerFields(info)).map((text,index) => <Text key={index} dimColor>{wrapText(text,textWidth).join('\n')}</Text>)}
    </Box>
  </Box>;
}
export function Transcript({ item, width }: { item: TranscriptItem; width: number }): ReactNode {
  if (item.kind === 'header') return <Header info={item.header} width={width} compact={item.compact ?? false} />;
  if (item.kind === 'user') return <Box marginBottom={1}><Text color="cyan" bold>› </Text><Text>{displayText(item.text)}</Text></Box>;
  if (item.kind === 'assistant') return <Box marginBottom={1}><Text color="green">• </Text><Box flexGrow={1} flexDirection="column" width={Math.max(1,width-2)}><Markdown text={item.text} width={Math.max(1,width-2)} /></Box></Box>;
  if (item.kind === 'notice' || item.kind === 'error') return <Box marginBottom={1}><Text color={item.kind === 'error' ? 'red' : 'yellow'}>{displayText(item.text)}</Text></Box>;
  if (item.kind === 'activity') return <Text dimColor={item.ok} {...(!item.ok ? {color:'red'} : {})}>{item.ok ? '✓' : '×'} {toolLabel(item.name)}{item.ok ? '' : `：${displayText(item.detail)}`}</Text>;
  if (item.kind === 'candidates') return <Box flexDirection="column" marginBottom={1}>
    <Text bold>作品候选</Text>
    {item.set.items.length ? item.set.items.map((candidate,index) => <Text key={candidate.id}>{index+1}. {displayText(candidate.title)} · {MEDIA_LABELS[candidate.type]} · #{candidate.id}</Text>) : <Text dimColor>没有找到作品。</Text>}
    <Text dimColor>可以说“第一项”或作品名；空输入框按 Tab 打开选择菜单。</Text>
  </Box>;
  if (item.kind === 'plan') return <Box flexDirection="column" borderStyle="round" borderColor={item.plan.results
    ? item.plan.results.some(result=>result.state==='unknown') ? 'yellow' : item.plan.results.some(result=>result.state==='failed') ? 'red' : item.plan.results.every(result=>result.state==='success') ? 'green' : 'gray'
    : 'yellow'} paddingX={1} marginBottom={1}>
    <Text bold>{item.plan.results ? '变更结果' : item.plan.requiresConfirmation ? '待确认变更' : '变更预览'}</Text>
    <Text>{planText(item.plan)}</Text>
  </Box>;
  return null;
}
