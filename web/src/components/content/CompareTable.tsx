import type { ReactNode } from 'react';
import type { CompareView } from '../../types/protocol';
import { ContentRaw } from './ContentRaw';
import { type AssertTrue, type Equal, isRecord, readFlag, readMaybeText, readText, reading } from './payload';

/** 一行对照。等价性由 `_A` 把住。 */
export interface CompareTableRowProps {
  /** 字段名（例：评分） */
  label: string;
  /** 修改前（例：8） */
  before: string;
  /** 修改后（例：9） */
  after: string;
  /** 是否真的变了；决定这一行是否强调（例：true） */
  changed: boolean;
}

/** 入参。 */
export interface CompareTableProps {
  /** 区块标题（例：写入结果） */
  title?: string;
  /** 逐字段对照（例：[{"label":"评分","before":"8","after":"9","changed":true},{"label":"短评","before":"（空）","after":"神作","changed":true},{"label":"标签","before":"音乐","after":"音乐","changed":false}]） */
  rows: CompareTableRowProps[];
  /** 脚注（例：只列出被写入的字段） */
  note?: string;
}
export type _A = AssertTrue<Equal<CompareTableRowProps, CompareView['rows'][number]>>;
export type _B = AssertTrue<Equal<CompareTableProps, CompareView>>;

/**
 * 修改前后对比（V3 · 点睛对比）。每行一条 flex 线、没有表头：三列表头会把每条记录压成
 * 窄格，而中间那支箭头已经把列义说清楚了。
 *
 * 「修改后」是权威状态，所以 `<ins>` 常驻；「修改前」只在 `changed` 为真时套 `<del>`——
 * 即使去掉颜色，删除线仍然说明「这个值被替换过」。
 */
export function CompareTable({ view }: { view: CompareTableProps }): ReactNode {
  if (!isRecord(view)) return <ContentRaw kind="CompareTable" data={view} />;
  if (!Array.isArray(view.rows)) return <ContentRaw kind="CompareTable" data={view} />;

  const r = reading('CompareTable');
  const rows: CompareTableRowProps[] = [];
  view.rows.forEach((row, index) => {
    if (!isRecord(row)) {
      r.miss(`rows[${index}]`, '不是一个对象');
      return;
    }
    // 局部降级：字段名取不到的整行剔除；`changed` 不是布尔时按 true（保守：当成改过）。
    const label = readText(r, row.label, `rows[${index}].label`);
    if (label === '') return;
    rows.push({
      label,
      before: readText(r, row.before, `rows[${index}].before`),
      after: readText(r, row.after, `rows[${index}].after`),
      changed: readFlag(r, row.changed, `rows[${index}].changed`, true),
    });
  });

  const title = readMaybeText(r, view.title, 'title');
  const note = readMaybeText(r, view.note, 'note');
  return (
    <section className="contentBlock contentCompare" aria-label={title === undefined || title === '' ? '修改对比' : title}>
      {title === undefined || title === '' ? null : <h3 className="contentBlockTitle">{title}</h3>}
      {rows.length === 0 ? (
        <p className="contentEmpty">没有可对比的字段。</p>
      ) : (
        <ul className="contentCompareList">
          {rows.map((row, index) => (
            <li key={`${row.label}-${index}`} className="contentCompareLine" data-changed={row.changed}>
              <span className="contentCompareField">{row.label}</span>
              <span className="contentCompareBefore">
                {row.changed ? <del>{row.before}</del> : row.before}
              </span>
              <span className="contentCompareArrow" aria-hidden="true">→</span>
              <span className="contentCompareAfter"><ins>{row.after}</ins></span>
              {row.changed ? <span className="contentCompareTag">已修改</span> : null}
            </li>
          ))}
        </ul>
      )}
      {note === undefined || note === '' ? null : <p className="contentNote">{note}</p>}
    </section>
  );
}
