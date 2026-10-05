import { useMemo, type ReactNode } from 'react';
import { Card, Col, Row, Tag, Typography } from 'antd';
import { ContentBlock } from '../../components/content';
import { blockOf } from './items';
import { componentHref, navigate } from './router';
import type { LibrarySection } from './samples';
import { LIBRARY_SECTIONS } from './samples';

/**
 * 总览页：12 张卡片，对应 ant.design 文档站的「组件总览」。
 *
 * 每张卡是「kind 名 + 中文名 + 一句话 + 一张小预览」，点卡片进详情页。
 * 预览用的是**真实 `ContentBlock`**，不是缩略图——所以总览页本身也是一次渲染核对。
 */
function OverviewCard({ section }: { section: LibrarySection }): ReactNode {
  const block = useMemo(() => blockOf(section.kind, section.payload), [section]);
  return (
    <Card
      hoverable
      size="small"
      className="libOverviewCard"
      onClick={() => navigate(componentHref(section.kind))}
      title={<span className="libOverviewTitle">{section.title}<Tag className="libKindTag">{section.kind}</Tag></span>}
    >
      <Typography.Paragraph type="secondary" className="libOverviewSummary" ellipsis={{ rows: 2 }}>
        {section.summary}
      </Typography.Paragraph>
      <div className="libOverviewPreview" aria-hidden="true">
        <ContentBlock block={block} />
      </div>
    </Card>
  );
}

export function Overview({ sections }: { sections: LibrarySection[] }): ReactNode {
  return (
    <>
      <Typography.Title level={2} className="libPageTitle">内容组件库</Typography.Title>
      <Typography.Paragraph type="secondary">
        {`${LIBRARY_SECTIONS.length} 种内容条目：真实组件渲染、参数契约，以及可直接粘进调试页的 event 与 frame。`}
        {sections.length === LIBRARY_SECTIONS.length
          ? null
          : ` 当前筛选出 ${sections.length} 个。`}
      </Typography.Paragraph>
      <Row gutter={[16, 16]}>
        {sections.map(section => (
          <Col key={section.kind} xs={24} sm={12} lg={8} xxl={6}>
            <OverviewCard section={section} />
          </Col>
        ))}
      </Row>
      {sections.length === 0 ? (
        <Typography.Paragraph type="secondary" className="libEmptyHint">
          没有匹配的组件，清空搜索框试试。
        </Typography.Paragraph>
      ) : null}
    </>
  );
}
