/**
 * 视口驱动入场：全站共享的 IntersectionObserver。
 *
 * 为什么要有这个模块：会话流、内容条目、文档页导航都想「滚进视口才浮现」。
 * 如果每处各建一个 `IntersectionObserver`，长会话下观察器数量随轮次增长，
 * 而且每处的 rootMargin、threshold、class 名都会各自漂移。
 *
 * 这里按**滚动容器**（root）缓存观察器：同一个容器全站只有一个实例，
 * 元素进入视口后立刻 `unobserve`（入场只播一次）。
 *
 * 配合 `styles/common.css` 的 `.appReveal` / `.appReveal.in` 使用：
 *
 * ```tsx
 * useEffect(() => {
 *   const el = ref.current;
 *   if (el === null) return;
 *   return observeReveal(el, container);
 * }, []);
 * ```
 *
 * 减少动态效果（`prefers-reduced-motion: reduce`）时 CSS 直接给可见状态，
 * 因此这里不需要分支——**但绝不能让元素因为没有触发而卡在不可见**，
 * 所以 rootMargin 给了负的底部余量之外不做任何延迟。
 */

/** 进入视口后由 CSS 消费的类名 */
const REVEALED_CLASS = 'in';

/** 底部留 8% 余量：元素刚露头时先不急着播，滚到更实的位置再浮现 */
const ROOT_MARGIN = '0px 0px -8% 0px';

const THRESHOLD = 0.05;

/** 按滚动容器缓存：同一个容器只有一个观察器 */
const OBSERVERS = new Map<Element | null, IntersectionObserver>();

function getObserver(root: Element | null): IntersectionObserver {
  const existing = OBSERVERS.get(root);
  if (existing !== undefined) return existing;

  const observer = new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add(REVEALED_CLASS);
        observer.unobserve(entry.target);
      }
    },
    { root, rootMargin: ROOT_MARGIN, threshold: THRESHOLD },
  );

  OBSERVERS.set(root, observer);
  return observer;
}

/**
 * 让元素「滚进视口时浮现」。
 *
 * @param target 要浮现的元素（调用方负责给它加 `.appReveal` 类）
 * @param root 滚动容器；用窗口滚动时传 `null`
 * @returns 取消订阅的函数（React 的 effect 直接 return 它）
 */
export function observeReveal(target: HTMLElement, root: Element | null = null): () => void {
  // 已经在视口里出现过（例如切换会话后重建）就不要重复播：由类名判断，
  // 避免同一个元素被再次隐藏——否则会出现「内容突然消失又浮现」的闪烁。
  if (target.classList.contains(REVEALED_CLASS)) return () => { /* 无需取消 */ };

  const observer = getObserver(root);
  observer.observe(target);
  return () => { observer.unobserve(target); };
}
