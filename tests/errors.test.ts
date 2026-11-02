import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { notFound, validationError } from '../src/errors.ts';

// Throwaway routes are registered on each built instance before the first
// inject(), so no test-only code ships in src/.
function buildTestApp(): FastifyInstance {
  const app = buildApp();
  app.get('/__test/boom', async () => {
    throw new Error('secret detail /Users/ryan/loop-engineering/src/leak.ts');
  });
  app.get('/__test/app-not-found', async () => {
    throw notFound('custom missing');
  });
  app.get('/__test/app-validation', async () => {
    throw validationError('custom invalid');
  });
  app.post('/__test/echo', async (request) => request.body);
  return app;
}

describe('error envelope', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('AC-API-12: GET /nope returns a JSON 404 NOT_FOUND envelope', async () => {
    app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/nope' });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });

  it('AC-API-12: GET /api/nope returns the same JSON 404 envelope', async () => {
    app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/nope' });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });

  it('AC-API-12: a browser navigating to an unknown path (Accept: text/html) still gets JSON, not HTML', async () => {
    app = buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/nope',
      headers: { accept: 'text/html,application/xhtml+xml' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).not.toMatch(/<html/i);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('a route throwing an unexpected error returns 500 INTERNAL_ERROR with no stack, path or source info', async () => {
    app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/__test/boom' });

    expect(res.statusCode).toBe(500);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: expect.any(String) } });
    expect(res.body).not.toContain('secret detail');
    expect(res.body).not.toContain('stack');
    expect(res.body).not.toContain('at ');
    expect(res.body).not.toContain('/Users');
    expect(res.body).not.toContain('src/');
  });

  it('an AppError thrown by a route keeps its own status and code', async () => {
    app = buildTestApp();

    const notFoundRes = await app.inject({ method: 'GET', url: '/__test/app-not-found' });
    expect(notFoundRes.statusCode).toBe(404);
    expect(notFoundRes.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'custom missing' } });

    const validationRes = await app.inject({ method: 'GET', url: '/__test/app-validation' });
    expect(validationRes.statusCode).toBe(400);
    expect(validationRes.json()).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'custom invalid' },
    });
  });

  it('malformed JSON body returns 400 VALIDATION_ERROR', async () => {
    app = buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/__test/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"title": ',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) },
    });
  });

  it('empty JSON body with application/json returns 400 VALIDATION_ERROR', async () => {
    app = buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/__test/echo',
      headers: { 'content-type': 'application/json' },
      payload: '',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('text/plain POST returns 400 VALIDATION_ERROR, not Fastify 415', async () => {
    app = buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/__test/echo',
      headers: { 'content-type': 'text/plain' },
      payload: 'hello',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) },
    });
  });

  // Fastify rejects a malformed percent-encoded URL before routing, so the
  // normal error handler never runs. Without frameworkErrors the body was
  // Fastify's own { error: 'Bad Request', code: 'FST_ERR_BAD_URL', ... } shape,
  // which breaks spec 01's rule that every error uses the one envelope.
  it.each(['/%', '/%E0%A4%A', '/api/todos/%', '/api/todos/%E0%A4%A'])(
    'R1: malformed percent-encoding %s returns the 400 VALIDATION_ERROR envelope',
    async (url) => {
      app = buildTestApp();
      const res = await app.inject({ method: 'GET', url });

      expect(res.statusCode).toBe(400);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.json()).toEqual({
        error: { code: 'VALIDATION_ERROR', message: expect.any(String) },
      });
      expect(res.body).not.toContain('FST_ERR');
    },
  );
});
