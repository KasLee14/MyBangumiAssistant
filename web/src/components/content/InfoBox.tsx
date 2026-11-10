import type { ReactNode } from 'react';
import type { InfoBoxView } from '../../types/protocol';
import { ContentRaw } from './ContentRaw';
import { type AssertTrue, type Equal, isRecord, readChoice, readMaybeText, readText, reading } from './payload';

/** 一行键值。等价性由 `_A` 把住。 */
export interface InfoBoxRowProps {
  /** 名称（例：中文名） */
  label: string;
  /** 值（例：轻音少女） */
  value: string;
  /** 次要信息降调（例：muted） */
  tone?: 'default' | 'muted';
}

/** 入参。 */
export interface InfoBoxProps {
  /** 区块标题（例：作品信息） */
  title?: string;
  /** 键值行（例：[{"label":"中文名","value":"轻音少女"},{"label":"话数","value":"13 话 + OVA"},{"label":"放送开始","value":"2009-04-03"}]） */
  rows: InfoBoxRowProps[];
}
export type _A = AssertTrue<Equal<InfoBoxRowProps, InfoBoxView['rows'][number]>>;
export type _B = AssertTrue<Equal<InfoBoxProps, InfoBoxView>>;

const TONES = ['default', 'muted'] as const;

/**
 * 键值信息栏（条目页左栏 infobox）。
 *
 * 用 `dl` 而不是两列表格：语义上这就是「名称–值」对，屏幕阅读器会把 label 与
 * value 成对读出；两列布局交给 CSS 网格，窄宽度下自动叠成上下两行。
 */
export function InfoBox({ view }: { view: InfoBoxProps }): ReactNode {
  if (!isRecord(view)) return <ContentRaw kind="InfoBox" data={view} />;
  if (!Array.isArray(view.rows)) return <ContentRaw kind="InfoBox" data={view} />;

  const r = reading('InfoBox');
  const rows: InfoBoxRowProps[] = [];
  view.rows.forEach((row, index) => {
    if (!isRecord(row)) {
      r.miss(`rows[${index}]`, '不是一个对象');
      return;
    }
    // 局部降级：名称与值都取不到的整行剔除（这一行没有任何可读信息）。
    const label = readText(r, row.label, `rows[${index}].label`);
    const value = readText(r, row.value, `rows[${index}].value`);
    if (label === '' && value === '') return;
    rows.push({ label, value, tone: readChoice(r, row.tone, `rows[${index}].tone`, TONES, 'default') });
  });

  const title = readMaybeText(r, view.title, 'title');
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
