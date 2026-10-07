import { memo, type ReactNode } from 'react';
import type { TranscriptItemView } from '../../../../../bangumi/src/web/protocol';
import type { TurnGroup } from '../../../utils/turns';
import { turnProcessKey } from '../../../utils/process';
import { MessageBlocks } from '../../content/MessageBlocks';
import { isBaseTranscriptKind } from '../../content/registry';
import { ConfirmationCard } from './ConfirmationCard';
import { ErrorRow, NoticeRow, SessionBanner, UserBubble } from './MessageParts';
import { ProcessGroup, TurnProcessBar } from './ProcessGroup';
import { TurnActions } from './TurnActions';

/**
 * 一个轮次。
 *
 * 结构（自上而下）：用户气泡 → 过程区（控制行 + 过程行）→ 主体（正文、通知、错误、确认卡）
 * → 轮尾操作行。**过程与主体的边界来自宿主**：`projectTurns` 按宿主下发的轮次条目切分，
 * 这里只负责把 `turn.process` 与 `turn.body` 各自交给对应的组件。
 *
 * 复用共享的原子行（`UserBubble` / `NoticeRow` / `ErrorRow` / `SessionBanner`）与共享的
 * `MessageBlocks`（助手正文的唯一渲染入口）。
 *
 * 进入动效：助手正文里的**内容块**数量少、体积大，交给 `MessageBlocks` 用 ReactBits 的
 * `AnimatedContent` 做滚动触发（流式期不挂，见该组件注释）；工具结果的展开体不挂（展开是
 * 显式动作，元素已在视口内）。
 *
 * 轮次这一层**不做视口入场**（试过，已撤）：会话区开着 `content-visibility: auto` 屏外优化，
 * 屏外轮次在**挂载那一瞬高度为 0**，于是「是否已在视口内」无法在挂载时判定——判据会把所有轮次
 * 都算成可见，入场永不触发。要在这里做就得等 Stage 的贴底滚动稳定（约 120ms 之后），
 * 而那时首屏内容已经显示，反而变成「先可见再淡出」。
 * 视口入场因此放在布局稳定的列表上（见 `page/library/Overview.tsx` 的卡片网格），
 * 共享观察器仍然是 `utils/revealOnScroll.ts` 那一个。
 *
 * `memo` 的理由：流式期间 `turns` 引用稳定，只有正在流式的那一轮与
 * `running`/`reveal`/展开状态变化的轮次会重渲染。
 */

/**
 * 已经告警过的未知条目 kind。
 *
 * 宿主下发未知条目 kind 时界面什么都不显示，开发期必须能发现这件事；但一轮渲染里同一条会
 * 反复走到这里（流式期间 `Turn` 会随所在轮次重渲染），所以同一个 kind 只报一次。
 * 注意这只针对**条目**层——内容块层的未知 type 由 `ContentBlock` 告警。
 */
const warnedKinds = new Set<string>();

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
  // 过程行（思考 / 工具）由 `Turn` 在这一层分走，不该走到这里；真走到了说明分组遗漏。
  // 走到这里的是本组件库不认识的条目 kind：宿主下发了协议之外的形态。丢弃是刻意的
  // （未知类型没有可依据的语义），但告警必须在这里补——否则宿主映射写错时界面只是"什么都
  // 没有"，永远没人发现。
  if (!isBaseTranscriptKind(item.kind) && !warnedKinds.has(item.kind)) {
    warnedKinds.add(item.kind);
    console.warn(`[content] 未登记的条目 kind「${item.kind}」，该条目已丢弃。`);
  }
  return null;
}

export const Turn = memo(function Turn({
  turn, running, reveal, hideAssistant = false,
  openMap, onToggleProcess, onToggleRow, onConfirm, onReject,
}: {
  turn: TurnGroup;
  running: boolean;
  reveal: number;
  /**
   * 收尾播放期间为真：这一轮的助手正文正由流式区逐字显示，条目这里**不能**再渲染一份
   * （流式区与历史条目是同一个渲染入口，同时出现就是屏幕上两份同样的回答）。
   */
  hideAssistant?: boolean;
  /** 过程区的展开状态表（键见 `utils/process.ts`）；引用稳定时本组跳过重渲染。 */
  openMap: Readonly<Record<string, boolean>>;
  onToggleProcess(key: string, open: boolean): void;
  onToggleRow(key: string, open: boolean): void;
  onConfirm(id: string): void;
  onReject(id: string): void;
}): ReactNode {
  const body = hideAssistant ? turn.body.filter(item => item.kind !== 'assistant') : turn.body;
  const key = turnProcessKey(turn.turn);
  /**
   * 整轮过程的默认开合：**进行中的轮展开，历史轮折叠**（对齐 DSH 的默认呈现）。
   * `openMap[key]` 有值时一律以用户的显式选择为准——`false` 表示"用户主动折过"，
   * 不能被默认值覆盖，否则进行中的轮会被重新拉开。
   */
  const recorded = openMap[key];
  const processOpen = recorded === undefined ? running : recorded;
  return (
    <section className="appTurn" id={`turn-${turn.id}`} data-turn={turn.id} data-turn-index={turn.turn}>
      <div className="appTurnStack">
        {turn.user ? <div className="appRow"><UserBubble text={turn.user.text} /></div> : null}
        {turn.process.length > 0 ? (
          <div className="appRow processRow">
            <TurnProcessBar
              items={turn.process}
              meta={turn.meta}
              running={running}
              open={processOpen}
              onToggle={next => onToggleProcess(key, next)}
              reveal={reveal}
            />
            <ProcessGroup
              turn={turn.turn}
              items={turn.process}
              open={processOpen}
              openMap={openMap}
              onToggle={next => onToggleProcess(key, next)}
              onToggleRow={onToggleRow}
            />
          </div>
        ) : null}
        {body.map(item => (
          <BodyItem key={item.id} item={item} onConfirm={onConfirm} onReject={onReject} />
        ))}
        {/* 收尾播放期间这一轮由流式区独占，操作行也跟着让位，避免出现又消失。 */}
        {hideAssistant ? null : <TurnActions turn={turn} />}
      </div>
    </section>
  );
});
