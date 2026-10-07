import { useEffect } from 'react';
import { openStream, rememberSession } from '../utils/api';
import { connectionChanged, deltaReceived, frameReceived, streamFatal, sessionsUpdated } from './actions';
import { useStore } from 'react-redux';
import type { RootState, AppStore } from './index';
import type { AppAction } from './actions';
import { useAppDispatch } from './hooks';

/**
 * 订阅宿主事件流。
 *
 * 订阅的处理逻辑只有转发：标量覆盖、条目合并或整体替换的语义都在
 * `reducers/stream.ts` 里。事件源只在主界面挂载期间建立，卸载即关闭。
 */
export function useStreamSubscription(): void {
  const dispatch = useAppDispatch();
  const store = useStore<RootState, AppAction>() as AppStore;
  useEffect(() => openStream({
    onFrame: frame => {
      if (frame.type === 'fatal') { dispatch(streamFatal(frame.message)); return; }
      if (frame.type === 'sessions') { dispatch(sessionsUpdated(frame.sessions)); return; }
      // 增量帧与全量帧走不同的 action：全量帧整体覆盖（自愈），增量帧只累加。
      if (frame.type === 'stream') {
        dispatch(deltaReceived(frame));
        rememberSession(store.getState().stream.sessionId);
        return;
      }
      dispatch(frameReceived(frame));
      rememberSession(store.getState().stream.sessionId);
    },
    onStatus: connected => { dispatch(connectionChanged(connected)); },
  }), [dispatch, store]);
}
