import type { ReactNode } from 'react';
import type { CompareView } from '../../../../bangumi/src/web/protocol';

/**
 * 修改前后对比。
 *
 * 「修改后」是权威状态，所以整列都用 `<ins>`（下划线由样式去掉，改为主色强调）；
 * 「修改前」只在 `changed` 为真时套 `<del>`，未变的字段不做多余装饰。这样即使完全
 * 去掉颜色，删除线仍然说明「这个值被替换过」——只靠颜色的差异对色觉障碍用户不可读。
 */
export function CompareTable({ view }: { view: CompareView }): ReactNode {
  const { title, rows, note } = view;
  return (
    <section className="contentBlock contentCompare" aria-label={title === undefined || title === '' ? '修改对比' : title}>
      {title === undefined || title === '' ? null : <h3 className="contentBlockTitle">{title}</h3>}
      {rows.length === 0 ? (
        <p className="contentEmpty">没有可对比的字段。</p>
      ) : (
        <div className="contentTableScroll">
          <table className="contentTable contentCompareTable">
            <thead>
              <tr>
                <th scope="col" className="contentTableCell">字段</th>
                <th scope="col" className="contentTableCell">修改前</th>
                <th scope="col" className="contentTableCell">修改后</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.label}-${index}`} data-changed={row.changed}>
                  <th scope="row" className="contentTableCell contentCompareLabel">{row.label}</th>
                  <td className="contentTableCell contentCompareBefore">
                    {row.changed ? <del>{row.before}</del> : row.before}
                  </td>
                  <td className="contentTableCell contentCompareAfter"><ins>{row.after}</ins></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {note === undefined || note === '' ? null : <p className="contentNote">{note}</p>}
    </section>
  );
}
