import type { ToolFamily } from './protocol';
import type { ProcessItem } from './turns';

/** 过程项的族：工具族，或思考。 */
export type ProcessKind = ToolFamily | 'reasoning';

/** 过程组汇总：状态行的标题与计数都从这里来。 */
export interface ProcessSummary {
  readonly total: number;
  /** 各族计数，按数量降序（并列保持首次出现顺序）。 */
  readonly counts: readonly (readonly [ProcessKind, number])[];
  /** 正在进行的项（running / waiting）；没有时是 null。 */
  readonly active: ProcessItem | null;
}
