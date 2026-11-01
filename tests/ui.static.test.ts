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
});
