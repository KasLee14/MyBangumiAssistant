import { memo, useEffect, useState, type ReactNode } from 'react';
import type { ActivityItemView, TranscriptItemView } from '../../../../../bangumi/src/web/protocol';
import type { TurnGroup } from '../../../utils/turns';
import { MessageBlocks } from '../../content/MessageBlocks';
import { isBaseTranscriptKind } from '../../content/registry';
import { ConfirmationCard } from './ConfirmationCard';
import { ErrorRow, NoticeRow, SessionBanner, UserBubble } from './MessageParts';
import { ToolActivity } from './ToolActivity';

/**
 * 一个轮次。
 *
 * 复用共享的原子行（`UserBubble` / `NoticeRow` / `ErrorRow` / `SessionBanner`）、共享的
 * `MessageBlocks`（助手正文的唯一渲染入口，与流式区同一个）与共享的确认卡。
 *
 * 进入动效：助手正文里的**内容块**数量少、体积大，交给 `MessageBlocks` 用 ReactBits 的
 * `AnimatedContent` 做滚动触发（流式期不挂，见该组件注释）。轮次与普通行仍然**没有**入场
 * 动画——逐行动画要付出 JS 开销与每节点观察器，收益不抵成本。
 *
 * `memo` 的理由：流式期间 `turns` 引用稳定，只有正在流式的那一轮与
 * `running`/`reveal` 变化的轮次会重渲染。
 */

/**
 * 已经告警过的未知条目 kind。
 *
 * 宿主下发未知条目 kind 时界面什么都不显示，开发期必须能发现这件事；但一轮渲染里同一条会
 * 反复走到这里（流式期间 `Turn` 会随所在轮次重渲染），所以同一个 kind 只报一次。
 * 注意这只针对**条目**层——内容块层的未知 type 由 `ContentBlock` 告警。
 */
const warnedKinds = new Set<string>();

function Chevron({ className }: { className: string }): ReactNode {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 6.5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 过程折叠块：`reveal` 语义与展开默认值与共享渲染器一致，只有排布在外壳这一层决定。 */
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
          {items.map(item => <ToolActivity key={item.id} item={item} />)}
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
  // 每一行包一层 `.appRow`：它是行的结构钩子，让样式层可以按行定位（目前无自有规则），
  // 共享渲染器本身一个字节都不用改。
  if (item.kind === 'assistant') {
    return (
      <div className="appRow assistantRow">
        <div className="assistantBody">
          <MessageBlocks blocks={item.content} />
        </div>
      </div>
    );
  }
  if (item.kind === 'notice') return <div className="appRow"><NoticeRow text={item.text} /></div>;
  if (item.kind === 'error') return <div className="appRow"><ErrorRow text={item.text} /></div>;
  if (item.kind === 'header') return <div className="appRow"><SessionBanner text={item.text} /></div>;
  // 会话里的确认条目是历史记录，动作只在接管输入区提供，因此没有应答在途一说。
  // 待授权的历史条目由 `ConfirmationCard` 自己隐藏（只在输入区呈现一次）。
  if (item.kind === 'confirmation') {
    return (
      <div className="appRow">
        <ConfirmationCard confirmation={item.confirmation} answering={false} showActions={false} onConfirm={onConfirm} onReject={onReject} />
      </div>
    );
  }
  // 走到这里说明这条不是本组件库认识的条目 kind：宿主下发了协议之外的形态。丢弃是刻意的
  // （未知类型没有可依据的语义），但告警必须在这里补——否则宿主映射写错时界面只是"什么都
  // 没有"，永远没人发现。
  if (!isBaseTranscriptKind(item.kind) && !warnedKinds.has(item.kind)) {
    warnedKinds.add(item.kind);
    console.warn(`[content] 未登记的条目 kind「${item.kind}」，该条目已丢弃。`);
  }
  return null;
}

export const Turn = memo(function Turn({ turn, running, reveal, onConfirm, onReject }: {
  turn: TurnGroup;
  running: boolean;
  reveal: number;
  onConfirm(id: string): void;
  onReject(id: string): void;
}): ReactNode {
  const process = turn.process.filter((item): item is ActivityItemView => item.kind === 'activity');
  return (
    <section className="appTurn" id={`turn-${turn.id}`} data-turn={turn.id}>
      <div className="appTurnStack">
        {turn.user ? <div className="appRow"><UserBubble text={turn.user.text} /></div> : null}
        {process.length ? <div className="appRow"><ProcessGroup items={process} running={running} reveal={reveal} /></div> : null}
        {turn.body.map(item => (
          <BodyItem key={item.id} item={item} onConfirm={onConfirm} onReject={onReject} />
        ))}
      </div>
    </section>
  );
});
