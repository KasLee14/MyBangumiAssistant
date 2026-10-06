import { memo, type ReactNode } from 'react';

/**
 * 调试页左侧的输入区。
 *
 * 纯 props 驱动：不读 store、不发请求，两个输入框与状态都由调试页装配层持有。
 * 这里只负责「填什么、点了什么」，映射与播放都在 `index.tsx` 与 `simulator.ts` 里。
 */

export interface DebugInputPanelProps {
  /** event 输入框内容（`AgentSessionEvent` 的 JSON，单个对象或一个 flush 窗口的数组）。 */
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
}

/** 八个 mock 用例与说明；按验收标准的顺序排列。 */
const SAMPLES: readonly { label: string; hint: string; json?: string; frame?: string; clearEvent?: boolean }[] = [
  {
    label: '1 文本流式',
    hint: 'message_update：流式区逐字出现，观察 Markdown 半成品抖动',
    json: JSON.stringify({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'text_delta',
        delta: '整体来看，这部的口碑集中在**中后段**。\n\n## 评分分布\n\n| 分段 | 人数 |\n| --- | ---: |\n| 8 分 | 1,204 |',
        // 一条 message_update 必须带 `partial.content` 快照：宿主与调试页都只从快照投影，
        // 不累加 delta（见 message-blocks.ts 的说明）。
        partial: {
          content: [{
            type: 'text',
            text: '整体来看，这部的口碑集中在**中后段**。\n\n## 评分分布\n\n| 分段 | 人数 |\n| --- | ---: |\n| 8 分 | 1,204 |',
          }],
        },
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
          id: 100, version: 1, kind: 'assistant',
          content: [
            { type: 'text', text: '章节与放送信息：' },
            {
              type: 'DataTable',
              props: {
                title: '章节',
                columns: [{ key: 'ep', label: '话' }, { key: 'score', label: '评分', align: 'right' }],
                rows: [{ ep: '第 1 话', score: '8.2' }, { ep: '第 2 话', score: '7.9' }],
              },
            },
            { type: 'InfoBox', props: { rows: [{ label: '放送开始', value: '2026-04-05' }] } },
          ],
        },
      ],
      state: {
        ready: true, busy: false, cancelling: false, startedAt: 0, status: '',
        modelLabel: 'debug/mock-model', sessionId: 'debug-session', sessionName: '调试预览',
        thinking: { current: 'off', currentLabel: '关闭', available: [], supported: false },
        tokenUsage: null, contextUsage: null, liveContent: [], liveThinking: '',
        pending: null, loginPrompt: null, loginBusy: false, loginStatus: '',
        loginText: '未登录', loginState: 'signed-out', loginUsername: '',
        proxyLabel: '直连', proxyMode: 'direct', proxyAddress: '',
      },
    }, null, 2),
  },
  {
    label: '6 批量合并',
    hint: 'event 数组 = 一个 flush 窗口：多条事件合并成一帧，只看到批次结束时的最终状态',
    json: JSON.stringify([
      { type: 'agent_start' },
      {
        type: 'message_update',
        assistantMessageEvent: {
          type: 'text_delta', delta: '先说第一句。',
          partial: { content: [{ type: 'text', text: '先说第一句。' }] },
        },
      },
      {
        type: 'message_update',
        assistantMessageEvent: {
          type: 'text_delta', delta: '再说第二句。',
          partial: { content: [{ type: 'text', text: '先说第一句。再说第二句。' }] },
        },
      },
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'stop',
          content: [{ type: 'text', text: '先说第一句。再说第二句。' }],
        },
      },
    ], null, 2),
  },
  {
    label: '7 内容块（骨架）',
    hint: '文本 + 内容块的 pending 骨架：不校验载荷、不显示降级块（先点它，再点 8）',
    json: JSON.stringify([
      { type: 'message_start', message: { role: 'assistant', content: [] } },
      {
        type: 'message_update',
        assistantMessageEvent: {
          type: 'text_delta', contentIndex: 0, delta: '先看这组数据：',
          partial: { content: [{ type: 'text', text: '先看这组数据：' }] },
        },
      },
      {
        type: 'message_update',
        assistantMessageEvent: {
          type: 'text_delta', contentIndex: 1, delta: '',
          partial: {
            content: [
              { type: 'text', text: '先看这组数据：' },
              // 第二项出现且 `pending: true` → 预览区渲染骨架（载荷故意不完整）。
              { type: 'StatsCard', pending: true, props: { title: '评分分布', mode: 'bars' } },
            ],
          },
        },
      },
    ], null, 2),
  },
  {
    label: '8 组件块（落定与续写）',
    hint: '骨架 → 真实数据 → 续写文本 → 落成历史条目（先点 7 看骨架）',
    json: JSON.stringify([
      { type: 'message_start', message: { role: 'assistant', content: [] } },
      {
        type: 'message_update',
        assistantMessageEvent: {
          type: 'text_delta', contentIndex: 0, delta: '先看这组数据：',
          partial: { content: [{ type: 'text', text: '先看这组数据：' }] },
        },
      },
      {
        type: 'message_update',
        assistantMessageEvent: {
          type: 'text_delta', contentIndex: 1, delta: '',
          partial: {
            content: [
              { type: 'text', text: '先看这组数据：' },
              // 第二项出现，`pending: true` → 前端渲染骨架（此时载荷故意不完整）。
              { type: 'StatsCard', pending: true, props: { title: '评分分布', mode: 'bars' } },
            ],
          },
        },
      },
      {
        type: 'message_update',
        assistantMessageEvent: {
          type: 'text_delta', contentIndex: 1, delta: '',
          partial: {
            content: [
              { type: 'text', text: '先看这组数据：' },
              // pending 消失 → 校验并渲染真实数据（此后内容不再变）。
              {
                type: 'StatsCard',
                props: {
                  title: '评分分布', mode: 'bars',
                  entries: [
                    { label: '10 分', value: '128', ratio: 0.21, tone: 'primary' },
                    { label: '9 分', value: '204', ratio: 0.33 },
                    { label: '8 分', value: '176', ratio: 0.29 },
                    { label: '7 分', value: '102', ratio: 0.17, tone: 'muted' },
                  ],
                  note: '共 610 人评分',
                },
              },
            ],
          },
        },
      },
      {
        type: 'message_update',
        assistantMessageEvent: {
          type: 'text_delta', contentIndex: 2, delta: '总体偏高。',
          partial: {
            content: [
              { type: 'text', text: '先看这组数据：' },
              {
                type: 'StatsCard',
                props: {
                  title: '评分分布', mode: 'bars',
                  entries: [
                    { label: '10 分', value: '128', ratio: 0.21, tone: 'primary' },
                    { label: '9 分', value: '204', ratio: 0.33 },
                    { label: '8 分', value: '176', ratio: 0.29 },
                    { label: '7 分', value: '102', ratio: 0.17, tone: 'muted' },
                  ],
                  note: '共 610 人评分',
                },
              },
              { type: 'text', text: '总体偏高。' },
            ],
          },
        },
      },
      {
        type: 'message_end',
        message: {
          role: 'assistant', stopReason: 'stop',
          content: [
            { type: 'text', text: '先看这组数据：' },
            {
              type: 'StatsCard',
              props: {
                title: '评分分布', mode: 'bars',
                entries: [
                  { label: '10 分', value: '128', ratio: 0.21, tone: 'primary' },
                  { label: '9 分', value: '204', ratio: 0.33 },
                  { label: '8 分', value: '176', ratio: 0.29 },
                  { label: '7 分', value: '102', ratio: 0.17, tone: 'muted' },
                ],
                note: '共 610 人评分',
              },
            },
            { type: 'text', text: '总体偏高。' },
          ],
        },
      },
    ], null, 2),
  },
];

const MODE_LABEL: Record<DebugInputPanelProps['source'], string> = {
  event: '以 event 为准',
  frame: '以 frame 为准',
  none: '无有效输入',
};

export const DebugInputPanel = memo(function DebugInputPanel({
  eventText, onEventChange, frameText, onFrameChange, frameAuto, error, playing,
  source, frameCount, eventCount, onPreview, onReset,
}: DebugInputPanelProps): ReactNode {
  return (
    <>
      {/* 品牌、组件库入口与「返回主界面」都搬去了顶栏
          （调试页与主界面同构，见 page/debug/index.tsx）。这里只剩输入区本身。 */}
      <div className="debugPane">
        <div className="debugSection">
          <div className="debugSectionHead">
            <span className="debugSectionTitle">event 输入</span>
            <span className="debugSectionHint">handleEvent 的入参：对象，或一个 flush 窗口的数组</span>
          </div>
          <textarea
            id="debug-event-input"
            name="debug-event"
            className="debugTextarea"
            value={eventText}
            spellCheck={false}
            placeholder='{"type":"message_update",…}　或　[{"type":"agent_start"},{"type":"message_end",…}]'
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
            用例 2、3 必须按顺序：模拟器要记住同一 `toolCallId` 的进行中条目。用例 5 请先清空 event 框，再把 frame 贴进右侧输入框。用例 6 是 event 数组：多条事件按宿主 40ms 的 flush 窗口合并成一帧。用例 7、8 是本轮「内容块」的验收用例，**按顺序点**：7 只看骨架，8 把骨架换成真实数据并落成条目（数组会被合并成一帧，所以一次喂完整条链路就看不到骨架那一跳）。
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
