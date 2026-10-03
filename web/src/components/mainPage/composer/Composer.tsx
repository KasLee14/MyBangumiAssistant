import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useActions, useAppSelector, useAppDispatch } from '../../../store/hooks';
import { draftSet, draftRestored } from '../../../store/actions';
import { selectHeroPhase } from '../../../store/selectors';
import { matchCommands } from '../../../utils/commands';
import { StatsDock } from './StatsDock';
import { ThinkingPicker } from './ThinkingPicker';

function SendIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.2l4.6 4.6a.9.9 0 01-1.3 1.3L8.9 5.7V13a.9.9 0 11-1.8 0V5.7L4.7 8.1A.9.9 0 013.4 6.8z" />
    </svg>
  );
}

function StopIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="3" width="10" height="10" rx="3" />
    </svg>
  );
}

/**
 * 输入卡 + 命令弹窗。弹窗锚在卡片顶边的零高条带上，向上展开。
 *
 * 草稿在 store 中按会话保存；输入卡只在切换会话时重建，清掉旧会话的提交与补全状态。
 */
export function Composer(): ReactNode {
  const actions = useActions();
  const dispatch = useAppDispatch();
  const sessionId = useAppSelector(state => state.stream.sessionId);
  const unavailable = useAppSelector(state => state.ui.switching || !state.stream.ready || !state.stream.connected);
  const busy = useAppSelector(state => state.stream.busy);
  const cancelling = useAppSelector(state => state.stream.cancelling);
  const tokenUsage = useAppSelector(state => state.stream.tokenUsage);
  const contextUsage = useAppSelector(state => state.stream.contextUsage);
  const commands = useAppSelector(state => state.catalog.commands);
  const problem = useAppSelector(state => state.ui.problem);
  const hero = useAppSelector(selectHeroPhase);

  const draft = useAppSelector(state => state.ui.drafts[sessionId] ?? '');
  const setDraft = (text: string): void => { dispatch(draftSet(sessionId, text)); };
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState('');
  /** 本次提交正在等待宿主确认：用于给出即时反馈并挡住重复提交。 */
  const [sending, setSending] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const suggestions = useMemo(() => (draft === dismissed ? [] : matchCommands(draft, commands)), [draft, dismissed, commands]);

  useEffect(() => { setIndex(0); }, [draft]);
  useEffect(() => {
    const node = area.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.max(24, node.scrollHeight)}px`;
  }, [draft]);

  // 参数错误等本地提示只留在界面上几秒；清理由 store 的 action 完成。
  useEffect(() => {
    if (problem === null) return;
    const timer = setTimeout(() => { actions.dismissProblem(); }, 4000);
    return () => clearTimeout(timer);
  }, [problem, actions]);

  const submit = (raw: string): void => {
    const value = raw.trim();
    if (!value || sending || unavailable) return;
    if (busy) { actions.notice('本轮尚未结束，草稿已保留；结束后再发送。'); return; }
    // 斜杠输入一律交给宿主；本地命令表只用来决定少数纯前端动作。
    if (value.startsWith('/') && !value.includes('\n')) {
      const name = value.split(/\s/, 1)[0]!;
      const local = commands.find(command => command.value === name && command.action !== undefined);
      if (local && local.value === value) { actions.localCommand(local); setDraft(''); return; }
    }
    // 乐观更新：立刻清空草稿并进入「发送中」，不等宿主返回。按回车因此是即时反馈，
    // 而不是等一次往返（首次发消息还要等模型首 token）才看到界面变化。
    // 失败时把原文写回草稿；只有当前草稿仍为空才回滚，避免冲掉用户这期间的新输入。
    setSending(true);
    setDraft('');
    setDismissed('');
    void Promise.resolve(actions.optimisticSend(value))
      .catch(() => { dispatch(draftRestored(sessionId, value)); })
      .finally(() => setSending(false));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    const selected = suggestions[index];
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (selected) { submit(selected.value); return; }
      submit(draft);
      return;
    }
    if (selected && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      setIndex(current => Math.max(0, Math.min(suggestions.length - 1, current + (event.key === 'ArrowUp' ? -1 : 1))));
      return;
    }
    if (selected && event.key === 'Tab') { event.preventDefault(); setDraft(selected.value); return; }
    if (event.key === 'Escape' && suggestions.length) { event.preventDefault(); setDismissed(draft); }
  };

  return (
    // 卡片与底栏读数在同一个栈里，但读数是卡片的**兄弟**节点而不是子节点：
    // 它是输入卡之外的常驻读数，写在卡内会看起来像输入框的一部分（DSH 的
    // InputBar 同样把 `.dock` 放在卡外，见 ui-conversation/skeleton/InputBar.tsx）。
    <div className="composerStack">
      <div className={`composerCard${hero ? ' composerHero' : ''}`}>
      {suggestions.length ? (
          <div className="overlayAnchor">
            <div className="composerPopup">
              <div className="composerPopupMaterial" />
              <div className="composerPopupViewport" role="listbox" aria-label="命令候选">
                <div className="popupSection">命令</div>
                {suggestions.map((command, position) => (
                  <button
                    key={command.value}
                    type="button"
                    role="option"
                    aria-selected={position === index}
                    className={`popupItem${position === index ? ' active' : ''}`}
                    onMouseEnter={() => setIndex(position)}
                    onClick={() => submit(command.value)}
                  >
                    <span className="value">{command.label}</span>
                    <span className="hint">{command.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
        <div className="composerScroll">
          <textarea
            ref={area}
            id="composer-input"
            name="input"
            className="composerInput"
            value={draft}
            rows={1}
            spellCheck={false}
            disabled={unavailable}
            placeholder={busy ? '本轮进行中；结束后可继续输入' : '输入作品名或问题，/ 查看命令，Shift+Enter 换行'}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="composerRow">
          <div className="composerTools">
            {problem ? <span className="composerProblem" role="alert">{problem}</span> : null}
            <span className="composerHint">
              {busy
                ? (cancelling ? '正在停止…' : 'Esc 停止本轮')
                : sending ? '正在提交…'
                  : draft.startsWith('/') ? '↑↓ 选择 · Tab 补全 · Enter 执行' : 'Enter 发送 · Shift+Enter 换行'}
            </span>
          </div>
          <div className="composerTrailing">
            {/* 思考强度：常驻标签显示当前级别，点开就地切换（会写成本机默认）。 */}
            <ThinkingPicker />
            {busy ? (
              <button type="button" className="sendButton" disabled={unavailable} onClick={actions.stopRound} aria-label="停止本轮" title="停止本轮">
                <StopIcon />
              </button>
            ) : (
              <button type="button" className="sendButton" disabled={!draft.trim() || unavailable || sending} onClick={() => submit(draft)} aria-label="发送" title="发送">
                <SendIcon />
              </button>
            )}
          </div>
        </div>
      </div>
      {/* 底栏读数（累计 token 与上下文占用）：卡外、紧贴卡片下方，浮层向上展开。 */}
      <StatsDock tokenUsage={tokenUsage} contextUsage={contextUsage} />
    </div>
  );
}
