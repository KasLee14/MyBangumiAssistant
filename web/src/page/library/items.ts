import type { ServerEvent } from '../../../../bangumi/src/web/protocol';
import type { ContentBlockView } from '../../components/content';
import type { ContentKind } from '../../components/content/registry';
import type { LibrarySection } from './samples';

type StateFrame = Extract<ServerEvent, { type: 'state' }>;

/**
 * 示例载荷 → 块 / event / frame 的转换。
 *
 * 页面上的 UI 预览、event 代码块、frame 代码块都由**同一份载荷**现场生成，
 * 所以"预览所见 = 粘进调试页所得"，不存在手抄的第二份数据。
 */

/** 帧里的标量：文档页不连宿主，全部是固定模拟值（与调试页的样例同形）。 */
export const FRAME_STATE: StateFrame['state'] = {
  ready: true, busy: false, cancelling: false, startedAt: 0, status: '',
  modelLabel: 'debug/mock-model', sessionId: 'library-preview', sessionName: '组件库预览',
  thinking: { current: 'off', currentLabel: '关闭', available: [], supported: false },
  tokenUsage: null, contextUsage: null, liveContent: [], liveThinking: '',
  pending: null, loginPrompt: null, loginBusy: false, loginStatus: '',
  loginText: '未登录（组件库不访问账户）', loginState: 'signed-out', loginUsername: '',
  proxyLabel: '直连', proxyMode: 'direct', proxyAddress: '',
};

/**
 * 把示例载荷包成一个内容块。
 *
 * 形状与宿主 `message-blocks.ts` 的投影完全一致：`{ type, props }`——**定制组件的参数一律
 * 写在 `props` 里**，块上没有随 kind 变化的字段名。所以"文档页看到的形状"就是"粘进调试页
 * 之后宿主投影出来的形状"。
 */
export function blockOf(kind: ContentKind, payload: unknown): ContentBlockView {
  return { type: kind, props: payload } as ContentBlockView;
}

/** 一条可直接粘进调试页「event 输入」框的 assistant 消息（正文是一个内容块）。 */
export function eventText(section: LibrarySection): string {
  return JSON.stringify({
    type: 'message_end',
    message: { role: 'assistant', stopReason: 'stop', content: [blockOf(section.kind, section.payload)] },
  }, null, 2);
}

/** 一条可直接粘进调试页「frame 输入」框的完整 state 帧。 */
export function frameText(section: LibrarySection): string {
  const frame: StateFrame = {
    type: 'state',
    instanceId: 'debug-instance',
    revision: 1,
    full: true,
    items: [
      { id: 1, version: 1, kind: 'user', text: `查看${section.title}` },
      { id: 2, version: 1, kind: 'assistant', content: [blockOf(section.kind, section.payload)] },
    ],
    state: FRAME_STATE,
  };
  return JSON.stringify(frame, null, 2);
}
