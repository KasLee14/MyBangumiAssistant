import { memo, useEffect, useState, type ReactNode } from 'react';
import type { ActivityItemView, TranscriptItemView } from '../../../../../bangumi/src/web/protocol';
import type { TurnGroup } from '../../../utils/turns';
import { Markdown } from '../../content/markdown';
import { ConfirmationCard } from './ConfirmationCard';
import { ContentItem, type ContentItemView } from '../../content';
import { isContentKind } from '../../content/registry';
import { ErrorRow, NoticeRow, SessionBanner, UserBubble } from './MessageParts';

/**
 * 把平铺条目收窄成组件库能接收的联合类型。
 *
 * kind 清单只有一处来源（`content/registry.ts`）：原先这里内联了一份 `Set` 与
 * 注册表并存，两份定义会各自漂移。
 */
function isContentItem(item: TranscriptItemView): item is ContentItemView {
  return isContentKind(item.kind);
}

function Chevron({ className }: { className: string }): ReactNode {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 6.5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* 工具活动的三种状态：进行中不给勾叉，避免把未结束的调用读成成功。 */
const ACTIVITY_MARK: Record<ActivityItemView['state'], string> = { running: '·', ok: '✓', error: '×' };
const ACTIVITY_TEXT: Record<ActivityItemView['state'], string> = {
  running: '进行中',
  ok: '完成',
  error: '失败',
};

/**
 * 过程折叠块：这一轮的工具活动。
 *
 * 运行中的轮次默认展开，结束后可手动切换；reveal 由 /details 递增，
 * 每次递增都强制展开并保持后续手动切换可用。
 */
function ProcessGroup({ items, running, reveal }: { items: ActivityItemView[]; running: boolean; reveal: number }): ReactNode {
  const [open, setOpen] = useState(running);
  useEffect(() => { setOpen(running); }, [running]);
  useEffect(() => { if (reveal > 0) setOpen(true); }, [reveal]);
  return (
    <div className="processGroup" data-open={open}>
      <button type="button" className="processTitle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <Chevron className="chevron" />
        <span>处理过程</span>
        <span className="count">{items.length} 步</span>
      </button>
      {open ? (
        <div className="processBody">
          {items.map(item => (
            <div key={item.id} className="activityRow" data-state={item.state}>
              <span className="mark" aria-hidden="true">{ACTIVITY_MARK[item.state]}</span>
              <span>
                {item.label}（{ACTIVITY_TEXT[item.state]}）
                {item.state !== 'ok' && item.detail ? `：${item.detail}` : ''}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BodyItem({ item, onConfirm, onReject }: {
  item: TranscriptItemView;
  onConfirm(id: string): void;
  onReject(id: string): void;
}): ReactNode {
  if (item.kind === 'assistant') {
    return <div className="assistantRow"><div className="assistantBody"><Markdown text={item.text} /></div></div>;
  }
  if (item.kind === 'notice') return <NoticeRow text={item.text} />;
  if (item.kind === 'error') return <ErrorRow text={item.text} />;
  if (item.kind === 'header') return <SessionBanner text={item.text} />;
  // 会话里的确认条目是历史记录，动作只在接管输入区提供，因此没有应答在途一说。
  if (item.kind === 'confirmation') {
    return <ConfirmationCard confirmation={item.confirmation} answering={false} showActions={false} onConfirm={onConfirm} onReject={onReject} />;
  }
  // 内容条目：条目、统计、进度、表格等多样化展示，由组件库统一分派。
  if (isContentItem(item)) return <ContentItem item={item} />;
  return null;
}

/**
 * 一个轮次：用户消息、过程折叠块与主体内容。
 *
 * `memo`：流式期间宿主每帧下发新状态，`turns` 数组由 `ConversationView` 用
 * `useMemo` 固定引用，因此只有「正在流式的那一轮」与 `running`/`reveal`
 * 变化的轮次会重渲染，历史轮次整体跳过。`ProcessGroup` 的展开状态由 `running`
 * 与 `reveal` 驱动，这两个 prop 必须保留传递，否则 memo 会把折叠块冻结在旧状态。
 *
 * 这里**不接收 `busy`**：会话里的确认条目是历史记录、不显示动作按钮，确认为待确认
 * 那张卡（输入区）的按钮禁用只跟它自己的应答在途状态有关。多传一个 `busy` 会让
 * 每次忙碌状态翻转都把全部轮次重渲染一遍。
 */
export const TurnView = memo(function TurnView({ turn, running, reveal, onConfirm, onReject }: {
  turn: TurnGroup;
  running: boolean;
  reveal: number;
  onConfirm(id: string): void;
  onReject(id: string): void;
}): ReactNode {
  const process = turn.process.filter((item): item is ActivityItemView => item.kind === 'activity');
  return (
    <section className="flowItem" id={`turn-${turn.id}`} data-turn={turn.id}>
      <div className="turnStack">
        {turn.user ? <UserBubble text={turn.user.text} /> : null}
        {process.length ? <ProcessGroup items={process} running={running} reveal={reveal} /> : null}
        {turn.body.map(item => (
          <BodyItem key={item.id} item={item} onConfirm={onConfirm} onReject={onReject} />
        ))}
      </div>
    </section>
  );
});
