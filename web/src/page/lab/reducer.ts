import type { LabCard, LabDraft, LabField, LabFieldKind } from './types';

/**
 * 卡片实验室的纯函数层：**草稿 ⇄ 载荷**。
 *
 * 为什么这一层单独成文件、且不碰 React：两个方向的数据转换（字段 → 载荷、载荷 → 字段）是本页
 * 唯一容易出错、也唯一值得单独验证的部分。它混进组件之后，就只能在「点一下、看一眼」的层面
 * 确认；留在这里，每一支都能被直接调用、直接断言。页面只负责把结果放进 state。
 *
 * 三条边界：
 * 1. **不判定载荷好坏**：字段少传一个、值不合约，由各内容组件自己的 `readXxx` 决定降级形态。
 *    这一层只回答「能不能组装」，不回答「组装出来对不对」。
 * 2. **回填与组装对称**：`draftFromPayload(payloadOf(draft))` 必须回到同一条草稿，否则
 *    「原始 JSON」来回切一次就会悄悄改数据。
 * 3. **解析失败不抛**：全部以判别联合返回，调用点（预览区 / 字段下方红字）自己决定怎么显示。
 */

/** 草稿 → 载荷的结果。`fieldErrors` 只在失败时非空，键是字段 key。 */
export type LabPayloadResult =
  | { readonly ok: true; readonly payload: unknown }
  | { readonly ok: false; readonly reason: string; readonly fieldErrors: Readonly<Record<string, string>> };

/** 原始 JSON 文本的解析结果。`payload` 就是交给 `ContentBlock` 的 props（`unknown`）。 */
export type LabRawResult =
  | { readonly ok: true; readonly payload: unknown }
  | { readonly ok: false; readonly reason: string };

/** 例值 → 初始草稿（「重置为默认值」也走这里，所以默认值只有生成物一个来源）。 */
export function draftOf(card: LabCard): LabDraft {
  const values: Record<string, string> = {};
  const omitted: Record<string, boolean> = {};
  for (const field of card.fields) {
    values[field.key] = field.value;
    omitted[field.key] = false;
  }
  return { values, omitted };
}

/** 草稿里的文本值。缺失按空串处理：控件是受控的，`undefined` 会让 input 变成非受控。 */
export function valueOf(draft: LabDraft, key: string): string {
  return draft.values[key] ?? '';
}

/** 这个字段是否被勾了「缺省」。 */
export function isOmitted(draft: LabDraft, key: string): boolean {
  return draft.omitted[key] === true;
}

export function withValue(draft: LabDraft, key: string, value: string): LabDraft {
  return { ...draft, values: { ...draft.values, [key]: value } };
}

export function withOmitted(draft: LabDraft, key: string, omitted: boolean): LabDraft {
  return { ...draft, omitted: { ...draft.omitted, [key]: omitted } };
}

/** 载荷里「是不是一个对象」。数组不算：`LabRoot` 已经把两种根分开表达。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * 生成器只产出四种控件形态，但生成物是 `as` 收窄来的——运行期可能多出一种。
 *
 * 未知一律按 `text` 处理：控件退化成单行输入框、载荷里发一个字符串。这比抛错好——生成器换一种
 * 控件形态时页面还能用，只是那个字段编辑起来不舒服；抛错会让整页白屏。
 */
function kindOf(field: LabField): LabFieldKind {
  switch (field.kind) {
    case 'textarea':
    case 'number':
    case 'select':
    case 'json':
    case 'list':
      return field.kind;
    default:
      return 'text';
  }
}

/**
 * 草稿 → 载荷。
 *
 * 几条刻意定下的口径（都不是「顺手」，是有代价的选择）：
 * - **缺省只对 `optional` 生效**：必填字段即使被勾上缺省也照发，否则一份草稿能让协议必填项
 *   静默消失，而预览看起来「只是没显示」。
 * - **空串在可缺省字段上等于没填**：清空 `detail` 与勾上缺省在载荷上应当同义；但必填字段的空串
 *   **原样保留**——`QuoteBlock.text` 的 `''` 是合法的「空引用块」，不是缺项。
 * - **`select` 的 true / false 发布尔**：生成器把布尔字段映射成 `select`（见 `types.LabFieldKind`），
 *   而 `readFlag` 只接受布尔；发字符串只会让组件静默回落默认值，发布尔才是那条元数据的意思。
 * - **数组根包一层**：`root: 'array'` 的 kind（`TagCloud`）字段描述的是**一个元素**，
 *   所以组装结果放进数组——否则那个 kind 永远只能渲染 `ContentRaw`。
 */
export function payloadOf(card: LabCard, draft: LabDraft): LabPayloadResult {
  const record: Record<string, unknown> = {};
  const fieldErrors: Record<string, string> = {};

  for (const field of card.fields) {
    if (field.optional && isOmitted(draft, field.key)) continue;

    const text = valueOf(draft, field.key);
    switch (kindOf(field)) {
      case 'json':
      case 'list': {
        if (text.trim() === '') {
          if (field.required) fieldErrors[field.key] = '是必填的 JSON 字段，现在是空的。';
          // 可缺省的结构化字段留空 = 不传（例：可选的分组信息）。
          break;
        }
        try {
          record[field.key] = JSON.parse(text);
        } catch (cause) {
          fieldErrors[field.key] = `的 JSON 解析失败：${messageOf(cause)}`;
        }
        break;
      }
      case 'number': {
        if (text.trim() === '') {
          if (field.required) fieldErrors[field.key] = '是必填的数字字段，现在是空的。';
          break;
        }
        const value = Number(text);
        if (!Number.isFinite(value)) {
          fieldErrors[field.key] = `不是有效数字：「${text}」。`;
          break;
        }
        record[field.key] = value;
        break;
      }
      case 'select': {
        if (text === 'true') {
          record[field.key] = true;
          break;
        }
        if (text === 'false') {
          record[field.key] = false;
          break;
        }
        if (text === '' && field.optional) break;
        record[field.key] = text;
        break;
      }
      default: {
        if (text === '' && field.optional) break;
        record[field.key] = text;
      }
    }
  }

  const failed = Object.keys(fieldErrors);
  if (failed.length > 0) {
    // 预览区只有一行位置，所以把字段名拼进 reason：否则用户不知道该改哪个控件。
    const key = failed[0] ?? '';
    return { ok: false, reason: `字段「${key}」${fieldErrors[key] ?? '无法组装。'}`, fieldErrors };
  }

  return { ok: true, payload: card.root === 'array' ? [record] : record };
}

/** 载荷里的任意值 → 控件文本。 */
function textOfValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // 对象与数组一律按 JSON 文本回填：json 字段本来就是这么编辑的；文本字段收到结构化值时，
  // 也只有这种表达不丢信息（截成 `[object Object]` 等于把数据抹掉）。
  return JSON.stringify(value, null, 2) ?? '';
}

/**
 * 从载荷里取出「字段对应的那一个对象」。
 *
 * 对象根就是它自己；数组根取第一个元素（数组根的字段组描述的是一个元素，见 `types.LabRoot`）。
 * 取不到就返回 null，由调用方决定回落到什么——这里不猜。
 */
function recordOfPayload(payload: unknown): Record<string, unknown> | null {
  if (Array.isArray(payload)) {
    const first: unknown = payload[0];
    return isRecord(first) ? first : null;
  }
  return isRecord(payload) ? payload : null;
}

/**
 * 载荷 → 草稿（「原始 JSON」切回字段表单时回填）。
 *
 * 原始 JSON 里**删掉或置 null** 的键按「勾上缺省」回填（可缺省字段）或「用回例值」（必填字段）：
 * 前者保住用户的意图，后者保住协议必填项。取不到字段对象时（例：数组根被用户写成空数组）
 * 回落到默认草稿——硬把空串塞回控件会让「切回来」看起来像把数据清空了。
 */
export function draftFromPayload(card: LabCard, payload: unknown): LabDraft {
  const record = recordOfPayload(payload);
  if (record === null) return draftOf(card);

  const values: Record<string, string> = {};
  const omitted: Record<string, boolean> = {};

  for (const field of card.fields) {
    const value = record[field.key];
    if (value === undefined || value === null) {
      values[field.key] = field.value;
      omitted[field.key] = field.optional;
      continue;
    }
    values[field.key] = textOfValue(value);
    omitted[field.key] = false;
  }
  return { values, omitted };
}

/**
 * 原始 JSON 文本 → 载荷。
 *
 * **数组根是合法的**：`TagCloud` 的载荷本体就是数组（生成物用 `root: 'array'` 标出来）。把数组
 * 判成坏数据会让 12 个 kind 里的一个永远预览不出来。只有标量根（字符串 / 数字 / 布尔 / null）
 * 与空文本才判「不能预览」——那几种情况下没有任何组件形态可依据。
 */
export function parseRawJson(text: string): LabRawResult {
  if (text.trim() === '') {
    return { ok: false, reason: '还没有内容：填一个 JSON 对象或数组，或者点「重置为默认值」。' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    return { ok: false, reason: `JSON 解析失败：${messageOf(cause)}` };
  }

  if (Array.isArray(parsed)) return { ok: true, payload: parsed };
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, reason: '载荷必须是对象或数组，现在是一个标量值。' };
  }
  return { ok: true, payload: parsed };
}

/** 载荷 → 可编辑 JSON 文本（两空格缩进：与文档页的代码块同一口径，方便逐行对照）。 */
export function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? '';
}

/**
 * 结构化列表字段：JSON 文本 → 数组。
 *
 * 解析失败或不是数组时返回 null，调用方（字段表单）据此退回「原始文本」编辑——
 * 这样用户把某一项改坏时仍然能修语法，而不是控件直接消失。
 */
export function itemsOf(text: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(text === '' ? '[]' : text);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 数组 → 写回字段的 JSON 文本（紧凑一行；换行由控件负责显示）。 */
export function itemsText(items: readonly unknown[]): string {
  return JSON.stringify(items);
}
