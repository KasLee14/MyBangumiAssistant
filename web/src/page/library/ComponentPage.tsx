import { useMemo, useState, type ReactNode } from 'react';
import { Pill } from '../../components/common/Pill';
import { ContentBlock } from '../../components/content';
import { eventText, frameText, blockOf } from './items';
import type { LibrarySection } from './samples';

/**
 * 单个 kind 的详情页（**自绘**）。
 *
 * 内容严格只有四块（这是产品定的边界，别往里加第五块）：
 * 1. UI 预览——真实 `ContentBlock` 渲染主载荷，另给一张「空数据」变体；
 * 2. 参数——字段表，**下面一行参考附注**；
 * 3. 调试页 event 输入——可直接复制粘贴的 JSON；
 * 4. 调试页 frame 输入——同上。
 *
 * 页内目录由 `App` 指向这四块的 id，所以 id 命名是契约（见 `PAGE_ANCHORS`）。
 *
 * 骨架与卡片全部自绘：按钮用 `.button`（cards.css 的按钮基元）、标签用 `<Pill>`、
 * **参数表直接复用内容条目的表格皮肤 `.contentTable`**——同一张表的形态在一处定义，
 * 文档页只补「表头没有排序按钮」这一处差异。
 */

/** 四个块的锚点 id 与标题；`App` 的右侧目录按这份清单生成。 */
export const PAGE_ANCHORS = [
  { id: 'ui-preview', title: 'UI 预览' },
  { id: 'params', title: '参数' },
  { id: 'event', title: 'event 输入' },
  { id: 'frame', title: 'frame 输入' },
] as const;

/** 参数表五列；宽度按内容比例给，最后一列吃掉剩余宽度。 */
const PARAM_COLUMNS: readonly { title: string; width: string | undefined }[] = [
  { title: '字段', width: '22%' },
  { title: '类型', width: '20%' },
  { title: '必填', width: '9%' },
  { title: '取值', width: '24%' },
  { title: '说明', width: undefined },
];

/** 一段可复制的 JSON：自绘卡片 + 复制按钮，按钮文案自己切换作反馈。 */
function CodeBlock({ hint, code }: { hint: string; code: string }): ReactNode {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // 剪贴板不可用（非安全上下文等）时不谎报成功，让用户手动全选
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <section className="libCard">
      <header className="libCardHead">
        <span className="libCardTitle">{hint}</span>
        <button type="button" className="button sm" onClick={() => { void copy(); }}>
          {copied ? '已复制' : '复制'}
        </button>
      </header>
      <pre className="libCodeBody"><code>{code}</code></pre>
    </section>
  );
}

function ReferenceLine({ section }: { section: LibrarySection }): ReactNode {
  const reference = section.reference;
  return (
    <p className="libReferenceLine">
      参考：
      {reference === null
        ? '未使用 ReactBits 组件。'
        : (
          <>
            <a href={reference.url} target="_blank" rel="noreferrer">{reference.name}</a>
            <span className="libReferenceUsage">{reference.usage}</span>
          </>
        )}
    </p>
  );
}

export function ComponentPage({ section }: { section: LibrarySection }): ReactNode {
  const main = useMemo(() => blockOf(section.kind, section.payload), [section]);
  const empty = useMemo(() => blockOf(section.kind, section.empty), [section]);
  const event = useMemo(() => eventText(section), [section]);
  const frame = useMemo(() => frameText(section), [section]);

  return (
    <>
      <h2 className="libPageTitle">
        {section.title}
        <Pill>{section.kind}</Pill>
      </h2>
      <p className="libPageSummary">{section.summary}</p>

      <section id="ui-preview" className="libBlock">
        <h3 className="libBlockDivider">UI 预览</h3>
        <section className="libCard libPreviewCard">
          <header className="libCardHead">
            <span className="libCardTitle">主载荷</span>
            <button
              type="button"
              className="button sm"
              title="把这类的 event JSON 复制走"
              onClick={() => { void navigator.clipboard.writeText(event); }}
            >
              复制 event
            </button>
          </header>
          <div className="libCardBody"><ContentBlock block={main} /></div>
        </section>
        <section className="libCard libPreviewCard">
          <header className="libCardHead">
            <span className="libCardTitle">空数据</span>
          </header>
          <div className="libCardBody"><ContentBlock block={empty} /></div>
        </section>
      </section>

      <section id="params" className="libBlock">
        <h3 className="libBlockDivider">参数</h3>
        <div className="contentTableScroll">
          <table className="contentTable libParamTable">
            <caption className="contentTableCaption">{section.title} 的参数</caption>
            <thead>
              <tr>
                {PARAM_COLUMNS.map(column => (
                  <th
                    key={column.title}
                    style={column.width === undefined ? undefined : { width: column.width }}
                  >
                    {column.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.params.map(param => (
                <tr key={param.field}>
                  <td><code className="libCode">{param.field}</code></td>
                  <td>{param.type}</td>
                  <td data-required={param.required === '必填' ? 'true' : undefined}>{param.required}</td>
                  <td>{param.values === undefined ? '—' : <code className="libCode">{param.values}</code>}</td>
                  <td>{param.note}</td>
                </tr>
              ))}
              {section.params.length === 0 ? (
                <tr><td colSpan={PARAM_COLUMNS.length}>—</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <ReferenceLine section={section} />
      </section>

      <section id="event" className="libBlock">
        <h3 className="libBlockDivider">调试页 event 输入</h3>
        <CodeBlock hint="粘进调试页的「event 输入」框" code={event} />
      </section>

      <section id="frame" className="libBlock">
        <h3 className="libBlockDivider">调试页 frame 输入</h3>
        <CodeBlock hint="粘进「frame 输入」框（先把 event 框清空）" code={frame} />
      </section>
    </>
  );
}

// 这里原本有一个 `payloadFieldOf(kind)`：它回答「这个 kind 的载荷挂在块上的哪个字段名」。
// 定制组件的块形状统一为 `{ type, pending?, props }` 之后，块上的载荷字段恒为 `props`，
// 这个问题不再存在，函数与 `registry.tsx` 的 `field` 表一并移除。
