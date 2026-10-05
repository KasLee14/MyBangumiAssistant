import { memo, type ReactNode } from 'react';

/**
 * 会话流里的原子行：用户气泡、提示行、错误行、会话头。
 *
 * 全部 props 驱动、全部 `memo`：流式期间宿主每 40ms 下发一帧状态，历史行的 props
 * 引用不变，这些行整块跳过重渲染。乐观回显（`pendingEcho`）也复用这里的 `UserBubble`，
 * 而不是在别处再写一份气泡样式。
 */

/** 用户消息气泡。 */
export const UserBubble = memo(function UserBubble({ text }: { text: string }): ReactNode {
  return (
    <div className="userRow">
      <div className="userStack">
        <div className="bubble">{text}</div>
      </div>
    </div>
  );
});

/** 普通提示行。 */
export const NoticeRow = memo(function NoticeRow({ text }: { text: string }): ReactNode {
  return <div className="noticeRow">{text}</div>;
});

/** 错误行：与 DSH 的轮次错误同一形态，只有状态点着色。 */
export const ErrorRow = memo(function ErrorRow({ text }: { text: string }): ReactNode {
  return (
    <div className="errorRow" role="status">
      <span className="stateDot" data-state="error" aria-hidden="true" />
      <span className="errorText">{text}</span>
    </div>
  );
});

/** 会话头横幅。 */
export const SessionBanner = memo(function SessionBanner({ text }: { text: string }): ReactNode {
  return <div className="sessionBanner">{text}</div>;
});
