import type {
  CatalogView,
  ModelOptionView,
  ProviderOptionView,
  SessionOptionView,
} from '../../../../bangumi/src/web/protocol';
import { mergeCommands, type CommandHint } from '../../utils/commands';
import type { AppAction } from './index';

/**
 * 目录状态：宿主下发的模型、历史会话、提供方与命令。
 *
 * `commands` 存的是**已与本地命令合并**的候选表（`mergeCommands` 的结果），因此
 * 输入区补全与 `/help` 读到的是同一个稳定引用，不必在组件里再合并一次。
 */
export interface CatalogState {
  models: ModelOptionView[];
  sessions: SessionOptionView[];
  providers: ProviderOptionView[];
  canPersistCredentials: boolean;
  commands: CommandHint[];
}

export const INITIAL_CATALOG_STATE: CatalogState = {
  models: [],
  sessions: [],
  providers: [],
  canPersistCredentials: false,
  commands: mergeCommands([]),
};

export type CatalogAction = { type: 'catalog/loaded'; catalog: CatalogView }
  | { type: 'catalog/sessions'; sessions: SessionOptionView[] };

export function catalogReducer(state: CatalogState = INITIAL_CATALOG_STATE, action: AppAction): CatalogState {
  if (action.type === 'catalog/sessions') {
    const sessions = new Map(state.sessions.map(session => [session.id, session]));
    for (const live of action.sessions) sessions.set(live.id, { ...sessions.get(live.id), ...live });
    return { ...state, sessions: [...sessions.values()] };
  }
  if (action.type !== 'catalog/loaded') return state;
  const { models, sessions, providers, canPersistCredentials } = action.catalog;
  return {
    models,
    sessions,
    providers,
    canPersistCredentials,
    commands: mergeCommands(action.catalog.commands),
  };
}
