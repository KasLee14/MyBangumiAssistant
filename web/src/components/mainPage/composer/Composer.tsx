import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useActions, useAppSelector } from '../../../store/hooks';
import { selectHeroPhase } from '../../../store/selectors';
import { matchCommands } from '../../../utils/commands';
import { StatsDock } from './StatsDock';
import { ThinkingPicker } from './ThinkingPicker';
import { BorderGlow } from '../../motion/vendor/BorderGlow';
import { Magnet } from '../../motion/vendor/Magnet';

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
 * 行为（草稿、命令匹配、乐观发送与失败回滚、IME 高度自适应、problem 自动消失）：
 *
 * 1. 结构由 `BorderGlow` 提供聚焦时的边缘光；
 * 2. 发送按钮外包一层 `Magnet`，指针靠近时轻微跟随（位移上限约 6px，幅度刻意压小）；
 * 3. 思考强度菜单与统计底栏复用共享组件，外观见 `styles/composer.css`。
 *
 * 草稿是**组件内部状态**：它每个按键都变，而且输入卡挂载点必须稳定（卸载重建
 * 会丢焦点与 IME 组合态）。全局状态（会话流、目录、`problem`、首屏阶段）都来自 store。
 */
export function Composer(): ReactNode {
  const actions = useActions();
  const busy = useAppSelector(state => state.stream.busy);
  const cancelling = useAppSelector(state => state.stream.cancelling);
  const tokenUsage = useAppSelector(state => state.stream.tokenUsage);
  const contextUsage = useAppSelector(state => state.stream.contextUsage);
  const commands = useAppSelector(state => state.catalog.commands);
  const problem = useAppSelector(state => state.ui.problem);
  const hero = useAppSelector(selectHeroPhase);

  const [draft, setDraft] = useState('');
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState('');
  /** 本次提交正在等待宿主确认：用于给出即时反馈并挡住重复提交。 */
  const [sending, setSending] = useState(false);
  /** 最近一次草稿。失败回滚时用它判断「用户这期间是否又输入了内容」。 */
  const lastDraft = useRef('');
  const area = useRef<HTMLTextAreaElement>(null);
  const suggestions = useMemo(() => (draft === dismissed ? [] : matchCommands(draft, commands)), [draft, dismissed, commands]);

  useEffect(() => { setIndex(0); }, [draft]);
  // 草稿与「用于回滚判断的最新值」在同一次 effect 里同步，避免两者错位。
  useEffect(() => {
    lastDraft.current = draft;
  }, [draft]);
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
    if (!value || sending) return;
    if (busy) { actions.notice('本轮尚未结束，草稿已保留；结束后再发送。'); return; }
    // 斜杠输入一律交给宿主；本地命令表只用来决定少数纯前端动作。
    if (value.startsWith('/') && !value.includes('\n')) {
      const name = value.split(/\s/, 1)[0]!;
      const local = commands.find(command => command.value === name && command.action !== undefined);
      if (local && local.value === value) { actions.localCommand(local); setDraft(''); return; }
    }
    // 乐观更新：立刻清空草稿并进入「发送中」，不等宿主返回。
    // 失败时把原文写回草稿；只有当前草稿仍为空才回滚，避免冲掉用户这期间的新输入。
    setSending(true);
    setDraft('');
    setDismissed('');
    void Promise.resolve(actions.optimisticSend(value))
      .catch(() => { if (lastDraft.current === '') setDraft(value); })
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
        // 浅色表面：BorderGlow 据此选 light 分支。对话区是白底，卡片改用比白面
        // 略沉的一档（`--bgm-surface-alt`），否则整张卡只剩一圈描边可辨。
        backgroundColor="#fafafa"
        // 主色 #f09199 的 HSL（355 76% 76%），BorderGlow 要的是「H S L」裸数字。
        glowColor="355 76 76"
        colors={['#f09199', '#f7b1b7', '#f6c9a8']}
        borderRadius={15}
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
            <div className="appComposerPopup" role="listbox" aria-label="命令候选">
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
              {/* 思考强度：常驻标签显示当前级别，点开就地切换（会写成本机默认）。 */}
              <ThinkingPicker />
              {busy ? (
                <button type="button" className="appSendButton" onClick={actions.stopRound} aria-label="停止本轮" title="停止本轮">
                  <StopIcon />
                </button>
              ) : (
                // 磁吸幅度刻意压小：这是「按钮注意到你了」的微反馈，不是让按钮躲指针。
                <Magnet padding={16} magnetStrength={8} disabled={!draft.trim()} wrapperClassName="appSendMagnet">
                  <button type="button" className="appSendButton" disabled={!draft.trim()} onClick={() => submit(draft)} aria-label="发送" title="发送">
                    <SendIcon />
                  </button>
                </Magnet>
              )}
            </div>
          </div>
        </div>
      </BorderGlow>
      {/* 底栏读数（累计 token 与上下文占用）：卡外、紧贴卡片下方，浮层向上展开。
          精确读数用滚动数字呈现（`StatsDock` 内置的 `CountUp`）。 */}
      <StatsDock tokenUsage={tokenUsage} contextUsage={contextUsage} />
    </div>
  );
}
