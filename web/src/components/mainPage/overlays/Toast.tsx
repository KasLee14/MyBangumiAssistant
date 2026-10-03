import { useEffect, type ReactNode } from 'react';
import { useActions, useAppSelector } from '../../../store/hooks';
import { selectNotice } from '../../../store/selectors';

/** 提示条的停留时间；超时后由 store 的动作清空，提示因此不会永久留在屏幕上。 */
const NOTICE_MS = 4000;

/** 一次性提示（toast）：内容来自 store，出现即计时，过期自动清除。 */
export function Toast(): ReactNode {
  const actions = useActions();
  const notice = useAppSelector(selectNotice);

  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => { actions.dismissNotice(); }, NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice, actions]);

  return notice ? <div className="toast" role="status">{notice}</div> : null;
}
