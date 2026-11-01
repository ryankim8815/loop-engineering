// Browser API client (spec 02: the UI uses only the API in spec 01). It takes an
// injectable fetch so tests can stub it. Any non-2xx response becomes an ApiError,
// built from the `{ error: { code, message } }` envelope in spec 01 when the body
// has one. Network failures are not caught here, so the caller can tell them apart.

/**
 * @typedef {{ id: string, title: string, completed: boolean, createdAt: string, updatedAt: string }} Todo
 * @typedef {'all' | 'active' | 'completed'} Filter
 */

export class ApiError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} status
   */
  constructor(code, message, status) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Reads the envelope from a failed response. Falls back to a generic message when
 * the body is not JSON or has no `error.code`/`error.message` strings.
 *
 * @param {Response} response
 * @returns {Promise<ApiError>}
 */
async function toApiError(response) {
  const fallback = `요청에 실패했습니다 (HTTP ${response.status}).`;
  let text = '';
  try {
    text = await response.text();
  } catch {
    return new ApiError('HTTP_ERROR', fallback, response.status);
  }
  try {
    const body = JSON.parse(text);
    const error = body?.error;
    if (typeof error?.code === 'string' && typeof error?.message === 'string') {
      return new ApiError(error.code, error.message, response.status);
    }
  } catch {
    // Not JSON: use the fallback below.
  }
  return new ApiError('HTTP_ERROR', fallback, response.status);
}

/**
 * @param {typeof fetch} fetchImpl
 */
export function createApi(fetchImpl = globalThis.fetch) {
  /**
   * Sends one request. `Content-Type` is set only when there is a body, because
   * Fastify rejects an empty body that claims to be JSON (DELETE must not send it).
   *
   * @param {string} method
   * @param {string} url
   * @param {unknown} [body]
   * @returns {Promise<unknown>} parsed JSON, or undefined for 204 No Content
   */
  async function request(method, url, body) {
    /** @type {RequestInit} */
    const init = { method };
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const response = await fetchImpl(url, init);
    if (!response.ok) {
      throw await toApiError(response);
    }
    if (response.status === 204) {
      return undefined;
    }
    return response.json();
  }

  return {
    /**
     * @param {Filter} filter
     * @returns {Promise<Todo[]>}
     */
    list(filter) {
      const query = new URLSearchParams({ filter });
      return request('GET', `/api/todos?${query.toString()}`);
    },

    /**
     * @param {string} title
     * @returns {Promise<Todo>}
     */
    create(title) {
      return request('POST', '/api/todos', { title });
    },

    /**
     * @param {string} id
     * @param {{ title?: string, completed?: boolean }} patch
     * @returns {Promise<Todo>}
     */
    update(id, patch) {
      return request('PATCH', `/api/todos/${encodeURIComponent(id)}`, patch);
    },

    /**
     * @param {string} id
     * @returns {Promise<void>}
     */
    async remove(id) {
      await request('DELETE', `/api/todos/${encodeURIComponent(id)}`);
    },

    /**
     * @returns {Promise<{ deleted: number }>}
     */
    clearCompleted() {
      return request('DELETE', '/api/todos?completed=true');
    },
  };
}
