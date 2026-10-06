import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pill } from '../../components/common/Pill';
import { ContentBlock } from '../../components/content';
import { observeReveal } from '../../utils/revealOnScroll';
import { blockOf } from './items';
import { componentHref, navigate } from './router';
import type { LibrarySection } from './samples';
import { LIBRARY_SECTIONS } from './samples';

/**
 * 总览页：每种内容条目一张卡。
 *
 * 每张卡是「中文名 + kind + 一句话 + 一张小预览」，整张卡可点（`button`，所以键盘可达）。
 * 预览用的是**真实 `ContentBlock`**，不是缩略图——所以总览页本身也是一次渲染核对。
 *
 * 卡片与网格都是自绘的（`libOverview*` 类）：文档页与主界面共用同一套表面语言，
 * 形状与阴影取自 `--app-*` 令牌，不再依赖任何 UI 框架的卡片或栅格。
 */
function OverviewCard({ section }: { section: LibrarySection }): ReactNode {
  const block = useMemo(() => blockOf(section.kind, section.payload), [section]);
  const root = useRef<HTMLButtonElement>(null);
  /**
   * 滚进视口才浮现。
   *
   * 为什么放在这里而不是会话流：卡片网格布局稳定，挂载时就能量出真实位置；
   * 会话区开着 `content-visibility: auto`，屏外轮次挂载时高度为 0，那个判据会失效。
   *
   * 用 state 驱动 className（不手动改 `classList`，否则会被下一次渲染重置），
   * 观察器来自共享模块 `utils/revealOnScroll.ts`：窗口滚动全站共用一个实例、进入即 `unobserve`。
   */
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const el = root.current;
    if (el === null) return;
    // 首屏那几张不参与入场，否则会先闪一帧空白
    if (el.getBoundingClientRect().top < window.innerHeight) return;
    setPending(true);
    return observeReveal(el, null);
  }, []);

  return (
    <button
      type="button"
      ref={root}
      className={`libOverviewCard${pending ? ' appReveal' : ''}`}
      onClick={() => { navigate(componentHref(section.kind)); }}
    >
      <span className="libOverviewHead">
        <span className="libOverviewTitle">{section.title}</span>
        <Pill>{section.kind}</Pill>
      </span>
      <span className="libOverviewSummary">{section.summary}</span>
      <span className="libOverviewPreview" aria-hidden="true">
        <ContentBlock block={block} />
      </span>
    </button>
  );
}

export function Overview({ sections }: { sections: LibrarySection[] }): ReactNode {
  return (
    <>
      <h2 className="libPageTitle">内容组件库</h2>
      <p className="libPageSummary">
        {`${LIBRARY_SECTIONS.length} 种内容条目：真实组件渲染、参数契约，以及可直接粘进调试页的 event 与 frame。`}
        {sections.length === LIBRARY_SECTIONS.length
          ? null
          : ` 当前筛选出 ${sections.length} 个。`}
      </p>
      <div className="libOverviewGrid">
        {sections.map(section => <OverviewCard key={section.kind} section={section} />)}
      </div>
      {sections.length === 0 ? (
        <p className="libEmptyHint">没有匹配的组件，清空搜索框试试。</p>
      ) : null}
    </>
  );
}
