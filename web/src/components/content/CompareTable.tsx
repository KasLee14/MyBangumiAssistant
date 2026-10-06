import type { ReactNode } from 'react';
import type { CompareView } from '../../../../bangumi/src/web/protocol';

/**
 * 修改前后对比（V3 · 点睛对比）。
 *
 * 结构取自样张 `style-demo-content-v2.html` 的 V3 列：**每行一条 flex 线**，
 * 没有表头——字段名是行首的弱色小标签，值只呈现「旧 → 新」。
 *
 * 为什么不留表头：三列表头会把每条记录压成窄格，中文字段名与长值都容易被截；
 * 而中间那支箭头本身已经把列义说清楚了。
 *
 * 「修改后」是权威状态，所以 `<ins>` 常驻；「修改前」只在 `changed` 为真时套 `<del>`——
 * 即使完全去掉颜色，删除线仍然说明「这个值被替换过」，不把可读性押在颜色上。
 * 行尾的「已修改」标签是**第二通道**，只有 `changed` 的行才有。
 */
export function CompareTable({ view }: { view: CompareView }): ReactNode {
  const { title, rows, note } = view;
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
              {/* 只有 changed 的行给「已修改」标签：它是第二通道，不是每行都贴的装饰 */}
              {row.changed ? <span className="contentCompareTag">已修改</span> : null}
            </li>
          ))}
        </ul>
      )}
      {note === undefined || note === '' ? null : <p className="contentNote">{note}</p>}
    </section>
  );
}
