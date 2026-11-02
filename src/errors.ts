// Single source of truth for the error envelope:
//   { "error": { "code": "...", "message": "..." } }
// Every error response from the server (API, unknown paths, Fastify-internal
// failures) goes through toErrorResponse(), so clients can rely on one shape.

export const NOT_FOUND_MESSAGE = '요청한 리소스를 찾을 수 없습니다.';
export const INTERNAL_MESSAGE = '서버 오류가 발생했습니다.';
const CLIENT_REQUEST_MESSAGE = '잘못된 요청입니다.';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function validationError(message: string): AppError {
  return new AppError(400, 'VALIDATION_ERROR', message);
}

export function notFound(message: string = NOT_FOUND_MESSAGE): AppError {
  return new AppError(404, 'NOT_FOUND', message);
}

export interface ErrorEnvelope {
  error: { code: string; message: string };
}

export function errorEnvelope(code: string, message: string): ErrorEnvelope {
  return { error: { code, message } };
}

// Fastify reports request-level client failures with stable `code`s. We map them to
// 400 VALIDATION_ERROR (spec 01) instead of Fastify's default 400/415 shapes.
// FST_ERR_BAD_URL is raised by the router before any route runs (malformed
// percent-encoding such as `/%`), so it only reaches us via frameworkErrors.
const REQUEST_ERROR_MESSAGES = new Map<string, string>([
  ['FST_ERR_BAD_URL', '잘못된 URL 형식입니다.'],
  ['FST_ERR_CTP_INVALID_JSON_BODY', '요청 본문이 올바른 JSON이 아닙니다.'],
  ['FST_ERR_CTP_EMPTY_JSON_BODY', 'JSON 요청 본문이 비어 있습니다.'],
  ['FST_ERR_CTP_BODY_TOO_LARGE', '요청 본문이 너무 큽니다.'],
  [
    'FST_ERR_CTP_INVALID_CONTENT_LENGTH',
    'Content-Length 헤더가 요청 본문 크기와 일치하지 않습니다.',
  ],
  [
    'FST_ERR_CTP_INVALID_MEDIA_TYPE',
    '지원하지 않는 Content-Type입니다. application/json을 사용하세요.',
  ],
]);

export interface ErrorResponse {
  statusCode: number;
  body: ErrorEnvelope;
}

function readProp(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

// Decides what the client sees. Only AppError and known client-side Fastify
// failures expose a message; everything else becomes a generic 500 so stack
// traces and internal paths never reach the response body.
export function toErrorResponse(error: unknown): ErrorResponse {
  if (error instanceof AppError) {
    return { statusCode: error.statusCode, body: errorEnvelope(error.code, error.message) };
  }

  const fastifyCode = readProp(error, 'code');
  if (typeof fastifyCode === 'string') {
    const requestMessage = REQUEST_ERROR_MESSAGES.get(fastifyCode);
    if (requestMessage !== undefined) {
      return { statusCode: 400, body: errorEnvelope('VALIDATION_ERROR', requestMessage) };
    }
  }

  // Fastify schema validation failures carry a `validation` array; their message is safe to show.
  if (readProp(error, 'validation') !== undefined) {
    const message = readProp(error, 'message');
    return {
      statusCode: 400,
      body: errorEnvelope(
        'VALIDATION_ERROR',
        typeof message === 'string' ? message : CLIENT_REQUEST_MESSAGE,
      ),
    };
  }

  // @fastify/static (via `send`) refuses odd paths such as `//` or `/..%5c…` with a
  // plain Error carrying statusCode 403. Those requests name a file that is not
  // served, so they are 404 NOT_FOUND (spec 01), not a server error.
  const statusCode = readProp(error, 'statusCode');
  if (statusCode === 403 || statusCode === 404) {
    return { statusCode: 404, body: errorEnvelope('NOT_FOUND', NOT_FOUND_MESSAGE) };
  }

  // Other client-side statuses from the framework (e.g. 412 or 416 from static
  // serving for If-Match / Range headers) are the caller's fault. Spec 01 defines
  // only 400/404/500, so they become 400 VALIDATION_ERROR and are not logged.
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
    return { statusCode: 400, body: errorEnvelope('VALIDATION_ERROR', CLIENT_REQUEST_MESSAGE) };
  }

  return { statusCode: 500, body: errorEnvelope('INTERNAL_ERROR', INTERNAL_MESSAGE) };
}
