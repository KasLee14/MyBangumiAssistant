import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { PATH } from '../constants/paths';

/**
 * 全局未命中页（路由表的 `*` 分支）。
 *
 * 态度与文档页的「没有这个组件」一致：**不静默回落**——把出错路径原样显示出来，
 * 再给一条明确出口。静默跳回主界面会让打错的地址看起来「正常打开」，
 * 排查时反而更难。
 *
 * 形态复用既有类：容器 `.appFallbackPage`（整屏居中，`styles/common.css`）、
 * 空态 `.appEmpty*`、按钮基元 `.button`——**不新增样式文件**。
 * 出口用 `<button>` + `navigate` 而不是 `<Link>`：`.button` 是按按钮设计的基元，
 * 挂在 `<a>` 上会把浏览器默认的链接下划线漏进来（项目里链接与按钮是两套类）。
 */
export function NotFoundPage(): ReactNode {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  return (
    <div className="appFallbackPage">
      <div className="appEmpty">
        <div className="appEmptyTitle">没有这个页面</div>
        <div className="appEmptyHint">路径「{pathname}」不在应用的页面路由里。</div>
        <button
          type="button"
          className="button primary"
          onClick={() => { void navigate(PATH.home); }}
        >
          回到主界面
        </button>
      </div>
    </div>
  );
}
