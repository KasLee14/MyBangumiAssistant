import type { ContentKind } from '../../components/content/registry';

/**
 * 内容组件库的示例数据。
 *
 * 每个 section 描述一个 `kind`：**一份主载荷 + 一份空载荷**，页面据此渲染真实预览，
 * 并现场生成「可直接粘进调试页」的 event 与 frame JSON（同一份数据，保证所见即所粘）。
 * 参数表写的是协议契约，字段名与 `bangumi/src/web/protocol.ts` 一一对应，取值枚举与
 * 前端校验器 `components/content/validate.ts` 一致——改协议时这里要跟着改，否则文档会说谎。
 */

/** 参数表的一行。`values` 只在枚举字段上给。 */
export interface ParamRow {
  field: string;
  type: string;
  required: '必填' | '可选';
  values?: string;
  note: string;
}

/** 参考的 ReactBits 组件；未使用就为 null。 */
export interface Reference {
  name: string;
  url: string;
  usage: string;
}

export interface LibrarySection {
  kind: ContentKind;
  title: string;
  summary: string;
  /**
   * 该 kind 的**载荷本体**——也就是块里 `props` 的内容。
   *
   * 不带字段名包装：定制组件的块形状统一为 `{ type, pending?, props }`，`props` 就是这个值
   * （`tags` 是数组本身）。类型放宽到 `unknown` 是因为 12 种载荷形状各不相同，示例数据不必
   * 逐 kind 收窄。
   */
  payload: unknown;
  /** 空数据形态，用来验证每个组件的空态；与 `payload` 同形。 */
  empty: unknown;
  params: ParamRow[];
  reference: Reference | null;
}

const REACTBITS = 'https://www.reactbits.dev';

/** `subjects` 的条目卡参数；`gallery` 的 item 是另一套字段（`subtitle` 等），不能共用这张表。 */
const SUBJECT_ITEM: ParamRow[] = [
  { field: 'id', type: 'number', required: '必填', note: '条目 ID，用作列表 key' },
  { field: 'name', type: 'string', required: '必填', note: '原名' },
  { field: 'kind', type: 'string', required: '必填', values: 'book / anime / music / game / real', note: '条目类型，决定角标' },
  { field: 'nameCn', type: 'string', required: '可选', note: '中文名；与原名相同时界面不重复显示' },
  { field: 'image', type: 'string', required: '可选', values: 'http(s) 绝对地址', note: '封面；缺失或加载失败时回落为等尺寸占位块' },
  { field: 'score', type: 'number', required: '可选', note: '全站评分，保留一位小数' },
  { field: 'scoreCount', type: 'number', required: '可选', note: '评分人数' },
  { field: 'rank', type: 'number', required: '可选', note: '站内排名' },
  { field: 'date', type: 'string', required: '可选', note: '放送/发售日期，宿主已格式化' },
  { field: 'summary', type: 'string', required: '可选', note: '简介' },
  { field: 'tags', type: 'string[]', required: '可选', note: '标签名' },
  { field: 'url', type: 'string', required: '可选', values: 'http(s) 绝对地址', note: '条目页；给了才渲染成可点链接' },
];

export const LIBRARY_SECTIONS: readonly LibrarySection[] = [
  {
    kind: 'SubjectCards',
    title: '条目集合 SubjectCards',
    summary: '封面墙（grid）与紧凑行（list）两种密度，共用同一份元信息。总数多于本帧条目时显式提示还有多少条未展示。',
    payload: {
      layout: 'grid',
      title: '搜索结果',
      total: 24,
      hint: '按匹配度排序',
      items: [
        {
          id: 1424, name: 'けいおん!', nameCn: '轻音少女', kind: 'anime',
          image: 'https://lain.bgm.tv/pic/cover/l/1f/6b/1424_x.jpg',
          score: 8.2, scoreCount: 12480, rank: 128, date: '2009-04-03',
          summary: '樱丘高中轻音部的日常。', tags: ['音乐', '日常', '京都动画'],
          url: 'https://bgm.tv/subject/1424',
        },
        {
          id: 876, name: 'CLANNAD', nameCn: '团子大家族', kind: 'anime',
          image: 'https://lain.bgm.tv/pic/cover/l/0e/83/876_x.jpg',
          score: 8.7, scoreCount: 15320, rank: 42, date: '2007-10-04',
          url: 'https://bgm.tv/subject/876',
        },
        {
          id: 2747, name: '涼宮ハルヒの憂鬱', nameCn: '凉宫春日的忧郁', kind: 'anime',
          score: 8, date: '2006-04-02', url: 'https://bgm.tv/subject/2747',
        },
      ],
    },
    empty: { layout: 'grid', items: [] },
    params: [
      { field: 'layout', type: 'string', required: '必填', values: 'grid / list', note: 'grid 封面墙、list 紧凑行' },
      { field: 'items', type: 'SubjectCardView[]', required: '必填', note: '条目卡列表' },
      { field: 'title', type: 'string', required: '可选', note: '区块标题' },
      { field: 'total', type: 'number', required: '可选', note: '结果总数；大于 items.length 时提示未展示条数' },
      { field: 'hint', type: 'string', required: '可选', note: '排序口径一类的补充说明' },
      ...SUBJECT_ITEM,
    ],
    // 这一条原先指向 Spotlight Card；该组件已按用户选择（interaction 样张的「A · 只精修状态反馈」）移除。
    // 网格卡现在没有 vendor 落点，只保留 hover 抬升与封面缓推（纯 CSS）。
    reference: null,
  },
  {
    kind: 'StatsCard',
    title: '统计 StatsCard',
    summary: '一个主数字加一组分布。三种编码：横向条形（bars）、竖向柱状（histogram）、纯列表（list）；不画坐标轴与网格线。',
    payload: {
      mode: 'histogram',
      title: '评分分布',
      headline: { value: '8.2', label: '平均分' },
      entries: [
        { label: '10', value: '1420', ratio: 0.11, tone: 'primary' },
        { label: '9', value: '3860', ratio: 0.31 },
        { label: '8', value: '4210', ratio: 0.34 },
        { label: '7', value: '1830', ratio: 0.15 },
        { label: '6 及以下', value: '1160', ratio: 0.09 },
      ],
      note: '共 12480 人评分',
    },
    empty: { mode: 'list', entries: [] },
    params: [
      { field: 'mode', type: 'string', required: '必填', values: 'list / bars / histogram', note: '分布编码方式' },
      { field: 'entries', type: 'StatEntryView[]', required: '必填', note: '分布项' },
      { field: 'entries[].label', type: 'string', required: '必填', note: '分档名，例如「9」' },
      { field: 'entries[].value', type: 'string', required: '必填', note: '展示值，宿主已格式化的字符串' },
      { field: 'entries[].ratio', type: 'number', required: '可选', note: '相对量 0–1，决定条形/柱高；越界由组件夹取' },
      { field: 'entries[].tone', type: 'string', required: '可选', values: 'default / primary / muted', note: '强调层级' },
      { field: 'headline.value / label', type: 'string', required: '可选', note: '主数字与其说明；两者都必填才生效' },
      { field: 'title / note', type: 'string', required: '可选', note: '标题与脚注' },
    ],
    reference: {
      name: 'Counter',
      url: `${REACTBITS}/components/counter`,
      usage: '主数字的滚动读数（原来是一段静态文本）',
    },
  },
  {
    kind: 'ProgressView',
    title: '进度 ProgressView',
    summary: '数值进度条与章节网格可同时出现。章节三态（已看/当前/未看）用颜色与描边区分，不靠图例说明。',
    payload: {
      title: '观看进度', current: 7, total: 13, unit: '话',
      episodes: [
        { id: 1, label: '1', state: 'done' }, { id: 2, label: '2', state: 'done' },
        { id: 3, label: '3', state: 'done' }, { id: 4, label: '4', state: 'done' },
        { id: 5, label: '5', state: 'done' }, { id: 6, label: '6', state: 'done' },
        { id: 7, label: '7', state: 'current' }, { id: 8, label: '8', state: 'todo' },
      ],
      note: '上次观看：2026-04-12',
    },
    empty: {},
    params: [
      { field: 'current / total', type: 'number', required: '可选', note: '数值进度；两者都在时渲染进度条与百分比' },
      { field: 'unit', type: 'string', required: '可选', note: '单位，例如「话」「卷」' },
      { field: 'episodes', type: 'Episode[]', required: '可选', note: '章节网格；与数值进度可同时出现' },
      { field: 'episodes[].id', type: 'number', required: '必填', note: '章节 ID' },
      { field: 'episodes[].label', type: 'string', required: '必填', note: '章节短标签' },
      { field: 'episodes[].state', type: 'string', required: '可选', values: 'done / current / todo', note: '缺省按未看处理' },
      { field: 'title / note', type: 'string', required: '可选', note: '标题与脚注' },
    ],
    reference: null,
  },
  {
    kind: 'InfoBox',
    title: '信息栏 InfoBox',
    summary: '键值对列表，语义是 `dl`（名称–值成对读出）。宽窄自适应：窄宽度下标签与值叠成两行。',
    payload: {
      title: '作品信息',
      rows: [
        { label: '中文名', value: '轻音少女' },
        { label: '原名', value: 'けいおん!' },
        { label: '类型', value: 'TV 动画' },
        { label: '话数', value: '13 话 + OVA' },
        { label: '放送开始', value: '2009-04-03' },
        { label: '放送星期', value: '星期四', tone: 'muted' },
      ],
    },
    empty: { rows: [] },
    params: [
      { field: 'rows', type: '{ label, value, tone? }[]', required: '必填', note: '键值行' },
      { field: 'rows[].label / value', type: 'string', required: '必填', note: '名称与值' },
      { field: 'rows[].tone', type: 'string', required: '可选', values: 'default / muted', note: '次要信息降调' },
      { field: 'title', type: 'string', required: '可选', note: '区块标题' },
    ],
    reference: {
      name: 'Animated List（只参考节奏，未引入源码）',
      url: `${REACTBITS}/components/animated-list`,
      usage: '行交错入场；该组件只接受 string[]，承载不了结构化行，因此用 CSS keyframes 实现了同样的错峰节奏',
    },
  },
  {
    kind: 'DataTable',
    title: '数据表格 DataTable',
    summary: '可点表头本地排序：`localeCompare(..., { numeric: true })` 让「第 10 话」排在「第 9 话」之后，空单元格始终排末尾，`aria-sort` 同步给读屏器。窄宽度下表体横向滚动。',
    payload: {
      title: '章节列表',
      columns: [
        { key: 'ep', label: '话', align: 'right' },
        { key: 'title', label: '标题' },
        { key: 'air', label: '放送日' },
      ],
      rows: [
        { ep: '1', title: '轻音部！', air: '2009-04-03' },
        { ep: '2', title: '乐器！', air: '2009-04-10' },
        { ep: '10', title: '合宿！' },
      ],
      // V3 点睛的两处可选强调：关键列（话数走主色深字）+ 当前行（整行浅粉底、首格左侧实心条、「当前」徽章）
      keyColumn: 'ep',
      currentRow: '2',
      note: '共 13 话，展示前 3 话',
    },
    empty: { columns: [{ key: 'ep', label: '话' }], rows: [] },
    params: [
      { field: 'columns', type: 'TableColumn[]', required: '必填', note: '列定义；空数组时显示空态' },
      { field: 'columns[].key / label', type: 'string', required: '必填', note: '取值键与表头文字' },
      { field: 'columns[].align', type: 'string', required: '可选', values: 'left / right', note: '数字列建议右对齐' },
      { field: 'rows', type: 'Record<string, string>[]', required: '必填', note: '每行按列 key 取值；缺键留空，不显示 undefined' },
      { field: 'keyColumn', type: 'string', required: '可选', note: '关键列：该列的值走主色深字 + 600' },
      { field: 'currentRow', type: 'string', required: '可选', note: '当前行：按关键列（缺省首列）的值匹配；命中则整行浅粉底 + 首格左侧 3px 实心条 + 「当前」徽章' },
      { field: 'title / note', type: 'string', required: '可选', note: '标题与脚注' },
    ],
    reference: {
      name: 'Animated List（只参考节奏，未引入源码）',
      url: `${REACTBITS}/components/animated-list`,
      usage: '行入场；排序重排时不做动画，避免 layout 抖动',
    },
  },
  {
    kind: 'Timeline',
    title: '时间线 Timeline',
    summary: '按时间排列的事件。`actor` 有值时单独成列，用弱文本呈现。',
    payload: {
      title: '最近动态',
      entries: [
        { time: '2026-04-12 21:40', text: '看到第 7 话', actor: '我' },
        { time: '2026-04-05 22:10', text: '收藏了条目', actor: '我' },
        { time: '2026-03-28 19:02', text: '评分 8 分' },
      ],
    },
    empty: { entries: [] },
    params: [
      { field: 'entries', type: '{ time, text, actor? }[]', required: '必填', note: '按传入顺序渲染，组件不重排' },
      { field: 'entries[].time / text', type: 'string', required: '必填', note: '时间（宿主已格式化）与事件文字' },
      { field: 'entries[].actor', type: 'string', required: '可选', note: '动作发出者' },
      { field: 'title', type: 'string', required: '可选', note: '区块标题' },
    ],
    reference: {
      name: 'Animated List（只参考节奏，未引入源码）',
      url: `${REACTBITS}/components/animated-list`,
      usage: '事件逐条入场',
    },
  },
  {
    kind: 'TagCloud',
    title: '标签云 TagCloud',
    summary: '唯一一个**载荷就是数组本身**的 kind。标签是纯展示，不带点击行为，因此用 `span` 而不是伪装成按钮。',
    payload: [
      { name: '音乐', count: 1820, selected: true },
      { name: '日常', count: 1640 },
      { name: '京都动画', count: 980 },
      { name: '校园', count: 870 },
      { name: '漫画改', count: 640 },
    ],
    empty: [],
    params: [
      { field: '（载荷本体）', type: '{ name, count?, selected? }[]', required: '必填', note: '注意没有外层对象：props 直接是数组' },
      { field: '[].name', type: 'string', required: '必填', note: '标签名' },
      { field: '[].count', type: 'number', required: '可选', note: '使用人数' },
      { field: '[].selected', type: 'boolean', required: '可选', note: '选中态（主色实心）' },
    ],
    reference: {
      name: 'Glare Hover',
      url: `${REACTBITS}/animations/glare-hover`,
      usage: '标签悬停时的掠光',
    },
  },
  {
    kind: 'Gallery',
    title: '横向列表 Gallery',
    summary: '角色、关联条目、图集。`overflow-x: auto` 且**不隐藏滚动条**——滚动条是键盘与触屏之外唯一能说明「右边还有内容」的信号；轨道可聚焦，方向键可滚动。',
    payload: {
      title: '主要声优',
      items: [
        { id: 1, name: '丰崎爱生', image: 'https://lain.bgm.tv/pic/crt/l/1f/6b/1_x.jpg', subtitle: '平泽唯', url: 'https://bgm.tv/person/1' },
        { id: 2, name: '日笠阳子', subtitle: '秋山澪', url: 'https://bgm.tv/person/2' },
        { id: 3, name: '佐藤聪美', subtitle: '田井中律' },
        { id: 4, name: '寿美菜子', subtitle: '琴吹紬' },
      ],
    },
    empty: { items: [] },
    params: [
      { field: 'items', type: 'GalleryItemView[]', required: '必填', note: '横向卡片' },
      { field: 'items[].id / name', type: 'number / string', required: '必填', note: 'ID 与名称' },
      { field: 'items[].image', type: 'string', required: '可选', values: 'http(s) 绝对地址', note: '封面，失败回落占位块' },
      { field: 'items[].subtitle', type: 'string', required: '可选', note: '副标题，例如角色名' },
      { field: 'items[].url', type: 'string', required: '可选', values: 'http(s) 绝对地址', note: '给了才渲染成链接' },
      { field: 'title', type: 'string', required: '可选', note: '区块标题' },
    ],
    reference: null,
  },
  {
    kind: 'CompareTable',
    title: '修改对比 CompareTable',
    summary: '写入前后的字段对照。`changed` 为 false 的行不强调，避免把「值没变」读成「改成了这样」。',
    payload: {
      title: '写入结果',
      rows: [
        { label: '评分', before: '8', after: '9', changed: true },
        { label: '短评', before: '（空）', after: '神作', changed: true },
        { label: '标签', before: '音乐', after: '音乐', changed: false },
      ],
      note: '只列出被写入的字段',
    },
    empty: { rows: [] },
    params: [
      { field: 'rows', type: '{ label, before, after, changed }[]', required: '必填', note: '逐字段对照' },
      { field: 'rows[].label', type: 'string', required: '必填', note: '字段名' },
      { field: 'rows[].before / after', type: 'string', required: '必填', note: '前后值；空值用占位文案表达，不要用空串' },
      { field: 'rows[].changed', type: 'boolean', required: '必填', note: '是否变化，决定该行是否强调' },
      { field: 'title / note', type: 'string', required: '可选', note: '标题与脚注' },
    ],
    reference: null,
  },
  {
    kind: 'QuoteBlock',
    title: '引用块 QuoteBlock',
    summary: '需要保真的文本：工具原始输出、日志、JSON。`mono` 为真时用等宽字体，横向可滚动而不换行折断。',
    payload: {
      title: '接口原始响应',
      text: '{\n  "subject_id": 1424,\n  "rating": { "total": 12480, "score": 8.24 }\n}',
      mono: true,
    },
    empty: { text: '', mono: true },
    params: [
      { field: 'text', type: 'string', required: '必填', note: '保留换行与空白' },
      { field: 'mono', type: 'boolean', required: '必填', note: '是否等宽呈现（JSON、日志为 true）' },
      { field: 'title', type: 'string', required: '可选', note: '区块标题' },
    ],
    // 这一条原先指向 Shiny Text；该组件已移除——content-v2 的 V3 把引用块标题退成等宽小字弱色，
    // 与「常驻闪光」冲突（常驻循环也因此少一处）。
    reference: null,
  },
  {
    kind: 'Callout',
    title: '状态提示 Callout',
    summary: '三段式反馈：进行中 / 成功 / 警告 / 失败。只有标记着色，不做整条彩色横幅。主预览给的是 **progress** 态——只有它会流动边框（`StarBorder` 的落点）；想看其余三态把 `tone` 换成 success / warning / error。',
    payload: {
      tone: 'progress',
      text: '正在写入 2 项修改…',
      detail: '这一步由宿主执行，界面只反映状态',
    },
    empty: { tone: 'warning', text: '' },
    params: [
      { field: 'tone', type: 'string', required: '必填', values: 'progress / success / warning / error', note: '语义色调' },
      { field: 'text', type: 'string', required: '必填', note: '主文案' },
      { field: 'detail', type: 'string', required: '可选', note: '补充说明' },
    ],
    // progress 态是本条唯一的 vendor 落点：StarBorder 的细光（色带 34%、透明度 12%、单程 2.2s）
    reference: {
      name: 'Star Border',
      url: `${REACTBITS}/animations/star-border`,
      usage: '仅 progress 态的流光细边；其余三态是终态，不加常驻动画',
    },
  },
  {
    kind: 'LinkList',
    title: '链接列表 LinkList',
    summary: '相关条目与参考资料。每个链接都是真实可聚焦的 `<a>`，`target="_blank"` 必然配 `rel="noreferrer"`。',
    payload: {
      title: '相关链接',
      links: [
        { label: '条目页', url: 'https://bgm.tv/subject/1424', hint: '官方' },
        { label: '角色列表', url: 'https://bgm.tv/subject/1424/characters' },
        { label: '制作人员', url: 'https://bgm.tv/subject/1424/persons' },
      ],
    },
    empty: { links: [] },
    params: [
      { field: 'links', type: '{ label, url, hint? }[]', required: '必填', note: '每项渲染成一个新窗口链接' },
      { field: 'links[].label / url', type: 'string', required: '必填', values: 'url 必须是 http(s) 绝对地址', note: '链接文字与地址' },
      { field: 'links[].hint', type: 'string', required: '可选', note: '同行弱文本，比 title 属性更可读' },
      { field: 'title', type: 'string', required: '可选', note: '区块标题' },
    ],
    reference: null,
  },
];

/**
 * 左侧导航的分组：**数组顺序即渲染顺序**，组内 `kinds` 的顺序即导航里的排列顺序。
 *
 * 为什么和 `LIBRARY_SECTIONS` 分开：分组是「导航怎么组织」，不是条目契约的一部分；
 * 但两者都是**表**——新增一个 kind 改的是数据（这里加进某一组 + `LIBRARY_SECTIONS` 加一项），
 * 而不是往组件的 JSX 里加分支。`App.tsx` 完全从这两张表派生导航，不硬编码任何 kind。
 */
export const LIBRARY_GROUPS = [
  { key: 'entries', label: '条目与集合', kinds: ['SubjectCards', 'Gallery', 'TagCloud', 'LinkList'] },
  { key: 'data', label: '数据与统计', kinds: ['StatsCard', 'ProgressView', 'DataTable', 'CompareTable', 'Timeline'] },
  { key: 'text', label: '文本与提示', kinds: ['InfoBox', 'QuoteBlock', 'Callout'] },
] as const satisfies readonly { key: string; label: string; kinds: readonly ContentKind[] }[];
