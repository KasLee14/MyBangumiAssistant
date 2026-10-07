import { memo, useEffect, useMemo, type ReactNode } from 'react';
import type { TurnItemView } from '../../../../../bangumi/src/web/protocol';
import type { ProcessItem } from '../../../utils/turns';
import { formatDuration, liveProcessTitle, processRowKey, settledProcessTitle, summarizeProcess } from '../../../utils/process';
import { ChevronIcon } from './ProcessIcons';
import { ProcessRow, useUntilFound } from './ProcessRows';

/**
 * 过程区：轮首的一行控制行 + 过程行列表。
 *
 * 与 DSH 的两级折叠相比这里只有**一级**：控制行既是状态行（活跃时「正在搜索 · 关键词」）
 * 也是整轮过程的开关，展开后就是过程行列表。之所以不照搬两级，是本项目一个轮次只对应
 * 一个过程组（宿主按用户回合切分），两级折叠在这里只是同一个开关的两种写法。
 *
 * 折叠同样用 `hidden="until-found"`：Ctrl+F 命中折叠的过程行时自动展开。
 */

/** 轮首控制行：状态 / 耗时 / 步骤计数，点它切换整轮过程。 */
export const TurnProcessBar = memo(function TurnProcessBar({ items, meta, running, open, onToggle, reveal }: {
  items: readonly ProcessItem[];
  /** 宿主下发的轮次条目；缺失时（协议外的形态）只显示按族汇总的标题。 */
  meta: TurnItemView | null;
  running: boolean;
  open: boolean;
  onToggle(open: boolean): void;
  /** `/details` 递增的展开计数：每次递增都强制展开（与改造前的行为一致）。 */
  reveal: number;
}): ReactNode {
  const summary = useMemo(() => summarizeProcess(items), [items]);
  useEffect(() => {
    if (reveal > 0) onToggle(true);
  }, [reveal, onToggle]);

  const stopped = meta !== null && meta.status === 'aborted';
  const failed = meta !== null && meta.status === 'error';
  const settled = meta !== null && meta.endedAt > meta.startedAt && !running;
  const title = running
    ? liveProcessTitle(summary)
    : settled
      ? `已完成，用时 ${formatDuration(meta.endedAt - meta.startedAt)}`
      : settledProcessTitle(summary);
  const headline = stopped ? '已停止' : failed ? '处理失败' : title;

  return (
    <div className="processBar" data-open={open} data-running={running} data-state={stopped ? 'aborted' : failed ? 'error' : running ? 'running' : 'ok'}>
      <button
        type="button"
        className="processBarTitle"
        aria-expanded={open}
        onClick={() => onToggle(!open)}
      >
        <ChevronIcon className="processChevron" />
        <span className="processBarText">{headline}</span>
        {/* 活跃时标题后补一句「按族汇总」的过程，让人知道这一步在做什么；结束时标题已经是耗时。 */}
        {running && summary.counts.length > 0 ? (
          <>
            <span className="processSep" aria-hidden="true" />
            <span className="processBarSummary">{settledProcessTitle(summary)}</span>
          </>
        ) : null}
        <span className="processBarCount">{summary.total} 步</span>
      </button>
    </div>
  );
});

/** 过程行列表；`open` 由控制行给，折叠时不卸载（`hidden="until-found"`，可被查找命中）。 */
export const ProcessGroup = memo(function ProcessGroup({ turn, items, open, openMap, onToggle, onToggleRow }: {
  turn: number;
  items: readonly ProcessItem[];
  open: boolean;
  /** 全局展开状态表（键由 `utils/process.ts` 的两个 helper 定义）。 */
  openMap: Readonly<Record<string, boolean>>;
  /** 整轮过程的开合：Ctrl+F 命中折叠行时用它把整轮展开。 */
  onToggle(open: boolean): void;
  onToggleRow(key: string, open: boolean): void;
}): ReactNode {
  const body = useUntilFound(open, () => onToggle(true));
  return (
    <div ref={body} className="processGroupBody" hidden={!open}>
      {items.map(item => {
        const key = processRowKey(turn, item.id);
        return (
          <ProcessRow
            key={item.id}
            item={item}
            open={openMap[key] === true}
            onToggle={next => onToggleRow(key, next)}
          />
        );
      })}
    </div>
  );
});
