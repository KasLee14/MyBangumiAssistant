import { memo, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { ReasoningItemView, ToolItemView } from '../../../../../bangumi/src/web/protocol';
import { MessageBlocks } from '../../content/MessageBlocks';
import { firstLine } from '../../../utils/process';
import type { ProcessItem } from '../../../utils/turns';
import { TOOL_STATE, toolBodyKind, toolExpandable } from '../../../utils/toolViews';
import { ChevronIcon, ProcessIcon, ReasoningIcon } from './ProcessIcons';

/**
 * 过程区的两种原子行：思考行与工具行。
 *
 * 与 `MessageParts` 同类：props 驱动、`memo`、展开状态由调用方传入（状态在 `ui.processOpen`，
 * 组件不读 store——见 `web/AGENTS.md` 跨层约束第 1 条）。
 *
 * **折叠用 `hidden="until-found"` 而不是条件渲染**：浏览器 Ctrl+F 命中折叠内容时会触发
 * `beforematch`，我们把「展开」交回调用方，于是「折叠」不等于「搜不到」。
 */

/**
 * 折叠容器的 `hidden="until-found"` 维护。
 *
 * 为什么不用 JSX 的 `hidden` 属性：React 把它当布尔属性处理，传字符串只会写成 `hidden=""`，
 * 丢掉 `until-found` 这个值（那正是「可被查找命中」的关键）。所以首帧给布尔 `hidden`（先藏住，
 * 避免折叠内容闪一下），挂载后换成 `until-found`。
 */
export function useUntilFound(open: boolean, onReveal: () => void): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  // 回调每次渲染都是新引用，用 ref 转存，避免反复摘挂监听。
  const reveal = useRef(onReveal);
  reveal.current = onReveal;
  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    if (open) node.removeAttribute('hidden');
    else node.setAttribute('hidden', 'until-found');
  }, [open]);
  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    const handler = (): void => reveal.current();
    node.addEventListener('beforematch', handler);
    return () => node.removeEventListener('beforematch', handler);
  }, []);
  return ref;
}

/** 思考行：图标 + 「思考」+ 摘要；展开后是等宽原文。 */
export const ReasoningRow = memo(function ReasoningRow({ item, open, onToggle }: {
  item: ReasoningItemView;
  open: boolean;
  onToggle(open: boolean): void;
}): ReactNode {
  const running = item.state === 'running';
  const summary = firstLine(item.text, 80);
  const body = useUntilFound(open, () => onToggle(true));
  return (
    <div className="reasoningRow" data-open={open} data-state={running ? 'running' : 'ok'}>
      <button
        type="button"
        className="processRowTitle"
        aria-expanded={open}
        onClick={() => onToggle(!open)}
      >
        <ReasoningIcon className="processIcon" />
        <span className="processLabel">思考</span>
        {!open && summary ? (
          <>
            <span className="processSep" aria-hidden="true" />
            <span className="processSummary">{summary}</span>
          </>
        ) : null}
        <ChevronIcon className="processChevron" />
      </button>
      <div ref={body} className="reasoningBody" hidden={!open}>
        <pre className="reasoningText">{item.text}</pre>
      </div>
    </div>
  );
});

/** 按条目类型分发到思考行或工具行。 */
export const ProcessRow = memo(function ProcessRow({ item, open, onToggle }: {
  item: ProcessItem;
  open: boolean;
  onToggle(open: boolean): void;
}): ReactNode {
  return item.kind === 'reasoning'
    ? <ReasoningRow item={item} open={open} onToggle={onToggle} />
    : <ToolRow item={item} open={open} onToggle={onToggle} />;
});

/** 行内文本的最大行数：批次写入的进度与缺口要看得见，但不能把过程区撑成一屏。 */
const INLINE_LINE_LIMIT = 6;

/** 结果文本压成最多 `INLINE_LINE_LIMIT` 行，超出明确标注截断。 */
function inlineLines(text: string): string {
  const lines = text.split('\n');
  if (lines.length <= INLINE_LINE_LIMIT) return text;
  return `${lines.slice(0, INLINE_LINE_LIMIT).join('\n')}\n…（还有 ${lines.length - INLINE_LINE_LIMIT} 行）`;
}

/** 一个工具的结果体：内容块走共享渲染入口，纯文本走等宽兜底。 */
function ToolResultBody({ item }: { item: ToolItemView }): ReactNode {
  const kind = toolBodyKind(item);
  const result = item.result;
  if (result === undefined || kind === 'empty') return <div className="toolEmpty">暂无结果。</div>;
  return (
    <>
      {result.errorText !== undefined && result.isError ? (
        <div className="toolError" role="status">{result.errorText}</div>
      ) : null}
      {kind === 'blocks' ? (
        <div className="toolResult">
          {/* 展开是用户的显式动作，元素已在视口内：不挂滚动入场动画（见 MessageBlocks 的 animate）。 */}
          <MessageBlocks blocks={result.blocks} animate={false} />
        </div>
      ) : null}
      {kind === 'text' && result.text !== undefined ? (
        <pre className="toolText">{result.text}</pre>
      ) : null}
      {result.truncated === true ? <div className="toolTruncated">结果已截断。</div> : null}
    </>
  );
}

/** 工具行：图标 + 标题 + 参数摘要 + 状态；展开后是参数与结果，子调用递归缩进。 */
export const ToolRow = memo(function ToolRow({ item, open, onToggle, depth = 0 }: {
  item: ToolItemView;
  open: boolean;
  onToggle(open: boolean): void;
  /** 子调用的缩进层级（0 表示根调用）。 */
  depth?: number;
}): ReactNode {
  const state = TOOL_STATE[item.state];
  const expandable = toolExpandable(item);
  const body = useUntilFound(open, () => onToggle(true));
  /** 子调用的开合状态留在这里：它们是同一条工具行内部的细节，粒度太细不值得进 store。 */
  const [openCalls, setOpenCalls] = useState<Record<string, boolean>>({});
  const inline = item.showDetail === true && item.result?.text !== undefined && item.result.text.trim().length > 0;
  return (
    <div className="toolRow" data-state={item.state} data-family={item.family} data-open={open} data-depth={depth}>
      <button
        type="button"
        className="processRowTitle"
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        onClick={() => { if (expandable) onToggle(!open); }}
      >
        <ProcessIcon family={item.family} className="processIcon" />
        <span className="processLabel">{item.title}</span>
        {item.summary ? (
          <>
            <span className="processSep" aria-hidden="true" />
            <span className="processSummary">{item.summary}</span>
          </>
        ) : null}
        <span className="processState" data-state={item.state}>
          <span aria-hidden="true">{state.mark}</span>
          <span className="visuallyHidden">{state.label}</span>
        </span>
        {expandable ? <ChevronIcon className="processChevron" /> : null}
      </button>
      {inline && item.result?.text !== undefined ? (
        <pre className="toolInlineText">{inlineLines(item.result.text)}</pre>
      ) : null}
      {expandable ? (
        <div ref={body} className="processBody" hidden={!open}>
          {item.argsText !== undefined ? (
            <div className="toolArgs">
              <span className="toolArgsLabel">参数</span>
              <pre className="toolArgsText">{item.argsText}</pre>
            </div>
          ) : null}
          <ToolResultBody item={item} />
          {item.subCalls !== undefined && item.subCalls.length > 0 ? (
            <div className="toolSubCalls">
              {item.subCalls.map(call => (
                <ToolRow
                  key={call.callId}
                  item={call}
                  open={openCalls[call.callId] === true}
                  onToggle={next => setOpenCalls(current => ({ ...current, [call.callId]: next }))}
                  depth={depth + 1}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
