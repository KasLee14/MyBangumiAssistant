import type { ReactNode } from 'react';
import { Box, Text } from 'ink';
import type { OperationPlan } from '../../core/operations.js';
export function OperationView({plan,acknowledged,selected}: {plan:OperationPlan;acknowledged:boolean;selected:number}):ReactNode {
  return <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
    <Text bold>等待确认 · {plan.actions.length} 个作品</Text>
    <Text dimColor>{acknowledged ? '完整变更已展示在上方。←→ 选择，Enter 提交；也可直接输入“确认执行”或“取消”。' : '正在完整展示变更，展示完成后才能确认。'}</Text>
    <Text>{selected === 0 ? '› ' : '  '}取消{'    '}{selected === 1 ? '› ' : '  '}确认执行</Text>
  </Box>;
}
