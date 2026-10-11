import { useMemo, type ReactNode } from 'react';
import { Provider } from 'react-redux';
import { DebugShell } from './components/shell/DebugShell';
import { createDebugStore, type DebugStore } from './utils/store';

/**
 * 调试页：左侧输入 event 或 frame，右侧用真实渲染链路预览结果。
 *
 * 三条设计约束：
 * 1. **与真实会话完全隔离**：这里自己建一个 redux store，用同一份 `rootReducer`。
 *    调试数据只进这个 store，主 store 一个字节都不动。
 * 2. **预览就是真实渲染**：直接复用 `<Stage>`（它连同 `Turn` / `Streaming` /
 *    `MessageBlocks` / `Markdown` 都是 props 驱动的），所以「预览所见 = 真实会话所见」。
 * 3. **流式由播放驱动**：模拟器按事件给出目标帧与目标块数组，页面把最后一个文本块按字符
 *    演一遍再提交——对应宿主每 40ms 一帧的下发节奏；内容块的「骨架 → 真实数据」是一次
 *    状态切换，不做补间。
 *
 * 这个文件只做装配：store 的创建在 `utils/store.ts`，输入解析与播放节奏在 `utils/playback.ts`，
 * 顶栏与三行的渲染、播放状态机在 `components/shell/DebugShell.tsx`。
 */
export function DebugPage(): ReactNode {
  // 独立 store：整个调试页唯一的状态容器，主 store 不参与。
  // 用 useMemo 而不是 useRef：Provider 需要的是一个稳定的 store 实例。
  const debugStore = useMemo<DebugStore>(createDebugStore, []);
  return (
    <Provider store={debugStore}>
      <DebugShell store={debugStore} />
    </Provider>
  );
}
