import { useEffect, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useActions, useAppSelector } from '../../../store/hooks';
import { selectNotice } from '../../../store/selectors';
import { V2_DURATION, V2_EASE_OUT, V2_SHIFT } from '../../motion/motionTokens';

/** 停留时间与 v1 一致：提示的生命周期是行为，不是外观。 */
const NOTICE_MS = 4000;

/**
 * v2 提示条：进出都走动效。
 *
 * 与 v1 的 `Toast` 是两份实现（v1 是出现即渲染、卸载即消失），差别只在过渡：
 * 这里用 `AnimatePresence` 把「消失」也做成一段过渡，因此提示不会硬切掉。
 * 停留时长、清空时机、`role="status"` 都与 v1 保持一致——这三条是行为，不是外观。
 */
export function ToastV2(): ReactNode {
  const actions = useActions();
  const notice = useAppSelector(selectNotice);

  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => { actions.dismissNotice(); }, NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice, actions]);

  return (
    <AnimatePresence>
      {notice ? (
        <motion.div
          className="v2Toast"
          role="status"
          initial={{ opacity: 0, y: V2_SHIFT.panel, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: V2_SHIFT.row, scale: 0.99 }}
          transition={{ duration: V2_DURATION.base, ease: V2_EASE_OUT }}
        >
          {notice}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
