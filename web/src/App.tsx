import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from 'react';
import type { CatalogView, SessionOptionView } from '../../bangumi/src/web/protocol';
import { answerConfirmation, cancelRound, fetchCatalog, selectSession, submitInput } from './api';
import { helpText, mergeCommands, type CommandHint } from './commands';
import { Composer } from './components/Composer';
import { ConfirmationCard } from './components/ConfirmationCard';
import { LoginDialog } from './components/LoginDialog';
import { StreamingBlock, UserBubble } from './components/MessageParts';
import { SessionDialog } from './components/SessionDialog';
import { SettingsDialog, type SettingsPane } from './components/SettingsDialog';
import { Sidebar } from './components/Sidebar';
import { TurnView } from './components/TurnView';
import { useChatStream } from './store';
import { projectTurns } from './turns';

const EMPTY_CATALOG: CatalogView = { models: [], sessions: [], commands: [], providers: [], canPersistCredentials: false };

const message = (error: unknown): string => (error instanceof Error ? error.message : '请求失败。');

const ICON = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true } as const;

/**
 * 乐观回显的本地条目：形状与用户气泡一致，但没有宿主 id（宿主确认后即撤下）。 */
interface PendingEcho {
  text: string;
  /** 发出这条消息时的会话 id，用于判断失败回滚是否还属于同一次会话。 */
  sessionId: string;
}

export function App(): ReactNode {
  const state = useChatStream();
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogView>(EMPTY_CATALOG);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPane, setSettingsPane] = useState<SettingsPane | null>(null);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => window.innerWidth <= 1024);
  const [activeTurn, setActiveTurn] = useState<number | null>(null);
  const [reveal, setReveal] = useState(0);
  const [pendingEcho, setPendingEcho] = useState<PendingEcho | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  /** rAF 句柄与「滚动停止」防抖句柄。 */
  const pendingFrame = useRef(0);
  const scrollIdle = useRef(0);

  // 投影只在条目真正变化时重算：流式帧只改标量（liveText 等），items 引用不变，
  // 于是 turns 引用稳定，配合各层的 memo 让历史轮次整体跳过重渲染。
  const turns = useMemo(() => projectTurns(state.items), [state.items]);
  // 首屏：完全空且空闲时才显示引导页。只要已有条目（含通知、命令回显）或正在
  // 流式输出，就必须进入会话视图，否则扩展命令结果与系统提示会被首屏遮住。
  const heroPhase = state.items.length === 0 && !state.busy && !state.liveText && !state.liveThinking && pendingEcho === null;
  // 轮次导航只标记真实对话轮次，前导内容（会话头）不算一轮
  const railTurns = useMemo(() => turns.filter(turn => turn.user !== null), [turns]);
  const commands = useMemo(() => mergeCommands(catalog.commands), [catalog.commands]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!problem) return;
    const timer = setTimeout(() => setProblem(null), 4000);
    return () => clearTimeout(timer);
  }, [problem]);

  /**
   * 切换会话：当前轮次高亮要清掉、视图要在下一帧拉回底部。
   *
   * `pinned` 必须重设为 true——上一会话可能停在半途（`pinned` 为 false），不重置
   * 的话新会话的跟随滚动会被跳过，视图就停在历史中段。
   */
  useEffect(() => {
    pinned.current = true;
    setActiveTurn(null);
  }, [state.sessionId]);

  /**
   * 只在用户停留在底部时跟随新内容。
   *
   * 读 `scrollHeight` 再写 `scrollTop` 是一次强制布局，因此这个副作用只在内容或
   * 忙碌状态真正变化时执行，不挂到任何计时器上——原先它跟着 250ms 的时钟一起跑，
   * 流式期间每秒多出 4 次强制布局。
   *
   * 贴底要贴几次：屏外轮次带 `content-visibility: auto`，浏览器会在随后的若干帧里
   * 分批算出真实高度，只贴一次会被后续的高度增长推回历史中段（实测偏差上千像素）。
   * 这里在一个很短的窗口内补贴三次。
   *
   * 注意不要在这一小段里检查 `pinned`：会话切换时滚动容器会因内容替换被浏览器
   * 自动钳制 `scrollTop`，那也会派发 scroll 事件、把 `pinned` 冲成 false，贴底就
   * 会被自己拦下来。
   */
  useEffect(() => {
    const node = scroller.current;
    if (!node || !pinned.current) return;
    const pin = (): void => {
      const target = scroller.current;
      if (target) target.scrollTop = target.scrollHeight;
    };
    pin();
    const raf = requestAnimationFrame(pin);
    const timer = setTimeout(pin, 120);
    return () => { cancelAnimationFrame(raf); clearTimeout(timer); };
  }, [state.items, state.liveText, state.liveThinking, state.busy, pendingEcho]);

  const recomputeActiveTurn = useCallback((force = false): void => {
    if (pendingFrame.current && !force) return;
    if (force && pendingFrame.current) { cancelAnimationFrame(pendingFrame.current); pendingFrame.current = 0; }
    pendingFrame.current = requestAnimationFrame(() => {
      pendingFrame.current = 0;
      const node = scroller.current;
      if (!node) return;
      const edge = node.getBoundingClientRect().top + node.clientHeight * 0.3;
      let latest: number | null = null;
      for (const element of node.querySelectorAll<HTMLElement>('[data-turn]')) {
        if (element.getBoundingClientRect().top <= edge) {
          const id = Number(element.dataset.turn);
          if (!Number.isNaN(id) && (latest === null || id > latest)) latest = id;
        }
      }
      setActiveTurn(current => (current === latest ? current : latest));
    });
  }, []);

  useEffect(() => {
    if (heroPhase) return;
    recomputeActiveTurn();
  }, [turns, heroPhase, recomputeActiveTurn]);

  useEffect(() => () => {
    if (pendingFrame.current) cancelAnimationFrame(pendingFrame.current);
    if (scrollIdle.current) clearTimeout(scrollIdle.current);
  }, []);

  /**
   * 滚动只做两件事：记录是否仍贴着底部、请求重算当前轮次。
   *
   * 当前轮次的判定已经从「对全部轮次做 querySelector + offsetTop」改成「对已挂载
   * 的轮次读一次 rect 并线性扫描」，并用 rAF 节流；400 轮会话里一次滚动因此不再
   * 产生 400 次同步布局读取。
   *
   * 另外挂一个 150ms 的「滚动停止」定时器：连续滚动时 rAF 节流会一直跳过重算，
   * 停在最终位置后高亮就不会更新。rAF 负责滚动过程中的跟随，这个定时器负责
   * 停下后的最终对齐。
   */
  const onScroll = (event: UIEvent<HTMLDivElement>): void => {
    const node = event.currentTarget;
    pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    const last = node.scrollTop;
    recomputeActiveTurn();
    if (scrollIdle.current) clearTimeout(scrollIdle.current);
    scrollIdle.current = window.setTimeout(() => {
      scrollIdle.current = 0;
      // 期间没有新滚动才对齐，否则留给下一次。
      if (scroller.current && scroller.current.scrollTop === last) recomputeActiveTurn(true);
    }, 150);
  };

  const jumpTo = useCallback((id: number): void => {
    document.getElementById(`turn-${id}`)?.scrollIntoView({ block: 'start' });
    // 跳转后立即更新高亮，不依赖滚动事件的时序。
    setActiveTurn(id);
    pinned.current = false;
  }, []);

  const loadCatalog = useCallback(async (): Promise<CatalogView> => {
    const next = await fetchCatalog();
    setCatalog(next);
    return next;
  }, []);

  useEffect(() => {
    // 会话切换后模型与历史会话列表都可能变化；列表失败不影响对话本身。
    void loadCatalog().catch(() => { /* 打开设置或会话弹窗时会再取一次。 */ });
  }, [loadCatalog, state.sessionId]);

  /** 提交给宿主；返回 promise 以便输入区在失败时回滚草稿。 */
  const send = useCallback((input: string): Promise<void> => {
    const value = input.trim();
    if (!value) return Promise.resolve();
    if (value.startsWith('/') && !value.includes('\n')) {
      const name = value.split(/\s/, 1)[0]!;
      // 未登记的斜杠命令不拦：宿主可能注册了浏览器还不知道的命令。
      if (commands.some(command => command.value === name) === false) {
        setProblem('没有匹配命令，请继续编辑；输入 / 查看命令列表。');
        return Promise.resolve();
      }
    }
    setProblem(null);
    return submitInput(value).catch(error => {
      setNotice(message(error));
      throw error;
    });
  }, [commands]);

  /**
   * 乐观回显：先把这条消息挂到界面上，宿主确认（真实的 user 条目出现）后撤下。
   * 失败时由输入区回滚草稿，这里只负责把气泡撤掉。
   */
  const optimisticSend = useCallback((input: string): Promise<void> => {
    const text = input.trim();
    if (!text) return Promise.resolve();
    const started = send(input);
    if (text.startsWith('/') && !text.includes('\n')) {
      // 斜杠命令不产生对话轮次，回显气泡反而会挡在结果前面。
      return started;
    }
    setPendingEcho({ text, sessionId: state.sessionId });
    return started;
  }, [send, state.sessionId]);

  useEffect(() => {
    if (!pendingEcho) return;
    const settled = state.items.some(item => item.kind === 'user' && item.text === pendingEcho.text);
    if (settled || state.sessionId !== pendingEcho.sessionId) setPendingEcho(null);
  }, [state.items, state.sessionId, pendingEcho]);

  const newSession = useCallback((): Promise<void> => {
    return selectSession().catch(error => { setNotice(message(error)); throw error; });
  }, []);

  const resumeSession = useCallback((session: SessionOptionView): Promise<void> => {
    return selectSession(session.path).catch(error => { setNotice(message(error)); throw error; });
  }, []);

  /** 打开设置前重取目录，让模型行显示的密钥状态是最新的。 */
  const openSettings = useCallback(async (pane: SettingsPane | null): Promise<void> => {
    try { await loadCatalog(); } catch { /* 用已缓存的一份打开，行内值可能略旧。 */ }
    // 同一时刻只留一个弹窗：会话弹窗与设置弹窗不叠加。
    setSessionsOpen(false);
    setSettingsPane(pane);
    setSettingsOpen(true);
  }, [loadCatalog]);

  const openSessions = useCallback(async (): Promise<void> => {
    try { await loadCatalog(); } catch { /* 同上。 */ }
    setSettingsOpen(false);
    setSessionsOpen(true);
  }, [loadCatalog]);

  const onLocalCommand = useCallback((command: CommandHint): void => {
    switch (command.action) {
      case 'help': setNotice(helpText(commands)); return;
      case 'details': setReveal(value => value + 1); return;
      case 'exit': setNotice('Web 终端不需要 /exit；直接关闭标签页即可，宿主仍在运行。'); return;
      case 'new': void newSession().catch(() => { /* 失败已提示。 */ }); return;
      case 'model': void openSettings('model'); return;
      case 'sessions': void openSessions(); return;
      default: return;
    }
  }, [commands, newSession, openSettings, openSessions]);

  const confirm = useCallback((id: string): void => {
    void answerConfirmation(id, true).catch(error => setNotice(message(error)));
  }, []);
  const reject = useCallback((id: string): void => {
    void answerConfirmation(id, false).catch(error => setNotice(message(error)));
  }, []);
  const stopRound = useCallback((): void => {
    void cancelRound().catch(error => setNotice(message(error)));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (state.busy) { stopRound(); return; }
      if (state.pending) reject(state.pending.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.busy, state.pending, stopRound, reject]);

  useEffect(() => {
    const onResize = (): void => setCollapsed(window.innerWidth <= 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 需要用户决定时接管输入区。写入确认只可能出现在工具执行期间（此时 busy
  // 为真），因此这里不能再看 busy，否则确认按钮永远不会出现。
  const takeover = state.pending
    ? <div className="cardSeat">
        <ConfirmationCard
          confirmation={state.pending}
          busy={state.busy}
          showActions
          onConfirm={confirm}
          onReject={reject}
        />
      </div>
    : null;

  /**
   * 输入卡挂载在唯一位置（`.composerSeat`），首屏与活动态只靠容器的 `data-phase`
   * 切换外观。原先首屏把同一个元素渲染在 `.heroStack`、活动态渲染在 `.composerSeat`，
   * 状态翻转会让 textarea 被卸载重建，输入焦点与 IME 组合态一起丢失。
   */
  const composer = (
    <div className="composerSeat">
      {takeover ?? (
        <Composer
          state={state}
          draft={draft}
          commands={commands}
          hero={heroPhase}
          problem={problem}
          onDraft={setDraft}
          onSend={optimisticSend}
          onLocal={onLocalCommand}
          onCancel={stopRound}
          onNotice={setNotice}
        />
      )}
    </div>
  );

  return (
    <div className="frame" data-sidebar={collapsed ? 'collapsed' : 'expanded'}>
      <Sidebar
        collapsed={collapsed}
        sessions={catalog.sessions}
        onToggle={() => setCollapsed(value => !value)}
        onNewSession={() => void newSession().catch(() => { /* 失败已提示。 */ })}
        onResume={session => void resumeSession(session).catch(() => { /* 失败已提示。 */ })}
      />
      <main className="conversation">
        <header className="conversationHeader">
          <div className="titleRow">
            <span className="title">Bangumi 助手</span>
            <span className="tab" aria-selected="true">会话</span>
          </div>
          <div className="headerMeta">
            <span className="chip" data-state={state.connected ? 'on' : 'off'} title="连接状态">
              <span className="dot" />
              {state.connected ? '已连接' : '连接中断'}
            </span>
            <button
              type="button"
              className="iconButton"
              title="设置：模型、代理端口、登录状态"
              aria-label="设置"
              onClick={() => void openSettings(null)}
            >
              <svg {...ICON}>
                <path d="M8 2.2l4.8 2.7v5.9L8 13.8 3.2 10.8V4.9z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </header>
        <div className="body" data-phase={heroPhase ? 'hero' : 'active'}>
          <div className="scrollBody" ref={scroller} onScroll={onScroll} data-phase={heroPhase ? 'hero' : 'active'}>
            {heroPhase ? (
              <div className="hero">
                <div className="heroStack">
                  <div className="heroHeadline">
                    <span>Bangumi 助手</span>
                    <span className="heroBadge">Web 终端</span>
                  </div>
                  <p className="heroHint">用自然语言查询作品、管理收藏与更新观看或阅读进度；写入前会先给出预览并等待确认。</p>
                </div>
              </div>
            ) : (
              <div className="scroll">
                <div className="column">
                  {turns.map((turn, index) => (
                    <TurnView
                      key={turn.id}
                      turn={turn}
                      running={state.busy && index === turns.length - 1}
                      busy={state.busy}
                      reveal={reveal}
                      onConfirm={confirm}
                      onReject={reject}
                    />
                  ))}
                  {pendingEcho ? <UserBubble key="pending-echo" text={pendingEcho.text} /> : null}
                  <StreamingBlock
                    liveText={state.liveText}
                    liveThinking={state.liveThinking}
                    busy={state.busy}
                    status={state.status}
                    cancelling={state.cancelling}
                    startedAt={state.startedAt}
                  />
                </div>
              </div>
            )}
          </div>
          {!heroPhase && railTurns.length >= 2 ? (
            <div className="railSlot">
              <nav className="turnRail" aria-label="轮次导航">
                {railTurns.map((turn, index) => (
                  <button
                    key={turn.id}
                    type="button"
                    data-active={turn.id === activeTurn}
                    aria-label={`跳到第 ${index + 1} 轮`}
                    title={`第 ${index + 1} 轮`}
                    onClick={() => jumpTo(turn.id)}
                  />
                ))}
              </nav>
            </div>
          ) : null}
          {composer}
        </div>
      </main>
      {state.loginPrompt ? (
        <LoginDialog prompt={state.loginPrompt} onNotice={setNotice} />
      ) : null}
      {settingsOpen ? (
        <SettingsDialog
          catalog={catalog}
          initialPane={settingsPane}
          modelLabel={state.modelLabel}
          proxyMode={state.proxyMode}
          proxyAddress={state.proxyAddress}
          loginUsername={state.loginUsername}
          loginState={state.loginState}
          loginBusy={state.loginBusy}
          loginStatus={state.loginStatus}
          onClose={() => setSettingsOpen(false)}
          onNotice={setNotice}
          onReload={async () => { await loadCatalog(); }}
        />
      ) : null}
      {sessionsOpen ? (
        <SessionDialog
          sessions={catalog.sessions}
          onPick={session => { setSessionsOpen(false); void resumeSession(session).catch(() => { /* 失败已提示。 */ }); }}
          onClose={() => setSessionsOpen(false)}
        />
      ) : null}
      {notice ? <div className="toast" role="status">{notice}</div> : null}
    </div>
  );
}
