import type { ReactNode } from 'react';
import type { ConfirmationView } from '../../../../../bangumi/src/web/protocol';
import { useActions, useAppSelector } from '../../../store/hooks';
import { ConfirmationCard } from '../conversation/ConfirmationCard';
import { Composer } from './Composer';

/**
 * 分支判定所需的全部输入。
 *
 * 分支只认这份快照，不去读闭包里的散变量：新增分支时只要能在这份输入上判定，
 * 就不需要再回主界面接线。
 */
interface SeatView {
  /** 宿主正在等待用户决定的写入预览；没有则为 null。 */
  pending: ConfirmationView | null;
  /**
   * 本条确认的应答请求是否在途：只用来禁用卡片上的动作按钮。
   *
   * 这里**不能用宿主的 `busy`**：写入确认只可能出现在工具执行期间，此时 `busy`
   * 恒为真，拿它当禁用条件会让确认按钮永远不会出现为可点。`busy` 也不参与接管
   * 判定——接管只看有没有 `pending`。
   */
  answering: boolean;
  onConfirm(id: string): void;
  onReject(id: string): void;
}

/** 一条接管形态：`match` 决定是否接管，`render` 给出接管后渲染的内容。 */
interface SeatBranch {
  /** 分支名：只用于阅读与调试时辨认是哪一条接管了输入区。 */
  name: string;
  match(view: SeatView): boolean;
  render(view: SeatView): ReactNode;
}

/**
 * 输入区座位的分支表，按优先级从上到下取第一个命中项；全部不命中则回退默认输入卡。
 *
 * 新增一种接管形态（例如另一种待决定卡片、登录提示卡）只需在这里加一项，判定流程
 * 与主界面都不用动。顺序即优先级，因此更「强」的接管形态要排在前面。
 */
const SEAT_BRANCHES: SeatBranch[] = [
  {
    name: 'confirmation',
    match: view => view.pending !== null,
    // match 与 render 成对定义：只有 match 命中的分支才会被调用，这里判空只为把
    // pending 收敛成非空类型，与上面的 match 条件保持一致。
    render: view => {
      const { pending } = view;
      if (pending === null) return null;
      return (
        <div className="cardSeat">
          <ConfirmationCard
            confirmation={pending}
            answering={view.answering}
            showActions
            onConfirm={view.onConfirm}
            onReject={view.onReject}
          />
        </div>
      );
    },
  },
];

/**
 * 输入区座位：决定「此刻输入位置该放什么」的唯一实现。
 *
 * 判定与渲染都收在这里：写入确认等接管形态由 `SEAT_BRANCHES` 按优先级匹配，未命中
 * 则渲染默认输入卡。调用方只负责把它挂到 `ConversationView` 的 `composer` 槽位，
 * 不再自己写 `pending ? 确认卡 : 输入卡` 这类分支。
 *
 * 输入卡挂载在唯一位置（`.composerSeat`），首屏与活动态只靠容器的 `data-phase`
 * 切换外观。原先首屏把同一个元素渲染在 `.heroStack`、活动态渲染在 `.composerSeat`，
 * 状态翻转会让 textarea 被卸载重建，输入焦点与 IME 组合态一起丢失。因此接管卡片
 * 必须替换 `.composerSeat` **内部**的内容，容器本身留在原地。
 */
export function ComposerSlot(): ReactNode {
  const actions = useActions();
  const pending = useAppSelector(state => state.stream.pending);
  const answering = useAppSelector(state => state.stream.answering);

  const view: SeatView = {
    pending,
    // 只有「当前这张卡」的在途应答才禁用按钮：换到新确认卡后旧的应答不该牵连它。
    answering: pending !== null && answering === pending.id,
    onConfirm: actions.confirm,
    onReject: actions.reject,
  };
  const branch = SEAT_BRANCHES.find(candidate => candidate.match(view));

  return (
    <div className="composerSeat">
      {branch ? branch.render(view) : <Composer />}
    </div>
  );
}
