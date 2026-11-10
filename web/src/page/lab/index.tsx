import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import generated from '../../components/content/content-cards.generated.json';
import { PATH } from '../../constants/paths';
import type { ContentKind } from '../../types/content';
import { LabCardList } from './components/LabCardList';
import { LabFieldForm } from './components/LabFieldForm';
import { LabPreview } from './components/LabPreview';
import {
  draftFromPayload, draftOf, parseRawJson, payloadOf, prettyJson, withOmitted, withValue,
} from './reducer';
import type { LabCard, LabDraft } from './types';

/**
 * 生成物（`node web/tools/gen-content-cards.mjs` 产出）：左侧列表、字段表单、默认值全来自它。
 * JSON 模块推断出的是宽泛类型，这里按 `types.ts` 收窄一次。
 */
const LAB_CARDS: readonly LabCard[] = (generated as unknown as { cards: LabCard[] }).cards;
const INITIAL_KIND: ContentKind = LAB_CARDS[0]?.kind ?? 'Callout';

/**
 * 边界状态：**由字段元数据现场推**，不引任何 `cases` 文件。
 *
 * 每个状态只是一份草稿变换（`build`），所以新增一个字段、改一个枚举，状态自动跟着变；
 * 代价是它测不到业务语义（缺图、重复 id 那类），那些要手写。
 */
interface LabCase {
  readonly key: string;
  readonly label: string;
  readonly build: (card: LabCard) => LabDraft;
}

const CASES: readonly LabCase[] = [
  { key: 'default', label: '默认', build: card => draftOf(card) },
  {
    key: 'empty',
    label: '空载荷',
    build: card => {
      let draft = draftOf(card);
      for (const field of card.fields) draft = withValue(draft, field.key, '');
      return draft;
    },
  },
  {
    key: 'missing',
    label: '缺必填',
    build: card => {
      let draft = draftOf(card);
      for (const field of card.fields) if (field.required) draft = withValue(draft, field.key, '');
      return draft;
    },
  },
  {
    key: 'invalid',
    label: '类型错误',
    build: card => {
      let draft = draftOf(card);
      for (const field of card.fields) {
        if (field.kind === 'number') draft = withValue(draft, field.key, '不是数字');
        else if (field.kind === 'json' || field.kind === 'list') draft = withValue(draft, field.key, '"一个字符串"');
      }
      return draft;
    },
  },
];

/** 只留下对这个 kind 有意义的状态：没有必填字段就不给「缺必填」，没有数字/JSON/列表字段就不给「类型错误」。 */
function casesOf(card: LabCard): readonly LabCase[] {
  return CASES.filter(item => {
    if (item.key === 'missing') return card.fields.some(field => field.required);
    if (item.key === 'invalid') {
      return card.fields.some(field => field.kind === 'number' || field.kind === 'json' || field.kind === 'list');
    }
    return true;
  });
}

function cardOf(kind: ContentKind): LabCard {
  const found = LAB_CARDS.find(card => card.kind === kind);
  const first = LAB_CARDS[0];
  if (found !== undefined) return found;
  if (first === undefined) throw new Error('content-cards.generated.json 里一张卡片都没有。');
  return first;
}

/**
 * 卡片实验室（`/lab`）：版式对齐卡片工作台。
 *
 * 三列——左「卡片」列表 / 中「模拟聊天栏」预览（工具条长在这一列上）/ 右「配置项」。
 * 右侧字段表单把数组字段渲染成「第 N 项 + 删除 + 添加一项」的子卡组；底部唯一的主按钮是
 * 「复制载荷 JSON」（bgm 没有「把决策交给宿主生成代码」这条链，复制载荷就是这里最实的出口）。
 *
 * 两处刻意的设计：
 * 1. **预览走真实链路**（`ContentBlock` + `ContentErrorBoundary`），不直接调组件——否则改注册表
 *    时实验室发现不了；
 * 2. **字段与 JSON 是同一份草稿的两种视图**：切到 JSON 时用当前载荷的文本，切回来时用解析结果
 *    回填。两边都不允许出现「另一份数据」。
 */
export function LabPage(): ReactNode {
  const [kind, setKind] = useState<ContentKind>(INITIAL_KIND);
  const [draft, setDraft] = useState<LabDraft>(() => draftOf(cardOf(INITIAL_KIND)));
  const [caseKey, setCaseKey] = useState<string>('default');
  /** `null` = 字段表单；非 null = 原始 JSON 模式的文本。 */
  const [rawText, setRawText] = useState<string | null>(null);
  /** 切 kind / 切状态时给预览换 key，让组件内部状态（排序、图片失败）一起重来。 */
  const [remount, setRemount] = useState(0);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);

  const card = cardOf(kind);
  const caseList = useMemo(() => casesOf(card), [card]);
  const currentCase = caseList.find(item => item.key === caseKey) ?? caseList[0];

  const composed = useMemo(() => payloadOf(card, draft), [card, draft]);
  const raw = useMemo(() => (rawText === null ? null : parseRawJson(rawText)), [rawText]);

  /** 预览用的一份视图：载荷、字段级错误、以及「组装不出来」的原因。 */
  const view = useMemo((): { payload: unknown; problem: string | null; fieldErrors: Readonly<Record<string, string>> } => {
    if (raw !== null) {
      return raw.ok
        ? { payload: raw.payload, problem: null, fieldErrors: {} }
        : { payload: undefined, problem: raw.reason, fieldErrors: {} };
    }
    return composed.ok
      ? { payload: composed.payload, problem: null, fieldErrors: {} }
      : { payload: undefined, problem: composed.reason, fieldErrors: composed.fieldErrors };
  }, [composed, raw]);

  const selectKind = useCallback((next: ContentKind) => {
    setKind(next);
    setDraft(draftOf(cardOf(next)));
    setCaseKey('default');
    setRawText(null);
    setRemount(value => value + 1);
  }, []);

  const applyCase = useCallback((key: string) => {
    const target = casesOf(card).find(item => item.key === key);
    if (target === undefined) return;
    setCaseKey(key);
    setRawText(null);
    setDraft(target.build(card));
    setRemount(value => value + 1);
  }, [card]);

  const stepCase = useCallback((delta: number) => {
    const index = caseList.findIndex(item => item.key === caseKey);
    const next = caseList[(index + delta + caseList.length) % caseList.length];
    if (next !== undefined) applyCase(next.key);
  }, [applyCase, caseKey, caseList]);

  const copyPayload = useCallback(() => {
    const text = prettyJson(view.payload);
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1600);
    }).catch(() => {
      // 剪贴板不可用（非安全上下文等）时不谎报成功。
    });
  }, [view.payload]);

  const toggleRaw = useCallback(() => {
    if (rawText !== null) {
      // 从 JSON 切回表单：只有解析成功才回填，否则留在 JSON 上让用户改完再切。
      const parsed = parseRawJson(rawText);
      if (parsed.ok) {
        setDraft(draftFromPayload(card, parsed.payload));
        setRawText(null);
      }
      return;
    }
    setRawText(prettyJson(view.payload));
  }, [card, rawText, view.payload]);

  return (
    <div className="labFrame">
      <LabCardList cards={LAB_CARDS} current={card.kind} onSelect={selectKind} />

      <section className="labStage">
        <div className="labTop">
          <span className="labTopCrumb">{`模拟聊天栏 · ${card.name}`}</span>
          <span className="labSpacer" />
          <Link className="labGhost" to={PATH.library}>组件库</Link>
          <button
            type="button"
            className="labGhost"
            data-on={rawText === null ? undefined : 'true'}
            aria-pressed={rawText !== null}
            onClick={toggleRaw}
            title={rawText === null ? '直接编辑整份 payload' : '切回配置项（用这份 JSON 的解析结果回填）'}
          >
            原始 JSON
          </button>
        </div>
        <div className="labChat">
          {/* 和真实会话同一列宽：`.appStageColumn` 实测 max-width 900px、居中、外层 24px 内距。
              不加头像/气泡——bgm 的助手消息本来就是裸内容块，套一层气泡会让宽度与真实会话不一致。 */}
          <div className="labColumn">
            {/* 与 `.assistantBody` 一致：正文左侧一条 1.5px 竖线 + 10px 内距，这是真实会话里的形态 */}
            <div className="labAssistant">
              <LabPreview
              key={`${card.kind}-${remount}`}
              kind={card.kind}
              payload={view.payload}
                problem={view.problem}
              />
            </div>
          </div>
        </div>

      </section>

      <aside className="labConfig">
        <div className="labConfigHead">
          配置项
          <span className="labSpacer" />
          <select
            className="labCaseSelect"
            aria-label="边界状态"
            value={caseKey}
            onChange={event => { applyCase(event.target.value); }}
          >
            {caseList.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
          <button
            type="button"
            className="labIconButton"
            aria-label="上一个状态"
            disabled={caseList.length < 2}
            onClick={() => { stepCase(-1); }}
          >
            ‹
          </button>
          <button
            type="button"
            className="labIconButton"
            aria-label="下一个状态"
            disabled={caseList.length < 2}
            onClick={() => { stepCase(1); }}
          >
            ›
          </button>
        </div>

        {rawText === null ? (
          <LabFieldForm
            card={card}
            draft={draft}
            fieldErrors={view.fieldErrors}
            onValue={(key, value) => { setDraft(current => withValue(current, key, value)); }}
            onOmit={(key, omitted) => { setDraft(current => withOmitted(current, key, omitted)); }}
          />
        ) : (
          <div className="labConfigBody">
            <textarea
              className="labFieldArea"
              aria-label="原始 JSON"
              spellCheck={false}
              value={rawText}
              data-invalid={raw !== null && !raw.ok ? 'true' : undefined}
              onChange={event => { setRawText(event.target.value); }}
            />
            {raw !== null && !raw.ok ? <span className="labFieldError">{raw.reason}</span> : null}
          </div>
        )}

        <div className="labFooter">
          <button
            type="button"
            className="labPrimary"
            disabled={view.payload === undefined}
            onClick={copyPayload}
            title={`当前状态：${currentCase?.label ?? '默认'}`}
          >
            {copied ? '已复制' : '复制载荷 JSON'}
          </button>
        </div>
      </aside>
    </div>
  );
}
