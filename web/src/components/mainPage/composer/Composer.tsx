import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useActions, useAppSelector, useAppDispatch } from '../../../store/hooks';
import { draftSet, draftRestored } from '../../../store/actions';
import { selectHeroPhase } from '../../../store/selectors';
import { matchCommands } from '../../../utils/commands';
import { StatsDock } from './StatsDock';
import { ThinkingPicker } from './ThinkingPicker';
import { BorderGlow } from '../../motion/vendor/BorderGlow';
/* Magnet 已移除：用户在 style-demo-interaction.html 里选的是「A · 只精修状态反馈」，
   明确排除了磁吸。详见发送键处的注释。 */

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
 * 输入卡 + 命令候选。
 *
 * 三个外观层的取舍：
 * 1. 卡片由 `BorderGlow` 提供底色、描边与聚焦时的边缘光，内层不再画边框与阴影；
 * 2. 发送按钮**不做磁吸**：用户在 `style-demo-interaction.html` 选的是「A · 只精修状态反馈」，
 *    排除了指针跟随类效果，反馈只保留 hover 加深与 active 压缩；
 * 3. 思考强度菜单与统计底栏是共享组件，外观见 `styles/composer.css`。
 *
 * 草稿在 store 中按会话保存（`ui.drafts[sessionId]`）：切换会话、切换输入卡与进入授权
 * 都保留原文；提交标记与补全状态留在组件内部，由座位按 `sessionId` 重建。
 * 切换中、宿主未就绪或断线时，输入与发送一并禁用。
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
    // 乐观更新：立刻清空草稿并进入「发送中」，不等宿主返回。
    // 失败时把原文写回草稿——`draftRestored` 只在草稿仍为空时生效，
    // 因此切换会话后迟到的失败不会冲掉另一个会话的新输入。
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
    // 读数（`StatsDock`）是输入卡的**兄弟**节点而不是子节点——
    // 它是卡外的常驻读数，写在卡内会看起来像输入框的一部分。
    <div className="appComposerStack">
      <BorderGlow
        className="appGlow"
        // 底色、光色与边缘光三色**全部走 BorderGlow 的令牌默认值**，这里不再抄色值：
        // 玻璃填充由 `.appGlow` 通过 `--card-bg-css` 注入（见 styles/composer.css），
        // 默认三色就是主色的深浅三档。改主色只需要改 bgm.css 一处。
        // 注：这个值与 `composer.css` 的 `.appGlow { border-radius: var(--app-radius-float) }`
        // 特异度相同，胜负取决于 CSS 加载顺序——dev 下拿到令牌的 18px，生产构建（两者分属不同
        // chunk）下是这个 20px。2026-10-06 用户裁示维持现状、仅登记；排查输入卡圆角时先看这里。
        borderRadius={20}
        glowRadius={26}
        glowIntensity={.7}
        edgeSensitivity={30}
        coneSpread={22}
        fillOpacity={.35}
        // 不做常驻循环：只有在指针进入卡片时才由指针位置驱动边缘光。
        animated={false}
      >
        <div className={`appComposerCard${hero ? ' appComposerHero' : ''}`}>
          {suggestions.length ? (
            <div className="appGlass appComposerPopup" role="listbox" aria-label="命令候选">
              <div className="appPopupSection">命令</div>
              {suggestions.map((command, position) => (
                <button
                  key={command.value}
                  type="button"
                  role="option"
                  aria-selected={position === index}
                  className="appPopupItem"
                  data-active={position === index}
                  onMouseEnter={() => setIndex(position)}
                  onClick={() => submit(command.value)}
                >
                  <span className="value">{command.label}</span>
                  <span className="hint">{command.hint}</span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="appComposerScroll">
            <textarea
              ref={area}
              id="composer-input"
              name="input"
              className="appComposerInput"
              value={draft}
              rows={1}
              spellCheck={false}
              disabled={unavailable}
              placeholder={busy ? '本轮进行中；结束后可继续输入' : '输入作品名或问题，/ 查看命令，Shift+Enter 换行'}
              onChange={event => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>
          <div className="appComposerRow">
            <div className="appComposerTools">
              {problem ? <span className="appComposerProblem" role="alert">{problem}</span> : null}
              <span className="appComposerHint">
                {busy
                  ? (cancelling ? '正在停止…' : 'Esc 停止本轮')
                  : sending ? '正在提交…'
                    : draft.startsWith('/') ? '↑↓ 选择 · Tab 补全 · Enter 执行' : 'Enter 发送 · Shift+Enter 换行'}
              </span>
            </div>
            <div className="appComposerTrailing">
              {busy ? (
                <button type="button" className="appSendButton" disabled={unavailable} onClick={actions.stopRound} aria-label="停止本轮" title="停止本轮">
                  <StopIcon />
                </button>
              ) : (
                /* 这里原有 ReactBits 的 Magnet（发送键磁吸跟随指针）。已移除：
                   用户在 `style-demo-interaction.html` 里选的是「A · 只精修状态反馈」，
                   明确排除了磁吸——发送键的反馈只保留 hover 加深与 active 压缩。 */
                <button type="button" className="appSendButton" disabled={!draft.trim() || unavailable || sending} onClick={() => submit(draft)} aria-label="发送" title="发送">
                  <SendIcon />
                </button>
              )}
            </div>
          </div>
        </div>
      </BorderGlow>
      {/* 卡外一行：思考强度 + 读数（累计 token 与上下文占用）。
          L-B 之后输入卡只留「输入 + 发送」，于是这两样移到卡外同一行；
          读数浮层仍向上展开，精确读数用滚动数字呈现（`StatsDock` 的 `countUp`）。 */}
      <div className="appComposerDock">
        {/* 思考强度：常驻标签显示当前级别，点开就地切换（会写成本机默认）。 */}
        <ThinkingPicker />
        <StatsDock tokenUsage={tokenUsage} contextUsage={contextUsage} countUp />
      </div>
    </div>
  );
}
