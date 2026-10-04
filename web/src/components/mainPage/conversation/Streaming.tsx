import { memo, useEffect, useState, type ReactNode } from 'react';
import { Markdown } from '../../content/markdown';
import { TextType } from '../../motion/vendor/TextType';

/**
 * 流式区：正文、思考块与运行状态行。
 *
 * 三块各自 `memo`，缩窄流式帧的更新范围——宿主每 40ms 合并下发一帧，只有真正变化的那
 * 一块重渲染。正文用**真实文本 + 一个呼吸光标**：文本由宿主逐帧下发，光标只表达
 * 「还在写」；光标用 ReactBits 的 `TextType` 但不接管文本——传空字符串并关掉循环，
 * 它的打字逻辑因此不会启动，只保留那一段光标闪烁。
 */

/** 「已运行 N 秒」：500ms 精度，读数只显示整秒。 */
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
const LiveText = memo(function LiveText({ text }: { text: string }): ReactNode {
  return (
    <div className="appStreaming">
      <div className="appStreamingBody">
        <Markdown text={text} />
        {/* 光标单独一行：Markdown 是块级元素，插不进它的末行；这一行只占极小高度。 */}
        <span className="appStreamingCursorRow">
          <TextType
            as="span"
            text=""
            loop={false}
            showCursor
            cursorCharacter="▍"
            cursorClassName="appStreamingCursor"
            cursorBlinkDuration={0.5}
            className="appStreamingCursorHolder"
            aria-hidden="true"
          />
        </span>
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
    <div className="running">
      <span>{cancelling ? '正在停止；已发出的变更会先核查结果' : status}</span>
      <Clock startedAt={startedAt} />
      <span>· Esc 停止</span>
    </div>
  );
});

/** 流式区入口。 */
export function Streaming({ liveText, liveThinking, busy, status, cancelling, startedAt }: {
  liveText: string;
  liveThinking: string;
  busy: boolean;
  status: string;
  cancelling: boolean;
  startedAt: number;
}): ReactNode {
  return (
    <>
      {liveText ? <LiveText text={liveText} /> : null}
      {liveThinking ? <ThinkingBlock text={liveThinking} /> : null}
      {busy ? <RunningRow status={status} cancelling={cancelling} startedAt={startedAt} /> : null}
    </>
  );
}
