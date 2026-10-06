/**
 * 置顶会话的本地持久化。
 *
 * 置顶是**纯前端**状态：宿主协议（`bangumi/src/web/protocol.ts` 的 `SessionOptionView`）
 * 里没有任何「置顶」字段，`catalog.sessions` 也不提供排序偏好。因此这一项只存在浏览器里
 * ——换浏览器、换配置文件或清缓存会丢，这是本方案已知的代价（不做协议改动）。
 *
 * 读写集中在这一处：`store/reducers/ui.ts` 的 reducer 保持纯净（只改 state），
 * 落盘由 `store/index.ts` 的一处订阅负责；组件只派发动作，不碰 `localStorage`。
 */

/** 存储键。带项目前缀，避免同源下与其它本地页面串味。 */
const STORAGE_KEY = 'bgm-assistant.pinned-sessions';

/**
 * 读回置顶列表。
 *
 * 每一层都容错：没有这条记录、JSON 坏掉、值不是数组、数组里混进非字符串，
 * 一律降级成「没有置顶」——置顶丢了只是少一个分组，不该让首屏挂掉。
 */
export function loadPinned(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
  } catch {
    // 隐私模式 / 存储被禁用时 `localStorage` 会直接抛异常，同样按「没有置顶」处理。
    return [];
  }
}

/** 写回置顶列表。写失败（配额、隐私模式）不抛异常——置顶是增强，不是关键路径。 */
export function savePinned(ids: readonly string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* 存储不可用：本次会话内仍然生效，刷新后丢失。 */
  }
}
