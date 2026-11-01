import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';

// AC-API-8: a todo saved through one app instance is still there after the app
// is closed and a new one is built on the same database file. This is what
// makes the todo list survive a server restart.

describe('persistence across app instances', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'todo-persist-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('AC-API-8: a todo created before a restart is returned by GET after it', async () => {
    // A nested path that does not exist yet: the DB layer must create the
    // parent directories, otherwise a fresh checkout with the default DB_PATH
    // would fail to start.
    const dbPath = join(dir, 'nested', 'todos.db');

    const first = buildApp({ dbPath });
    const created = await first.inject({
      method: 'POST',
      url: '/api/todos',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ title: '재시작 후에도 남아 있어야 함' }),
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    await first.close();

    expect(existsSync(dbPath)).toBe(true);

    const second = buildApp({ dbPath });
    try {
      const res = await second.inject({ method: 'GET', url: `/api/todos/${id}` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        id,
        title: '재시작 후에도 남아 있어야 함',
        completed: false,
      });

      const list = await second.inject({ method: 'GET', url: '/api/todos' });
      expect(list.json()).toHaveLength(1);
    } finally {
      await second.close();
    }
  });
});
