import type { ServerEvent } from '../../../../bangumi/src/web/protocol';
import type { ContentItemView } from '../../components/content';
import type { ContentKind } from '../../components/content/registry';
import type { LibrarySection } from './samples';

type StateFrame = Extract<ServerEvent, { type: 'state' }>;

/**
 * 示例载荷 → 条目 / event / frame 的转换。
 *
 * 页面上的 UI 预览、event 代码块、frame 代码块都由**同一份载荷**现场生成，
 * 所以"预览所见 = 粘进调试页所得"，不存在手抄的第二份数据。
 */

/** 帧里的标量：文档页不连宿主，全部是固定模拟值（与调试页的样例同形）。 */
export const FRAME_STATE: StateFrame['state'] = {
  ready: true, busy: false, cancelling: false, startedAt: 0, status: '',
  modelLabel: 'debug/mock-model', sessionId: 'library-preview', sessionName: '组件库预览',
  thinking: { current: 'off', currentLabel: '关闭', available: [], supported: false },
  tokenUsage: null, contextUsage: null, liveText: '', liveThinking: '',
  pending: null, loginPrompt: null, loginBusy: false, loginStatus: '',
  loginText: '未登录（组件库不访问账户）', loginState: 'signed-out', loginUsername: '',
  proxyLabel: '直连', proxyMode: 'direct', proxyAddress: '',
};

/** 信封字段由这里补，载荷原样带上——与宿主 `customContentDraft` 的展开方式一致。 */
export function itemOf(kind: ContentKind, payload: Record<string, unknown>, id: number): ContentItemView {
  return { id, version: 1, kind, ...payload } as ContentItemView;
}

/** 一条可直接粘进调试页「event 输入」框的 custom 消息。 */
export function eventText(section: LibrarySection): string {
  return JSON.stringify({
    type: 'message_end',
    message: { role: 'custom', customType: section.kind, display: true, details: section.payload },
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
      itemOf(section.kind, section.payload, 2),
    ],
    state: FRAME_STATE,
  };
  return JSON.stringify(frame, null, 2);
}
