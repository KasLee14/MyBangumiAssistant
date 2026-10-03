import { memo, useEffect, useState, type ReactNode } from 'react';
import { Markdown } from '../markdown';

/**
 * 会话流里的原子行：用户气泡、提示行、错误行、会话头。
 *
 * 这些行原先散在 `TurnView` 的 `BodyItem` 里，只有历史条目能用；抽出来是为了让
 * 「乐观回显」那条尚未被宿主确认的用户消息（见 `App` 的 `pendingEcho`）复用同一套
 * 形态，而不是在别处再写一份气泡样式。
 *
 * 全部 `memo`：流式期间宿主每 40ms 下发一帧状态，历史行的 props 引用不变，
 * 这些行整块跳过重渲染。
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

/* ---------------------------------------------------------------- 流式输出区 */

/**
 * 流式正文 / 思考 / 运行行。
 *
 * 拆成独立组件并逐块 `memo`，缩窄流式帧的更新范围：宿主每 40ms 合并下发一帧，
 * 原先每帧都让整个 `App`（含全部历史轮次）重渲染，现在只有真正变化的那一块会
 * 重渲染——`liveText` 变只重渲染正文，`liveThinking` 变只重渲染思考块，
 * 两者都没变的帧一个都不重渲染。
 */

/**
 * 「已运行 N 秒」。
 *
 * 计时精度取舍：用 500ms 而不是原来的 250ms。读数只显示整秒，500ms 足够让秒数
 * 变化看起来是即时的，而一整轮对话期间的重渲染次数减半。关键是这个定时器现在
 * 只更新自己这一小块，不再带着整棵会话树一起渲染。
 */
const Clock = memo(function Clock({ startedAt }: { startedAt: number }): ReactNode {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [startedAt]);
  return <span>{Math.max(0, Math.floor((now - startedAt) / 1000))}秒</span>;
});

/** 流式正文：只有 `text` 变化时才重新解析 Markdown。 */
const StreamingText = memo(function StreamingText({ text }: { text: string }): ReactNode {
  return (
    <div className="flowItem assistantRow">
      <div className="assistantBody">
        <div className="shimmer"><Markdown text={text} /></div>
      </div>
    </div>
  );
});

/** 流式思考：默认折叠，只有宿主下发了内容时才出现。 */
const ThinkingBlock = memo(function ThinkingBlock({ text }: { text: string }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <div className="thinkingBlock" data-open={open}>
      <button type="button" className="thinkingTitle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span>思考过程</span>
        <span className="count">{open ? '收起' : '展开'}</span>
      </button>
      {open ? <pre className="thinkingBody">{text}</pre> : null}
    </div>
  );
});

/** 本轮进行中的状态行：状态文案、已运行时长与停止提示。 */
const RunningRow = memo(function RunningRow({ status, cancelling, startedAt }: {
  status: string;
  cancelling: boolean;
  startedAt: number;
}): ReactNode {
  return (
    <div className="flowItem running">
      <span>{cancelling ? '正在停止；已发出的变更会先核查结果' : status}</span>
      <Clock startedAt={startedAt} />
      <span>· Esc 停止</span>
    </div>
  );
});

/** 流式区入口：三块各自 memo，互不牵连。 */
export function StreamingBlock({ liveText, liveThinking, busy, status, cancelling, startedAt }: {
  liveText: string;
  liveThinking: string;
  busy: boolean;
  status: string;
  cancelling: boolean;
  startedAt: number;
}): ReactNode {
  return (
    <>
      {liveText ? <StreamingText text={liveText} /> : null}
      {liveThinking ? <ThinkingBlock text={liveThinking} /> : null}
      {busy ? <RunningRow status={status} cancelling={cancelling} startedAt={startedAt} /> : null}
    </>
  );
}
