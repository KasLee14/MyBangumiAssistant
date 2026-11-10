import type { ContentKind } from '../../../types/content';

/** 参数表的一行。`values` 只在枚举字段上给。 */
export interface ParamRow {
  field: string;
  type: string;
  required: '必填' | '可选';
  values?: string;
  note: string;
}

/** 参考的 ReactBits 组件；未使用就为 null。 */
export interface Reference {
  name: string;
  url: string;
  usage: string;
}

/**
 * 主载荷之外的**另一种形态**。
 *
 * 一个组件可以靠载荷里的判别字段切换外观（`SubjectCards` 的 `layout`、`StatsCard` 的
 * `mode`、`ProgressView` 的数值/章节网格…）。主载荷只演得出其中一种，剩下的放这里，
 * 于是「这一类组件一共有几种长相」在同一页可见——变体卡与主载荷卡渲染方式完全相同
 * （同一份 `ContentBlock`、同一套接收侧校验），只是换了一份数据。
 */
export interface LibraryVariant {
  /** 预览卡标题，例如 `紧凑行（layout: "list"）`。 */
  label: string;
  /** 与 `payload` 同形；只换判别字段，其余数据尽量与主载荷保持一致以便对照。 */
  payload: unknown;
  /** 贴在标题旁的一句话说明（可选）：这一形态与主载荷差在哪、有什么坑。 */
  note?: string;
}

/**
 * 左侧导航的分组键。
 *
 * 定义成联合而不是自由字符串：`sections.ts` 里的 `group` 与 `GROUP_LABELS` 的键互相约束，
 * 写错分组名是编译错误。新增一个**分组**要在这里加成员并补一条标签；新增一个**组件**不需要
 * 碰它（在它自己那条 `LibrarySection` 里写 `group` 即可）。
 */
export type LibraryGroupKey = 'entries' | 'data' | 'text';

export interface LibrarySection {
  kind: ContentKind;
  /**
   * 左侧导航的分组归属。
   *
   * 放在条目里而不是另建一张「分组 → kinds」的表：那样每加一种组件要改两处，而两处之间
   * 没有任何编译期约束（漏改只会让它从导航里消失）。现在分组是条目自身的一部分，
   * `LIBRARY_GROUPS` 由它派生（见 `constants/sections.ts`）。
   */
  group: LibraryGroupKey;
  title: string;
  summary: string;
  /**
   * 该 kind 的**载荷本体**——也就是块里 `props` 的内容。
   *
   * 不带字段名包装：定制组件的块形状统一为 `{ type, pending?, props }`，`props` 就是这个值
   * （`tags` 是数组本身）。类型放宽到 `unknown` 是因为 12 种载荷形状各不相同，示例数据不必
   * 逐 kind 收窄。
   */
  payload: unknown;
  /**
   * 该 kind 的其它形态（可选）。
   *
   * 属于**第 1 块「UI 预览」内部**，不占第五块：详情页的结构契约仍是四块，这里只是让
   * 同一块里多出几张同构的预览卡（详情页的四块结构契约见 `ComponentPage.tsx` 的 `PAGE_ANCHORS`）。
   */
  variants?: readonly LibraryVariant[];
  /** 空数据形态，用来验证每个组件的空态；与 `payload` 同形。 */
  empty: unknown;
  params: ParamRow[];
  reference: Reference | null;
}

/**
 * 骨架经 `<Outlet context>` 下发给子路由的数据（索引路由与详情路由都要它）。
 *
 * 放在这里而不是骨架文件里：`router/routes.tsx` 的两个子路由都要标注这个类型，
 * 而 `router → page` 是允许的方向——类型属于页面模块的公开契约。
 */
export interface LibraryOutletContext {
  sections: LibrarySection[];
}
