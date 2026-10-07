import { memo, useCallback, useRef, useState, type ReactNode } from 'react';
import type { TurnUsageView } from '../../../../../bangumi/src/web/protocol';
import type { TurnGroup } from '../../../utils/turns';

/**
 * 轮尾操作行：复制本轮回答 + 每轮用量。
 *
 * 位置与形态对齐 DSH 的 turn tail（`data-actions-reveal='hover'`：平时不显形，指针进入这一轮
 * 才出现），但**复制对象只是回答正文**：`assistant` 条目的文本块，不含内容块载荷与过程文本
 * ——粘出去的东西要能读。
 *
 * 分支（fork）与点赞/点踩不做：本项目没有分支能力，反馈也没有宿主端点（见方案 §4.8）。
 */

/** 取这一轮最后一个助手条目的纯文本；没有回答时返回空串（不渲染操作行）。 */
function assistantPlainText(turn: TurnGroup): string {
  for (let index = turn.body.length - 1; index >= 0; index -= 1) {
    const item = turn.body[index];
    if (item === undefined || item.kind !== 'assistant') continue;
    const text = item.content
      .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim();
    if (text) return text;
  }
  return '';
}

/** token 读数：与统计底栏一致，超过一千用 k（精确值留给面板）。 */
function formatTokens(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

/** 用量明细的一行。 */
function UsageRow({ label, value, hint }: { label: string; value: number; hint?: string | undefined }): ReactNode {
  if (value <= 0) return null;
  return (
    <div className="usageRow">
      <dt>{label}</dt>
      <dd>
        {value.toLocaleString('zh-CN')}
        {hint ? <span className="usageHint">{hint}</span> : null}
      </dd>
    </div>
  );
}

function UsagePanel({ usage }: { usage: TurnUsageView }): ReactNode {
  return (
    // 浮层材质来自共享类 `.appGlass`（玻璃只有那一处定义），`usagePanel` 只补定位与几何。
    <div className="usagePanel appGlass" role="dialog" aria-label="本轮用量">
      <dl className="usageList">
        <UsageRow label="未缓存输入" value={usage.input} />
        <UsageRow label="缓存读取" value={usage.cacheRead} />
        <UsageRow label="缓存写入" value={usage.cacheWrite} />
        <UsageRow label="输出" value={usage.output} hint={usage.reasoning ? `（其中推理 ${usage.reasoning.toLocaleString('zh-CN')}）` : undefined} />
        <UsageRow label="合计" value={usage.total} />
      </dl>
      {usage.cost > 0 ? <div className="usageCost">费用 {usage.cost.toFixed(4)}</div> : null}
    </div>
  );
}

export const TurnActions = memo(function TurnActions({ turn }: { turn: TurnGroup }): ReactNode {
  const [copied, setCopied] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const timer = useRef(0);
  const text = assistantPlainText(turn);
  const usage = turn.meta?.usage;

  const copy = useCallback((): void => {
    if (!text) return;
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      // 1 秒后复原（与 DSH 的复制反馈一致）；重复点击时以最后一次为准。
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1000);
    }).catch(() => undefined);
  }, [text]);

  if (!text && usage === undefined) return null;
  return (
    <div className="turnActions" data-actions-reveal={text ? 'always' : 'hover'}>
      {text ? (
        <button type="button" className="turnAction" onClick={copy} aria-label="复制本轮回答">
          {copied ? '已复制' : '复制'}
        </button>
      ) : null}
      {usage !== undefined ? (
        <div className="turnUsage">
          <button
            type="button"
            className="turnAction"
            aria-expanded={usageOpen}
            onClick={() => setUsageOpen(open => !open)}
          >
            用量 {formatTokens(usage.total)}
          </button>
          {usageOpen ? <UsagePanel usage={usage} /> : null}
        </div>
      ) : null}
    </div>
  );
});
