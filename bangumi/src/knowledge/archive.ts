import { createReadStream, existsSync, mkdirSync, openSync, closeSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { createInflateRaw, crc32 } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { AppError } from '../support/errors.js';
import { ARCHIVE_FILES, createSchema, finishIndexes, normalizeSearch, SCHEMA_VERSION, INDEX_VERSION, tokenizeSearch, type ArchiveFile, type EntityKind } from './schema.js';
import { parseWiki, WIKI_PARSER_VERSION } from './wiki.js';
import { DICTIONARY_VERSION } from './dictionaries.js';
import { activateSnapshot, atomicWriteJson, markStaging, pruneSnapshots, readManifest, recordBuildFailure, removeStaging, snapshotPath, withUpdateLock, type SnapshotManifest } from './store.js';

export interface ImportProgress { stage: string; file?: string; records?: number }
export interface ImportOptions {
  root: string; source: string; snapshotId?: string; expectedSha256?: string; activate?: boolean;
  sourceUrl?: string; exportedAt?: string; onProgress?: (progress: ImportProgress) => void;
}
interface ZipEntry { name: string; compressed: number; raw: number; method: number; offset: number; crc: number }

export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function zipEntries(path: string): Map<string, ZipEntry> {
  const size = statSync(path).size, fd = openSync(path, 'r');
  try {
    const tail = Buffer.alloc(Math.min(size, 65557));
    readSync(fd, tail, 0, tail.length, size - tail.length);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { end = i; break; }
    if (end < 0 || tail.readUInt16LE(end + 4) !== 0 || tail.readUInt16LE(end + 6) !== 0) throw new AppError('KNOWLEDGE_INVALID_ARCHIVE', 'Archive ZIP 目录无效或采用了多卷压缩。');
    const count = tail.readUInt16LE(end + 10), length = tail.readUInt32LE(end + 12), offset = tail.readUInt32LE(end + 16);
    if (count === 65535 || length === 0xffffffff || offset === 0xffffffff) throw new AppError('KNOWLEDGE_INVALID_ARCHIVE', '当前导入器暂不支持 ZIP64，请先解压后使用目录导入。');
    if (length > 16 * 1024 * 1024 || offset + length > size) throw new AppError('KNOWLEDGE_INVALID_ARCHIVE', 'Archive ZIP 目录大小异常。');
    const directory = Buffer.alloc(length); readSync(fd, directory, 0, length, offset);
    const result = new Map<string, ZipEntry>();
    for (let pos = 0, i = 0; i < count; i++) {
      if (pos + 46 > directory.length || directory.readUInt32LE(pos) !== 0x02014b50) throw new AppError('KNOWLEDGE_INVALID_ARCHIVE', 'Archive ZIP 目录记录不完整。');
      const nameLength = directory.readUInt16LE(pos + 28), extraLength = directory.readUInt16LE(pos + 30), commentLength = directory.readUInt16LE(pos + 32);
      const name = directory.subarray(pos + 46, pos + 46 + nameLength).toString('utf8');
      const method = directory.readUInt16LE(pos + 10), flags = directory.readUInt16LE(pos + 8);
      if ((flags & 1) || ![0, 8].includes(method)) throw new AppError('KNOWLEDGE_INVALID_ARCHIVE', 'Archive ZIP 含加密或不支持的压缩方法。');
      if (result.has(name)) throw new AppError('KNOWLEDGE_INVALID_ARCHIVE', 'Archive ZIP 含重复文件名。');
      result.set(name, { name, method, compressed: directory.readUInt32LE(pos + 20), raw: directory.readUInt32LE(pos + 24), offset: directory.readUInt32LE(pos + 42), crc: directory.readUInt32LE(pos + 16) });
      pos += 46 + nameLength + extraLength + commentLength;
    }
    return result;
  } finally { closeSync(fd); }
}

function zipStream(path: string, entry: ZipEntry): Readable {
  const fd = openSync(path, 'r'), local = Buffer.alloc(30);
  try { readSync(fd, local, 0, 30, entry.offset); } finally { closeSync(fd); }
  if (local.readUInt32LE(0) !== 0x04034b50) throw new AppError('KNOWLEDGE_INVALID_ARCHIVE', 'Archive ZIP 文件头无效。');
  const start = entry.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
  if (start + entry.compressed > statSync(path).size) throw new AppError('KNOWLEDGE_INVALID_ARCHIVE', 'Archive ZIP 文件内容不完整。');
  async function* contents(): AsyncGenerator<Buffer> {
    const source = entry.compressed ? createReadStream(path, { start, end: start + entry.compressed - 1 }) : Readable.from([]);
    const decoded = entry.method === 8 ? source.pipe(createInflateRaw()) : source;
    source.on('error', (error: Error) => decoded.destroy(error));
    let bytes = 0, crc = 0;
    try { for await (const chunk of decoded) { const data = chunk as Buffer; bytes += data.length; crc = crc32(data, crc); yield data; } }
    finally { source.destroy(); decoded.destroy(); }
    if (bytes !== entry.raw || crc !== entry.crc) throw new AppError('KNOWLEDGE_ARCHIVE_CHECKSUM', `Archive 文件 ${entry.name} 的长度或 CRC 校验失败。`);
  }
  return Readable.from(contents());
}

function number(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function integer(value: unknown): number | null { const n = number(value); return n !== null && Number.isSafeInteger(n) ? n : null; }
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
function dateValue(value: unknown): { date: string | null; year: number | null; invalid: boolean } {
  const input = text(value).trim();
  if (!input) return { date: null, year: null, invalid: false };
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(input);
  if (!match) return { date: null, year: null, invalid: true };
  const year = Number(match[1]), month = match[2] ? Number(match[2]) : null, day = match[3] ? Number(match[3]) : null;
  if (year < 1 || (month !== null && (month < 1 || month > 12)) || (day !== null && (day < 1 || day > new Date(Date.UTC(year, month!, 0)).getUTCDate()))) return { date: null, year: null, invalid: true };
  return { date: input, year, invalid: false };
}

export async function importArchive(options: ImportOptions): Promise<SnapshotManifest> {
  return withUpdateLock(options.root, () => buildArchiveSnapshot(options));
}

/** 仅供已持有更新锁的 updater 调用；普通调用方使用 importArchive。 */
export async function buildArchiveSnapshot(options: ImportOptions): Promise<SnapshotManifest> {
  const { root, source, onProgress } = options;
  const started = performance.now();
  const timings = { totalMs: 0, sourceHashMs: 0, files: {} as Record<string, number>, indexMs: 0, verifyMs: 0, integrityMs: 0 };
  const isDirectory = statSync(source).isDirectory();
  onProgress?.({ stage: 'hashing' });
  let digest: string, sourceSize: number;
  let entries: Map<string, ZipEntry> | null = null;
  if (isDirectory) {
    const hash = createHash('sha256'); sourceSize = 0;
    for (const file of ARCHIVE_FILES) { const path = join(source, `${file}.jsonlines`); if (!existsSync(path)) throw new AppError('KNOWLEDGE_ARCHIVE_INCOMPLETE', `缺少 ${file}.jsonlines。`);
      sourceSize += statSync(path).size; hash.update(`${file}\0${await hashFile(path)}\n`); }
    digest = hash.digest('hex');
  } else { sourceSize = statSync(source).size; digest = await hashFile(source); entries = zipEntries(source); }
  if (options.expectedSha256 && digest !== options.expectedSha256.replace(/^sha256:/, '').toLowerCase()) throw new AppError('KNOWLEDGE_ARCHIVE_CHECKSUM', 'Archive SHA-256 与预期摘要不一致，当前数据库未改变。');
  timings.sourceHashMs = performance.now() - started;
  const id = options.snapshotId ?? `${basename(source).replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 100) || 'archive'}-${digest.slice(0, 12)}-s${SCHEMA_VERSION}-i${INDEX_VERSION}`;
  const target = snapshotPath(root, id);
  if (existsSync(join(target, 'manifest.json'))) {
    const existing = readManifest(root, id);
    if (existing.source.sha256 !== digest) throw new AppError('KNOWLEDGE_SNAPSHOT_CONFLICT', '相同快照标识已经对应不同数据。');
    if (options.activate !== false) activateSnapshot(root, id);
    return existing;
  }
  if (existsSync(target)) throw new AppError('KNOWLEDGE_SNAPSHOT_CONFLICT', '快照目标目录已经存在但不完整，请使用其他标识。');
  const building = snapshotPath(root, `build-${id}-${Date.now()}`);
  mkdirSync(building, { recursive: true });
  markStaging(root, building, source);
  try {
  const databasePath = join(building, 'catalog.sqlite');
  const db = new DatabaseSync(databasePath);
  const counts: Record<string, number> = {};
  const quality = { infoboxParseFailures: 0, danglingRelations: 0, invalidDates: 0, duplicateAliases: 0, invalidRelations: 0 };
  let transaction = false;
  try {
    createSchema(db);
    const insert = db.prepare('INSERT INTO entities VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const aliasInsert = db.prepare('INSERT OR IGNORE INTO aliases VALUES(?,?,?,?)');
    const tagInsert = db.prepare('INSERT OR IGNORE INTO tags VALUES(?,?,?,?,?)');
    const ftsInsert = db.prepare('INSERT INTO entity_fts(kind,entity_id,name,aliases,summary) VALUES(?,?,?,?,?)');
    const scoreInsert = db.prepare('INSERT INTO subject_scores VALUES(?,?,?)');
    const relationInsert = db.prepare('INSERT INTO relations(source_kind,source_id,target_kind,target_id,subject_id,relation_type,order_index,raw_json) VALUES(?,?,?,?,?,?,?,?)');
    const issueInsert = db.prepare('INSERT INTO import_issues VALUES(?,?,?,?)');
    let currentFile = '', currentLine = 0;
    const putRelation = (from: EntityKind, fromId: unknown, to: EntityKind, toId: unknown, subject: unknown, type: unknown, order: unknown, raw: string) => {
      if (integer(fromId) === null || Number(fromId) <= 0 || integer(toId) === null || Number(toId) <= 0) {
        quality.invalidRelations++; issueInsert.run(currentFile, currentLine, 'invalid_relation_endpoint', raw); return;
      }
      relationInsert.run(from, Number(fromId), to, Number(toId), integer(subject), integer(type) ?? 0, number(order), raw);
    };
    for (const file of ARCHIVE_FILES) {
      const fileStarted = performance.now(); currentFile = file;
      const name = `${file}.jsonlines`, entry = entries?.get(name);
      if (entries && !entry) throw new AppError('KNOWLEDGE_ARCHIVE_INCOMPLETE', `Archive ZIP 缺少 ${name}。`);
      const stream = isDirectory ? createReadStream(join(source, name)) : zipStream(source, entry!);
      const lines = createInterface({ input: stream, crlfDelay: Infinity });
      counts[file] = 0; db.exec('BEGIN'); transaction = true;
      for await (const line of lines) {
        if (!line.trim()) continue;
        currentLine = counts[file]! + 1;
        let row: Record<string, unknown>;
        try { const parsed = JSON.parse(line) as unknown; if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); row = parsed as Record<string, unknown>; }
        catch { throw new AppError('KNOWLEDGE_INVALID_RECORD', `Archive ${name} 第 ${counts[file]! + 1} 条 JSON 记录无效。`); }
        if (['subject', 'person', 'character', 'episode'].includes(file)) {
          const kind = file as EntityKind, id = integer(row.id);
          if (id === null || id <= 0) throw new AppError('KNOWLEDGE_INVALID_RECORD', `Archive ${name} 含无效 ID。`);
          const wiki = parseWiki(row.infobox), title = text(row.name), nameCn = text(row.name_cn) || wiki.nameCn;
          const summary = text(kind === 'episode' ? row.description : row.summary);
          const date = dateValue(kind === 'episode' ? row.airdate : row.date);
          if (date.invalid) quality.invalidDates++;
          if (wiki.status === 'failed') quality.infoboxParseFailures++;
          const details = row.score_details && typeof row.score_details === 'object' ? row.score_details as Record<string, unknown> : null;
          const votes = details ? Object.values(details).reduce<number>((sum, value) => sum + (integer(value) ?? 0), 0) : null;
          insert.run(kind, id, kind === 'subject' ? integer(row.type) : null, kind === 'character' ? integer(row.role) : integer(row.type), title, nameCn, summary,
            date.date, date.year, integer(row.platform), votes === 0 ? null : number(row.score), (integer(row.rank) ?? 0) > 0 ? integer(row.rank) : null, votes, row.nsfw === true ? 1 : 0,
            integer(row.subject_id), number(row.sort), line, JSON.stringify(wiki.fields), wiki.status);
          const aliases = [...new Set([title, nameCn, ...wiki.aliases].map(value => value.trim()).filter(Boolean))];
          for (const alias of aliases) if (Number(aliasInsert.run(kind, id, alias, normalizeSearch(alias)).changes) === 0) quality.duplicateAliases++;
          for (const tag of Array.isArray(row.tags) ? row.tags : []) {
            if (tag && typeof tag === 'object' && typeof (tag as Record<string, unknown>).name === 'string') {
              const value = tag as Record<string, unknown>; tagInsert.run(kind, id, text(value.name), integer(value.count), 'user');
            }
          }
          for (const tag of Array.isArray(row.meta_tags) ? row.meta_tags : []) if (typeof tag === 'string') tagInsert.run(kind, id, tag, null, 'meta');
          if (details) for (let value = 1; value <= 10; value++) scoreInsert.run(id, value, integer(details[String(value)]) ?? 0);
          ftsInsert.run(kind, id, tokenizeSearch(`${title} ${nameCn}`), tokenizeSearch(aliases.join(' ')), tokenizeSearch(summary));
          if (kind === 'episode' && integer(row.subject_id)) putRelation('subject', row.subject_id, 'episode', id, row.subject_id, row.type, row.sort, line);
        } else {
          if (file === 'subject-relations') putRelation('subject', row.subject_id, 'subject', row.related_subject_id, row.subject_id, row.relation_type, row.order, line);
          else if (file === 'subject-persons') putRelation('subject', row.subject_id, 'person', row.person_id, row.subject_id, row.position, null, line);
          else if (file === 'subject-characters') putRelation('subject', row.subject_id, 'character', row.character_id, row.subject_id, row.type, row.order, line);
          else if (file === 'person-characters') putRelation('person', row.person_id, 'character', row.character_id, row.subject_id, row.type, null, line);
          else { const kind: EntityKind = row.person_type === 'crt' ? 'character' : 'person';
            if (!['prsn', 'crt'].includes(text(row.person_type))) { quality.invalidRelations++; issueInsert.run(file, currentLine, 'unknown_relation_entity_kind', line); }
            else putRelation(kind, row.person_id, kind, row.related_person_id, null, row.relation_type, null, line); }
        }
        counts[file] = counts[file]! + 1;
        if (counts[file]! % 10000 === 0) { db.exec('COMMIT; BEGIN'); onProgress?.({ stage: 'importing', file, records: counts[file]! }); }
      }
      db.exec('COMMIT'); transaction = false;
      db.prepare('INSERT INTO metadata VALUES(?,?)').run(`completedFile:${file}`, String(counts[file]));
      timings.files[file] = performance.now() - fileStarted;
      onProgress?.({ stage: 'imported', file, records: counts[file]! });
    }
    onProgress?.({ stage: 'indexing' }); const indexStarted = performance.now(); finishIndexes(db);
    quality.danglingRelations = Number(db.prepare(`SELECT count(*) AS n FROM relations r
      WHERE NOT EXISTS(SELECT 1 FROM entities e WHERE e.kind=r.source_kind AND e.id=r.source_id)
        OR NOT EXISTS(SELECT 1 FROM entities e WHERE e.kind=r.target_kind AND e.id=r.target_id)
        OR (r.subject_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM entities e WHERE e.kind='subject' AND e.id=r.subject_id))`).get()?.n ?? 0);
    timings.indexMs = performance.now() - indexStarted;
    const integrityStarted = performance.now(), check = db.prepare('PRAGMA quick_check').get();
    timings.integrityMs = performance.now() - integrityStarted;
    if (check?.quick_check !== 'ok') throw new AppError('KNOWLEDGE_DATABASE_CORRUPT', '新数据库完整性检查失败，当前数据库未改变。');
    const setMeta = db.prepare('INSERT INTO metadata VALUES(?,?)');
    setMeta.run('snapshotId', id); setMeta.run('sourceSha256', digest); setMeta.run('schemaVersion', String(SCHEMA_VERSION));
    setMeta.run('normalizationVersion', '1');
    setMeta.run('indexVersion', String(INDEX_VERSION));
  } catch (error) {
    if (transaction) try { db.exec('ROLLBACK'); } catch { /* 保留初始错误。 */ }
    throw error;
  } finally { db.close(); }
  onProgress?.({ stage: 'verifying' }); const verifyStarted = performance.now();
  const databaseHash = await hashFile(databasePath);
  timings.verifyMs = performance.now() - verifyStarted; timings.totalMs = performance.now() - started;
  const sourceDate = /dump-(\d{4}-\d{2}-\d{2})\.(\d{2})(\d{2})(\d{2})Z/.exec(basename(source));
  const manifest: SnapshotManifest = { schemaVersion: SCHEMA_VERSION, snapshotId: id, builtAt: new Date().toISOString(), parserVersion: WIKI_PARSER_VERSION, dictionaryVersion: DICTIONARY_VERSION, normalizationVersion: 1, indexVersion: INDEX_VERSION,
    source: { kind: isDirectory ? 'directory' : 'zip', name: basename(source), url: options.sourceUrl ?? null, sha256: digest, size: sourceSize, exportedAt: options.exportedAt ?? (sourceDate ? `${sourceDate[1]}T${sourceDate[2]}:${sourceDate[3]}:${sourceDate[4]}Z` : null) },
    counts, quality, timings, database: { file: 'catalog.sqlite', bytes: statSync(databasePath).size, sha256: databaseHash },
    capabilities: { vector: false, fullText: true, account: false, images: false, tagsComplete: false } };
  atomicWriteJson(join(building, 'manifest.json'), manifest);
  mkdirSync(join(root, 'snapshots'), { recursive: true }); renameSync(building, target);
  if (options.activate !== false) { activateSnapshot(root, id); pruneSnapshots(root); }
  onProgress?.({ stage: 'complete' }); return manifest;
  } catch (error) {
    // 内层finally先关闭SQLite。小型诊断独立保留，不让失败建库每次占用数GB。
    if (existsSync(building)) {
      try { recordBuildFailure(root, building, error instanceof AppError ? error.code : 'KNOWLEDGE_IMPORT_FAILED', error instanceof Error ? error.message : '本地数据构建失败。'); removeStaging(root, building, source); }
      catch { /* 原始错误优先；若文件仍被外部占用，status会继续列出staging。 */ }
    }
    throw error;
  }
}
