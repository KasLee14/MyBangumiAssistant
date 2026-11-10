import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ContentRaw } from './ContentRaw';

interface ContentErrorBoundaryProps {
  /** 出错时显示在兜底块里的 kind 名。 */
  kind: string;
  /** 出错时折叠显示的原始载荷。 */
  data: unknown;
  children: ReactNode;
}

interface ContentErrorBoundaryState {
  error: Error | null;
}

/**
 * 内容块的**最后一道**兜底。
 *
 * 与各组件内的 `readXxx` 分工：
 * - `readXxx` 处理**可预期**的坏数据（类型不对、缺字段、坏地址），降级是设计好的形态；
 * - 这个边界处理**漏网**的异常（判定写漏一个分支、某个字段在渲染期才炸）。
 *
 * 改造前整块只有一个 `validateMessageBlock`，它一旦放行，渲染期抛错就没有任何拦截——
 * 一处异常会炸掉所在 React 子树，会话流跟着中断。这次把判定分散进 12 个组件之后，
 * 「漏一个分支」的概率变高，因此必须有这层。
 *
 * 重置策略是「载荷换了就重试」：同一个块在流式期会从残缺变为完整，如果失败一次就永久
 * 停在兜底块，那么一条先坏后好的数据再也回不来。用**引用比较**而不是深比较——宿主侧的
 * 流式投影做了结构共享，引用变就是真的变了。
 */
export class ContentErrorBoundary extends Component<ContentErrorBoundaryProps, ContentErrorBoundaryState> {
  state: ContentErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ContentErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 开发期诊断：这条是「判定漏了」的直接证据，比任何 console.warn 都重要。
    console.error(`[content] ${this.props.kind} 渲染抛错`, error, info.componentStack);
  }

  componentDidUpdate(previous: ContentErrorBoundaryProps): void {
    if (this.state.error !== null && previous.data !== this.props.data) {
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    if (this.state.error !== null) {
      return <ContentRaw kind={this.props.kind} data={this.props.data} />;
    }
    return this.props.children;
  }
}
