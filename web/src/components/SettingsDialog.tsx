import { useState, type ReactNode } from 'react';
import type { CatalogView } from '../../../bangumi/src/web/protocol';
import { BangumiLoginDialog } from './BangumiLoginDialog';
import { BangumiLogoutDialog } from './BangumiLogoutDialog';
import { AUTH_LABEL } from './credentialLabel';
import { Modal } from './Modal';
import { ModelDialog } from './ModelDialog';
import { ModelPickerDialog } from './ModelPickerDialog';
import { ProxyDialog } from './ProxyDialog';

/** 设置行里可以直接进入的子弹窗。 */
export type SettingsPane = 'credential' | 'model' | 'proxy' | 'login' | 'logout';

interface SettingsDialogProps {
  /** 模型与提供方列表，用于组装各行当前值与编辑弹窗。 */
  catalog: CatalogView;
  /** 打开时直接进入哪一行的编辑弹窗；`/model` 命令用它直达。 */
  initialPane?: SettingsPane | null;
  modelLabel: string;
  proxyMode: 'auto' | 'direct' | 'manual';
  proxyAddress: string;
  loginUsername: string;
  loginState: 'signed-in' | 'signed-out';
  /** 宿主是否正在完成一次显式登录。 */
  loginBusy: boolean;
  /** 宿主下发的登录进度文本。 */
  loginStatus: string;
  onClose(): void;
  onNotice(message: string): void;
  /** 重新抓取目录：填入密钥或登录/登出后行内值都要跟着更新。 */
  onReload(): Promise<void>;
}

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
 * 位置换成对应的修改弹窗，关闭修改弹窗即回到设置本身。
 */
export function SettingsDialog({
  catalog, initialPane = null, modelLabel, proxyMode, proxyAddress,
  loginUsername, loginState, loginBusy, loginStatus, onClose, onNotice, onReload,
}: SettingsDialogProps): ReactNode {
  // 没有可用模型时不能直接进入模型选择，退回设置本身（该行的编辑是置灰的）。
  const modelsReady = catalog.models.length > 0;
  const [pane, setPane] = useState<SettingsPane | null>(
    initialPane === 'model' && !modelsReady ? null : initialPane,
  );
  const [credentialProvider, setCredentialProvider] = useState(
    () => catalog.providers.find(provider => provider.current)?.id ?? catalog.providers[0]?.id ?? '',
  );

  if (pane === 'credential') {
    return (
      <ModelDialog
        providers={catalog.providers}
        initialProvider={credentialProvider}
        onClose={() => setPane(null)}
        onApplied={provider => {
          setCredentialProvider(provider);
          // 密钥生效后可用模型与凭据来源都会变，重取目录让两行的值立刻更新。
          void onReload();
        }}
        onNotice={onNotice}
      />
    );
  }
  if (pane === 'model') {
    return (
      <ModelPickerDialog models={catalog.models} onClose={() => setPane(null)} onNotice={onNotice} />
    );
  }
  if (pane === 'proxy') {
    return (
      <ProxyDialog
        currentMode={proxyMode}
        currentAddress={proxyAddress}
        onClose={() => setPane(null)}
        onNotice={onNotice}
      />
    );
  }
  // 登录与退出登录都在弹窗里完成：不再向会话发送 /bangumi-login、/bangumi-logout。
  if (pane === 'login') {
    return (
      <BangumiLoginDialog
        busy={loginBusy}
        status={loginStatus}
        onClose={() => setPane(null)}
        onNotice={onNotice}
      />
    );
  }
  if (pane === 'logout') {
    return (
      <BangumiLogoutDialog username={loginUsername} onClose={() => setPane(null)} onNotice={onNotice} />
    );
  }

  const provider = catalog.providers.find(candidate => candidate.id === credentialProvider) ?? null;
  // 宿主在未选择模型时下发字面量 unknown/unknown，这里换成可读的「未选择模型」。
  const modelText = modelLabel && modelLabel !== 'unknown/unknown' ? modelLabel : '未选择模型';
  const signedIn = loginState === 'signed-in' && loginUsername !== '';
  return (
    <Modal
      title="设置"
      onClose={onClose}
      footer={(
        <>
          <span className="note">密钥与线路只影响本次运行。</span>
          <button type="button" className="button ghost" onClick={onClose}>关闭</button>
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
          <button type="button" className="button ghost" onClick={() => setPane('credential')}>编辑</button>
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
            onClick={() => setPane('model')}
          >
            编辑
          </button>
        </span>
      </div>
      <div className="settingsRow">
        <span className="label">代理端口</span>
        <span className="value">{PROXY_MODE_LABEL[proxyMode]} · {proxyAddress || '直连'}</span>
        <span className="actions">
          <button type="button" className="button ghost" onClick={() => setPane('proxy')}>编辑</button>
        </span>
      </div>
      <div className="settingsRow">
        <span className="label">登录状态</span>
        <span className="value">{signedIn ? loginUsername : '未登录'}</span>
        <span className="actions">
          {signedIn ? (
            <button type="button" className="button ghost" onClick={() => setPane('logout')}>退出登录</button>
          ) : (
            <button type="button" className="button ghost" onClick={() => setPane('login')}>登录</button>
          )}
        </span>
      </div>
    </Modal>
  );
}
