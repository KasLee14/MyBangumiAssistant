import type { ReactNode } from 'react';
import { useActions, useAppSelector } from '../../store/hooks';
import {
  selectCredentialProvider,
  selectLastSettingsPane,
  selectModels,
  selectProviders,
  selectSettingsPane,
} from '../../store/selectors';
import { AUTH_LABEL } from '../../utils/credentialLabel';
import { BentoCard, BentoGrid } from '../motion/vendor/BentoGrid';
import { BangumiLoginDialog } from './BangumiLoginDialog';
import { BangumiLogoutDialog } from './BangumiLogoutDialog';
import { Modal } from './Modal';
import { ModelDialog } from './ModelDialog';
import { ModelPickerDialog } from './ModelPickerDialog';
import { ProxyDialog } from './ProxyDialog';

const PROXY_MODE_LABEL: Record<'auto' | 'direct' | 'manual', string> = {
  auto: '自动发现',
  direct: '直连',
  manual: '手动指定',
};

/* 图标统一 24×24 / `stroke-width: 1.5` / 走 currentColor——尺寸由 `.bentoIcon` 约束。 */
const ICON = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true } as const;

function ConfigIcon(): ReactNode {
  return <svg {...ICON}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M7 9h10M7 13h6" /></svg>;
}

function ModelIcon(): ReactNode {
  return <svg {...ICON}><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2" /></svg>;
}

function ProxyIcon(): ReactNode {
  return <svg {...ICON}><circle cx="12" cy="12" r="8" /><path d="M4 12h16M12 4v16" /></svg>;
}

function AccountIcon(): ReactNode {
  return <svg {...ICON}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" /></svg>;
}

/**
 * 设置弹窗：四格状态总览（[C29](../../docs/design/decisions/C29-settings-dialog.md) 定稿）。
 *
 * 形态由「四行清单 + 每行一个『编辑』按钮」改成 **magicui `BentoGrid` 的四格**：
 * 模型配置与模型选择各跨两行（大卡）、代理端口与登录状态各一行（小卡）。
 * 两条随之而来的规则：
 *
 * - **只有当前状态，没有动作条**：每格显示的就是「现在是什么」，动作由整格承担
 *   （hover 浮出「配置 →」这类提示），因此底部不再有动作行——原先把说明文字与「关闭」
 *   一起放在 footer 里，现在说明升为弹窗副标题，关闭用右上角的 `×` 或 Esc。
 * - **整格可点**：`BentoCard` 本身是 `<button>`，键盘可达。
 *
 * 配置密钥与选模型仍是两个独立动作，因此仍是两个弹窗（`ModelDialog` / `ModelPickerDialog`）：
 * 只有宿主报告了可用模型时，「模型选择」那一格才可点。
 *
 * 当前处于哪一屏由 store 的 `settingsPane` 决定，因此 `/model` 命令可以直达模型选择。
 */
export function SettingsDialog({ leaving, onExited }: { leaving: boolean; onExited(): void }): ReactNode {
  const actions = useActions();
  /* 退场动画期间要用 `lastSettingsPane`（屏幕上最后画出来的那一屏），否则渲染分支会在
     关闭的同一帧从「模型配置」跳成「设置主屏」——换分支就是换子树，旧 `Modal` 连同动画
     一起被卸载，弹窗既不播退场也永远不会消失。弹窗还开着时（比如子弹窗刚关掉）则照
     `settingsPane` 走，好立刻让位给主屏。语义见 `store/reducers/ui.ts` 的字段注释。 */
  const pane = useAppSelector(leaving ? selectLastSettingsPane : selectSettingsPane);
  const models = useAppSelector(selectModels);
  const providers = useAppSelector(selectProviders);
  const credentialProvider = useAppSelector(selectCredentialProvider);
  const modelLabel = useAppSelector(state => state.stream.modelLabel);
  const proxyMode = useAppSelector(state => state.stream.proxyMode);
  const proxyAddress = useAppSelector(state => state.stream.proxyAddress);
  const loginUsername = useAppSelector(state => state.stream.loginUsername);
  const loginState = useAppSelector(state => state.stream.loginState);

  // 没有可用模型时不能直接进入模型选择，退回设置本身（那一格是置灰的）。
  const modelsReady = models.length > 0;
  const activePane = pane === 'model' && !modelsReady ? null : pane;

  if (activePane === 'credential') return <ModelDialog />;
  if (activePane === 'model') return <ModelPickerDialog />;
  if (activePane === 'proxy') return <ProxyDialog />;
  if (activePane === 'login') return <BangumiLoginDialog />;
  if (activePane === 'logout') return <BangumiLogoutDialog />;

  const provider = providers.find(candidate => candidate.id === credentialProvider) ?? null;
  // 宿主在未选择模型时下发字面量 unknown/unknown，这里换成可读的「未选择模型」。
  const modelText = modelLabel && modelLabel !== 'unknown/unknown' ? modelLabel : '未选择模型';
  const signedIn = loginState === 'signed-in' && loginUsername !== '';

  return (
    <Modal
      title="设置"
      wide
      eyebrow="模型选择会保存为本机默认，密钥可保存到本机；线路只影响本次运行。"
      onClose={actions.closeSettings}
      leaving={leaving}
      onExited={onExited}
    >
      <BentoGrid>
        <BentoCard
          tall
          bottom
          icon={<ConfigIcon />}
          name="模型配置"
          description={`${credentialProvider || '未选择提供方'}${provider ? ` · ${AUTH_LABEL[provider.authSource]}` : ''}`}
          cta="配置 →"
          onSelect={() => { actions.openCredentialPane(credentialProvider); }}
        />
        <BentoCard
          tall
          bottom
          icon={<ModelIcon />}
          name="模型选择"
          description={modelsReady ? modelText : '请先完成模型配置'}
          cta="切换 →"
          disabled={!modelsReady}
          onSelect={() => { actions.switchPane('model'); }}
        />
        <BentoCard
          icon={<ProxyIcon />}
          name="代理端口"
          description={`${PROXY_MODE_LABEL[proxyMode]} · ${proxyAddress || '直连'}`}
          cta="修改 →"
          onSelect={() => { actions.switchPane('proxy'); }}
        />
        <BentoCard
          icon={<AccountIcon />}
          name="登录状态"
          description={signedIn ? loginUsername : '未登录'}
          cta={signedIn ? '退出登录 →' : '登录 →'}
          onSelect={() => { actions.switchPane(signedIn ? 'logout' : 'login'); }}
        />
      </BentoGrid>
    </Modal>
  );
}
