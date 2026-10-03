import type { ReactNode } from 'react';

/**
 * 首屏引导。
 *
 * 它是 `ConversationView` 的 `hero` 槽位内容：会话完全空且空闲时由页面装配传入，
 * 此时 `.scrollBody[data-phase='hero']` 生效，输入卡改用更高的最小高度。
 */
export function Hero(): ReactNode {
  return (
    <div className="hero">
      <div className="heroStack">
        <div className="heroHeadline">
          <span>Bangumi 助手</span>
          <span className="heroBadge">Web 终端</span>
        </div>
        <p className="heroHint">用自然语言查询作品、管理收藏与更新观看或阅读进度；写入前会先给出预览并等待确认。</p>
      </div>
    </div>
  );
}
