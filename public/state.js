// Pure UI state logic (spec 02, AC-UI-3). No DOM access, no fetch, no globals, so
// it runs unchanged under node tests. The title rule mirrors src/validation.ts
// (parseTitle); keep the two in step. tests/ui.state.test.ts checks the parity.

/**
 * @typedef {'all' | 'active' | 'completed'} Filter
 * @typedef {{ id: string, title: string, completed: boolean }} Todo
 * @typedef {{ ok: true, value: string } | { ok: false, message: string }} TitleResult
 * @typedef {{ action: 'save', value: string } | { action: 'cancel' }} EditResult
 */

export const TITLE_MAX_CODE_POINTS = 200;

/**
 * Returns the todos that match the filter, in their original order. The input
 * array is never mutated. Unknown filters behave like `all`.
 *
 * @param {readonly Todo[]} todos
 * @param {Filter} filter
 * @returns {Todo[]}
 */
export function filterTodos(todos, filter) {
  if (filter === 'active') {
    return todos.filter((todo) => !todo.completed);
  }
  if (filter === 'completed') {
    return todos.filter((todo) => todo.completed);
  }
  return todos.slice();
}

/**
 * Number of items not yet completed (the "남은 개수" counter).
 *
 * @param {readonly Todo[]} todos
 * @returns {number}
 */
export function countRemaining(todos) {
  return todos.filter((todo) => !todo.completed).length;
}

/**
 * Trims the raw title, then checks it. Length counts code points (not UTF-16
 * units), so one emoji is one character, matching the server (AC-API-11).
 *
 * @param {unknown} raw
 * @returns {TitleResult}
 */
export function validateTitle(raw) {
  if (typeof raw !== 'string') {
    return { ok: false, message: '제목은 문자열이어야 합니다.' };
  }
  const trimmed = raw.trim();
  const length = [...trimmed].length;
  if (length === 0) {
    return { ok: false, message: '제목을 입력하세요.' };
  }
  if (length > TITLE_MAX_CODE_POINTS) {
    return { ok: false, message: `제목은 ${TITLE_MAX_CODE_POINTS}자 이하여야 합니다.` };
  }
  return { ok: true, value: trimmed };
}

/**
 * Maps the URL hash to a filter. Only `#/active` and `#/completed` select a
 * filter. Anything else (including an empty hash) shows all items.
 *
 * @param {string} hash
 * @returns {Filter}
 */
export function parseFilterFromHash(hash) {
  if (hash === '#/active') {
    return 'active';
  }
  if (hash === '#/completed') {
    return 'completed';
  }
  return 'all';
}

/**
 * Decides what an inline edit does on commit. Empty or whitespace-only input and
 * an unchanged title both cancel, so no PATCH is sent (AC-UI-7).
 *
 * @param {string} original
 * @param {string} raw
 * @returns {EditResult}
 */
export function resolveEdit(original, raw) {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === original) {
    return { action: 'cancel' };
  }
  return { action: 'save', value: trimmed };
}
