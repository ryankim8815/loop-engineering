import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';

// Route-level acceptance for DELETE /api/todos?completed=true (spec 01 bulk clear).
// Each test gets a fresh in-memory DB so the cases stay isolated.

interface TodoJson {
  id: string;
  title: string;
  completed: boolean;
}

describe('todos API: DELETE /api/todos?completed=true (bulk clear)', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp({ dbPath: ':memory:' });
  });

  afterEach(async () => {
    await app.close();
  });

  async function create(title: string): Promise<TodoJson> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/todos',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ title }),
    });
    expect(res.statusCode).toBe(201);
    return res.json();
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
    return (res.json() as TodoJson[]).map((todo) => todo.id);
  }

  it('AC-API-7: removes only completed todos and reports the count in deleted', async () => {
    const done1 = await create('done one');
    const active = await create('still active');
    const done2 = await create('done two');
    await complete(done1.id);
    await complete(done2.id);

    const res = await app.inject({ method: 'DELETE', url: '/api/todos?completed=true' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: 2 });

    expect(await listIds()).toEqual([active.id]);
  });

  it('AC-API-7: with no completed todos returns { deleted: 0 } and leaves the list unchanged', async () => {
    const first = await create('active one');
    const second = await create('active two');

    const res = await app.inject({ method: 'DELETE', url: '/api/todos?completed=true' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: 0 });

    expect(await listIds()).toEqual([first.id, second.id]);
  });

  it('AC-API-10: DELETE /api/todos with no query is 400 VALIDATION_ERROR and the list is unchanged', async () => {
    const done = await create('completed');
    const active = await create('active');
    await complete(done.id);

    const res = await app.inject({ method: 'DELETE', url: '/api/todos' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');

    expect(await listIds()).toEqual([done.id, active.id]);
  });

  it('AC-API-10: DELETE /api/todos?completed=false is 400 VALIDATION_ERROR and the list is unchanged', async () => {
    const done = await create('completed');
    const active = await create('active');
    await complete(done.id);

    const res = await app.inject({ method: 'DELETE', url: '/api/todos?completed=false' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');

    expect(await listIds()).toEqual([done.id, active.id]);
  });

  it('AC-API-10: a repeated completed param is 400 and removes nothing', async () => {
    const done = await create('completed');
    await complete(done.id);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/todos?completed=true&completed=true',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');

    expect(await listIds()).toEqual([done.id]);
  });
});
