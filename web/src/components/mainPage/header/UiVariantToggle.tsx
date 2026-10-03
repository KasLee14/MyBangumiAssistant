import type { ReactNode } from 'react';
import type { UiVariant } from '../../../store';
import { useActions, useAppSelector } from '../../../store/hooks';
import { selectVariant } from '../../../store/selectors';

/**
 * 外观版本切换：旧版（v1）与新版（v2）。
 *
 * 这是**两版共用**的控件，也是两版界面上唯一的共同入口：顶栏在 v1 与 v2 里各写一份，
 * 但都挂这一个组件，因此「切换」这件事只有一处实现。版本状态在 `store.ui.variant`，
 * 持久化由 `operations.setUiVariant` 负责（写 localStorage）。
 *
 * 结构上刻意只有一层文字：滑块由一个绝对定位的胶囊承载，位置由容器上的
 * `data-variant` 驱动（纯 CSS 过渡），因此切换不需要 JS 参与动画，也不依赖
 * 任何布局测量。用 `aria-pressed` 而不是 `aria-selected`：这是两个独立开关状态，
 * 不是一个列表里的选中项。
 */
const OPTIONS: ReadonlyArray<{ value: UiVariant; label: string; title: string }> = [
  { value: 'v1', label: '旧版', title: '旧版外观：与迁移前的既有界面一致' },
  { value: 'v2', label: '新版', title: '新版外观：当前默认，含流程过渡与动效' },
];

export function UiVariantToggle(): ReactNode {
  const actions = useActions();
  const variant = useAppSelector(selectVariant);

  return (
    <span className="uiVariantToggle" data-variant={variant} role="group" aria-label="界面外观版本">
      <span className="uiVariantPill" aria-hidden="true" />
      {OPTIONS.map(option => {
        const active = option.value === variant;
        return (
          <button
            key={option.value}
            type="button"
            className="uiVariantOption"
            data-active={active}
            aria-pressed={active}
            title={option.title}
            onClick={() => { actions.setUiVariant(option.value); }}
          >
            {option.label}
          </button>
        );
      })}
    </span>
  );
}
