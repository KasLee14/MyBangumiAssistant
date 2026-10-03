import type { ReactNode } from 'react';
import type { InfoBoxView } from '../../../../bangumi/src/web/protocol';

/**
 * 键值信息栏（条目页左栏 infobox）。
 *
 * 用 `dl` 而不是两列表格：语义上这就是「名称–值」对，屏幕阅读器会把 label 与
 * value 成对读出；两列布局交给 CSS 网格，窄宽度下自动叠成上下两行。
 */
export function InfoBox({ view }: { view: InfoBoxView }): ReactNode {
  const { title, rows } = view;
  return (
    <section className="contentBlock contentInfoBox" aria-label={title === undefined || title === '' ? '基本信息' : title}>
      {title === undefined || title === '' ? null : <h3 className="contentBlockTitle">{title}</h3>}
      {rows.length === 0 ? (
        <p className="contentEmpty">没有可展示的信息。</p>
      ) : (
        <dl className="contentInfoList">
          {rows.map((row, index) => (
            <div key={`${row.label}-${index}`} className="contentInfoRow" data-tone={row.tone ?? 'default'}>
              <dt className="contentInfoLabel">{row.label}</dt>
              <dd className="contentInfoValue">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
