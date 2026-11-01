import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../src/db.ts';
import { TodoRepository } from '../src/todo-repository.ts';

// Each test gets a fresh in-memory database so ordering and counts are exact.
// Fake timers freeze Date so same-millisecond behaviour is deterministic.
const T0 = new Date('2026-11-02T00:00:00.000Z');

describe('TodoRepository', () => {
  let repo: TodoRepository;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    repo = new TodoRepository(openDatabase(':memory:'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('create', () => {
    it('returns an incomplete todo with a UUID id and equal ISO timestamps', () => {
      const todo = repo.create('우유 사기');

      expect(todo.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(todo.title).toBe('우유 사기');
      expect(todo.completed).toBe(false);
      expect(todo.createdAt).toBe(T0.toISOString());
      expect(todo.updatedAt).toBe(T0.toISOString());
    });

    it('generates a different id for each todo', () => {
      expect(repo.create('a').id).not.toBe(repo.create('b').id);
    });
  });

  describe('get', () => {
    it('returns the stored todo with boolean completed', () => {
      const created = repo.create('read');
      expect(repo.get(created.id)).toEqual(created);
    });

    it('returns undefined for an unknown id', () => {
      expect(repo.get(randomUUID())).toBeUndefined();
    });
  });

  describe('list', () => {
    it('orders by createdAt ascending', () => {
      vi.setSystemTime(new Date(T0.getTime() + 2000));
      repo.create('later');
      vi.setSystemTime(T0);
      repo.create('earlier');

      expect(repo.list().map((t) => t.title)).toEqual(['earlier', 'later']);
    });

    it('keeps insertion order for todos created in the same millisecond', () => {
      const titles = ['first', 'second', 'third', 'fourth'];
      for (const title of titles) {
        repo.create(title);
      }

      expect(repo.list().map((t) => t.title)).toEqual(titles);
    });

    it('filters by active and completed', () => {
      const a = repo.create('a');
      repo.create('b');
      repo.update(a.id, { completed: true });

      expect(repo.list('all')).toHaveLength(2);
      expect(repo.list('completed').map((t) => t.title)).toEqual(['a']);
      expect(repo.list('active').map((t) => t.title)).toEqual(['b']);
    });

    it('defaults to all', () => {
      repo.create('a');
      expect(repo.list()).toHaveLength(1);
    });
  });

  describe('update', () => {
    it('changes only the provided fields and keeps createdAt', () => {
      const created = repo.create('old');
      vi.setSystemTime(new Date(T0.getTime() + 5000));

      const updated = repo.update(created.id, { title: 'new' });

      expect(updated).toMatchObject({
        id: created.id,
        title: 'new',
        completed: false,
        createdAt: created.createdAt,
      });
      expect(repo.get(created.id)).toEqual(updated);
    });

    it('updates completed', () => {
      const created = repo.create('x');
      expect(repo.update(created.id, { completed: true })?.completed).toBe(true);
      expect(repo.update(created.id, { completed: false })?.completed).toBe(false);
    });

    it('returns undefined for an unknown id', () => {
      expect(repo.update(randomUUID(), { completed: true })).toBeUndefined();
    });

    it('moves updatedAt forward by 1 ms when the clock has not advanced', () => {
      const created = repo.create('x');

      const first = repo.update(created.id, { completed: true });
      const second = repo.update(created.id, { completed: false });

      expect(first?.updatedAt).toBe(new Date(T0.getTime() + 1).toISOString());
      expect(second?.updatedAt).toBe(new Date(T0.getTime() + 2).toISOString());
    });

    it('keeps updatedAt strictly increasing when the clock goes backwards', () => {
      const created = repo.create('x');
      const ahead = repo.update(created.id, { title: 'ahead' });
      vi.setSystemTime(new Date(T0.getTime() - 60_000));

      const behind = repo.update(created.id, { title: 'behind' });

      expect(Date.parse(behind?.updatedAt ?? '')).toBeGreaterThan(
        Date.parse(ahead?.updatedAt ?? ''),
      );
    });
  });

  describe('remove', () => {
    it('returns true when a todo was deleted', () => {
      const created = repo.create('x');
      expect(repo.remove(created.id)).toBe(true);
      expect(repo.get(created.id)).toBeUndefined();
    });

    it('returns false for an unknown id', () => {
      expect(repo.remove(randomUUID())).toBe(false);
    });
  });

  describe('removeCompleted', () => {
    it('deletes only completed todos and returns how many', () => {
      const a = repo.create('a');
      const b = repo.create('b');
      repo.create('c');
      repo.update(a.id, { completed: true });
      repo.update(b.id, { completed: true });

      expect(repo.removeCompleted()).toBe(2);
      expect(repo.list().map((t) => t.title)).toEqual(['c']);
    });

    it('returns 0 when nothing is completed', () => {
      repo.create('a');
      expect(repo.removeCompleted()).toBe(0);
    });
  });
});
