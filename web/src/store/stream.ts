import { useEffect } from 'react';
import { openStream } from '../utils/api';
import { connectionChanged, frameReceived, streamFatal } from './actions';
import { useAppDispatch } from './hooks';

/**
 * 订阅宿主事件流。
 *
 * 订阅的处理逻辑只有转发：标量覆盖、条目合并或整体替换的语义都在
 * `reducers/stream.ts` 里。事件源只在主界面挂载期间建立，卸载即关闭。
 */
export function useStreamSubscription(): void {
  const dispatch = useAppDispatch();
  useEffect(() => openStream({
    onFrame: frame => {
      if (frame.type === 'fatal') { dispatch(streamFatal(frame.message)); return; }
      dispatch(frameReceived(frame));
    },
    onStatus: connected => { dispatch(connectionChanged(connected)); },
  }), [dispatch]);
}
