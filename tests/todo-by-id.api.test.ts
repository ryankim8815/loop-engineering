import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';

// Route-level acceptance for GET / PATCH / DELETE /api/todos/:id (spec 01).
// Each test gets a fresh in-memory DB so the cases stay isolated.

const MISSING_UUID = '00000000-0000-4000-8000-000000000000';

interface TodoJson {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

describe('todos API: GET / PATCH / DELETE /api/todos/:id', () => {
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

  async function patch(id: string, payload: unknown, headers: Record<string, string> = {}) {
    return app.inject({
      method: 'PATCH',
      url: `/api/todos/${id}`,
      headers: { 'content-type': 'application/json', ...headers },
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    });
  }

  async function getOne(id: string) {
    return app.inject({ method: 'GET', url: `/api/todos/${id}` });
  }

  async function list(query = '') {
    return app.inject({ method: 'GET', url: `/api/todos${query}` });
  }

  it('GET /api/todos/:id returns the todo with 200', async () => {
    const created = await create('read me');

    const res = await getOne(created.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(created);
  });

  it('AC-API-4: after PATCH completed: true the todo is in filter=completed and not in filter=active', async () => {
    const created = await create('finish me');

    const res = await patch(created.id, { completed: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: created.id, completed: true });

    const completed = (await list('?filter=completed')).json() as TodoJson[];
    const active = (await list('?filter=active')).json() as TodoJson[];
    expect(completed.map((todo) => todo.id)).toEqual([created.id]);
    expect(active.map((todo) => todo.id)).not.toContain(created.id);
  });

  it('AC-API-5: after PATCH updatedAt grows and createdAt is unchanged', async () => {
    const created = await create('bump me');

    const res = await patch(created.id, { title: 'bumped' });
    const updated = res.json() as TodoJson;
    expect(updated.createdAt).toBe(created.createdAt);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
  });

  it('AC-API-5: two PATCHes back-to-back each strictly increase updatedAt', async () => {
    const created = await create('rapid');

    const first = (await patch(created.id, { completed: true })).json() as TodoJson;
    const second = (await patch(created.id, { completed: false })).json() as TodoJson;

    expect(Date.parse(first.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
    expect(Date.parse(second.updatedAt)).toBeGreaterThan(Date.parse(first.updatedAt));
    expect(second.createdAt).toBe(created.createdAt);
  });

  it('AC-API-6: GET, PATCH and DELETE on a missing UUID are 404 NOT_FOUND', async () => {
    const responses = [
      await getOne(MISSING_UUID),
      await patch(MISSING_UUID, { completed: true }),
      await app.inject({ method: 'DELETE', url: `/api/todos/${MISSING_UUID}` }),
    ];

    for (const res of responses) {
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    }
  });

  it('AC-API-6: GET, PATCH and DELETE on a non-UUID id are 404 NOT_FOUND', async () => {
    const responses = [
      await getOne('abc'),
      await patch('abc', { completed: true }),
      await app.inject({ method: 'DELETE', url: '/api/todos/abc' }),
    ];

    for (const res of responses) {
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    }
  });

  it('AC-API-9: PATCH with an empty {} is 400 and the todo (updatedAt included) is unchanged', async () => {
    const created = await create('keep me');

    const res = await patch(created.id, {});
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');

    const after = (await getOne(created.id)).json() as TodoJson;
    expect(after).toEqual(created);
  });

  it('PATCH trims the title and applies the same 1–200 code-point rule as POST', async () => {
    const created = await create('old');

    const trimmed = await patch(created.id, { title: '  new title  ' });
    expect(trimmed.statusCode).toBe(200);
    expect(trimmed.json().title).toBe('new title');

    for (const title of ['', '   ', 'a'.repeat(201)]) {
      const res = await patch(created.id, { title });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    }
    expect((await getOne(created.id)).json().title).toBe('new title');
  });

  it('PATCH with an unknown field is 400 and changes nothing', async () => {
    const created = await create('strict');

    const res = await patch(created.id, { completed: true, priority: 1 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect((await getOne(created.id)).json()).toEqual(created);
  });

  it('PATCH with completed as a string is 400 and changes nothing', async () => {
    const created = await create('typed');

    const res = await patch(created.id, { completed: 'yes' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect((await getOne(created.id)).json()).toEqual(created);
  });

  it('PATCH with a text/plain body is 400 VALIDATION_ERROR', async () => {
    const created = await create('plain');

    const res = await patch(created.id, 'completed=true', { 'content-type': 'text/plain' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('DELETE with no body and no Content-Type is 204 with an empty body, and the todo is gone', async () => {
    const created = await create('delete me');

    const res = await app.inject({ method: 'DELETE', url: `/api/todos/${created.id}` });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');

    expect((await getOne(created.id)).statusCode).toBe(404);
    expect((await list()).json()).toEqual([]);
  });

  it('DELETE on an already-deleted todo is 404 NOT_FOUND', async () => {
    const created = await create('twice');
    await app.inject({ method: 'DELETE', url: `/api/todos/${created.id}` });

    const res = await app.inject({ method: 'DELETE', url: `/api/todos/${created.id}` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});
