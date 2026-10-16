import type { DatabaseSync } from 'node:sqlite';

export const SCHEMA_VERSION = 1;
export const INDEX_VERSION = 2;
export const ENTITY_KINDS = ['subject', 'person', 'character', 'episode'] as const;
export type EntityKind = typeof ENTITY_KINDS[number];
export const ARCHIVE_FILES = ['subject', 'person', 'character', 'episode', 'subject-relations', 'subject-persons', 'subject-characters', 'person-characters', 'person-relations'] as const;
export type ArchiveFile = typeof ARCHIVE_FILES[number];

export function createSchema(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode=DELETE;
    PRAGMA synchronous=NORMAL;
    PRAGMA temp_store=MEMORY;
    PRAGMA cache_size=-65536;
    CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
    CREATE TABLE entities(
      kind TEXT NOT NULL, id INTEGER NOT NULL, subject_type INTEGER, entity_type INTEGER,
      name TEXT NOT NULL, name_cn TEXT NOT NULL, summary TEXT NOT NULL, date TEXT, year INTEGER,
      platform INTEGER, score REAL, rank INTEGER, rating_total INTEGER, nsfw INTEGER NOT NULL,
      subject_id INTEGER, sort REAL, raw_json TEXT NOT NULL, infobox_json TEXT NOT NULL,
      infobox_status TEXT NOT NULL, PRIMARY KEY(kind,id)
    ) STRICT;
    CREATE TABLE aliases(kind TEXT NOT NULL,entity_id INTEGER NOT NULL,alias TEXT NOT NULL,normalized TEXT NOT NULL,
      PRIMARY KEY(kind,entity_id,normalized)) WITHOUT ROWID;
    CREATE TABLE tags(kind TEXT NOT NULL,entity_id INTEGER NOT NULL,name TEXT NOT NULL,count INTEGER,source TEXT NOT NULL,
      PRIMARY KEY(kind,entity_id,name,source)) WITHOUT ROWID;
    CREATE TABLE relations(id INTEGER PRIMARY KEY,source_kind TEXT NOT NULL,source_id INTEGER NOT NULL,
      target_kind TEXT NOT NULL,target_id INTEGER NOT NULL,subject_id INTEGER,relation_type INTEGER NOT NULL,
      order_index REAL,raw_json TEXT NOT NULL) STRICT;
    CREATE TABLE subject_scores(subject_id INTEGER NOT NULL,score INTEGER NOT NULL,count INTEGER NOT NULL,
      PRIMARY KEY(subject_id,score)) WITHOUT ROWID;
    CREATE TABLE import_issues(file TEXT NOT NULL,line_number INTEGER NOT NULL,reason TEXT NOT NULL,raw_json TEXT NOT NULL) STRICT;
    CREATE VIRTUAL TABLE entity_fts USING fts5(kind UNINDEXED,entity_id UNINDEXED,name,aliases,summary,
      tokenize='unicode61 remove_diacritics 2');
    PRAGMA user_version=${SCHEMA_VERSION};
  `);
}

export function finishIndexes(db: DatabaseSync): void {
  db.exec(`
    CREATE INDEX entity_filter ON entities(kind,subject_type,nsfw,date,id);
    CREATE INDEX entity_score ON entities(kind,subject_type,nsfw,score DESC,id);
    CREATE INDEX entity_rank ON entities(kind,subject_type,nsfw,rank,id);
    CREATE INDEX entity_parent ON entities(kind,subject_id,sort,id);
    CREATE INDEX entity_year ON entities(kind,subject_type,nsfw,year,id);
    CREATE INDEX entity_aggregate ON entities(kind,nsfw,subject_type,platform,year,score,rating_total) WHERE kind='subject';
    CREATE INDEX alias_search ON aliases(normalized,kind,entity_id);
    CREATE INDEX tags_search ON tags(name,source,kind,entity_id);
    CREATE INDEX relations_source ON relations(source_kind,source_id,target_kind,relation_type,subject_id);
    CREATE INDEX relations_target ON relations(target_kind,target_id,source_kind,relation_type,subject_id);
    CREATE INDEX relations_subject ON relations(subject_id,source_kind,target_kind,relation_type);
    INSERT INTO entity_fts(entity_fts) VALUES('optimize');
    ANALYZE;
  `);
}

/** 别名等值检索和全文预分词必须使用同一套规范化，避免全半角名称断开。 */
export function normalizeSearch(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase('und').replace(/\s+/gu, ' ').trim();
}

/** CJK 单字形成位置连续的 token，FTS phrase 因而也支持两字和单字标题。 */
export function tokenizeSearch(text: string): string {
  const split = normalizeSearch(text).replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, ' $& ');
  return (split.match(/[\p{L}\p{N}]+/gu) ?? []).join(' ');
}

export function buildFtsQuery(text: string): string {
  const words = tokenizeSearch(text);
  return words ? `"${words}"` : '';
}
