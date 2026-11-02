import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';

// R13: spec 01 scopes the Content-Type / JSON-body rules to POST and PATCH and defines
// DELETE by path and query only. Many HTTP clients send `Content-Type: application/json`
// on every request, so a DELETE must succeed whatever headers or body it carries.
// See IMPLEMENTATION_PLAN.md "DELETE ignores request bodies (R13)".

describe('R13: DELETE ignores request bodies and Content-Type', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp({ dbPath: ':memory:' });
  });

  afterEach(async () => {
    await app.close();
  });

  async function create(title: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/todos',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ title }),
    });
    expect(res.statusCode).toBe(201);
    return res.json().id;
  }

  async function complete(id: string): Promise<void> {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/todos/${id}`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ completed: true }),
    });
    expect(res.statusCode).toBe(200);
  }

  async function listIds(): Promise<string[]> {
    const res = await app.inject({ method: 'GET', url: '/api/todos' });
    return (res.json() as { id: string }[]).map((todo) => todo.id);
  }

  it('R13: DELETE /api/todos/:id with an application/json header and empty body returns 204', async () => {
    const id = await create('delete me');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/todos/${id}`,
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(204);
    expect(await listIds()).toEqual([]);
  });

  it('R13: DELETE /api/todos/:id with text/plain and a non-empty body returns 204', async () => {
    const id = await create('delete me');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/todos/${id}`,
      headers: { 'content-type': 'text/plain' },
      payload: 'x',
    });
    expect(res.statusCode).toBe(204);
    expect(await listIds()).toEqual([]);
  });

  it('R13: DELETE /api/todos?completed=true with an application/json header and empty body returns 200', async () => {
    const done = await create('completed');
    await create('active');
    await complete(done);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/todos?completed=true',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: 1 });
    expect((await listIds()).length).toBe(1);
  });

  it('R13: DELETE /api/todos?completed=true with text/plain and a non-empty body returns 200', async () => {
    const done = await create('completed');
    await create('active');
    await complete(done);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/todos?completed=true',
      headers: { 'content-type': 'text/plain' },
      payload: 'x',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: 1 });
    expect((await listIds()).length).toBe(1);
  });
});
