import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import type { ConfirmationView } from '../../../../../bangumi/src/web/protocol';
import { useActions, useAppSelector } from '../../../store/hooks';
import { ConfirmationCard } from '../conversation/ConfirmationCard';
import { DURATION, EASE_OUT, SHIFT } from '../../motion/motionTokens';
import { Composer } from './Composer';

/**
 * 输入区座位：决定「此刻输入位置该放什么」。
 *
 * 分支表只认一份快照，新增一种接管形态只加一项。接管卡的进入方式是一段从下方推入的
 * 过渡，让「输入卡被替换成确认卡」看起来是一次接管，而不是一次跳变。
 *
 * 输入卡挂载在唯一位置（`.appSeat`），首屏与活动态只靠容器的 `data-phase` 切换外观。
 * `key={sessionId}` 让切换会话时重建输入卡，清掉上一个会话的提交与补全状态；
 * 草稿本身在 store 里按会话保存，因此重建不会丢文字。
 */
interface SeatView {
  /** 宿主正在等待用户决定的写入预览；没有则为 null。 */
  pending: ConfirmationView | null;
  /**
   * 本条确认的应答请求是否在途：只用来禁用卡片上的动作按钮。
   *
   * 不能用宿主的 `busy`：写入确认只可能出现在工具执行期间，此时 `busy` 恒为真，
   * 拿它当禁用条件会让确认按钮永远不会出现为可点。
   */
  answering: boolean;
  onConfirm(id: string): void;
  onReject(id: string): void;
}

/** 一条接管形态：`match` 决定是否接管，`render` 给出接管后渲染的内容。 */
interface SeatBranch {
  name: string;
  match(view: SeatView): boolean;
  render(view: SeatView): ReactNode;
}

/** 座位分支表，按优先级从上到下取第一个命中项；全部不命中则回退默认输入卡。 */
const SEAT_BRANCHES: SeatBranch[] = [
  {
    name: 'confirmation',
    match: view => view.pending !== null,
    render: view => {
      const { pending } = view;
      if (pending === null) return null;
      return (
        <motion.div
          className="appCardSeat"
          initial={{ opacity: 0, y: SHIFT.panel }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DURATION.slow, ease: EASE_OUT }}
        >
          <ConfirmationCard
            confirmation={pending}
            answering={view.answering}
            showActions
            onConfirm={view.onConfirm}
            onReject={view.onReject}
          />
        </motion.div>
      );
    },
  },
];

export function ComposerSeat(): ReactNode {
  const actions = useActions();
  const pending = useAppSelector(state => state.stream.pending);
  const answering = useAppSelector(state => state.stream.answering);
  const sessionId = useAppSelector(state => state.stream.sessionId);

  const view: SeatView = {
    pending,
    // 只有「当前这张卡」的在途应答才禁用按钮：换到新确认卡后旧的应答不该牵连它。
    answering: pending !== null && answering === pending.id,
    onConfirm: actions.confirm,
    onReject: actions.reject,
  };
  const branch = SEAT_BRANCHES.find(candidate => candidate.match(view));

  return (
    <div className="appSeat">
      {branch ? branch.render(view) : <Composer key={sessionId} />}
    </div>
  );
}
