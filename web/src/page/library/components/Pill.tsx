import type { ReactNode } from 'react';

/**
 * 胶囊：标签、chip、读数共用的一种形态。
 *
 * 与 `MicroLabel` 的分工：MicroLabel 是「文字样式」，Pill 是「带底与描边的容器」。
 * 内容条目里的标签、输入区的读数胶囊、文档页的版本号都用它。
 */
export interface PillProps {
  children: ReactNode;
  className?: string | undefined;
  title?: string | undefined;
}

export function Pill({ children, className = '', title }: PillProps): ReactNode {
  return (
    <span className={`appPill ${className}`.trim()} title={title}>
      {children}
    </span>
  );
}
