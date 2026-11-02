import { describe, expect, it, vi } from 'vitest';
import { resolveDbPath } from '../src/app.ts';

// Spec 01 persistence: DB_PATH selects the SQLite file, and the default is ./data/todos.db.
// `new DatabaseSync('')` opens a temporary database that is deleted on close(), so an empty
// DB_PATH (for example `DB_PATH=` in a .env file) used to silently drop all data on restart
// (R6). An empty or whitespace-only value is therefore treated as unset.
describe('resolveDbPath (R6)', () => {
  it('uses the default file when neither dbPath nor DB_PATH is set', () => {
    vi.stubEnv('DB_PATH', undefined);
    expect(resolveDbPath(undefined)).toBe('data/todos.db');
    vi.unstubAllEnvs();
  });

  it('R6: an empty DB_PATH falls back to the default file instead of a temporary database', () => {
    vi.stubEnv('DB_PATH', '');
    expect(resolveDbPath(undefined)).toBe('data/todos.db');
    vi.unstubAllEnvs();
  });

  it('R6: a whitespace-only DB_PATH falls back to the default file', () => {
    vi.stubEnv('DB_PATH', '   ');
    expect(resolveDbPath(undefined)).toBe('data/todos.db');
    vi.unstubAllEnvs();
  });

  it('R6: an empty explicit dbPath falls back to DB_PATH, then to the default', () => {
    vi.stubEnv('DB_PATH', '/var/lib/todo/todos.db');
    expect(resolveDbPath('')).toBe('/var/lib/todo/todos.db');
    vi.stubEnv('DB_PATH', '');
    expect(resolveDbPath('  ')).toBe('data/todos.db');
    vi.unstubAllEnvs();
  });

  it('an explicit dbPath wins over DB_PATH, and ":memory:" is passed through unchanged', () => {
    vi.stubEnv('DB_PATH', '/var/lib/todo/todos.db');
    expect(resolveDbPath(':memory:')).toBe(':memory:');
    expect(resolveDbPath('/tmp/other.db')).toBe('/tmp/other.db');
    vi.unstubAllEnvs();
  });

  it('a non-empty DB_PATH is used as given', () => {
    vi.stubEnv('DB_PATH', '/var/lib/todo/todos.db');
    expect(resolveDbPath(undefined)).toBe('/var/lib/todo/todos.db');
    vi.unstubAllEnvs();
  });
});
