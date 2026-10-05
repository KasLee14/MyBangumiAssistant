import { useEffect, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useActions, useAppSelector } from '../../../store/hooks';
import { selectNotice } from '../../../store/selectors';
import { DURATION, EASE_OUT, SHIFT } from '../../motion/motionTokens';

/** 提示条的停留时间；超时后由 store 的动作清空，提示因此不会永久留在屏幕上。 */
const NOTICE_MS = 4000;

/**
 * 一次性提示（toast）：内容来自 store，出现即计时，过期自动清除。
 *
 * 用 `AnimatePresence` 把「消失」也做成一段过渡，因此提示不会硬切掉。
 */
export function Toast(): ReactNode {
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
          className="appToast"
          role="status"
          initial={{ opacity: 0, y: SHIFT.panel, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: SHIFT.row, scale: 0.99 }}
          transition={{ duration: DURATION.base, ease: EASE_OUT }}
        >
          {notice}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
