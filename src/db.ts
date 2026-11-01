import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const MEMORY_DB = ':memory:';

// Single source of truth for the schema. CREATE IF NOT EXISTS makes opening an
// existing file a no-op, so restarting the server never drops data.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

// Opens (or creates) the SQLite file and ensures the schema exists. The parent
// directory is created for file paths so a fresh checkout can start with the
// default DB_PATH without manual setup. ':memory:' skips the filesystem.
export function openDatabase(path: string): DatabaseSync {
  if (path !== MEMORY_DB) {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}
