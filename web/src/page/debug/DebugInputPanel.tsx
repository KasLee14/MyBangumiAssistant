import { memo, type ReactNode } from 'react';
import { SidebarBrand } from '../../components/mainPage/shell/SidebarBrand';

/**
 * 调试页左侧的输入区。
 *
 * 纯 props 驱动：不读 store、不发请求，两个输入框与状态都由调试页装配层持有。
 * 这里只负责「填什么、点了什么」，映射与播放都在 `index.tsx` 与 `simulator.ts` 里。
 */

export interface DebugInputPanelProps {
  /** event 输入框内容（`AgentSessionEvent` 的 JSON）。 */
  eventText: string;
  onEventChange(text: string): void;
  /** frame 输入框内容（`ServerEvent` 的 state 帧 JSON）。 */
  frameText: string;
  onFrameChange(text: string): void;
  /** frame 框当前是否是 event 自动生成的（仅用于视觉区分）。 */
  frameAuto: boolean;
  /** 输入校验错误；null 表示没有错误。 */
  error: string | null;
  /** 播放中禁用按钮。 */
  playing: boolean;
  /** 预览实际采用的依据。 */
  source: 'event' | 'frame' | 'none';
  /** 已提交的帧数。 */
  frameCount: number;
  /** 已处理的 event 数。 */
  eventCount: number;
  onPreview(): void;
  onReset(): void;
  /** 从品牌区关闭调试页（与双击等价）。 */
  onExit(): void;
}

/** 五个 mock 用例与说明；按验收标准的顺序排列。 */
const SAMPLES: readonly { label: string; hint: string; json?: string; frame?: string; clearEvent?: boolean }[] = [
  {
    label: '1 文本流式',
    hint: 'message_update：流式区逐字出现，观察 Markdown 半成品抖动',
    json: JSON.stringify({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'text_delta',
        delta: '整体来看，这部的口碑集中在**中后段**。\n\n## 评分分布\n\n| 分段 | 人数 |\n| --- | ---: |\n| 8 分 | 1,204 |',
      },
    }, null, 2),
  },
  {
    label: '2 工具开始',
    hint: 'tool_execution_start：出现「处理过程」条目，状态进行中',
    json: JSON.stringify({ type: 'tool_execution_start', toolCallId: 'call-1', toolName: 'query_subject' }, null, 2),
  },
  {
    label: '3 工具结束',
    hint: 'tool_execution_end：同一 id 原地更新为完成（验证 version++ 重发）',
    json: JSON.stringify({
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      isError: false,
      result: { details: { value: { state: 'ok' } }, content: [{ type: 'text', text: '命中 1 项' }] },
    }, null, 2),
  },
  {
    label: '4 回答落盘',
    hint: 'message_end：流式区消失、文本落成历史条目',
    json: JSON.stringify({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'stop',
        content: [{ type: 'text', text: '整体来看，这部的口碑集中在**中后段**。\n\n综合看，**7 分档**最厚。' }],
      },
    }, null, 2),
  },
  {
    label: '5 内容条目',
    hint: '清空 event，再把这一帧贴进 frame 输入框',
    clearEvent: true,
    frame: JSON.stringify({
      type: 'state',
      instanceId: 'debug-instance',
      revision: 9,
      full: true,
      items: [
        {
          id: 100, version: 1, kind: 'table',
          table: {
            title: '章节',
            columns: [{ key: 'ep', label: '话' }, { key: 'score', label: '评分', align: 'right' }],
            rows: [{ ep: '第 1 话', score: '8.2' }, { ep: '第 2 话', score: '7.9' }],
          },
        },
        { id: 101, version: 1, kind: 'infobox', info: { rows: [{ label: '放送开始', value: '2026-04-05' }] } },
      ],
      state: {
        ready: true, busy: false, cancelling: false, startedAt: 0, status: '',
        modelLabel: 'debug/mock-model', sessionId: 'debug-session', sessionName: '调试预览',
        thinking: { current: 'off', currentLabel: '关闭', available: [], supported: false },
        tokenUsage: null, contextUsage: null, liveText: '', liveThinking: '',
        pending: null, loginPrompt: null, loginBusy: false, loginStatus: '',
        loginText: '未登录', loginState: 'signed-out', loginUsername: '',
        proxyLabel: '直连', proxyMode: 'direct', proxyAddress: '',
      },
    }, null, 2),
  },
];

const MODE_LABEL: Record<DebugInputPanelProps['source'], string> = {
  event: '以 event 为准',
  frame: '以 frame 为准',
  none: '无有效输入',
};

export const DebugInputPanel = memo(function DebugInputPanel({
  eventText, onEventChange, frameText, onFrameChange, frameAuto, error, playing,
  source, frameCount, eventCount, onPreview, onReset, onExit,
}: DebugInputPanelProps): ReactNode {
  return (
    <>
      <SidebarBrand title="双击返回主界面" onDoubleClick={onExit}>
        <button type="button" className="debugButton" data-compact="true" onClick={onExit} title="返回主界面">
          返回
        </button>
      </SidebarBrand>

      <div className="debugPane">
        <div className="debugSection">
          <div className="debugSectionHead">
            <span className="debugSectionTitle">event 输入</span>
            <span className="debugSectionHint">handleEvent 的入参</span>
          </div>
          <textarea
            id="debug-event-input"
            name="debug-event"
            className="debugTextarea"
            value={eventText}
            spellCheck={false}
            placeholder='{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"…"}}'
            aria-label="event 输入"
            onChange={event => onEventChange(event.target.value)}
          />
          <div className="debugSamples">
            {SAMPLES.map(sample => (
              <button
                key={sample.label}
                type="button"
                className="debugButton"
                title={sample.hint}
                onClick={() => {
                  // 用例 5 走 frame 通道：先清空 event，再把帧贴进 frame 框。
                  if (sample.clearEvent) onEventChange('');
                  if (sample.json !== undefined) onEventChange(sample.json);
                  if (sample.frame !== undefined) onFrameChange(sample.frame);
                }}
              >
                {sample.label}
              </button>
            ))}
          </div>
          <div className="debugNote">
            用例 2、3 必须按顺序：模拟器要记住同一 `toolCallId` 的进行中条目。用例 5 请先清空 event 框，再把 frame 贴进右侧输入框。
          </div>
        </div>

        <div className="debugSection">
          <div className="debugSectionHead">
            <span className="debugSectionTitle">frame 输入</span>
            <span className="debugSectionHint">
              {frameAuto ? '由 event 自动生成，可编辑；event 变化时会被覆盖' : 'onFrame 的入参'}
            </span>
          </div>
          <textarea
            id="debug-frame-input"
            name="debug-frame"
            className="debugTextarea"
            value={frameText}
            spellCheck={false}
            data-auto={frameAuto ? 'true' : 'false'}
            placeholder='{"type":"state","instanceId":"debug-instance","revision":0,"full":true,"items":[],"state":{…}}'
            aria-label="frame 输入"
            onChange={event => onFrameChange(event.target.value)}
          />
          {frameAuto ? (
            <div className="debugNote">event 非空时预览以 event 为准；想直接调 frame，请先清空上面的 event 输入。</div>
          ) : null}
        </div>

        {error !== null ? <div className="debugError">{error}</div> : null}

        <div className="debugActions">
          <button type="button" className="debugButton" data-primary="true" onClick={onPreview} disabled={playing}>
            {playing ? '播放中…' : '预览'}
          </button>
          <button type="button" className="debugButton" onClick={onReset} disabled={playing}>
            清空并重置
          </button>
        </div>

        <div className="debugStatus">
          <span>当前依据：<b>{MODE_LABEL[source]}</b></span>
          <span>已处理 event：<b>{eventCount}</b>　已提交帧：<b>{frameCount}</b></span>
          <span>token 用量、上下文占用、登录与代理字段为固定模拟值。</span>
        </div>
      </div>
    </>
  );
});
