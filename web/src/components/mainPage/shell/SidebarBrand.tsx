import type { ReactNode } from 'react';

/**
 * 侧栏品牌区。
 *
 * 单独成文件是因为它有第二个使用者：调试页的侧栏也要这个品牌行，并且同样要求
 * 「双击品牌区切换页面」。两处共用一份 DOM 与事件，避免调试入口的落点漂移。
 *
 * `onDoubleClick` 由调用方决定：主界面传「进入调试页」，调试页传「返回主界面」。
 */
export function SidebarBrand({
  onDoubleClick, title, children,
}: {
  onDoubleClick(): void;
  /** 悬停提示；两处的语义不同（进入 / 返回）。 */
  title: string;
  /** 品牌行右侧的控件；未传时保持原样（只有折叠按钮）。 */
  children?: ReactNode;
}): ReactNode {
  return (
    <div className="appLogoRow">
      <span
        className="appBrand appBrandAction"
        data-debug-toggle="true"
        role="button"
        tabIndex={0}
        title={title}
        onDoubleClick={onDoubleClick}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') onDoubleClick();
        }}
      >
        Bangumi 助手
      </span>
      {children}
    </div>
  );
}
