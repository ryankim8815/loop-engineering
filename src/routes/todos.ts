import type { FastifyInstance } from 'fastify';
import { notFound } from '../errors.ts';
import { parseCreateBody, parseFilter, parsePatchBody } from '../validation.ts';

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

  // Unknown ids (including non-UUID ones, spec 01) are 404 NOT_FOUND. The repository
  // lookup is by exact id, so a non-UUID string simply matches nothing.
  app.get<{ Params: { id: string } }>('/api/todos/:id', async (request) => {
    const todo = app.todos.get(request.params.id);
    if (todo === undefined) {
      throw notFound();
    }
    return todo;
  });

  // Body is validated before the lookup, so a bad body is a 400 regardless of whether
  // the id exists. An empty `{}` is rejected by parsePatchBody (AC-API-9), so the
  // repository's updatedAt bump only happens on real changes.
  app.patch<{ Params: { id: string } }>('/api/todos/:id', async (request) => {
    const patch = parsePatchBody(request.body);
    const todo = app.todos.update(request.params.id, patch);
    if (todo === undefined) {
      throw notFound();
    }
    return todo;
  });

  // 204 with an empty body. Requests need no Content-Type or body (the UI client
  // sends none for DELETE, and a stray empty JSON body would be a 400 from Fastify).
  app.delete<{ Params: { id: string } }>('/api/todos/:id', async (request, reply) => {
    if (!app.todos.remove(request.params.id)) {
      throw notFound();
    }
    return reply.code(204).send();
  });
}
