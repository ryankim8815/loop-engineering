import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApi } from '../../public/api.js';
import { startApp } from '../../public/app.js';

// DOM test harness (spec 03: happy-dom). Test files that use it start with
// `// @vitest-environment happy-dom`, so `document` and `window` are globals there.
// The fake fetch keeps an in-memory list shaped like the spec 01 API and records every
// request, so tests can check what the UI sent and what the server state became.

export type Todo = {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RecordedRequest = { method: string; url: string; body: unknown };

/**
 * What a queued failure does to the next request with a matching method: answer with the
 * spec 01 error envelope, or reject the fetch the way a dropped network connection does.
 */
export type FailureOutcome = { status: number; code: string; message: string } | 'network';

export type FakeServer = {
  todos: Todo[];
  requests: RecordedRequest[];
  fetch: typeof fetch;
  /** Queues a failure for the next request whose method matches. Failures run in queue order. */
  failNext(method: string, outcome: FailureOutcome): void;
};

// happy-dom replaces import.meta.url with a non-file URL, so resolve from the cwd.
// `npm test` always runs from the repo root.
const indexHtml = readFileSync(resolve('public/index.html'), 'utf8');

/** Waits for pending promise callbacks and any already-resolved fake responses. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Builds a stateful fake of the spec 01 API. Unknown routes return the spec's
 * JSON 404 envelope, so a wrong URL from the UI shows up as an error, not as silence.
 */
export function createFakeServer(seed: Todo[] = []): FakeServer {
  const failures: { method: string; outcome: FailureOutcome }[] = [];
  const server: FakeServer = {
    todos: seed.map((todo) => ({ ...todo })),
    requests: [],
    fetch: undefined as unknown as typeof fetch,
    failNext(method, outcome) {
      failures.push({ method, outcome });
    },
  };
  let counter = 0;

  server.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const url = new URL(String(input), 'http://fake.local');
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
    server.requests.push({ method, url: url.pathname + url.search, body });

    const queued = failures.findIndex((failure) => failure.method === method);
    const failure = queued === -1 ? undefined : failures.splice(queued, 1)[0];
    if (failure) {
      if (failure.outcome === 'network') {
        throw new TypeError('fetch failed');
      }
      const { code, message, status } = failure.outcome;
      return json({ error: { code, message } }, status);
    }

    if (url.pathname === '/api/todos' && method === 'GET') {
      const filter = url.searchParams.get('filter') ?? 'all';
      const shown = server.todos.filter((todo) =>
        filter === 'active' ? !todo.completed : filter === 'completed' ? todo.completed : true,
      );
      return json(shown);
    }

    if (url.pathname === '/api/todos' && method === 'POST') {
      counter += 1;
      const now = new Date(Date.UTC(2026, 0, 1, 0, 0, counter)).toISOString();
      const created: Todo = {
        id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
        title: (body as { title: string }).title,
        completed: false,
        createdAt: now,
        updatedAt: now,
      };
      server.todos.push(created);
      return json(created, 201);
    }

    if (url.pathname === '/api/todos' && method === 'DELETE' && url.search === '?completed=true') {
      const before = server.todos.length;
      server.todos = server.todos.filter((todo) => !todo.completed);
      return json({ deleted: before - server.todos.length });
    }

    const match = /^\/api\/todos\/([^/]+)$/.exec(url.pathname);
    const todo = match ? server.todos.find((t) => t.id === match[1]) : undefined;
    if (todo && method === 'PATCH') {
      Object.assign(todo, body);
      return json(todo);
    }
    if (todo && method === 'DELETE') {
      server.todos = server.todos.filter((t) => t !== todo);
      return new Response(null, { status: 204 });
    }

    return json({ error: { code: 'NOT_FOUND', message: '리소스를 찾을 수 없습니다.' } }, 404);
  }) as typeof fetch;

  return server;
}

/**
 * Loads the `<body>` of public/index.html into the happy-dom document. Scripts are
 * stripped, so the real main.js never runs in tests. startApp is called instead.
 */
export function loadIndexBody(): void {
  const match = /<body[^>]*>([\s\S]*)<\/body>/.exec(indexHtml);
  if (!match) {
    throw new Error('public/index.html has no <body>');
  }
  document.body.innerHTML = (match[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');
}

/**
 * Mounts a fresh app on the index.html body against a fake server seeded with `seed`.
 * `beforeStart` runs before startApp, so a test can queue a failure for the first load.
 * Resolves after the initial list has rendered (or the initial load has failed).
 */
export async function mountApp(seed: Todo[] = [], beforeStart?: (server: FakeServer) => void) {
  loadIndexBody();
  const server = createFakeServer(seed);
  beforeStart?.(server);
  await startApp({ document, window, api: createApi(server.fetch) });
  return { document, server };
}
