import { useState, type ReactNode } from 'react';
import type { TableView } from '../../../../bangumi/src/web/protocol';

type SortState = { key: string; desc: boolean } | null;

/** 取单元格文本；缺值返回空字符串（表格里留空比显示「undefined」更诚实）。 */
function cellText(row: Record<string, string>, key: string): string | undefined {
  return Object.hasOwn(row, key) ? row[key] : undefined;
}

/**
 * 结构化表格。
 *
 * 只做本地排序：宿主给的 `rows` 顺序是有意义的默认序（例如按章节号），用户点表头
 * 只改变呈现顺序，不回写数据、不发请求。排序比较用 `localeCompare`，让「第 10 话」
 * 这类中文数字串也得到自然顺序；空单元格始终排到末尾，不参与比较。
 */
export function DataTable({ view }: { view: TableView }): ReactNode {
  const { title, columns, rows, note, keyColumn, currentRow } = view;
  const [sort, setSort] = useState<SortState>(null);
  // 首列用于给行生成 key；列可以为空，所以先取出再兜底。
  const primaryKey = columns[0]?.key ?? '';
  // 「当前行」按 `keyColumn`（缺省首列）的值匹配；宿主没给 `currentRow` 就一层强调都不加。
  const currentKey = keyColumn ?? primaryKey;

  const sorted = sort === null ? rows : rows.slice().sort((left, right) => {    const a = cellText(left, sort.key) ?? '';
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

  /** 表头按钮的 aria-sort 值：让屏幕阅读器知道当前排序列与方向。 */
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
                // 行没有稳定 id，用「首列内容 + 序号」作为 key：序号保证同一内容的多行也能区分。
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
                          {/* 「当前」徽章跟在关键值后面（V3 点睛的第二通道）；
                              没有关键列时退回首格，免得徽章孤零零地挂在行尾。 */}
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
