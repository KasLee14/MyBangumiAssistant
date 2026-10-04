import {
  CONTENT_RENDERERS, isContentKind,
  type BaseTranscriptKind, type ContentKind,
} from './registry';

/* ============================================================
 * 内容条目运行时校验
 * ------------------------------------------------------------
 * 零依赖手写守卫：前端源码位于 `web/`，要引第三方运行时库（zod/ajv）必须在
 * `vite.config.ts` 里加 alias 指向 `bangumi/node_modules`，本轮刻意不动构建配置，
 * 因此这里不引入任何库。规则与 `docs/bgm-design/component-library.html` 第 13 节
 * 「宿主接入清单」逐条对应，宿主侧将来要做权威校验时可直接翻译成 JSON Schema。
 *
 * 三条刻意的边界：
 * 1. **不校验 `id` / `version`**：它们是信封字段，由调用方补齐（宿主天然有，
 *    调试面板按出现顺序分配）。校验器只管载荷形状。
 * 2. **不做数值换算、不生成文案、不排序**：`value` 是宿主写好的字符串，
 *    界面不换算单位；`histogram` 的顺序属于数据语义。
 * 3. **数值越界不算非法**：`ratio`、负 `count` 由组件自己夹取（见 StatsCard），
 *    在这里报错只会把可渲染的数据变成降级提示。
 * ============================================================ */

export interface ItemIssue {
  /** 出问题的字段路径，例如 `subjects.items[3].name`。 */
  path: string;
  /** 中文原因，可直接用于界面提示。 */
  reason: string;
}

/** 单条校验结果：通过 / 局部降级 / 丢弃。 */
export type ItemValidation =
  | { status: 'ok' }
  | { status: 'degraded'; kind: string; issues: ItemIssue[] }
  | { status: 'dropped'; kind: string; reason: string };

/** 问题累积器：一次列全同一条目的所有问题，便于定位。 */
interface IssueBag { issues: ItemIssue[] }

function add(bag: IssueBag, path: string, reason: string): void {
  bag.issues.push({ path, reason });
}

/* ---------------------------------------------------------------- 基础守卫 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkRecord(bag: IssueBag, value: unknown, path: string): Record<string, unknown> | null {
  if (!isRecord(value)) {
    add(bag, path, '需要一个对象');
    return null;
  }
  return value;
}

/** 字符串字段；`optional` 为真时允许字段缺失或为 undefined。 */
function checkText(bag: IssueBag, value: unknown, path: string, optional: boolean): void {
  if (value === undefined && optional) return;
  if (typeof value !== 'string') add(bag, path, '需要一个字符串');
}

/** 数字字段；只接受有限数，`NaN` / `Infinity` 一律算非法。 */
function checkNumber(bag: IssueBag, value: unknown, path: string, optional: boolean): void {
  if (value === undefined && optional) return;
  if (typeof value !== 'number' || !Number.isFinite(value)) add(bag, path, '需要一个数字');
}

function checkBoolean(bag: IssueBag, value: unknown, path: string, optional: boolean): void {
  if (value === undefined && optional) return;
  if (typeof value !== 'boolean') add(bag, path, '需要一个布尔值');
}

/** 枚举字段：提示里列出允许值，省得宿主猜。 */
function checkEnum(
  bag: IssueBag, value: unknown, allowed: readonly string[], path: string, optional: boolean,
): void {
  if (value === undefined && optional) return;
  if (typeof value !== 'string' || !allowed.includes(value)) {
    add(bag, path, `需要是 ${allowed.join(' / ')} 之一`);
  }
}

/**
 * 外部资源地址。
 *
 * 只接受绝对地址：界面不拼站内相对路径（component-library.html「url 必须能直接
 * 打开」）。图片同样走这里，因此相对路径的封面会被判为非法并降级——这是刻意的，
 * 否则生成的链接在会话里点不开。
 */
function checkUrl(bag: IssueBag, value: unknown, path: string, optional: boolean): void {
  if (value === undefined && optional) return;
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) {
    add(bag, path, '需要一个 http/https 绝对地址');
  }
}

function checkStringArray(bag: IssueBag, value: unknown, path: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    add(bag, path, '需要一个字符串数组');
    return;
  }
  value.forEach((entry, index) => {
    if (typeof entry !== 'string') add(bag, `${path}[${index}]`, '需要一个字符串');
  });
}

/** 数组字段；缺失或类型不符时返回 null，问题已记入 bag。 */
function checkArray(bag: IssueBag, value: unknown, path: string): unknown[] | null {
  if (!Array.isArray(value)) {
    add(bag, path, '需要一个数组');
    return null;
  }
  return value;
}

/** 遍历数组并对每个元素跑一遍校验；非对象元素只记一次问题。 */
function eachRecord(
  bag: IssueBag, list: unknown[], path: string,
  visit: (entry: Record<string, unknown>, at: string) => void,
): void {
  list.forEach((entry, index) => {
    const at = `${path}[${index}]`;
    const record = isRecord(entry) ? entry : null;
    if (record === null) {
      add(bag, at, '需要一个对象');
      return;
    }
    visit(record, at);
  });
}

const BASE_KINDS: ReadonlySet<string> = new Set<string>([
  'header', 'user', 'assistant', 'notice', 'error', 'activity', 'confirmation',
]);

function isBaseKind(value: string): value is BaseTranscriptKind {
  return BASE_KINDS.has(value);
}

/* ---------------------------------------------------------------- base 条目 */

/**
 * base 条目的形状。
 *
 * 它们不参与内容注册表（`Turn` 用自己的分支渲染），但调试面板可以粘贴它们，
 * 因此校验器一并覆盖，避免「面板能贴内容条目、贴 base 条目却报未知类型」。
 */
function validateBase(kind: BaseTranscriptKind, raw: Record<string, unknown>, bag: IssueBag): void {
  switch (kind) {
    case 'header':
    case 'user':
    case 'assistant':
    case 'notice':
    case 'error':
      checkText(bag, raw.text, 'text', false);
      return;
    case 'activity':
      checkText(bag, raw.label, 'label', false);
      checkEnum(bag, raw.state, ['running', 'ok', 'error'], 'state', false);
      // 协议里 detail 是必填字符串（可以为空串），缺失说明宿主映射漏了字段。
      checkText(bag, raw.detail, 'detail', false);
      return;
    case 'confirmation': {
      const confirmation = checkRecord(bag, raw.confirmation, 'confirmation');
      if (confirmation === null) return;
      checkText(bag, confirmation.id, 'confirmation.id', false);
      checkText(bag, confirmation.title, 'confirmation.title', false);
      checkText(bag, confirmation.preview, 'confirmation.preview', false);
      checkEnum(bag, confirmation.state, ['pending', 'accepted', 'rejected', 'expired'], 'confirmation.state', false);
      checkText(bag, confirmation.hint, 'confirmation.hint', false);
      return;
    }
  }
}

/* ---------------------------------------------------------------- 内容载荷 */

function validateSubjects(bag: IssueBag, payload: Record<string, unknown>, path: string): void {
  checkEnum(bag, payload.layout, ['grid', 'list'], `${path}.layout`, false);
  checkText(bag, payload.title, `${path}.title`, true);
  checkNumber(bag, payload.total, `${path}.total`, true);
  checkText(bag, payload.hint, `${path}.hint`, true);
  const items = checkArray(bag, payload.items, `${path}.items`);
  if (items === null) return;
  eachRecord(bag, items, `${path}.items`, (card, at) => {
    checkNumber(bag, card.id, `${at}.id`, false);
    checkText(bag, card.name, `${at}.name`, false);
    checkEnum(bag, card.kind, ['book', 'anime', 'music', 'game', 'real'], `${at}.kind`, false);
    checkText(bag, card.nameCn, `${at}.nameCn`, true);
    checkUrl(bag, card.image, `${at}.image`, true);
    checkNumber(bag, card.score, `${at}.score`, true);
    checkNumber(bag, card.scoreCount, `${at}.scoreCount`, true);
    checkNumber(bag, card.rank, `${at}.rank`, true);
    checkText(bag, card.date, `${at}.date`, true);
    checkText(bag, card.summary, `${at}.summary`, true);
    checkStringArray(bag, card.tags, `${at}.tags`);
    checkUrl(bag, card.url, `${at}.url`, true);
  });
}

function validateStats(bag: IssueBag, payload: Record<string, unknown>, path: string): void {
  checkEnum(bag, payload.mode, ['list', 'bars', 'histogram'], `${path}.mode`, false);
  checkText(bag, payload.title, `${path}.title`, true);
  checkText(bag, payload.note, `${path}.note`, true);
  if (payload.headline !== undefined) {
    const headline = checkRecord(bag, payload.headline, `${path}.headline`);
    if (headline !== null) {
      checkText(bag, headline.value, `${path}.headline.value`, false);
      checkText(bag, headline.label, `${path}.headline.label`, false);
    }
  }
  const entries = checkArray(bag, payload.entries, `${path}.entries`);
  if (entries === null) return;
  eachRecord(bag, entries, `${path}.entries`, (entry, at) => {
    checkText(bag, entry.label, `${at}.label`, false);
    // value 是宿主写好的字符串，界面不换算单位。
    checkText(bag, entry.value, `${at}.value`, false);
    checkNumber(bag, entry.ratio, `${at}.ratio`, true);
    checkText(bag, entry.hint, `${at}.hint`, true);
    checkEnum(bag, entry.tone, ['default', 'primary', 'muted'], `${at}.tone`, true);
  });
}

function validateProgress(bag: IssueBag, payload: Record<string, unknown>, path: string): void {
  // 无必填字段：数值进度、章节网格、note 都缺席时由组件显示空态。
  checkText(bag, payload.title, `${path}.title`, true);
  checkNumber(bag, payload.current, `${path}.current`, true);
  checkNumber(bag, payload.total, `${path}.total`, true);
  checkText(bag, payload.unit, `${path}.unit`, true);
  checkText(bag, payload.note, `${path}.note`, true);
  if (payload.episodes === undefined) return;
  const episodes = checkArray(bag, payload.episodes, `${path}.episodes`);
  if (episodes === null) return;
  eachRecord(bag, episodes, `${path}.episodes`, (episode, at) => {
    checkNumber(bag, episode.id, `${at}.id`, false);
    checkText(bag, episode.label, `${at}.label`, false);
    // state 缺省按未看处理，因此允许缺席；给了就必须是三者之一。
    checkEnum(bag, episode.state, ['done', 'current', 'todo'], `${at}.state`, true);
  });
}

function validateInfoBox(bag: IssueBag, payload: Record<string, unknown>, path: string): void {
  checkText(bag, payload.title, `${path}.title`, true);
  const rows = checkArray(bag, payload.rows, `${path}.rows`);
  if (rows === null) return;
  eachRecord(bag, rows, `${path}.rows`, (row, at) => {
    checkText(bag, row.label, `${at}.label`, false);
    checkText(bag, row.value, `${at}.value`, false);
    checkEnum(bag, row.tone, ['default', 'muted'], `${at}.tone`, true);
  });
}

function validateTable(bag: IssueBag, payload: Record<string, unknown>, path: string): void {
  checkText(bag, payload.title, `${path}.title`, true);
  checkText(bag, payload.note, `${path}.note`, true);
  const columns = checkArray(bag, payload.columns, `${path}.columns`);
  const keys: string[] = [];
  if (columns !== null) {
    eachRecord(bag, columns, `${path}.columns`, (column, at) => {
      checkText(bag, column.key, `${at}.key`, false);
      checkText(bag, column.label, `${at}.label`, false);
      checkEnum(bag, column.align, ['left', 'right'], `${at}.align`, true);
      if (typeof column.key === 'string') keys.push(column.key);
    });
  }
  const rows = checkArray(bag, payload.rows, `${path}.rows`);
  if (rows === null) return;
  // 行里的键必须与某个 column.key 同名；多余的键只是被忽略，不算非法。
  eachRecord(bag, rows, `${path}.rows`, (row, at) => {
    for (const key of keys) {
      const cell = row[key];
      if (cell !== undefined && typeof cell !== 'string') add(bag, `${at}.${key}`, '需要一个字符串');
    }
  });
}

function validateTimeline(bag: IssueBag, payload: Record<string, unknown>, path: string): void {
  checkText(bag, payload.title, `${path}.title`, true);
  const entries = checkArray(bag, payload.entries, `${path}.entries`);
  if (entries === null) return;
  eachRecord(bag, entries, `${path}.entries`, (entry, at) => {
    checkText(bag, entry.time, `${at}.time`, false);
    checkText(bag, entry.text, `${at}.text`, false);
    checkText(bag, entry.actor, `${at}.actor`, true);
  });
}

function validateTags(bag: IssueBag, payload: Record<string, unknown>, path: string): void {
  const tags = checkArray(bag, payload.tags, `${path}.tags`);
  if (tags === null) return;
  eachRecord(bag, tags, `${path}.tags`, (tag, at) => {
    checkText(bag, tag.name, `${at}.name`, false);
    checkNumber(bag, tag.count, `${at}.count`, true);
    checkBoolean(bag, tag.selected, `${at}.selected`, true);
  });
}

function validateGallery(bag: IssueBag, payload: Record<string, unknown>, path: string): void {
  checkText(bag, payload.title, `${path}.title`, true);
  const items = checkArray(bag, payload.items, `${path}.items`);
  if (items === null) return;
  eachRecord(bag, items, `${path}.items`, (item, at) => {
    checkNumber(bag, item.id, `${at}.id`, false);
    checkText(bag, item.name, `${at}.name`, false);
    checkUrl(bag, item.image, `${at}.image`, true);
    checkText(bag, item.subtitle, `${at}.subtitle`, true);
    checkUrl(bag, item.url, `${at}.url`, true);
  });
}

function validateCompare(bag: IssueBag, payload: Record<string, unknown>, path: string): void {
  checkText(bag, payload.title, `${path}.title`, true);
  checkText(bag, payload.note, `${path}.note`, true);
  const rows = checkArray(bag, payload.rows, `${path}.rows`);
  if (rows === null) return;
  eachRecord(bag, rows, `${path}.rows`, (row, at) => {
    checkText(bag, row.label, `${at}.label`, false);
    checkText(bag, row.before, `${at}.before`, false);
    checkText(bag, row.after, `${at}.after`, false);
    checkBoolean(bag, row.changed, `${at}.changed`, false);
  });
}

function validateQuote(bag: IssueBag, payload: Record<string, unknown>, path: string): void {
  checkText(bag, payload.text, `${path}.text`, false);
  checkBoolean(bag, payload.mono, `${path}.mono`, false);
  checkText(bag, payload.title, `${path}.title`, true);
}

function validateCallout(bag: IssueBag, payload: Record<string, unknown>, path: string): void {
  checkEnum(bag, payload.tone, ['progress', 'success', 'warning', 'error'], `${path}.tone`, false);
  checkText(bag, payload.text, `${path}.text`, false);
  checkText(bag, payload.detail, `${path}.detail`, true);
}

function validateLinks(bag: IssueBag, payload: Record<string, unknown>, path: string): void {
  checkText(bag, payload.title, `${path}.title`, true);
  const links = checkArray(bag, payload.links, `${path}.links`);
  if (links === null) return;
  eachRecord(bag, links, `${path}.links`, (link, at) => {
    checkText(bag, link.label, `${at}.label`, false);
    checkUrl(bag, link.url, `${at}.url`, false);
    checkText(bag, link.hint, `${at}.hint`, true);
  });
}

const CONTENT_VALIDATORS: { [K in ContentKind]: (bag: IssueBag, payload: Record<string, unknown>, path: string) => void } = {
  subjects: validateSubjects,
  stats: validateStats,
  progress: validateProgress,
  infobox: validateInfoBox,
  table: validateTable,
  timeline: validateTimeline,
  tags: validateTags,
  gallery: validateGallery,
  compare: validateCompare,
  quote: validateQuote,
  callout: validateCallout,
  links: validateLinks,
};

/* ---------------------------------------------------------------- 对外接口 */

/**
 * 校验单条条目。
 *
 * 三种结果对应三种处理方式：
 * - `ok`：正常渲染；
 * - `degraded`：`kind` 已知但载荷非法 → 局部降级为提示 + 原始数据；
 * - `dropped`：`kind` 未知 → 整条丢弃（与 Adaptive Cards 的
 *   「未知 element type MUST BE DROPPED」一致）。
 */
export function validateTranscriptItem(raw: unknown): ItemValidation {
  if (!isRecord(raw)) return { status: 'degraded', kind: '未知', issues: [{ path: '', reason: '数组项必须是一个对象' }] };

  const kind = raw.kind;
  if (typeof kind !== 'string' || kind === '') {
    return { status: 'degraded', kind: '未知', issues: [{ path: 'kind', reason: '缺少 kind 字段' }] };
  }

  const bag: IssueBag = { issues: [] };
  if (isContentKind(kind)) {
    const field = CONTENT_RENDERERS[kind].field;
    const payload = checkRecord(bag, raw[field], field);
    if (payload !== null) CONTENT_VALIDATORS[kind](bag, payload, field);
  } else if (isBaseKind(kind)) {
    validateBase(kind, raw, bag);
  } else {
    return { status: 'dropped', kind, reason: `未知的内容类型「${kind}」` };
  }

  return bag.issues.length === 0 ? { status: 'ok' } : { status: 'degraded', kind, issues: bag.issues };
}


