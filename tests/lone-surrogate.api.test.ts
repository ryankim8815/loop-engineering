import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';

// R4: SQLite stores TEXT as UTF-8, which cannot represent a lone UTF-16 surrogate, so the
// stored title becomes U+FFFD. Before the fix POST and PATCH echoed the in-memory string
// ("a\ud800b") while GET later returned the stored "a�b". The UI keeps the POST copy, so
// its state drifted from the server until a reload. A write response must equal what a read
// returns for the same todo.
const JSON_HEADERS = { 'content-type': 'application/json' };

describe('lone surrogates in titles (R4)', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('R4: the POST response title equals the title GET returns later', async () => {
    app = buildApp({ dbPath: ':memory:' });
    const created = await app.inject({
      method: 'POST',
      url: '/api/todos',
      headers: JSON_HEADERS,
      payload: '{"title":"a\\ud800b"}',
    });
    expect(created.statusCode).toBe(201);

    const id = created.json().id;
    const fetched = await app.inject({ method: 'GET', url: `/api/todos/${id}` });

    expect(created.json().title).toBe(fetched.json().title);
  });

  it('R4: the PATCH response title equals the title GET returns later', async () => {
    app = buildApp({ dbPath: ':memory:' });
    const created = await app.inject({
      method: 'POST',
      url: '/api/todos',
      headers: JSON_HEADERS,
      payload: '{"title":"plain"}',
    });
    const id = created.json().id;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/todos/${id}`,
      headers: JSON_HEADERS,
      payload: '{"title":"a\\ud800b"}',
    });
    expect(patched.statusCode).toBe(200);

    const fetched = await app.inject({ method: 'GET', url: `/api/todos/${id}` });
    expect(patched.json().title).toBe(fetched.json().title);
  });
});
