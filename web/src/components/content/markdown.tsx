import { memo, type CSSProperties, type ReactNode } from 'react';

const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>()]+)/g;

/** 表格分隔行：每格是 `:?-+:?`，首尾的 `|` 可以省略。 */
const DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

/** 水平分隔线：三个以上连续的 `-`、`*` 或 `_`，且独占一行。 */
const THEMATIC_BREAK = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

/** 单元格对齐；分隔行里没有冒号的列返回 undefined，沿用样式表的默认左对齐。 */
type Align = 'left' | 'center' | 'right';

/** 表格行的判定：含列分隔符 `|`。 */
function looksLikeTableRow(line: string): boolean {
  return line.includes('|');
}

/** 按 `|` 切分一行，去掉首尾空单元格与每格两侧空白。 */
function splitCells(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|')) text = text.slice(0, -1);
  return text.split('|').map(cell => cell.trim());
}

/** 从分隔行的单元格解析对齐方式。 */
function parseAlign(cell: string): Align | undefined {
  const trimmed = cell.trim();
  const left = trimmed.startsWith(':');
  const right = trimmed.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return undefined;
}

/** 行内标记：粗体、行内代码、Markdown 链接与裸链接。全部以 React 节点输出，不注入 HTML。 */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;
  INLINE.lastIndex = 0;
  let match = INLINE.exec(text);
  while (match !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;
    if (token.startsWith('**')) nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('`')) nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith('[')) {
      const parts = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token);
      nodes.push(parts
        ? <a key={key} href={parts[2]} target="_blank" rel="noreferrer noopener">{parts[1]}</a>
        : <span key={key}>{token}</span>);
    } else nodes.push(<a key={key} href={token} target="_blank" rel="noreferrer noopener">{token}</a>);
    last = match.index + token.length;
    match = INLINE.exec(text);
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

interface Block {
  kind: 'paragraph' | 'heading' | 'list' | 'code' | 'quote' | 'table' | 'divider';
  level?: number;
  ordered?: boolean;
  lines: string[];
}

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split('\n');
  let current: Block | null = null;
  let fence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (/^\s*```/.test(line)) {
      if (fence && current?.kind === 'code') { blocks.push(current); current = null; fence = false; continue; }
      if (current) { blocks.push(current); current = null; }
      current = { kind: 'code', lines: [] };
      fence = true;
      continue;
    }
    if (fence) { current?.lines.push(line); continue; }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      if (current) { blocks.push(current); current = null; }
      blocks.push({ kind: 'heading', level: heading[1]!.length, lines: [heading[2]!] });
      continue;
    }
    // 表格：本行含 `|` 且下一行是分隔行。列数必须与分隔行一致才成立，否则退回普通段落
    // ——这样文档里单独成行的 `---` 不会被读成单列表格。
    const next = lines[index + 1];
    if (next !== undefined && looksLikeTableRow(line) && DELIMITER_ROW.test(next)) {
      const head = splitCells(line);
      const delimiter = splitCells(next);
      if (head.length > 0 && head.length === delimiter.length) {
        if (current) { blocks.push(current); current = null; }
        const table: Block = { kind: 'table', lines: [line, next] };
        // 表体吃到空行或不含 `|` 的行为止。
        let cursor = index + 2;
        while (cursor < lines.length) {
          const row = lines[cursor] ?? '';
          if (!row.trim() || !looksLikeTableRow(row)) break;
          table.lines.push(row);
          cursor += 1;
        }
        blocks.push(table);
        index = cursor - 1;
        continue;
      }
    }
    if (THEMATIC_BREAK.test(line)) {
      if (current) { blocks.push(current); current = null; }
      blocks.push({ kind: 'divider', lines: [] });
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      if (!current || current.kind !== 'quote') {
        if (current) blocks.push(current);
        current = { kind: 'quote', lines: [] };
      }
      current.lines.push(quote[1]!);
      continue;
    }
    const bullet = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (bullet) {
      const ordered = /^\s*\d+\./.test(line);
      if (!current || current.kind !== 'list' || current.ordered !== ordered) {
        if (current) blocks.push(current);
        current = { kind: 'list', ordered, lines: [] };
      }
      current.lines.push(bullet[1]!);
      continue;
    }
    if (!line.trim()) {
      if (current) { blocks.push(current); current = null; }
      continue;
    }
    if (!current || current.kind !== 'paragraph') {
      if (current) blocks.push(current);
      current = { kind: 'paragraph', lines: [] };
    }
    current.lines.push(line);
  }
  if (current) blocks.push(current);
  return blocks;
}

/** 单元格的对齐样式；没有声明对齐时交给样式表。 */
function alignStyle(align: Align | undefined): CSSProperties | undefined {
  return align === undefined ? undefined : { textAlign: align };
}

/**
 * 表格：首行是表头，第二行是分隔行，其余为数据行。
 *
 * 每行都按表头列数渲染，多出的单元格截断、缺失的留空，因此列数不齐的数据行也能
 * 稳定成表。四列以上交给样式表按内容自然宽度铺开，由外层容器横向滚动。
 */
function renderTable(block: Block, key: string): ReactNode {
  const rows = block.lines.map(splitCells);
  const header = rows[0] ?? [];
  const aligns = (rows[1] ?? []).map(parseAlign);
  const body = rows.slice(2);
  const wide = header.length >= 4;
  return (
    <div className={wide ? 'markdownTableWrap markdownTableWide' : 'markdownTableWrap'} key={key}>
      <table>
        <thead>
          <tr>
            {header.map((cell, column) => (
              <th key={`${key}-h${column}`} style={alignStyle(aligns[column])}>
                {inline(cell, `${key}-h${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        {body.length > 0 ? (
          <tbody>
            {body.map((row, rowIndex) => (
              <tr key={`${key}-r${rowIndex}`}>
                {header.map((_, column) => (
                  <td key={`${key}-r${rowIndex}-c${column}`} style={alignStyle(aligns[column])}>
                    {inline(row[column] ?? '', `${key}-r${rowIndex}-c${column}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ) : null}
      </table>
    </div>
  );
}

/**
 * 回答正文的轻量 Markdown 渲染：段落、标题、列表、表格、分隔线与行内标记。
 *
 * 用 `memo` 包一层：解析发生在渲染期（每次渲染都重跑 `parseBlocks`），而历史回答的
 * `text` 在流式期间不会变。没有这层缓存时，每个状态帧都要把整段历史重新解析一遍。
 * 流式正文自己那一块 `text` 每帧都在长，仍会正常重渲染。
 */
export const Markdown = memo(function Markdown({ text }: { text: string }): ReactNode {
  const blocks = parseBlocks(text);
  return (
    <div className="markdown">
      {blocks.map((block, index) => {
        const key = `block-${index}`;
        if (block.kind === 'code') {
          return <pre key={key}><code>{block.lines.join('\n')}</code></pre>;
        }
        if (block.kind === 'table') return renderTable(block, key);
        if (block.kind === 'divider') return <hr key={key} />;
        if (block.kind === 'heading') {
          const content = inline(block.lines[0] ?? '', key);
          if (block.level === 1) return <h1 key={key}>{content}</h1>;
          if (block.level === 2) return <h2 key={key}>{content}</h2>;
          if (block.level === 3) return <h3 key={key}>{content}</h3>;
          return <h4 key={key}>{content}</h4>;
        }
        if (block.kind === 'quote') {
          return <blockquote key={key}>{inline(block.lines.join('\n'), key)}</blockquote>;
        }
        if (block.kind === 'list') {
          const items = block.lines.map((line, position) => <li key={`${key}-${position}`}>{inline(line, `${key}-${position}`)}</li>);
          return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
        }
        return <p key={key}>{inline(block.lines.join('\n'), key)}</p>;
      })}
    </div>
  );
});
