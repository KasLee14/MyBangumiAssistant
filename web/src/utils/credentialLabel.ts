import type { ProviderOptionView } from '../../../bangumi/src/web/protocol';

/** 提供方凭据来源的中文说明，模型弹窗与设置弹窗共用同一套措辞。 */
export const AUTH_LABEL: Record<ProviderOptionView['authSource'], string> = {
  runtime: '本次运行已填入',
  environment: '来自环境变量',
  stored: '已保存在本机',
  none: '尚未配置',
};
