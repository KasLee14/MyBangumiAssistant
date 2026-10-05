import { useMemo, useState, type ReactNode } from 'react';
import { Button, Card, Divider, Table, Tag, Tooltip, Typography, type TableProps } from 'antd';
import { ContentItem } from '../../components/content';
import { eventText, frameText, itemOf } from './items';
import type { LibrarySection, ParamRow } from './samples';

/**
 * 单个 kind 的详情页。
 *
 * 内容严格只有五块（这是产品定的边界，别往里加第六块）：
 * 1. UI 预览——真实 `ContentItem` 渲染主载荷，另给一张「空数据」变体；
 * 2. customType——`customType: "<kind>"` 与载荷字段名（独立一块，不和参数表混在一起）；
 * 3. 参数——字段表，**下面一行参考附注**；
 * 4. 调试页 event 输入——可直接复制粘贴的 JSON；
 * 5. 调试页 frame 输入——同上。
 *
 * 页内目录由 `App` 指向这五块的 id，所以 id 命名是契约（见 `PAGE_ANCHORS`）。
 */

/** 五个块的锚点 id 与标题；`App` 的右侧目录按这份清单生成。 */
export const PAGE_ANCHORS = [
  { id: 'ui-preview', title: 'UI 预览' },
  { id: 'custom-type', title: 'customType' },
  { id: 'params', title: '参数' },
  { id: 'event', title: 'event 输入' },
  { id: 'frame', title: 'frame 输入' },
] as const;

const PARAM_COLUMNS: NonNullable<TableProps<ParamRow>['columns']> = [
  {
    title: '字段', dataIndex: 'field', width: '22%',
    render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
  },
  { title: '类型', dataIndex: 'type', width: '20%' },
  {
    title: '必填', dataIndex: 'required', width: '9%',
    render: (value: ParamRow['required']) => (
      <Typography.Text type={value === '必填' ? 'danger' : 'secondary'}>{value}</Typography.Text>
    ),
  },
  {
    title: '取值', dataIndex: 'values', width: '24%',
    render: (value?: string) => (value === undefined ? '—' : <Typography.Text code>{value}</Typography.Text>),
  },
  { title: '说明', dataIndex: 'note' },
];

/** 一段可复制的 JSON：antd 的卡片 + 复制按钮，按钮文案自己切换作反馈。 */
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
    <Card
      size="small"
      className="libCodeCard"
      title={<Typography.Text type="secondary">{hint}</Typography.Text>}
      extra={<Button size="small" onClick={() => { void copy(); }}>{copied ? '已复制' : '复制'}</Button>}
    >
      <pre className="libCodeBody"><code>{code}</code></pre>
    </Card>
  );
}

function ReferenceLine({ section }: { section: LibrarySection }): ReactNode {
  const reference = section.reference;
  return (
    <Typography.Paragraph type="secondary" className="libReferenceLine">
      参考：
      {reference === null
        ? '未使用 ReactBits 组件。'
        : (
          <>
            <a href={reference.url} target="_blank" rel="noreferrer">{reference.name}</a>
            <span className="libReferenceUsage">{reference.usage}</span>
          </>
        )}
    </Typography.Paragraph>
  );
}

export function ComponentPage({ section }: { section: LibrarySection }): ReactNode {
  const main = useMemo(() => itemOf(section.kind, section.payload, 1), [section]);
  const empty = useMemo(() => itemOf(section.kind, section.empty, 1), [section]);
  const event = useMemo(() => eventText(section), [section]);
  const frame = useMemo(() => frameText(section), [section]);

  return (
    <>
      <Typography.Title level={2} className="libPageTitle">
        {section.title}
        <Tag className="libKindTag">{section.kind}</Tag>
      </Typography.Title>
      <Typography.Paragraph type="secondary" className="libPageSummary">{section.summary}</Typography.Paragraph>

      <section id="ui-preview" className="libBlock">
        <Divider titlePlacement="start" className="libBlockDivider">UI 预览</Divider>
        <Card
          size="small"
          className="libPreviewCard"
          title="主载荷"
          extra={(
            <Tooltip title="把这类的 event JSON 复制走">
              <Button size="small" type="text" onClick={() => { void navigator.clipboard.writeText(event); }}>
                复制 event
              </Button>
            </Tooltip>
          )}
        >
          <ContentItem item={main} />
        </Card>
        <Card size="small" className="libPreviewCard" title="空数据">
          <ContentItem item={empty} />
        </Card>
      </section>

      <section id="custom-type" className="libBlock">
        <Divider titlePlacement="start" className="libBlockDivider">customType</Divider>
        <Typography.Paragraph className="libCustomType">
          <Typography.Text code>{`customType: "${section.kind}"`}</Typography.Text>
          <Typography.Text type="secondary">
            {' '}载荷放在事件的 <Typography.Text code>details</Typography.Text> 里，本条约目的载荷字段是
            {' '}<Typography.Text code>{payloadFieldOf(section.kind)}</Typography.Text>。
          </Typography.Text>
        </Typography.Paragraph>
      </section>

      <section id="params" className="libBlock">
        <Divider titlePlacement="start" className="libBlockDivider">参数</Divider>
        <Table<ParamRow>
          size="small"
          rowKey="field"
          columns={PARAM_COLUMNS}
          dataSource={[...section.params]}
          pagination={false}
          locale={{ emptyText: '—' }}
          className="libParamTable"
        />
        <ReferenceLine section={section} />
      </section>

      <section id="event" className="libBlock">
        <Divider titlePlacement="start" className="libBlockDivider">调试页 event 输入</Divider>
        <CodeBlock hint="粘进调试页的「event 输入」框" code={event} />
      </section>

      <section id="frame" className="libBlock">
        <Divider titlePlacement="start" className="libBlockDivider">调试页 frame 输入</Divider>
        <CodeBlock hint="粘进「frame 输入」框（先把 event 框清空）" code={frame} />
      </section>
    </>
  );
}

/** 载荷字段名：与 `registry.tsx` 的 `field` 一致，只有 `infobox` 不是同名。 */
function payloadFieldOf(kind: LibrarySection['kind']): string {
  return kind === 'infobox' ? 'info' : kind;
}
