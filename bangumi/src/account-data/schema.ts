import type { DatabaseSync } from 'node:sqlite';

export const ACCOUNT_SCHEMA_VERSION = 1;
export function createAccountSchema(db: DatabaseSync): void {
  db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA user_version=${ACCOUNT_SCHEMA_VERSION};
    CREATE TABLE collections (
      subject_id INTEGER PRIMARY KEY, interest_id INTEGER NOT NULL, subject_type INTEGER NOT NULL,
      collection_type INTEGER NOT NULL, personal_rating INTEGER NOT NULL, comment TEXT NOT NULL,
      is_private INTEGER NOT NULL, ep_status INTEGER NOT NULL, vol_status INTEGER NOT NULL,
      source_updated_at INTEGER NOT NULL, observed_at INTEGER NOT NULL, content_hash TEXT NOT NULL,
      record_state TEXT NOT NULL DEFAULT 'visible' CHECK(record_state IN ('visible','missing'))
    );
    CREATE TABLE collection_tags(subject_id INTEGER NOT NULL,tag TEXT NOT NULL,position INTEGER NOT NULL,PRIMARY KEY(subject_id,tag));
    CREATE TABLE subject_hints(subject_id INTEGER PRIMARY KEY,name TEXT NOT NULL,name_cn TEXT NOT NULL,
      subject_type INTEGER NOT NULL,nsfw INTEGER NOT NULL,image_url TEXT,observed_at INTEGER NOT NULL);
    CREATE INDEX collection_status ON collections(record_state,subject_type,collection_type,subject_id);
    CREATE INDEX collection_rating ON collections(collection_type,personal_rating,subject_id);
    CREATE INDEX collection_updated ON collections(source_updated_at,subject_id);
    CREATE INDEX personal_tag_lookup ON collection_tags(tag,subject_id);`);
}
