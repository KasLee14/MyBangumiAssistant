import { useState, type ReactNode } from 'react';
import type { TableView } from '../../types/protocol';
import { ContentRaw } from './ContentRaw';
import { type AssertTrue, type Equal, isRecord, readChoice, readMaybeText, readText, reading } from './payload';

/** 一列。等价性由 `_A` 把住。 */
export interface DataTableColumnProps {
  /** 取值键，同时是 React key（例：ep） */
  key: string;
  /** 表头文字（例：话） */
  label: string;
  /** 对齐方式（例：right） */
  align?: 'left' | 'right';
}

/** 入参。 */
export interface DataTableProps {
  /** 区块标题（例：章节列表） */
  title?: string;
  /** 列定义（例：[{"key":"ep","label":"话","align":"right"},{"key":"title","label":"标题"}]） */
  columns: DataTableColumnProps[];
  /** 每行按列 key 取值（例：[{"ep":"1","title":"轻音部！"},{"ep":"2","title":"乐器！"},{"ep":"10","title":"合宿！"}]） */
  rows: Record<string, string>[];
  /** 关键列：该列的值走主色深字（例：ep） */
  keyColumn?: string;
  /** 当前行：按关键列的值匹配（例：2） */
  currentRow?: string;
  /** 脚注（例：共 13 话，展示前 3 话） */
  note?: string;
}
export type _A = AssertTrue<Equal<DataTableColumnProps, TableView['columns'][number]>>;
export type _B = AssertTrue<Equal<DataTableProps, TableView>>;

const ALIGNS = ['left', 'right'] as const;
type SortState = { key: string; desc: boolean } | null;

/** 取单元格文本；缺值返回空字符串（表格里留空比显示「undefined」更诚实）。 */
function cellText(row: Record<string, string>, key: string): string | undefined {
  return Object.hasOwn(row, key) ? row[key] : undefined;
}

/**
 * 结构化表格。只做本地排序：宿主给的 `rows` 顺序是有意义的默认序，用户点表头只改变
 * 呈现顺序。比较用 `localeCompare` 让「第 10 话」排在「第 9 话」之后；空单元格始终排末尾。
 */
export function DataTable({ view }: { view: DataTableProps }): ReactNode {
  if (!isRecord(view)) return <ContentRaw kind="DataTable" data={view} />;
  if (!Array.isArray(view.columns) || !Array.isArray(view.rows)) return <ContentRaw kind="DataTable" data={view} />;

  const r = reading('DataTable');
  const columns: DataTableColumnProps[] = [];
  view.columns.forEach((column, index) => {
    if (!isRecord(column)) {
      r.miss(`columns[${index}]`, '不是一个对象');
      return;
    }
    // 局部降级：没有 key 的列剔除（既不能取值也不能当 React key）；label 缺失用 key 兜底。
    const key = readText(r, column.key, `columns[${index}].key`);
    if (key === '') return;
    const label = readText(r, column.label, `columns[${index}].label`);
    columns.push({
      key,
      label: label === '' ? key : label,
      align: readChoice(r, column.align, `columns[${index}].align`, ALIGNS, 'left'),
    });
  });

  // 行不整行剔除：缺哪格只是那格空着；非字符串单元格转空串（表格里混排数字更糟）。
  const rows: Record<string, string>[] = [];
  view.rows.forEach((row, index) => {
    if (!isRecord(row)) {
      r.miss(`rows[${index}]`, '不是一个对象');
      rows.push({});
      return;
    }
    const cells: Record<string, string> = {};
    for (const [key, cell] of Object.entries(row)) {
      if (typeof cell === 'string') cells[key] = cell;
      else if (cell !== undefined) r.miss(`rows[${index}].${key}`, '不是字符串');
    }
    rows.push(cells);
  });

  const [sort, setSort] = useState<SortState>(null);
  const title = readMaybeText(r, view.title, 'title');
  const note = readMaybeText(r, view.note, 'note');
  const keyColumn = readMaybeText(r, view.keyColumn, 'keyColumn');
  const currentRow = readMaybeText(r, view.currentRow, 'currentRow');
  const primaryKey = columns[0]?.key ?? '';
  const currentKey = keyColumn ?? primaryKey;

  const sorted = sort === null ? rows : rows.slice().sort((left, right) => {
    const a = cellText(left, sort.key) ?? '';
    const b = cellText(right, sort.key) ?? '';
    if (a === '' && b === '') return 0;
    if (a === '') return 1;
    if (b === '') return -1;
    const order = a.localeCompare(b, 'zh-Hans-CN', { numeric: true });
    return sort.desc ? -order : order;
  });

  function toggle(key: string): void {
    setSort(current => current !== null && current.key === key ? { key, desc: !current.desc } : { key, desc: false });
  }

  function sortOf(key: string): 'ascending' | 'descending' | 'none' {
    if (sort === null || sort.key !== key) return 'none';
    return sort.desc ? 'descending' : 'ascending';
  }

  return (
    <section className="contentBlock contentTableBlock" aria-label={title === undefined || title === '' ? '数据表格' : title}>
      {title === undefined || title === '' ? null : <h3 className="contentBlockTitle">{title}</h3>}
      {columns.length === 0 ? (
        <p className="contentEmpty">没有可展示的列。</p>
      ) : (
        <div className="contentTableScroll">
          <table className="contentTable">
            {title === undefined || title === '' ? null : <caption className="contentTableCaption">{title}</caption>}
            <thead>
              <tr>
                {columns.map(column => (
                  <th
                    key={column.key}
                    scope="col"
                    className="contentTableCell"
                    data-align={column.align ?? 'left'}
                    aria-sort={sortOf(column.key)}
                  >
                    <button type="button" className="contentTableSort" onClick={() => toggle(column.key)}>
                      {column.label}
                      <span className="contentTableSortMark" aria-hidden="true">
                        {sort !== null && sort.key === column.key ? (sort.desc ? '▼' : '▲') : '↕'}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, index) => {
                // 行没有稳定 id，用「首列内容 + 序号」作为 key。
                const isCurrent = currentRow !== undefined && currentRow !== '' && cellText(row, currentKey) === currentRow;
                return (
                  <tr key={`${cellText(row, primaryKey) ?? ''}#${index}`} data-current={isCurrent}>
                    {columns.map(column => {
                      const isKey = keyColumn !== undefined && keyColumn !== '' && column.key === keyColumn;
                      return (
                        <td
                          key={column.key}
                          className={isKey ? 'contentTableCell contentTableKey' : 'contentTableCell'}
                          data-align={column.align ?? 'left'}
                        >
                          {cellText(row, column.key) ?? ''}
                          {isCurrent && (isKey || (keyColumn === undefined && column.key === primaryKey)) ? (
                            <span className="contentTableCurrent">当前</span>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {note === undefined || note === '' ? null : <p className="contentNote">{note}</p>}
    </section>
  );
}
