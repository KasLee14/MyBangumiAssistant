/**
 * 载荷读取的共享原语。
 *
 * 分工：**判定与降级策略在各组件自己的 `readXxx` 里**（见同目录的 12 个组件），本文件
 * 只放它们都要用到的收窄动作——取字符串 / 数字 / 枚举 / 数组、按元素过滤、记一次降级。
 *
 * 为什么这里**没有任何 kind 知识**：一旦出现「哪几种 kind 共用什么规则」，规则就又回到了
 * 中心化的老路上（改造前 `validate.ts` 的 643 行规则表就是这么长出来的）。加东西之前先问：
 * 这条规则是「每种载荷都一样」还是「恰好这两种一样」？后者不要放这里。
 *
 * 三条与改造前一致的边界：
 * 1. 只回答「能不能渲染、怎么降级」，不做业务裁决（不判断 URL 可达、不判断交叉引用、不换算单位）；
 * 2. 数值越界不算非法（`ratio`、负 `count` 由组件自己夹取）；
 * 3. 降级对用户是静默的——只在开发期打一条去重后的 `console.warn`，界面不留痕迹。
 */

/**
 * 一次读取的上下文。
 *
 * 只承担「记一次降级」：`readXxx` 里的每个回退分支都调一次 `miss`，开发期就能顺手看到
 * 「这条载荷的哪个字段不合约、被怎么处理了」。用户侧不显示任何提示（改造前的降级卡会
 * 把整块换成 JSON，那正是这次要拆掉的东西）。
 */
export interface Reading {
  readonly kind: string;
  /** 记一次降级：字段回落，或子项被剔除。 */
  miss(field: string, reason: string): void;
}

/** 同一条 `(kind, 字段, 原因)` 只告警一次：流式帧每帧重算，不去重会把控制台刷满。 */
const warned = new Set<string>();

/** 开发期诊断出口。 */
export function warnPayload(kind: string, field: string, reason: string): void {
  const message = `[content] ${kind} 的载荷字段 ${field} ${reason}，已按降级策略处理。`;
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

export function reading(kind: string): Reading {
  return { kind, miss: (field, reason) => { warnPayload(kind, field, reason); } };
}

/**
 * 子项级读取：把字段路径前缀接到 `miss` 上。
 *
 * 于是数组里的降级会报成 `items[2].name`，而不是含糊的 `name`。
 */
export function scoped(r: Reading, prefix: string): Reading {
  return { kind: r.kind, miss: (field, reason) => { r.miss(`${prefix}.${field}`, reason); } };
}

/* ---------------------------------------------------------------- 基础收窄 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 载荷根必须是对象；不是就整块不可渲染（返回 null，由组件渲染 `ContentRaw`）。 */
export function asRecord(r: Reading, value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  r.miss('载荷', '不是一个对象');
  return null;
}

/** 必填文本：不是字符串就回落 `fallback`（默认空串）。 */
export function readText(r: Reading, value: unknown, field: string, fallback = ''): string {
  if (typeof value === 'string') return value;
  r.miss(field, value === undefined ? '缺失' : '不是字符串');
  return fallback;
}

/** 可选文本：缺失合法，类型不对同样回落为 undefined（等于这一行/这一段不渲染）。 */
export function readMaybeText(r: Reading, value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  r.miss(field, '不是字符串');
  return undefined;
}

/** 可选数字：只接受有限数，`NaN` / `Infinity` 一律回落 undefined。 */
export function readNumber(r: Reading, value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  r.miss(field, '不是有限数字');
  return undefined;
}

/** 必填布尔：不是布尔就回落 `fallback`。 */
export function readFlag(r: Reading, value: unknown, field: string, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value !== undefined) r.miss(field, '不是布尔值');
  return fallback;
}

/** 枚举：不在候选里就回落 `fallback`。 */
export function readChoice<T extends string>(
  r: Reading, value: unknown, field: string, allowed: readonly T[], fallback: T,
): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  if (value !== undefined) r.miss(field, `不是 ${allowed.join(' / ')} 之一`);
  return fallback;
}

/**
 * 可缺省的枚举：不在候选里就回落 undefined（调用方据此**不显示**这一维，而不是猜一个值）。
 *
 * `SubjectCards` 的 `kind` 用它：媒体类型错的卡片仍然该显示封面与标题，只是角标不写。
 */
export function readMaybeChoice<T extends string>(
  r: Reading, value: unknown, field: string, allowed: readonly T[],
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  r.miss(field, `不是 ${allowed.join(' / ')} 之一`);
  return undefined;
}

/**
 * 外部资源地址：只接受 http(s) 绝对地址。
 *
 * 界面不拼站内相对路径，相对地址在会话里点不开——回落为 undefined（卡片显示占位块或
 * 不渲染成链接），比渲染一个坏链接更诚实。
 */
export function readLink(r: Reading, value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
  r.miss(field, '不是 http(s) 绝对地址');
  return undefined;
}

/** 字符串数组：非字符串项就地剔除。 */
export function readTextList(r: Reading, value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    r.miss(field, '不是数组');
    return undefined;
  }
  const out: string[] = [];
  value.forEach((entry, index) => {
    if (typeof entry === 'string') out.push(entry);
    else r.miss(`${field}[${index}]`, '不是字符串');
  });
  return out;
}

/** 子项读法：返回 null 表示这一项不可渲染，会被调用方剔除。 */
export type ItemReader<T> = (raw: Record<string, unknown>, r: Reading) => T | null;

/**
 * 数组字段：根不是数组返回 undefined（由调用方决定是「整块不可渲染」还是「当作空」），
 * 子项由 `read` 逐个收窄，返回 null 的直接剔除。
 *
 * 注意 `read` 返回 null 之前**必须自己记过一次 `miss`**（通常由它内部的 `readText` 等完成），
 * 否则剔除会变成静默的——这里不补记，避免同一处降级打两条日志。
 */
export function readList<T>(
  r: Reading, value: unknown, field: string, read: ItemReader<T>,
): T[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    r.miss(field, '不是数组');
    return undefined;
  }
  const out: T[] = [];
  const path = field === '' ? '' : field;
  value.forEach((entry, index) => {
    const at = path === '' ? `[${index}]` : `${path}[${index}]`;
    if (!isRecord(entry)) {
      r.miss(at, '不是一个对象');
      return;
    }
    const item = read(entry, scoped(r, at));
    if (item !== null) out.push(item);
  });
  return out;
}

/**
 * 对象字段（例如 `StatsView.headline`）。
 *
 * 与 `readList` 同一套约定：不是对象就记一次 `miss` 并回落 undefined。
 */
export function readObject(
  r: Reading, value: unknown, field: string,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (isRecord(value)) return value;
  r.miss(field, '不是一个对象');
  return undefined;
}


/* ---------------------------------------------------------------- 类型断言 */

/** 结构相等（含可选性）判定：两边逐字段等价才是 true。 */
export type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
/** 断言：`T` 必须是 true，否则编译失败。用法见各组件里的 `export type _A = ...`。 */
export type AssertTrue<T extends true> = T;

/**
 * 组件内自声明的 props 必须与协议载荷**逐字段等价**。
 *
 * 每个组件把自己的入参类型写在自己文件里（可读、可就近写例值），协议仍是线上形状的
 * 唯一来源；`AssertTrue<Equal<...>>` 把两者绑死：字段名、可选性、枚举成员任何一边变了都
 * **编译失败**。
 * 用法：`export type _A = AssertTrue<Equal<CalloutProps, CalloutView>>;`
 */

