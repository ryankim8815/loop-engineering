import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

// Data access for todos. Returns the API shape (boolean `completed`, ISO UTC
// timestamps) so routes never touch SQLite column types.

export type TodoFilter = 'all' | 'active' | 'completed';

export interface Todo {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TodoPatch {
  title?: string;
  completed?: boolean;
}

// Constant fragments only; the filter value is never interpolated from input.
const WHERE_BY_FILTER: Record<TodoFilter, string> = {
  all: '',
  active: 'WHERE completed = 0',
  completed: 'WHERE completed = 1',
};

export class TodoRepository {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  // created_at ties (same millisecond) fall back to rowid, which follows
  // insertion order, so the list order is stable.
  list(filter: TodoFilter = 'all'): Todo[] {
    const rows = this.#db
      .prepare(`SELECT * FROM todos ${WHERE_BY_FILTER[filter]} ORDER BY created_at ASC, rowid ASC`)
      .all();
    return rows.map(toTodo);
  }

  get(id: string): Todo | undefined {
    const row = this.#db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
    return row === undefined ? undefined : toTodo(row);
  }

  // Write methods return the row read back from SQLite, not the value they were given.
  // SQLite stores TEXT as UTF-8, so some strings change on the way in (a lone UTF-16
  // surrogate becomes U+FFFD). Returning the input would make the write response differ
  // from what GET returns later, and the UI would then disagree with the server (R4).
  create(title: string): Todo {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.#db
      .prepare(
        'INSERT INTO todos (id, title, completed, created_at, updated_at) VALUES (?, ?, 0, ?, ?)',
      )
      .run(id, title, now, now);
    const stored = this.get(id);
    if (stored === undefined) {
      // Cannot happen with a working database: the row was inserted just above.
      throw new Error(`todo ${id} is missing right after insert`);
    }
    return stored;
  }

  // Returns undefined when the id does not exist (the route maps that to 404).
  update(id: string, patch: TodoPatch): Todo | undefined {
    const current = this.get(id);
    if (current === undefined) {
      return undefined;
    }
    const title = patch.title ?? current.title;
    const completed = patch.completed ?? current.completed;
    const updatedAt = nextUpdatedAt(current.updatedAt);
    this.#db
      .prepare('UPDATE todos SET title = ?, completed = ?, updated_at = ? WHERE id = ?')
      .run(title, completed ? 1 : 0, updatedAt, id);
    return this.get(id);
  }

  remove(id: string): boolean {
    const result = this.#db.prepare('DELETE FROM todos WHERE id = ?').run(id);
    return Number(result.changes) > 0;
  }

  removeCompleted(): number {
    const result = this.#db.prepare('DELETE FROM todos WHERE completed = 1').run();
    return Number(result.changes);
  }
}

// updatedAt must strictly increase on every update, even when two updates land
// in the same millisecond or the clock steps backwards. Otherwise clients that
// order by updatedAt could not tell which write happened last.
export function nextUpdatedAt(previous: string): string {
  const previousMs = Date.parse(previous);
  const nowMs = Date.now();
  return new Date(nowMs > previousMs ? nowMs : previousMs + 1).toISOString();
}

function toTodo(row: Record<string, unknown>): Todo {
  return {
    id: String(row.id),
    title: String(row.title),
    completed: row.completed === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
