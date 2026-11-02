import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';

// Static UI is served from public/ by the same app that serves /api. These
// tests use app.inject() so no port is bound.
describe('static UI', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('AC-UI-1: GET / serves the HTML page with the input, list and filter elements', async () => {
    app = buildApp({ dbPath: ':memory:' });
    const res = await app.inject({ method: 'GET', url: '/' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('id="new-title"');
    expect(res.body).toContain('id="add-button"');
    expect(res.body).toContain('id="todo-list"');
    expect(res.body).toContain('id="remaining-count"');
    expect(res.body).toContain('id="clear-completed"');
    expect(res.body).toContain('href="#/"');
    expect(res.body).toContain('href="#/active"');
    expect(res.body).toContain('href="#/completed"');
    expect(res.body).toContain('id="error-banner"');
    expect(res.body).toContain('role="alert"');
    expect(res.body).toContain('lang="ko"');
    expect(res.body).toContain('name="viewport"');
  });

  it('AC-UI-1: GET /styles.css is served as text/css', async () => {
    app = buildApp({ dbPath: ':memory:' });
    const res = await app.inject({ method: 'GET', url: '/styles.css' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/css/);
  });

  it.each(['/main.js', '/app.js', '/state.js', '/api.js'])(
    'AC-UI-2: GET %s is served as a JavaScript module',
    async (url) => {
      app = buildApp({ dbPath: ':memory:' });
      const res = await app.inject({ method: 'GET', url });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/javascript|application\/javascript/);
    },
  );

  it('AC-UI-1: an unknown static path returns the JSON 404 envelope, not HTML', async () => {
    app = buildApp({ dbPath: ':memory:' });
    const res = await app.inject({
      method: 'GET',
      url: '/missing.js',
      headers: { accept: 'text/html,application/xhtml+xml' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });

  it('static serving does not shadow /api routes', async () => {
    app = buildApp({ dbPath: ':memory:' });
    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('static serving does not shadow /api 404s', async () => {
    app = buildApp({ dbPath: ':memory:' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/nope',
      headers: { accept: 'text/html' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  // @fastify/static (via send) refuses these paths with a plain Error carrying
  // statusCode 403. Before the fix that became 500 INTERNAL_ERROR, which blamed
  // the server for a bad URL and logged it as an unhandled error. The path is a
  // client mistake for a file that does not exist, so the answer is 404 NOT_FOUND.
  // The body must not leak package.json, which the traversal sequences point at.
  it.each([
    '/..%5cpackage.json',
    '/a%5c..%5c..%5cpackage.json',
    '/api/todos//',
    '/index.html%00',
    '//api/health',
    '//',
    '/a//b',
    '//index.html',
  ])('R2: %s returns the JSON 404 NOT_FOUND envelope, not 500', async (url) => {
    app = buildApp({ dbPath: ':memory:' });
    const res = await app.inject({ method: 'GET', url });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
    expect(res.body).not.toContain('"name"');
  });
});
