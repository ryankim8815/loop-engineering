import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDatabase } from '../src/db.ts';

describe('openDatabase', () => {
  it('creates the todos table in an in-memory database', () => {
    const db = openDatabase(':memory:');
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'todos'")
      .all();
    expect(tables).toHaveLength(1);
    db.close();
  });

  it('creates a missing parent directory for a file path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'todo-db-'));
    try {
      const path = join(dir, 'nested', 'deeper', 'todos.db');
      const db = openDatabase(path);
      expect(existsSync(dirname(path))).toBe(true);
      expect(existsSync(path)).toBe(true);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps existing rows when the same file is opened again', () => {
    const dir = mkdtempSync(join(tmpdir(), 'todo-db-'));
    try {
      const path = join(dir, 'todos.db');
      const first = openDatabase(path);
      first.exec(
        "INSERT INTO todos (id, title, completed, created_at, updated_at) VALUES ('a', 't', 0, 'x', 'x')",
      );
      first.close();

      const second = openDatabase(path);
      const rows = second.prepare('SELECT id FROM todos').all();
      expect(rows).toHaveLength(1);
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('buildApp database wiring', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('exposes a repository on the app that works against the configured database', () => {
    app = buildApp({ dbPath: ':memory:' });
    const created = app.todos.create('우유 사기');
    expect(app.todos.get(created.id)?.title).toBe('우유 사기');
  });

  it('closes the database when the app closes', async () => {
    app = buildApp({ dbPath: ':memory:' });
    const repo = app.todos;
    await app.close();
    app = undefined;
    expect(() => repo.list()).toThrow();
  });
});

describe('buildApp database path', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'todo-app-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates the database file at the given dbPath', async () => {
    const path = join(dir, 'data', 'todos.db');
    const app = buildApp({ dbPath: path });
    await app.close();
    expect(existsSync(path)).toBe(true);
  });
});
