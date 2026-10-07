import { useEffect } from 'react';
import { useStore } from 'react-redux';
import type { MessageBlock } from '../../../bangumi/src/web/protocol';
import { pacedDone, pacedUpdated } from './actions';
import type { AppAction } from './actions';
import { useAppDispatch } from './hooks';
import type { AppStore, RootState } from './index';

/**
 * 流式正文的逐字摊平（pacing）。
 *
 * **问题**：上游的正文以突发批次到达——DeepSeek 官方的 SSE chunk 本身是逐字的（实测中位数
 * 2 字符），但它们成批到达（一批 10~90 字符、间隔 20~190ms）。按到达直接渲染，屏幕上就是
 * 「停一下、冒十几个字」。这是数据到达模式决定的，与前端渲染性能无关（改造后浏览器长任务为 0）。
 *
 * **做法**：按**时间**吐字（每 16.7ms 一个字，约 60 字/秒），并把流式结束那一刻的目标冻住，
 * 让剩下的字接着播完（理由见 `StreamState.pacedTarget`）。
 *
 * **按时间而不是按帧**：`requestAnimationFrame` 的频率随显示器刷新率与其他环境因素变化
 * （实测在无头/离屏环境下能到 170 帧以上，同一次推进就会快三倍）。所以这里用经过的毫秒数
 * 折算该吐几个字，120Hz 屏幕上仍然是 60 字/秒。
 *
 * **代价（必须知道）**：上游正文实测约 330 字符/秒，是逐字速度的五倍多，所以显示必然滞后于
 * 真实内容——500 字的回答写完时大约还要再播 6~7 秒。这是「看着像逐字」的必然代价，
 * 不是可以优化掉的开销。
 */

/** 每个字的显示间隔（毫秒）：约 60 字/秒。 */
const MS_PER_CHAR = 1000 / 60;
/**
 * 积压超过这个字数才开始加速。
 *
 * 正常回答不会触发（500 字的回答最多积压 500）。它是给超长回答兜底的：一段 5000 字的回答
 * 若始终一字一帧要播一分半钟，用户会以为界面卡死了。
 */
const CATCHUP_THRESHOLD = 1200;
/** 加速时按这个帧数预算收敛：每帧多吐 `ceil((积压 - 阈值) / CATCHUP_FRAMES)` 个字。 */
const CATCHUP_FRAMES = 120;
/** 单帧吐字上限：卡顿或从后台切回后不要一次性刷出一大段。 */
const MAX_CHARS_PER_FRAME = 8;
/** 积压超过这个字数直接补齐（极端情况的保险）。 */
const MAX_BACKLOG = 3000;

/** 把最后一个文本块替换成前缀为 `text` 的那一份。 */
function withText(blocks: MessageBlock[], text: string): MessageBlock[] {
  const next = [...blocks];
  next[next.length - 1] = { type: 'text', text };
  return next;
}

/**
 * 推进一帧显示。
 *
 * @param target - 正在追赶的目标（流式期是权威正文，流式结束后是冻住的尾巴）。
 * @param displayed - 屏幕上已有的那份。
 * @param budget - 这一帧允许吐出的字数（由经过的时间折算；0 表示时间还没到）。
 * @returns 下一帧的显示用块数组；没有可推进的内容时返回 `null`（调用方据此跳过派发）。
 *
 * 只在**结构一致**（块数相同、前面的块引用相同）时才逐字截断——结构对齐不受 `budget` 限制，
 * 因为那不是「吐字」而是「换内容」。结构变化分两种处理：
 * - 目标多出一个**文本块**（正文开始）：补一个空块接着逐字播，避免一次跳出整段开头；
 * - 其它结构变化（新的内容块、整体替换）：直接对齐目标——那些情况要么是「上一段已定稿」，
 *   要么是「屏幕要被别的内容接管」，继续摊平只会落后于已定稿的内容。
 */
export function advanceFrame(target: MessageBlock[], displayed: MessageBlock[], budget: number): MessageBlock[] | null {
  if (target === displayed) return null;
  if (target.length === displayed.length + 1) {
    for (let cursor = 0; cursor < displayed.length; cursor += 1) {
      if (target[cursor] !== displayed[cursor]) return target;
    }
    const extra = target[target.length - 1];
    return extra !== undefined && extra.type === 'text'
      ? [...displayed, { type: 'text', text: '' }]
      : target;
  }
  if (target.length !== displayed.length) return target;
  const index = target.length - 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (target[cursor] !== displayed[cursor]) return target;
  }
  const real = target[index];
  const shown = displayed[index];
  if (real === undefined || shown === undefined) return null;
  // 最后一块不是文本块（内容块骨架等）时没有可摊平的字，直接对齐。
  if (real.type !== 'text' || shown.type !== 'text') return target;
  const backlog = real.text.length - shown.text.length;
  if (backlog <= 0) return null;
  if (backlog > MAX_BACKLOG) return target;
  const catchup = backlog > CATCHUP_THRESHOLD
    ? Math.ceil((backlog - CATCHUP_THRESHOLD) / CATCHUP_FRAMES)
    : 0;
  const step = Math.min(MAX_CHARS_PER_FRAME, budget + catchup);
  if (step <= 0) return null;
  return withText(displayed, real.text.slice(0, shown.text.length + step));
}

/**
 * 显示是否已经**追上**目标。
 *
 * 这是收尾播放的结束条件，不能用「`advanceFrame` 返回 null」代替——时间没到（`budget` 为 0）
 * 时它也返回 null，那会把还没播完的内容提前清掉。比较的是文本内容而不是引用：推进过程每次
 * 都构造新块。
 */
export function hasCaughtUp(target: MessageBlock[], displayed: MessageBlock[]): boolean {
  if (target.length !== displayed.length) return false;
  for (let index = 0; index < target.length; index += 1) {
    const expected = target[index];
    const actual = displayed[index];
    if (expected === actual) continue;
    if (expected === undefined || actual === undefined) return false;
    if (expected.type !== 'text' || actual.type !== 'text') return false;
    if (expected.text !== actual.text) return false;
  }
  return true;
}

/**
 * 挂载摊平推进器。只在主界面挂载期间运行。
 *
 * `requestAnimationFrame` 在后台标签页自动停摆；切回前台时经过的时间会一次折算成较大的
 * `budget`（并被单帧上限截断），于是分几帧追上，不需要额外的可见性处理。
 */
export function usePacing(): void {
  const dispatch = useAppDispatch();
  const store = useStore<RootState, AppAction>() as AppStore;
  useEffect(() => {
    let handle = 0;
    let last = performance.now();
    /** 不足一个字的余量（毫秒），跨帧累积，避免高刷新率下变慢。 */
    let carry = 0;
    function step(): void {
      handle = requestAnimationFrame(step);
      const now = performance.now();
      const want = (now - last) / MS_PER_CHAR + carry;
      last = now;
      const budget = Math.max(0, Math.floor(want));
      carry = want - budget;
      const { liveContent, pacedTarget, displayedContent } = store.getState().stream;
      const next = advanceFrame(pacedTarget, displayedContent, budget);
      if (next !== null) {
        dispatch(pacedUpdated(next));
        return;
      }
      // 追上目标了：流式还在继续时什么都不做（等新内容）；流式已经结束就把屏幕交回历史条目
      // ——正文已经逐字显示完，条目里的同一段文本落在同一个位置，切换没有跳变。
      if (liveContent.length === 0 && hasCaughtUp(pacedTarget, displayedContent)) dispatch(pacedDone());
    }
    handle = requestAnimationFrame(step);
    return () => cancelAnimationFrame(handle);
  }, [dispatch, store]);
}
