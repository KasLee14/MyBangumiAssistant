import { memo, useEffect, useState, type ReactNode } from 'react';
import type { ActivityItemView, TranscriptItemView } from '../../../../../bangumi/src/web/protocol';
import type { TurnGroup } from '../../../utils/turns';
import { Markdown } from '../../content/markdown';
import { ContentItem, type ContentItemView } from '../../content';
import { isContentKind } from '../../content/registry';
import { ConfirmationCard } from './ConfirmationCard';
import { ErrorRow, NoticeRow, SessionBanner, UserBubble } from './MessageParts';
import { ToolActivity } from './ToolActivity';
import { AnimatedContent } from '../../motion/vendor/AnimatedContent';

/**
 * 一个轮次。
 *
 * 复用共享的原子行（`UserBubble` / `NoticeRow` / `ErrorRow` / `SessionBanner`）、
 * 共享的 `Markdown`、共享的内容条目分派（`ContentItem`）与共享的确认卡。
 *
 * 进入动效：内容条目（条目卡、统计、进度、表格这类整块）数量少、体积大，交给
 * ReactBits 的 `AnimatedContent` 做滚动触发。轮次与普通行目前**没有**入场动画——
 * 逐行动画要付出 JS 开销与每节点观察器，收益不抵成本。
 *
 * `memo` 的理由：流式期间 `turns` 引用稳定，只有正在流式的那一轮与
 * `running`/`reveal` 变化的轮次会重渲染。
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
    return <div className="appRow assistantRow"><div className="assistantBody"><Markdown text={item.text} /></div></div>;
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
  // 内容条目：交给共享的组件库分派，入场由 `AnimatedContent` 按滚动位置触发。
  // 为什么要单独走 JS 动画：这些块比普通行大得多（表格、卡片组、图表），「进入视口
  // 那一刻」才开始更合适；而它们的数量远少于行数（一轮通常 0–2 块），不会像逐行那样
  // 给会话流挂上几百个 ScrollTrigger。
  if (isContentItem(item)) {
    return (
      <AnimatedContent
        // scroller 必须指向真正的滚动容器：不传的话它会先找 `#snap-main-container`、
        // 再退到 `window`，而这里的滚动发生在 `.appStageScroll` 内，用 window 永远触发不到，
        // 元素会因为初始 `visibility: hidden` 而一直不可见。
        container="#app-stage-scroll"
        distance={16}
        duration={0.35}
        ease="power2.out"
        threshold={0.05}
      >
        <ContentItem item={item} />
      </AnimatedContent>
    );
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
