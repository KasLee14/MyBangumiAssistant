import type { ReactNode } from 'react';
import type { ContentKind } from '../../../types/content';
import type { LabCard } from '../types';

/**
 * 左侧列表：12 个 kind。
 *
 * 自己不读数据、不读路由、不读 store：输入就是「有哪些卡、当前是哪张」。徽标显示**字段数**
 * ——卡片实验室那个位置显示的是模板名，bgm 没有模板层，「这张卡有多少东西可调」更有用。
 *
 * 不用 `appSidebar` / `appNavRow` 那套原语：它们是主界面侧栏的语汇（图标 + 会话行），
 * 实验室要的是「名字 + kind + 徽标」的三段式，硬套只会让两边都变形。
 */
export function LabCardList({ cards, current, onSelect }: {
  cards: readonly LabCard[];
  current: ContentKind;
  onSelect: (kind: ContentKind) => void;
}): ReactNode {
  return (
    <aside className="labSide" aria-label="卡片列表">
      <div className="labSideHead">
        <span className="labSideTitle">卡片</span>
        <span className="labSideCount">{cards.length}</span>
      </div>
      <nav className="labList" aria-label="卡片导航">
        {cards.map(card => (
          <button
            key={card.kind}
            type="button"
            className="labCardRow"
            data-current={card.kind === current}
            aria-current={card.kind === current}
            onClick={() => { onSelect(card.kind); }}
          >
            <span>
              <span className="labCardName">{card.name}</span>
              <span className="labCardKind">{card.kind}</span>
            </span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
