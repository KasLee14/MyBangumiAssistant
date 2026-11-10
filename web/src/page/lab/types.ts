import type { ContentKind } from '../../types/content';

/**
 * 卡片实验室的数据形状（本页的公开契约）。
 *
 * **这份类型为什么手写**：`components/content/content-cards.generated.json` 由
 * `web/tools/gen-content-cards.mjs` 从各组件自己的 `XxxProps` interface + JSDoc 生成，导入时没有
 * 可用类型（JSON 模块只能 `as unknown as` 收窄）。所以本文件是这套形状**唯一的类型来源**：
 * 生成物加了字段而这里没加，编译期不会报，只会在运行期静默降级。改生成物必须同步改这里，
 * 这是这套设计唯一的代价（真实生成物里 `root`、`name` 都是这么来的）。
 *
 * **为什么不复用文档页的 `LibrarySection`**：那一份是「章节 + 参数表 + 示例载荷」的**文档形状**
 * （写给人读的契约说明），这一份是「字段元数据 + 可编辑草稿」的**实验形状**（用来生成控件）。
 * 两者只共享 `kind` 一个词；而页面之间不互引（见 `web/AGENTS.md` 规则 2），所以宁可各写一份小的。
 */

/**
 * 字段的控件形态。
 *
 * 生成器（`gen-content-cards.mjs` 的 `controlOf`）产出 `text` / `number` / `select` / `json` 四种；
 * `textarea` 是留给手写元数据的多行形态，目前没有生成物用它——控件层照样支持，因为「长文本用
 * 单行输入框」在预览时很难改。
 *
 * 布尔字段**没有独立形态**：生成器把它映射成 `select` + `['true','false']`。载荷里它必须是
 * 真布尔（`readFlag` 只接受布尔），所以「`select` 的 true / false 发布尔」这条转换规则在
 * `reducer.payloadOf` 里，而不是在控件层——否则同一件事要在两处维护。
 */
export type LabFieldKind = 'text' | 'textarea' | 'number' | 'select' | 'json' | 'list';

/**
 * 载荷根的形态。
 *
 * `'array'` 的语义来自生成器：这类 kind（`TagCloud`）的 props 是**数组**，`fields` 描述的是
 * **一个元素**（`<Kind>ItemProps`）。所以组装时要把字段收成一个对象、再放进数组，
 * 见 `reducer.payloadOf`。
 */
export type LabRoot = 'object' | 'array';

/**
 * 一个字段的元数据 + 例值。
 *
 * `value` **永远是字符串**（json 字段的 value 是一段 JSON 文本），控件与载荷之间的类型转换全部
 * 发生在 `reducer.ts` 里。控件层不做类型判断——否则「一个字段怎么变成载荷里的值」会在控件、
 * 组装、回填三处各写一遍，迟早三处不一致。
 */
export interface LabField {
  /** 载荷里的键名，也是表单控件的唯一标识。 */
  readonly key: string;
  readonly kind: LabFieldKind;
  /** 协议契约上的必填：只用于在表单里打个标记，真正的判定在各组件自己的 `readXxx`。 */
  readonly required: boolean;
  /** 可以「不传」：勾上缺省后这个键不出现在载荷里。 */
  readonly optional: boolean;
  /** 例值（字符串）。也是点「重置为默认值」恢复到的值。 */
  readonly value: string;
  readonly hint?: string;
  /** `kind: 'select'` 的候选值（枚举字段与布尔字段都有）。 */
  readonly options?: readonly string[];
  /**
   * `kind: 'list'` 的元素字段（只展开一层）。
   *
   * 由生成器从数组元素的对象形状解析出来（`SubjectCardProps[]` → 那一份 interface 的字段）。
   * 元素形状不是对象（`Record<string,string>[]`、`string[]`）时这个字段仍是 `json`，
   * 因为那时没有可靠的「一格一格编辑」的依据。
   */
  readonly itemFields?: readonly LabField[];
}

/** 一张卡片 = 一个内容块 kind 的字段元数据。 */
export interface LabCard {
  readonly kind: ContentKind;
  /** 中文名（例：状态提示）。 */
  readonly name: string;
  readonly root: LabRoot;
  /** 渲染它的组件文件名（例：`Callout.tsx`）：说明「预览长这样，代码在哪」。 */
  readonly componentFile: string;
  /**
   * 一句话说明。
   *
   * 现有生成物**不产出**这一项（原始需求里的示例结构有），所以按可选处理：有就显示在预览区
   * 顶部，没有就只显示名字与文件名。加它不需要改生成器，但要让每个 kind 都有一句话，
   * 得在生成器里带上 props interface 的类型注释。
   */
  readonly summary?: string;
  readonly fields: readonly LabField[];
}

/**
 * 字段草稿：**值与「缺省」分开存**。
 *
 * 为什么不把「不传」编码成空串：空串本身是合法载荷（`QuoteBlock.text` 可以是空文本），
 * 用空串表示不传就再也分不出「用户清空了」和「用户不想传」。两件事，草稿里就要能分开。
 */
export interface LabDraft {
  /** 字段 key → 控件里的文本。缺失的键按空串处理（见 `reducer.valueOf`）。 */
  readonly values: Readonly<Record<string, string>>;
  /** 字段 key → 是否勾了「缺省」（`true` 才会被跳过，缺失等于没勾）。 */
  readonly omitted: Readonly<Record<string, boolean>>;
}
