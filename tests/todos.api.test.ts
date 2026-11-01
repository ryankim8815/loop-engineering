import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';

// Route-level acceptance for POST /api/todos and GET /api/todos?filter=.
// Each test gets a fresh in-memory DB so the cases stay isolated.

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('todos API: POST /api/todos and GET /api/todos', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp({ dbPath: ':memory:' });
  });

  afterEach(async () => {
    await app.close();
  });

  async function post(payload: unknown, headers: Record<string, string> = {}) {
    return app.inject({
      method: 'POST',
      url: '/api/todos',
      headers: { 'content-type': 'application/json', ...headers },
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    });
  }

  async function list(query = '') {
    return app.inject({ method: 'GET', url: `/api/todos${query}` });
  }

  it('AC-API-1: a created todo appears in GET /api/todos with completed: false', async () => {
    const created = await post({ title: '우유 사기' });
    expect(created.statusCode).toBe(201);

    const res = await list();
    expect(res.statusCode).toBe(200);
    const todos = res.json();
    expect(todos).toHaveLength(1);
    expect(todos[0]).toMatchObject({ id: created.json().id, title: '우유 사기', completed: false });
  });

  it('AC-API-2: a title with surrounding spaces is stored trimmed', async () => {
    const res = await post({ title: '  우유 사기  ' });

    expect(res.statusCode).toBe(201);
    expect(res.json().title).toBe('우유 사기');
    expect((await list()).json()[0].title).toBe('우유 사기');
  });

  it('AC-API-3: an empty title, a whitespace-only title and a 201-char title are 400 VALIDATION_ERROR', async () => {
    for (const title of ['', '   ', 'a'.repeat(201)]) {
      const res = await post({ title });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    }
    expect((await list()).json()).toEqual([]);
  });

  it('AC-API-11: a 200-emoji title is created and a 201-emoji title is 400', async () => {
    const ok = await post({ title: '😀'.repeat(200) });
    expect(ok.statusCode).toBe(201);

    const tooLong = await post({ title: '😀'.repeat(201) });
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('a non-string title is 400 VALIDATION_ERROR', async () => {
    const res = await post({ title: 123 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('an unknown body field is 400 VALIDATION_ERROR and nothing is created', async () => {
    const res = await post({ title: 'ok', priority: 1 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect((await list()).json()).toEqual([]);
  });

  it('a text/plain body on the real route is 400 VALIDATION_ERROR', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/todos',
      headers: { 'content-type': 'text/plain' },
      payload: 'title=hello',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('a POST with no body is 400 VALIDATION_ERROR', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/todos' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('the created todo has a UUID v4 id and ISO UTC timestamps', async () => {
    const res = await post({ title: 'shape' });
    const todo = res.json();

    expect(todo.id).toMatch(UUID_V4);
    expect(new Date(todo.createdAt).toISOString()).toBe(todo.createdAt);
    expect(new Date(todo.updatedAt).toISOString()).toBe(todo.updatedAt);
    expect(todo.createdAt).toBe(todo.updatedAt);
    expect(Object.keys(todo).sort()).toEqual([
      'completed',
      'createdAt',
      'id',
      'title',
      'updatedAt',
    ]);
  });

  it('the list keeps creation order (oldest first)', async () => {
    await post({ title: 'first' });
    await post({ title: 'second' });
    await post({ title: 'third' });

    const titles = (await list()).json().map((todo: { title: string }) => todo.title);
    expect(titles).toEqual(['first', 'second', 'third']);
  });

  it('GET ?filter=all and no filter both return every todo', async () => {
    await post({ title: 'a' });
    await post({ title: 'b' });

    expect((await list('?filter=all')).json()).toHaveLength(2);
    expect((await list()).json()).toHaveLength(2);
  });

  it('GET ?filter=active includes a new todo, ?filter=completed does not', async () => {
    await post({ title: 'new' });

    expect((await list('?filter=active')).json()).toHaveLength(1);
    expect((await list('?filter=completed')).json()).toEqual([]);
  });

  it('GET with an invalid filter is 400 VALIDATION_ERROR', async () => {
    const res = await list('?filter=done');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('GET ignores unknown query params and returns 200', async () => {
    await post({ title: 'x' });

    const res = await list('?foo=1');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });
});
