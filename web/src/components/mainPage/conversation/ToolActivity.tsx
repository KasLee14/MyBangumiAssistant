import { Fragment, type ReactNode } from 'react';
import type { ActivityItemView } from '../../../../../bangumi/src/web/protocol';

const ACTIVITY: Record<ActivityItemView['state'], { mark: string; label: string }> = {
  running: { mark: '·', label: '进行中' }, waiting: { mark: '…', label: '额度等待' },
  ok: { mark: '✓', label: '完成' }, partial: { mark: '!', label: '未全部完成' },
  unknown: { mark: '?', label: '结果待核实' }, error: { mark: '×', label: '失败' },
};

/** 两种外观共用活动语义；批次计数与每项缺口来自宿主的中文投影。 */
export function ToolActivity({ item }: { item: ActivityItemView }): ReactNode {
  const status = ACTIVITY[item.state];
  const showDetail = Boolean(item.detail && (item.showDetail || item.state !== 'ok'));
  return (
    <div className="activityRow" data-state={item.state}>
      <span className="mark" aria-hidden="true">{status.mark}</span>
      <span>
        {item.label}（{status.label}）
        {showDetail ? item.detail.split('\n').map((text, index) => (
          <Fragment key={index}>{index === 0 ? '：' : <br />}{text}</Fragment>
        )) : null}
      </span>
    </div>
  );
}
