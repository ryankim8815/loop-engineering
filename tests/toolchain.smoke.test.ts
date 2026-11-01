// Verifies the development environment itself (not the app).
// Ralph relies on these guarantees; keep this file.
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

describe('toolchain', () => {
  it('runs on Node.js 24 or newer', () => {
    const major = Number(process.versions.node.split('.')[0]);
    expect(major).toBeGreaterThanOrEqual(24);
  });

  it('has the built-in node:sqlite module', () => {
    const db = new DatabaseSync(':memory:');
    expect(db.prepare('select 1 as x').get()).toEqual({ x: 1 });
    db.close();
  });

  it('uses an in-memory database during tests', () => {
    expect(process.env.DB_PATH).toBe(':memory:');
  });
});
