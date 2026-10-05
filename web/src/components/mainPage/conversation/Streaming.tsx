import { memo, useEffect, useState, type ReactNode } from 'react';
import type { MessageBlock } from '../../../../../bangumi/src/web/protocol';
import { MessageBlocks } from '../../content/MessageBlocks';
import { TextType } from '../../motion/vendor/TextType';

/**
 * 流式区：正文、思考块与运行状态行。
 *
 * 三块各自 `memo`，缩窄流式帧的更新范围——宿主每 40ms 合并下发一帧，只有真正变化的那
 * 一块重渲染。正文走 `MessageBlocks`（与历史条目同一个渲染入口），文本块由宿主逐帧下发
 * 的真实文本渲染；光标只表达「还在写」，用 ReactBits 的 `TextType` 但不接管文本——
 * 传空字符串并关掉循环，它的打字逻辑因此不会启动，只保留那一段光标闪烁。
 *
 * 光标单独一行、挂在块序列末尾：Markdown 是块级元素插不进它的末行，而光标表达的是
 * 「这一轮还在写」，与最后一个块是文本还是内容块无关。
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

/** 流式正文：块序列 + 末尾光标。块内的重渲染由 `MessageBlocks` 的块级 memo 决定。 */
const LiveBlocks = memo(function LiveBlocks({ blocks }: { blocks: MessageBlock[] }): ReactNode {
  return (
    <div className="appStreaming">
      <div className="appStreamingBody">
        <MessageBlocks blocks={blocks} streaming />
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
export function Streaming({ liveContent, liveThinking, busy, status, cancelling, startedAt }: {
  liveContent: MessageBlock[];
  liveThinking: string;
  busy: boolean;
  status: string;
  cancelling: boolean;
  startedAt: number;
}): ReactNode {
  return (
    <>
      {liveContent.length > 0 ? <LiveBlocks blocks={liveContent} /> : null}
      {liveThinking ? <ThinkingBlock text={liveThinking} /> : null}
      {busy ? <RunningRow status={status} cancelling={cancelling} startedAt={startedAt} /> : null}
    </>
  );
}
