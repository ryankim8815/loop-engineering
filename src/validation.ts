// Single source of truth for request validation (spec 01). Pure functions: they
// take untrusted input and return a typed value or throw a VALIDATION_ERROR
// AppError. The same 1–200 code-point rule is mirrored in public/state.js for
// the browser; keep the two in step.

import { validationError } from './errors.ts';
import type { TodoFilter } from './todo-repository.ts';

export const TITLE_MAX_CODE_POINTS = 200;

const FILTERS: readonly TodoFilter[] = ['all', 'active', 'completed'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreateBody {
  title: string;
}

export interface PatchBody {
  title?: string;
  completed?: boolean;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Trims, then counts code points (not UTF-16 units) so one emoji counts as one character.
export function parseTitle(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw validationError('제목은 문자열이어야 합니다.');
  }
  const trimmed = raw.trim();
  const length = [...trimmed].length;
  if (length === 0) {
    throw validationError('제목을 입력하세요.');
  }
  if (length > TITLE_MAX_CODE_POINTS) {
    throw validationError(`제목은 ${TITLE_MAX_CODE_POINTS}자 이하여야 합니다.`);
  }
  return trimmed;
}

function assertOnlyKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      throw validationError(`알 수 없는 필드입니다: ${key}`);
    }
  }
}

// Body for POST /api/todos: exactly `{ title }`.
export function parseCreateBody(body: unknown): CreateBody {
  if (!isPlainObject(body)) {
    throw validationError('요청 본문은 JSON 객체여야 합니다.');
  }
  assertOnlyKeys(body, ['title']);
  return { title: parseTitle(body.title) };
}

// Body for PATCH /api/todos/:id: at least one of `title` / `completed`.
// An empty object is rejected so a no-op PATCH cannot bump `updatedAt` (AC-API-9).
export function parsePatchBody(body: unknown): PatchBody {
  if (!isPlainObject(body)) {
    throw validationError('요청 본문은 JSON 객체여야 합니다.');
  }
  assertOnlyKeys(body, ['title', 'completed']);

  const patch: PatchBody = {};
  if (Object.hasOwn(body, 'title')) {
    patch.title = parseTitle(body.title);
  }
  if (Object.hasOwn(body, 'completed')) {
    if (typeof body.completed !== 'boolean') {
      throw validationError('completed는 true 또는 false여야 합니다.');
    }
    patch.completed = body.completed;
  }
  if (Object.keys(patch).length === 0) {
    throw validationError('수정할 필드(title 또는 completed)가 필요합니다.');
  }
  return patch;
}

// `filter` defaults to `all`. Other query keys are ignored (spec 01: queries
// ignore unknown params; only the bodies are strict).
export function parseFilter(query: Record<string, unknown>): TodoFilter {
  const raw = query.filter;
  if (raw === undefined) {
    return 'all';
  }
  if (typeof raw === 'string' && (FILTERS as readonly string[]).includes(raw)) {
    return raw as TodoFilter;
  }
  throw validationError('filter는 all, active, completed 중 하나여야 합니다.');
}

// Bulk delete is only allowed with `?completed=true`. Anything else (no query,
// `completed=false`, repeated params) is refused so a bare DELETE can't wipe the list.
export function parseBulkDeleteQuery(query: Record<string, unknown>): { completed: true } {
  if (query.completed !== 'true') {
    throw validationError('일괄 삭제는 completed=true 쿼리가 있어야 합니다.');
  }
  return { completed: true };
}

// Non-UUID ids are treated as "not found" by the routes (spec 01), not as validation errors.
export function isUuid(id: string): boolean {
  return UUID_PATTERN.test(id);
}
