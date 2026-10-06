/**
 * Web 终端与宿主之间的共享协议。
 *
 * 只包含类型与纯数据定义，不依赖 node 内置模块或后端实现，因此既能被
 * `tsconfig.json` 编译进宿主侧，也能被 `web/tsconfig.json` 下的浏览器代码
 * 以 `import type` 引用。宿主把 Pi 的会话事件与消息显式映射成这里的视图
 * 类型：排版文案、状态名、脱敏与控制字符清理全部在宿主侧生成，浏览器只
 * 负责呈现。
 */

/** 写入预览：一次具体修改的确认请求，浏览器只呈现宿主生成的文本。 */
export interface ConfirmationView {
  id: string;
  title: string;
  /** 宿主按完整计划生成的确认按钮文案。 */
  confirmLabel?: string;
  /** 宿主生成的中文操作说明和完整范围，按普通正文呈现并保留换行。 */
  preview: string;
  state: 'pending' | 'accepted' | 'rejected' | 'expired';
  hint: string;
}

/**
 * 条目公共字段。
 *
 * `id` 在会话切换后仍继续递增；`version` 在条目被原地更新时递增（工具从
 * 进行中变为完成、确认卡从待确认变为已确认）。宿主按这两个字段决定增量帧
 * 里要重发哪些条目，浏览器按 `id` 替换而不是重复追加。
 */
export interface TranscriptItemBase { id: number; version: number }

/** 工具活动：一次工具调用的开始、进行与结束。 */
export interface ActivityItemView extends TranscriptItemBase {
  kind: 'activity';
  label: string;
  state: 'running' | 'waiting' | 'ok' | 'partial' | 'unknown' | 'error';
  detail: string;
  /** 批次的中文计数与缺口在成功时也展示；普通工具仍沿用折叠详情。 */
  showDetail?: boolean;
}

/* ============================================================
 * 内容块载荷：多样化消息展示
 * ------------------------------------------------------------
 * 下面这些类型描述 12 种内容块各自的载荷（块的信封见下方「消息内容块」）。
 * 它们是**协议预留的展示能力**：宿主只有在收到上游下发的对应块时才会投影出
 * 来，浏览器则按块渲染，不需要改前端。
 *
 * 字段命名尽量贴着 Bangumi 官方 API 的响应（subject 的 rating / images /
 * tags、collection 的 type / ep_status 等），减少宿主映射时的转换成本。
 * 组件清单、渲染示例与完整示例 JSON 见
 * `docs/bgm-design/component-library.html`。
 * ============================================================ */

/** 条目类型，与 Bangumi 的 subject type 对应（1 书籍 / 2 动画 / 3 音乐 / 4 游戏 / 6 三次元）。 */
export type SubjectKind = 'book' | 'anime' | 'music' | 'game' | 'real';

/** 单个条目卡；可直接由 `get_subject_details` 的结果映射。 */
export interface SubjectCardView {
  id: number;
  /** 原名。 */
  name: string;
  /** 中文名；缺失时界面回落显示 `name`。 */
  nameCn?: string;
  kind: SubjectKind;
  /** 封面图地址；缺失时显示占位块。 */
  image?: string;
  /** 全站评分（0–10）。 */
  score?: number;
  /** 评分人数。 */
  scoreCount?: number;
  /** 站内排名。 */
  rank?: number;
  /** 放送/发售日期，已格式化的文本。 */
  date?: string;
  /** 简介；界面按行数截断。 */
  summary?: string;
  /** 标签名，可带收藏人数（界面只显示名字与可选计数）。 */
  tags?: string[];
  /** 条目页地址。 */
  url?: string;
}

/** 条目网格或列表；`layout` 决定封面墙还是紧凑行。 */
export interface SubjectCollectionView {
  title?: string;
  items: SubjectCardView[];
  layout: 'grid' | 'list';
  /** 结果总数；大于 `items.length` 时界面提示还有更多。 */
  total?: number;
  hint?: string;
}

/** 统计数据的一项。 */
export interface StatEntryView {
  label: string;
  value: string;
  /** 相对量（0–1），用于条形长度；缺失时只显示数字。 */
  ratio?: number;
  hint?: string;
  tone?: 'default' | 'primary' | 'muted';
}

/** 统计卡：一个主数字 + 一组分布。 */
export interface StatsView {
  title?: string;
  /** 主数字，例如平均分。 */
  headline?: { value: string; label: string };
  entries: StatEntryView[];
  /** `bars` 横向条形；`histogram` 竖向柱状（评分分布）；`list` 纯列表。 */
  mode: 'list' | 'bars' | 'histogram';
  note?: string;
}

/** 进度：数值进度条或章节网格。 */
export interface ProgressView {
  title?: string;
  current?: number;
  total?: number;
  /** 进度单位，例如「话」「卷」。 */
  unit?: string;
  /** 章节网格；与数值进度可同时出现。 */
  episodes?: { id: number; label: string; state: 'done' | 'current' | 'todo' }[];
  note?: string;
}

/** 键值信息栏，对应条目页左栏的 infobox。 */
export interface InfoBoxView {
  title?: string;
  rows: { label: string; value: string; tone?: 'default' | 'muted' }[];
}

/** 结构化表格：章节列表、目录条目、修订记录等。 */
export interface TableView {
  title?: string;
  columns: { key: string; label: string; align?: 'left' | 'right' }[];
  /** 每行按 `columns[].key` 取值；缺失的单元格留空。 */
  rows: Record<string, string>[];
  /**
   * V3 点睛的两处可选强调（宿主不填就没有那一层，前端不会去猜哪一行是「当前」）：
   * - `keyColumn`：哪一列是**关键列**——该列的值走主色深字 + 加粗；
   * - `currentRow`：哪一行是**当前行**——整行浅粉底 + 首格左侧 3px 实心条 + 「当前」徽章。
   *   `currentRow` 按 `keyColumn`（缺省用首列）的值匹配 `rows` 里的某一行。
   */
  keyColumn?: string;
  currentRow?: string;
  note?: string;
}

/** 时间线：按时间排列的动态或事件。 */
export interface TimelineView {
  title?: string;
  entries: { time: string; text: string; actor?: string }[];
}

/** 标签云里的一项；条目载荷就是这个数组（见 `TranscriptItemView` 的 `tags` 成员）。 */
export interface TagCloudItemView {
  name: string;
  count?: number;
  selected?: boolean;
}

/** 横向封面或人物列表。 */
export interface GalleryView {
  title?: string;
  items: { id: number; name: string; image?: string; subtitle?: string; url?: string }[];
}

/** 修改前后对比；用于写入完成后的结果回显。 */
export interface CompareView {
  title?: string;
  rows: { label: string; before: string; after: string; changed: boolean }[];
  note?: string;
}

/** 引用块：工具原始输出、日志或需要保真的文本。 */
export interface QuoteView {
  title?: string;
  text: string;
  /** 是否按等宽字体呈现（JSON、日志为真）。 */
  mono: boolean;
}

/** 三段式反馈（进行中 / 成功 / 警告 / 失败）。 */
export interface CalloutView {
  tone: 'progress' | 'success' | 'warning' | 'error';
  text: string;
  detail?: string;
}

/** 链接列表：相关条目、参考资料。 */
export interface LinkListView {
  title?: string;
  links: { label: string; url: string; hint?: string }[];
}

/* ============================================================
 * 消息内容块：助手消息的内部结构
 * ------------------------------------------------------------
 * 助手消息的 `content` 是一个**有序块数组**：文本块与内容块按数组顺序交替，
 * 于是"在文本中间插入一个组件"就只是数组里多了一项。前端按块顺序流式渲染：
 * 文本块实时增长，内容块先渲染骨架、`pending` 消失后渲染真实数据。
 *
 * 三个关键约定（由下发方遵守，宿主只做投影）：
 * 1. 块只出现在 `message_update.assistantMessageEvent.partial.content` 与
 *    `message_end.message.content` 里；
 * 2. 同一个 `contentIndex` 被多次快照**整体替换**，`pending: true` 表示这一块的
 *    载荷还在传（期间可以缺字段），该字段消失表示"传完了，且此后内容不再变"；
 * 3. 数组顺序即渲染顺序。
 *
 * 为什么块用 `type` 而不是条目的 `kind`：文本块的形状与 Pi 的 `TextContent` 一致
 * （`{ type: 'text', text }`），上游可以直接透传快照，不需要为显示层做一次改名。
 * ============================================================ */

/** 文本块：与 Pi 的 `TextContent` 同形。 */
export interface TextBlock {
  type: 'text';
  text: string;
}

/**
 * 12 种定制组件的载荷。
 *
 * 块的形状对 12 种组件**完全统一**：`{ type, pending?, props }`。`type` 的取值就是
 * **组件库里的组件名**（`SubjectCards` / `TagCloud` / …，与 `components/content/` 的文件名
 * 一致），组件需要的参数一律写在 `props` 里。
 *
 * 这样标识只有一个来源（组件名本身），不必再维护「语义名 → 组件」的对照：
 * 读到 `type: 'DataTable'` 就知道渲染哪个组件。
 *
 * 只适用于**定制组件**：文本块保持 Pi 的原生形状 `{ type:'text', text }`（见 `TextBlock`），
 * 因此上游下发的快照里文本块可以直接透传，不必为显示层多做一次映射。
 */
type ContentBlockPayload =
  | { type: 'SubjectCards'; props: SubjectCollectionView }
  | { type: 'StatsCard'; props: StatsView }
  | { type: 'ProgressView'; props: ProgressView }
  | { type: 'InfoBox'; props: InfoBoxView }
  | { type: 'DataTable'; props: TableView }
  | { type: 'Timeline'; props: TimelineView }
  | { type: 'TagCloud'; props: TagCloudItemView[] }
  | { type: 'Gallery'; props: GalleryView }
  | { type: 'CompareTable'; props: CompareView }
  | { type: 'QuoteBlock'; props: QuoteView }
  | { type: 'Callout'; props: CalloutView }
  | { type: 'LinkList'; props: LinkListView };

/**
 * 内容块。
 *
 * `pending` 只在流式期出现，含义是「这一块的载荷还在传」——前端据此渲染骨架，
 * **不校验载荷**（骨架与降级卡是两件事：前者是"还没到"，后者是"到了但不对"）。
 * 交叉而不是在 12 个分支里各写一遍，是为了让判别字段 `type` 与穷尽性检查保持原样。
 */
export type ContentBlockView = ContentBlockPayload & { pending?: boolean };

/** 助手消息内容块的联合。 */
export type MessageBlock = TextBlock | ContentBlockView;

export type TranscriptItemView =
  | (TranscriptItemBase & { kind: 'header'; text: string })
  | (TranscriptItemBase & { kind: 'user' | 'notice' | 'error'; text: string })
  // 助手消息：内容块数组（见上方「消息内容块」）。扩展注入的结构化内容也投影成
  // 这一形态（单块），`origin` 只用于排查与将来的样式区分，不参与渲染分支。
  | (TranscriptItemBase & { kind: 'assistant'; content: MessageBlock[]; origin?: 'extension' })
  | ActivityItemView
  | (TranscriptItemBase & { kind: 'confirmation'; confirmation: ConfirmationView });

/** Pi 的思考强度名称；`off` 表示关闭思考。 */
export type ThinkingLevelName = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** 一个可选的思考强度：原始级别名与中文展示名都由宿主给出，浏览器不做映射。 */
export interface ThinkingLevelOptionView {
  level: ThinkingLevelName;
  /** 中文展示名，例如「高」；原始级别名用于与 Pi 文档对齐。 */
  label: string;
}

/**
 * 思考强度：当前值、当前模型支持的级别与是否支持思考。
 *
 * 可用级别来自 Pi 的 `getAvailableThinkingLevels()`，随模型能力变化（例如
 * `deepseek/deepseek-flash` 只支持 off/low/high/max）；未选择模型时三者都是空值，
 * 浏览器据此把入口置灰。
 */
export interface ThinkingView {
  /** 当前生效级别；未选择模型时为空字符串。 */
  current: ThinkingLevelName | '';
  /** 当前生效级别的中文展示名；未选择模型时为空字符串。 */
  currentLabel: string;
  /** 当前模型支持的级别，按 Pi 的顺序排列；未选择模型时为空数组。 */
  available: ThinkingLevelOptionView[];
  /** 当前模型是否支持思考（Pi 的 `model.reasoning`）。 */
  supported: boolean;
}

/**
 * 本会话累计消耗。
 *
 * 这是**计费口径**的累计值：包含已经被压缩掉的历史，也包含全部工具轮次，因此
 * 它大于当前上下文里的 token 数。`total` 是四项之和，由宿主算好，浏览器不做
 * 任何估算；`cost` 按 Pi 的价目表计算，模型未配置价格时为 0。
 *
 * 界面主数字用的是「已计费输入 ＋ 输出」：`input + cacheRead + cacheWrite` 才是
 * 完整的提示词量，缓存命中与缓存写入同属计费输入。
 */
export interface TokenUsageView {
  /** 未命中缓存的输入 token。 */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** 四项之和。 */
  total: number;
  cost: number;
  /**
   * 会话累计缓存命中率（百分比数值，例如 67.4）；提示词总量为 0 时为 null，
   * 浏览器据此不显示这一段。口径与 Pi 自己的终端底栏一致：
   * `cacheRead / (input + cacheRead + cacheWrite)`。
   */
  cacheHitPercent: number | null;
}

/**
 * 当前上下文占用。
 *
 * `tokens` 是**当前上下文**的估算量，与会话累计消耗是两个不同的数：压缩之后它
 * 会变小，而累计消耗只会增长。Pi 在压缩后到下一次模型响应之前无法给出这个值，
 * 此时整个字段为 null（宿主已过滤 `percent` 也为 null 的情况）。
 */
export interface ContextUsageView {
  tokens: number;
  contextWindow: number;
  /** 占窗口的百分比数值（例如 13.2），由 Pi 计算。 */
  percent: number;
}

/** 除会话条目之外的会话状态；流式更新时它随每一帧发送。 */
export interface ChatScalarsView {
  /** 宿主已完成初始化，可以接受输入。 */
  ready: boolean;
  busy: boolean;
  cancelling: boolean;
  /** 本轮开始时间（毫秒时间戳），未运行时为 0。 */
  startedAt: number;
  status: string;
  /** `provider/model`；未选择模型时为空字符串。 */
  modelLabel: string;
  sessionId: string;
  sessionName: string;
  /** 思考强度：当前值、当前模型支持的级别与是否支持思考。 */
  thinking: ThinkingView;
  /**
   * 本会话累计 token 消耗；尚未产生任何消耗时为 null，浏览器据此不显示这一项。
   * 数字在每次 agent 轮次结束时刷新，流式过程中保持上一轮的值。
   */
  tokenUsage: TokenUsageView | null;
  /** 当前上下文占用；未选择模型或压缩后暂时未知时为 null。 */
  contextUsage: ContextUsageView | null;
  loginText: string;
  /** 登录状态摘要，供侧栏按钮显示；不代表在线核实结果。 */
  loginState: 'signed-in' | 'signed-out';
  /** 已保存会话中的 Bangumi 用户名；未登录时为空字符串。 */
  loginUsername: string;
  /** 当前生效的网络线路描述（例如「系统代理：http://127.0.0.1:7890」或「直连」）。 */
  proxyLabel: string;
  /** 当前选中的线路配置项，供设置弹窗回显。 */
  proxyMode: 'auto' | 'direct' | 'manual';
  /** 当前生效的代理地址；直连或未发现代理时为空字符串。 */
  proxyAddress: string;
  /** 正在流式输出的助手内容块与思考文本；思考不进块序列（见 Streaming 的折叠块）。 */
  liveContent: MessageBlock[];
  liveThinking: string;
  /** 等待浏览器确认的写入预览。 */
  pending: ConfirmationView | null;
  /** 等待浏览器输入的登录凭据；原值不进入聊天、模型或会话条目。 */
  loginPrompt: { id: number } | null;
  /** 设置弹窗里的显式登录正在进行（等待人机验证或网站响应）。 */
  loginBusy: boolean;
  /** 登录进度文本，例如「正在等待浏览器完成人机验证…」；没有进行中的登录时为空串。 */
  loginStatus: string;
}

export interface ChatStateView extends ChatScalarsView { items: TranscriptItemView[] }

/** 可切换的模型；`current` 标记当前生效项。 */
export interface ModelOptionView {
  provider: string;
  model: string;
  label: string;
  current: boolean;
}

/** 历史会话；`name` 用于展示，`path` 用于恢复，`id` 保留会话身份。 */
export interface SessionOptionView {
  id: string;
  path: string;
  name: string;
  modified: string;
  messageCount: number;
  current: boolean;
  /** 活跃会话的后台状态；未载入的历史会话没有这些字段。 */
  busy?: boolean;
  awaitingConfirmation?: boolean;
  awaitingLogin?: boolean;
}

/** 斜杠命令提示：来自 Pi 已注册的扩展命令、提示模板与技能。 */
export interface CommandOptionView {
  name: string;
  description: string;
  source: string;
}

/** 可填入密钥的模型提供方，以及它当前的凭据来源。 */
export interface ProviderOptionView {
  id: string;
  /** 展示名；没有单独名称时与 `id` 相同。 */
  label: string;
  /**
   * 凭据来源：`runtime` 是本次运行在浏览器里填入的，`environment` 来自环境变量，
   * `stored` 来自本机凭据存储，`none` 表示尚未配置。
   */
  authSource: 'runtime' | 'environment' | 'stored' | 'none';
  /** 该提供方可用的模型数量。 */
  modelCount: number;
  /** 是否是当前生效模型所属的提供方。 */
  current: boolean;
}

export interface CatalogView {
  models: ModelOptionView[];
  sessions: SessionOptionView[];
  commands: CommandOptionView[];
  providers: ProviderOptionView[];
  /** 是否支持把密钥保存到本机（Pi 的 `auth.json`）；为 false 时浏览器只提供「仅本次运行」。 */
  canPersistCredentials: boolean;
}

export interface ApiErrorView { code: string; message: string }

/** SSE 帧：`state` 增量携带条目，`full` 表示客户端应整体替换已有条目。 */
export type ServerEvent =
  | { type: 'state'; instanceId: string; revision: number; full: boolean; items: TranscriptItemView[]; state: ChatScalarsView }
  | { type: 'sessions'; sessions: SessionOptionView[] }
  | { type: 'fatal'; message: string };

/** 客户端提交的命令载荷，全部是按需字段而非通用透传。 */
export interface SubmitPayload { input: string }
/** 写入确认回应；`accepted` 为 false 即拒绝，宿主按默认取消处理。 */
export interface ConfirmPayload { id: string; accepted: boolean }
/** 登录凭据输入：一次交出邮箱与密码；取消时传 `cancelled: true`。 */
export interface LoginInputPayload { id: number; email?: string; password?: string; cancelled?: boolean }
/** 模型切换：提供方与模型 ID 都必须来自模型列表。 */
export interface ModelPayload { provider: string; model: string }
/** 思考强度切换；级别必须来自宿主下发的可用列表。 */
export interface ThinkingPayload { level: ThinkingLevelName }
/**
 * 模型密钥：`persist` 为 true 时写入本机 Pi 凭据存储（`auth.json`），重启后仍然生效；
 * 缺省或 false 时只注入本次运行的运行时凭据。两种方式都不进入会话条目与日志。
 */
export interface CredentialPayload { provider: string; key: string; persist?: boolean }
/** 清除某个提供方保存在本机的密钥；环境变量与 `models.json` 内联密钥不受影响。 */
export interface ClearCredentialPayload { provider: string }
/** 网络线路切换；`manual` 时 `url` 必填，形如 `http://127.0.0.1:7890`。 */
export interface ProxyPayload { mode: 'auto' | 'direct' | 'manual'; url?: string }
/** 新建会话或恢复指定会话。 */
export interface SessionPayload { action: 'new' | 'resume'; path?: string; sessionId?: string }
