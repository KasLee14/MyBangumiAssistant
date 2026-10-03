import type { ReactNode } from 'react';
import { useActions, useAppSelector } from '../../store/hooks';
import {
  selectCredentialProvider,
  selectModels,
  selectProviders,
  selectSettingsPane,
} from '../../store/selectors';
import { AUTH_LABEL } from '../../utils/credentialLabel';
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

/**
 * 设置弹窗：模型配置、模型选择、代理端口、登录状态四行。
 *
 * 配置密钥与选模型是两个独立动作，因此拆成两行两个弹窗：只有宿主报告了可用模型
 * （某个提供方的凭据已配置）时，「模型选择」的编辑才可点。每行的「编辑」在同一个
 * 位置换成对应的修改弹窗，关闭修改弹窗即回到设置本身（`settingsPane` 回到 null）。
 *
 * 当前处于哪一行由 store 的 `settingsPane` 决定，因此 `/model` 命令可以直达模型行。
 */
export function SettingsDialog(): ReactNode {
  const actions = useActions();
  const pane = useAppSelector(selectSettingsPane);
  const models = useAppSelector(selectModels);
  const providers = useAppSelector(selectProviders);
  const credentialProvider = useAppSelector(selectCredentialProvider);
  const modelLabel = useAppSelector(state => state.stream.modelLabel);
  const proxyMode = useAppSelector(state => state.stream.proxyMode);
  const proxyAddress = useAppSelector(state => state.stream.proxyAddress);
  const loginUsername = useAppSelector(state => state.stream.loginUsername);
  const loginState = useAppSelector(state => state.stream.loginState);

  // 没有可用模型时不能直接进入模型选择，退回设置本身（该行的编辑是置灰的）。
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
      onClose={actions.closeSettings}
      footer={(
        <>
          <span className="note">模型选择会保存为本机默认，密钥可保存到本机；线路只影响本次运行。</span>
          <button type="button" className="button ghost" onClick={actions.closeSettings}>关闭</button>
        </>
      )}
    >
      <div className="settingsRow">
        <span className="label">模型配置</span>
        <span className="value">
          {credentialProvider || '未选择提供方'}
          {provider ? ` · ${AUTH_LABEL[provider.authSource]}` : ''}
        </span>
        <span className="actions">
          <button
            type="button"
            className="button ghost"
            onClick={() => actions.openCredentialPane(credentialProvider)}
          >
            编辑
          </button>
        </span>
      </div>
      <div className="settingsRow">
        <span className="label">模型选择</span>
        <span className="value">{modelsReady ? modelText : '请先完成模型配置'}</span>
        <span className="actions">
          <button
            type="button"
            className="button ghost"
            disabled={!modelsReady}
            title={modelsReady ? '切换当前模型' : '请先完成模型配置'}
            onClick={() => actions.switchPane('model')}
          >
            编辑
          </button>
        </span>
      </div>
      <div className="settingsRow">
        <span className="label">代理端口</span>
        <span className="value">{PROXY_MODE_LABEL[proxyMode]} · {proxyAddress || '直连'}</span>
        <span className="actions">
          <button type="button" className="button ghost" onClick={() => actions.switchPane('proxy')}>编辑</button>
        </span>
      </div>
      <div className="settingsRow">
        <span className="label">登录状态</span>
        <span className="value">{signedIn ? loginUsername : '未登录'}</span>
        <span className="actions">
          {signedIn ? (
            <button type="button" className="button ghost" onClick={() => actions.switchPane('logout')}>退出登录</button>
          ) : (
            <button type="button" className="button ghost" onClick={() => actions.switchPane('login')}>登录</button>
          )}
        </span>
      </div>
    </Modal>
  );
}
