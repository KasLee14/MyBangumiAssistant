import { AppError } from '../../domain/errors.js';

/** bgm-cli 1.1.2 的 stderr 文本契约；不将原始错误或响应体送入日志、模型或终端。 */
export function bgmProcessError(stderr: string): AppError {
  const local = /^((?:OAUTH_[A-Z_]+|ACCOUNT_CHANGED|BGM_HTTP_\d{3}|INVALID_RESPONSE|INVALID_INPUT|BGM_NETWORK|BGM_TIMEOUT|CANCELLED)): /m.exec(stderr)?.[1];
  if(local) return new AppError(local, local.startsWith('OAUTH_') || local === 'BGM_HTTP_401' ? 'OAuth 登录无效或未配置，请运行 npm start -- login，再用 auth-check 验证。' : 'Bangumi 查询未完成，请核对账户、权限或网络；未回显上游错误。');
  const status = /^Bangumi API error \((\d{3})\):/m.exec(stderr)?.[1];
  if (status === '401') return new AppError('BGM_AUTH_REQUIRED', 'Bangumi 未认证或认证已失效。请运行 npm start -- login，再用 auth-check 验证；不要在对话中发送凭据。');
  if (status === '403') return new AppError('BGM_FORBIDDEN', '当前 Bangumi 账户没有读取此资源的权限；重新登录也不保证获得权限。');
  if (status === '404') {
    if (/^Bangumi API error \(404\): Collection for subject \d+ was not found\./m.test(stderr)) {
      return new AppError('BGM_COLLECTION_NOT_FOUND', '未读取到该条目的个人收藏。上游存在收藏查找范围限制，不能仅据此断定未收藏；请核对网站状态。');
    }
    return new AppError('BGM_NOT_FOUND', '条目不存在或当前认证无权读取；不能据此断定未收藏或未看。');
  }
  if (/^Error: Failed to list episodes for subject \d+\./m.test(stderr)) {
    return new AppError('BGM_EPISODES_UNAVAILABLE', '无法读取章节，可能与条目不存在、认证或受限内容权限有关；请核对条目并运行 auth-check。');
  }
  if (/^Error: Subject \d+ is a book-type entry\./m.test(stderr)) {
    return new AppError('UNSUPPORTED_EPISODES', '书籍不提供动画式章节清单，请使用 progress 查询章数和卷数。');
  }
  if (/^Error: Failed to parse .*config file:/m.test(stderr)) return new AppError('BGM_INVALID_CONFIG', 'bgm-cli 配置不是有效 JSON，请检查应用独立配置目录中的 config.json。');
  if (status === '429') return new AppError('BGM_RATE_LIMIT', 'Bangumi 请求过于频繁，请稍后重试。');
  if (/^Bangumi API error \(undefined\): Network request failed:/m.test(stderr)) return new AppError('BGM_NETWORK', '无法连接 Bangumi，请检查网络和代理配置。');
  return new AppError('BGM_FAILED', status ? `Bangumi 查询失败（HTTP ${status}）。` : 'Bangumi 查询失败，请检查配置、网络或输入。');
}
