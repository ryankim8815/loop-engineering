import type { FastifyInstance } from 'fastify';
import { parseCreateBody, parseFilter } from '../validation.ts';

// Todo routes. Bodies and queries are validated in validation.ts; this module only
// maps HTTP to the repository. Errors are thrown as AppError and rendered by the
// app-wide error handler, so no per-route error formatting lives here.
export function registerTodoRoutes(app: FastifyInstance): void {
  // Unknown query params are ignored (spec 01); only `filter` is read.
  app.get<{ Querystring: Record<string, unknown> }>('/api/todos', async (request) => {
    return app.todos.list(parseFilter(request.query));
  });

  // Spec 01: the body is strictly `{ title }`. The 201 + full Todo is returned
  // so the UI can append the item without a second GET.
  app.post('/api/todos', async (request, reply) => {
    const { title } = parseCreateBody(request.body);
    const todo = app.todos.create(title);
    return reply.code(201).send(todo);
  });
}
