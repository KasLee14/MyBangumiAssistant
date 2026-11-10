import type { ReactNode } from 'react';
import { isOmitted, itemsOf, itemsText, valueOf } from '../reducer';
import type { LabCard, LabDraft, LabField } from '../types';

/** 单个控件；`kind: 'list'` 由 `LabListField` 单独处理（它要渲染一组子卡）。 */
function controlOf(
  field: LabField,
  value: string,
  onChange: (next: string) => void,
  disabled: boolean,
  invalid: boolean,
  id: string,
  ariaLabel?: string,
): ReactNode {
  const common = { id, disabled, 'data-invalid': invalid ? 'true' : undefined } as const;

  if (field.kind === 'select') {
    return (
      <select {...common} className="labFieldSelect" value={value} onChange={event => { onChange(event.target.value); }}>
        {(field.options ?? []).map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  if (field.kind === 'json') {
    return (
      <textarea
        {...common}
        aria-label={ariaLabel ?? field.key}
        className="labFieldArea"
        spellCheck={false}
        value={value}
        onChange={event => { onChange(event.target.value); }}
      />
    );
  }
  return (
    <input
      {...common}
      className="labFieldInput"
      type="text"
      inputMode={field.kind === 'number' ? 'decimal' : undefined}
      value={value}
      onChange={event => { onChange(event.target.value); }}
    />
  );
}

/** 子字段值 → 控件里的文本。 */
function textOfItem(item: unknown, key: string, kind: string): string {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) return '';
  const raw = (item as Record<string, unknown>)[key];
  if (raw === undefined) return '';
  if (kind === 'json' || typeof raw === 'object') return JSON.stringify(raw);
  return String(raw);
}

/**
 * 子字段文本 → 载荷里的值。
 *
 * `number` 能解析就发数字、解析不动就发原字符串——后者正是「类型错误」那一档要的形态，
 * 实验室不应替用户把非法输入吞掉。`json` 同理：解析成功才发布尔/数组，失败就发字符串，
 * 让组件的降级路径能被看到。
 */
function valueOfItem(text: string, kind: string): unknown {
  if (kind === 'number') {
    const trimmed = text.trim();
    if (trimmed === '') return undefined;
    const parsed = Number(trimmed);
    return Number.isNaN(parsed) ? text : parsed;
  }
  if (kind === 'json') {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  if (kind === 'select' && (text === 'true' || text === 'false')) return text === 'true';
  return text;
}

/**
 * 列表字段：一组「第 N 项 + 删除」的子卡 +「添加一项」。
 *
 * 值仍然是**一个 JSON 字符串**（`LabDraft` 的约定：字段 → 文本），这里只做
 * 「解析 → 改一项 → 序列化回文本」。好处是草稿/组装/回填三处逻辑完全不用改；
 * 代价是每次按键都要解析一次整份数组——条目数量级在几十，可以接受。
 *
 * 数组本身解析不出来时退回一个 textarea：否则用户改坏一个逗号就再也改不回来。
 */
function LabListField({ field, value, onChange }: {
  field: LabField;
  value: string;
  onChange: (next: string) => void;
}): ReactNode {
  const items = itemsOf(value);
  if (items === null) {
    return (
      <>
        <textarea
          className="labFieldArea"
          aria-label={`${field.key}（JSON 语法有误）`}
          spellCheck={false}
          value={value}
          data-invalid="true"
          onChange={event => { onChange(event.target.value); }}
        />
        <span className="labFieldError">这份数组的 JSON 语法不对，先在这里修好再逐项编辑。</span>
      </>
    );
  }

  const write = (next: unknown[]): void => { onChange(itemsText(next)); };

  const setField = (index: number, key: string, kind: string, text: string): void => {
    const next = items.map((item, at) => {
      if (at !== index) return item;
      const record = typeof item === 'object' && item !== null && !Array.isArray(item)
        ? { ...(item as Record<string, unknown>) }
        : {};
      const parsed = valueOfItem(text, kind);
      if (parsed === undefined) delete record[key];
      else record[key] = parsed;
      return record;
    });
    write(next);
  };

  return (
    <div className="labGroup">
      {items.length === 0 ? (
        <p className="labGroupEmpty">这个数组是空的：点下面的「添加一项」加一条。</p>
      ) : null}
      {items.map((item, index) => (
        <div className="labItem" key={index}>
          <div className="labItemHead">
            <span>{`第 ${index + 1} 项`}</span>
            <button
              type="button"
              className="labDelete"
              onClick={() => { write(items.filter((_, at) => at !== index)); }}
            >
              删除
            </button>
          </div>
          <div className="labItemGrid">
            {(field.itemFields ?? []).map(sub => (
              <label className="labItemCell" key={sub.key}>
                <span className="labItemLabel">
                  {sub.key}
                  {sub.optional ? null : <em>必填</em>}
                </span>
                {controlOf(
                  sub,
                  textOfItem(item, sub.key, sub.kind),
                  text => { setField(index, sub.key, sub.kind, text); },
                  false,
                  false,
                  `lab-item-${field.key}-${index}-${sub.key}`,
                  `${field.key}[${index}].${sub.key}`,
                )}
              </label>
            ))}
          </div>
        </div>
      ))}
      <button type="button" className="labAdd" onClick={() => { write([...items, {}]); }}>
        + 添加一项
      </button>
    </div>
  );
}

/**
 * 右侧「配置项」：字段名 + 可选勾选 + 控件 + 说明。
 *
 * 每行三列（名称 / 控件 / 缺省），说明与字段级错误挂在控件下方。列表字段用子卡组渲染
 * （`LabListField`）——工作台最有价值的一处：改一条条目不用碰 JSON 语法。
 */
export function LabFieldForm({ card, draft, fieldErrors, onValue, onOmit }: {
  card: LabCard;
  draft: LabDraft;
  fieldErrors: Readonly<Record<string, string>>;
  onValue: (key: string, value: string) => void;
  onOmit: (key: string, omitted: boolean) => void;
}): ReactNode {
  return (
    <div className="labConfigBody">
      {card.fields.map(field => {
        const value = valueOf(draft, field.key);
        const omitted = isOmitted(draft, field.key);
        const error = fieldErrors[field.key];
        const controlId = `lab-field-${card.kind}-${field.key}`;

        return (
          <div className="labField" key={field.key}>
            <div className="labFieldHead">
              <b className="labFieldKey" data-required={field.optional ? undefined : 'true'}>{field.key}</b>
              {field.optional ? (
                <label className="labOptional" title="取消勾选表示这个键不出现在载荷里">
                  <input
                    type="checkbox"
                    checked={!omitted}
                    onChange={event => { onOmit(field.key, !event.target.checked); }}
                  />
                  可选
                </label>
              ) : null}
            </div>

            {field.kind === 'list' ? (
              <LabListField
                field={field}
                value={value}
                onChange={next => { onValue(field.key, next); }}
              />
            ) : (
              controlOf(
                field,
                value,
                next => { onValue(field.key, next); },
                omitted,
                error !== undefined,
                controlId,
              )
            )}

            {error === undefined ? null : <span className="labFieldError">{error}</span>}
            {field.hint === undefined || field.hint === '' ? null : (
              <span className="labFieldHint">{field.hint}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
