import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createApi } from '../public/api.js';

// The browser API client (spec 02, AC-UI-8 support). fetch is stubbed, so these run
// on node without a server. Each test records the URL, method, headers and body that
// the client sent, so the wire format is checked directly.

type Recorded = { url: string; init: RequestInit };

function stubFetch(responses: Response[]) {
  const calls: Recorded[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) {
      throw new Error('no queued response');
    }
    return next;
  });
  return { fetchImpl, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const todo = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'buy milk',
  completed: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AC-UI-8: API client requests', () => {
  it('list sends GET /api/todos with the filter query and no body or Content-Type', async () => {
    const { fetchImpl, calls } = stubFetch([json([todo])]);
    const api = createApi(fetchImpl);

    const result = await api.list('active');

    expect(result).toEqual([todo]);
    expect(calls[0]?.url).toBe('/api/todos?filter=active');
    expect(calls[0]?.init.method).toBe('GET');
    expect(calls[0]?.init.body).toBeUndefined();
    expect(calls[0]?.init.headers).toBeUndefined();
  });

  it('create sends POST with a JSON body and Content-Type, and returns the new todo', async () => {
    const { fetchImpl, calls } = stubFetch([json(todo, 201)]);
    const api = createApi(fetchImpl);

    const result = await api.create('buy milk');

    expect(result).toEqual(todo);
    expect(calls[0]?.url).toBe('/api/todos');
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ title: 'buy milk' });
  });

  it('update sends PATCH to the encoded id with the patch as a JSON body', async () => {
    const updated = { ...todo, completed: true };
    const { fetchImpl, calls } = stubFetch([json(updated)]);
    const api = createApi(fetchImpl);

    const result = await api.update(todo.id, { completed: true });

    expect(result).toEqual(updated);
    expect(calls[0]?.url).toBe(`/api/todos/${todo.id}`);
    expect(calls[0]?.init.method).toBe('PATCH');
    expect(calls[0]?.init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ completed: true });
  });

  it('remove sends DELETE with no body and no Content-Type, and resolves on 204', async () => {
    const { fetchImpl, calls } = stubFetch([new Response(null, { status: 204 })]);
    const api = createApi(fetchImpl);

    await expect(api.remove(todo.id)).resolves.toBeUndefined();

    expect(calls[0]?.url).toBe(`/api/todos/${todo.id}`);
    expect(calls[0]?.init.method).toBe('DELETE');
    expect(calls[0]?.init.body).toBeUndefined();
    expect(calls[0]?.init.headers).toBeUndefined();
  });

  it('clearCompleted sends DELETE ?completed=true with no Content-Type and returns the count', async () => {
    const { fetchImpl, calls } = stubFetch([json({ deleted: 3 })]);
    const api = createApi(fetchImpl);

    const result = await api.clearCompleted();

    expect(result).toEqual({ deleted: 3 });
    expect(calls[0]?.url).toBe('/api/todos?completed=true');
    expect(calls[0]?.init.method).toBe('DELETE');
    expect(calls[0]?.init.headers).toBeUndefined();
  });

  it('uses globalThis.fetch when no fetch is injected', async () => {
    const { fetchImpl, calls } = stubFetch([json([])]);
    vi.stubGlobal('fetch', fetchImpl);

    await createApi().list('all');

    expect(calls[0]?.url).toBe('/api/todos?filter=all');
  });
});

describe('AC-UI-8: API client errors', () => {
  it('throws ApiError with the envelope code and message on a 400', async () => {
    const { fetchImpl } = stubFetch([
      json({ error: { code: 'VALIDATION_ERROR', message: '제목은 200자 이하여야 합니다.' } }, 400),
    ]);
    const api = createApi(fetchImpl);

    const error = await api.create('x').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      name: 'ApiError',
      code: 'VALIDATION_ERROR',
      message: '제목은 200자 이하여야 합니다.',
      status: 400,
    });
  });

  it('carries the envelope code and message from a 404 NOT_FOUND', async () => {
    const { fetchImpl } = stubFetch([
      json({ error: { code: 'NOT_FOUND', message: '존재하지 않는 할 일입니다.' } }, 404),
    ]);
    const api = createApi(fetchImpl);

    await expect(api.remove('missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: '존재하지 않는 할 일입니다.',
      status: 404,
    });
  });

  it('falls back to a generic message when a 500 body is not JSON', async () => {
    const { fetchImpl } = stubFetch([new Response('<html>oops</html>', { status: 500 })]);
    const api = createApi(fetchImpl);

    const error = await api.list('all').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'HTTP_ERROR',
      message: '요청에 실패했습니다 (HTTP 500).',
      status: 500,
    });
  });

  it('falls back to a generic message when the JSON body has no error envelope', async () => {
    const { fetchImpl } = stubFetch([json({ message: 'nope' }, 400)]);
    const api = createApi(fetchImpl);

    await expect(api.create('x')).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      message: '요청에 실패했습니다 (HTTP 400).',
      status: 400,
    });
  });

  it('lets a network failure reject unchanged, so callers can tell it apart from an API error', async () => {
    const networkError = new TypeError('fetch failed');
    const fetchImpl = vi.fn(async () => {
      throw networkError;
    });
    const api = createApi(fetchImpl);

    await expect(api.list('all')).rejects.toBe(networkError);
  });
});
