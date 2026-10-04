import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import type { ConfirmationView } from '../../../../../bangumi/src/web/protocol';
import { useActions, useAppSelector } from '../../../store/hooks';
import { ConfirmationCard } from '../../mainPage/conversation/ConfirmationCard';
import { V2_DURATION, V2_EASE_OUT, V2_SHIFT } from '../../motion/motionTokens';
import { ComposerV2 } from './ComposerV2';

/**
 * v2 输入区座位：决定「此刻输入位置该放什么」。
 *
 * 结构与 v1 的 `ComposerSlot` 同构（同一张分支表、同一份判定输入、同一条优先级规则：
 * 新增一种接管形态只加一项），差别在接管卡的进入方式——v2 用 motion 把它从下方
 * 推入，让「输入卡被替换成确认卡」这件事看起来是一次接管，而不是一次跳变。
 *
 * 接管卡片本身仍复用共享的 `ConfirmationCard`（props 驱动），两版的确认语义因此
 * 只有一处实现。
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
          className="v2CardSeat"
          initial={{ opacity: 0, y: V2_SHIFT.panel }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: V2_DURATION.slow, ease: V2_EASE_OUT }}
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

export function ComposerSeatV2(): ReactNode {
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
    <div className="v2Seat">
      {branch ? branch.render(view) : <ComposerV2 key={sessionId} />}
    </div>
  );
}
