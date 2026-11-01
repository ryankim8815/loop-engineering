import Fastify, { type FastifyInstance } from 'fastify';
import { openDatabase } from './db.ts';
import { errorEnvelope, NOT_FOUND_MESSAGE, toErrorResponse } from './errors.ts';
import { TodoRepository } from './todo-repository.ts';

export interface BuildAppOptions {
  logger?: boolean;
  // SQLite file path, or ':memory:'. Falls back to DB_PATH, then the default file.
  dbPath?: string;
}

const DEFAULT_DB_PATH = 'data/todos.db';

declare module 'fastify' {
  interface FastifyInstance {
    todos: TodoRepository;
  }
}

// App factory shared by the server entry point and the tests. Tests call
// buildApp() and drive it with app.inject(), so no real port is bound.
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  const db = openDatabase(options.dbPath ?? process.env.DB_PATH ?? DEFAULT_DB_PATH);
  app.decorate('todos', new TodoRepository(db));
  // Closing the app closes its database handle so the file is released.
  app.addHook('onClose', async () => {
    db.close();
  });

  // Fastify ships a text/plain body parser by default. Spec 01 accepts only
  // application/json bodies, so drop it; other types then hit the 415 path,
  // which the error handler maps to 400 VALIDATION_ERROR.
  app.removeContentTypeParser('text/plain');

  app.get('/api/health', async () => ({ status: 'ok' }));

  // Every error response uses the { error: { code, message } } envelope (spec 01).
  app.setErrorHandler((error: unknown, request, reply) => {
    const { statusCode, body } = toErrorResponse(error);
    if (statusCode >= 500) {
      // Log the real error server-side; it is never sent to the client.
      request.log.error({ err: error }, 'unhandled request error');
    }
    reply.code(statusCode).send(body);
  });

  // Unknown paths get the same JSON 404 whether or not they are under /api and
  // whatever Accept header the browser sends.
  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send(errorEnvelope('NOT_FOUND', NOT_FOUND_MESSAGE));
  });

  return app;
}
