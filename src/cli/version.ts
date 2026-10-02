import metadata from '../../package.json' with { type: 'json' };

/** 随 TypeScript 构建复制包元数据，源码与构建入口均不依赖当前工作目录。 */
export const APP_VERSION = metadata.version;

export const APP_NAME = 'MyBangumiAssistant';
