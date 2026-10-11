import type { ReactNode } from 'react';

/**
 * 顶栏骨架：**调试页与组件库文档页共用**。主界面已按 C01 删除顶栏
 * （品牌 / 折叠 / 新建 / 连接状态 / 设置全部迁进侧栏），不再使用这个组件。
 *
 * 意义在于「改一处两个入口同改」：顶栏形态只有这一份定义，各入口只决定放什么进去。
 * 骨架与样式见 `styles/common.css` 的 `.appTopBar*`。
 */
export interface AppTopBarProps {
  /** 最左侧（通常放侧栏折叠按钮） */
  leading?: ReactNode | undefined;
  brand: ReactNode;
  /** 栏目/入口链接，通常是一个或多个 AppTopBarTab */
  tabs?: ReactNode | undefined;
  /** 右侧动作区（靠右） */
  actions?: ReactNode | undefined;
}

export function AppTopBar({ leading, brand, tabs, actions }: AppTopBarProps): ReactNode {
  return (
    <header className="appTopBar">
      {leading}
      <span className="appTopBarBrand">{brand}</span>
      {tabs}
      <div className="appTopBarActions">{actions}</div>
    </header>
  );
}

export interface AppTopBarTabProps {
  children: ReactNode;
  current?: boolean | undefined;
  onClick?: (() => void) | undefined;
  title?: string | undefined;
}

/** 顶栏栏目：当前项只用一条 2px 主色下划线表态，不做底色块。 */
export function AppTopBarTab({ children, current, onClick, title }: AppTopBarTabProps): ReactNode {
  return (
    <button
      type="button"
      className="appTopBarTab"
      data-current={current === true ? 'true' : undefined}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}
