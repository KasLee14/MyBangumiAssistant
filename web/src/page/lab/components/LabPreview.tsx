import type { ReactNode } from 'react';
import { ContentBlock, type ContentBlockView } from '../../../components/content';
import { ContentErrorBoundary } from '../../../components/content/ContentErrorBoundary';
import type { ContentKind } from '../../../types/content';

/**
 * 预览：**走真实链路**（`ContentBlock`，外面套 `ContentErrorBoundary`），不直接调组件——
 * 否则改注册表时实验室发现不了。
 *
 * 外壳（头像 + 气泡）由调用方给：这里只负责「一块内容」，不做版式。
 * 组装不出载荷时（JSON 语法错误、必填字段为空）不渲染组件，只显示原因——那时没有载荷可依据。
 */
export function LabPreview({ kind, payload, problem }: {
  kind: ContentKind;
  payload: unknown;
  problem: string | null;
}): ReactNode {
  if (problem !== null) {
    return <div className="labProblem" role="status">{`还不能预览：${problem}`}</div>;
  }
  return (
    <ContentErrorBoundary kind={kind} data={payload}>
      <ContentBlock block={{ type: kind, pending: false, props: payload } as ContentBlockView} />
    </ContentErrorBoundary>
  );
}
