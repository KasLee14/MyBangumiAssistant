/**
 * 命令候选条目：本地命令带 `action`，后端命令只带 `value`。
 *
 * 放在顶层 `types/`（而不是命令工具里）：`store/reducers/catalog.ts` 的
 * `CatalogState.commands` 与 `store/operations.ts` 的命令执行都消费它——它是 store 与页面
 * 之间的跨模块契约，不是页面私有类型。
 */
export interface CommandHint {
  value: string;
  label: string;
  hint: string;
  /** 需要浏览器侧处理的动作；后端命令没有它，按原样提交给宿主。 */
  action?: 'help' | 'details' | 'exit' | 'model' | 'sessions' | 'new';
}
