import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDatabase } from './db.ts';
import { errorEnvelope, NOT_FOUND_MESSAGE, toErrorResponse } from './errors.ts';
import { registerTodoRoutes } from './routes/todos.ts';
import { TodoRepository } from './todo-repository.ts';

export interface BuildAppOptions {
  logger?: boolean;
  // SQLite file path, or ':memory:'. Falls back to DB_PATH, then the default file.
  dbPath?: string;
}

const DEFAULT_DB_PATH = 'data/todos.db';
// The browser UI lives in public/ at the repo root, next to src/.
const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

declare module 'fastify' {
  interface FastifyInstance {
    todos: TodoRepository;
  }
}

// Picks the SQLite path: explicit option, then DB_PATH, then the default file. An empty or
// whitespace-only value counts as unset. `new DatabaseSync('')` would open a temporary
// database that vanishes on close, so an empty DB_PATH must never reach it (R6).
export function resolveDbPath(explicit: string | undefined): string {
  for (const candidate of [explicit, process.env.DB_PATH]) {
    if (candidate !== undefined && candidate.trim() !== '') {
      return candidate;
    }
  }
  return DEFAULT_DB_PATH;
}

// App factory shared by the server entry point and the tests. Tests call
// buildApp() and drive it with app.inject(), so no real port is bound.
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  // One sender for every error. frameworkErrors covers failures Fastify raises
  // before routing (e.g. a malformed percent-encoded URL), which would otherwise
  // bypass setErrorHandler and return Fastify's own error shape.
  const sendError: Parameters<FastifyInstance['setErrorHandler']>[0] = (error, request, reply) => {
    const { statusCode, body } = toErrorResponse(error);
    if (statusCode >= 500) {
      // Log the real error server-side; it is never sent to the client.
      request.log.error({ err: error }, 'unhandled request error');
    }
    reply.code(statusCode).send(body);
  };

  const app = Fastify({
    logger: options.logger ?? false,
    frameworkErrors: sendError,
  });

  const db = openDatabase(resolveDbPath(options.dbPath));
  app.decorate('todos', new TodoRepository(db));
  // Closing the app closes its database handle so the file is released.
  app.addHook('onClose', async () => {
    db.close();
  });

  // Fastify ships a text/plain body parser by default. Spec 01 accepts only
  // application/json bodies, so drop it; other types then hit the 415 path,
  // which the error handler maps to 400 VALIDATION_ERROR.
  app.removeContentTypeParser('text/plain');

  // DELETE takes its input from the path and query only (spec 01), and many clients send
  // `Content-Type: application/json` on every request. Drop the headers that describe a
  // body before Fastify parses it, so a DELETE with any headers or body is not refused
  // with 400 (R13). The body bytes are never read, so they are discarded.
  app.addHook('onRequest', async (request) => {
    if (request.method === 'DELETE') {
      delete request.headers['content-type'];
      delete request.headers['content-length'];
      delete request.headers['transfer-encoding'];
    }
  });

  app.get('/api/health', async () => ({ status: 'ok' }));
  registerTodoRoutes(app);

  // Static UI at /. Only GET/HEAD files that exist are served; /api/* and
  // unknown paths fall through to the JSON 404 handler below.
  app.register(fastifyStatic, { root: PUBLIC_DIR, prefix: '/' });

  // Every error response uses the { error: { code, message } } envelope (spec 01).
  app.setErrorHandler(sendError);

  // Unknown paths get the same JSON 404 whether or not they are under /api and
  // whatever Accept header the browser sends.
  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send(errorEnvelope('NOT_FOUND', NOT_FOUND_MESSAGE));
  });

  return app;
}
