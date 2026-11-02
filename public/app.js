// UI controller (spec 02). `startApp` wires the DOM to the API client. It has no side
// effects on import: the caller passes the document, window and api, so tests can drive it
// with a DOM harness and a fake fetch. The pure rules (title validation, filtering) come
// from state.js. Each action re-renders the whole list from the in-memory copy of server state.

import { ApiError } from './api.js';
import {
  countRemaining,
  filterTodos,
  parseFilterFromHash,
  resolveEdit,
  validateTitle,
} from './state.js';

/**
 * @typedef {import('./state.js').Todo} Todo
 * @typedef {import('./state.js').Filter} Filter
 * @typedef {ReturnType<typeof import('./api.js').createApi>} Api
 */

const NETWORK_ERROR_MESSAGE = '서버에 연결할 수 없습니다. 연결을 확인해 주세요.';

/**
 * Puts `todo` into `list` by id: it replaces the entry with the same id, or appends it when
 * that id is not there yet. A create can resolve after a resync already fetched the new todo
 * (R9), so appending blindly would show the same todo twice.
 *
 * @param {Todo[]} list
 * @param {Todo} todo
 * @returns {Todo[]}
 */
function upsertTodo(list, todo) {
  return list.some((t) => t.id === todo.id)
    ? list.map((t) => (t.id === todo.id ? todo : t))
    : [...list, todo];
}

/**
 * Replaces the todo with the same id by the server copy `updated`, unless the local copy is
 * newer. Two PATCHes for one item can be answered in either order, so an older response that
 * arrives last must not overwrite a newer one (R10). The server's updatedAt strictly increases
 * on every change (spec 01), so comparing it tells the two copies apart.
 *
 * @param {Todo[]} list
 * @param {Todo} updated
 * @returns {Todo[]}
 */
function mergeUpdated(list, updated) {
  return list.map((t) =>
    t.id === updated.id && Date.parse(updated.updatedAt) >= Date.parse(t.updatedAt) ? updated : t,
  );
}

/**
 * The message for the error banner. An ApiError carries the spec 01 envelope message.
 * Anything else is a failed fetch (network down), since the API client does not wrap it.
 *
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
  return error instanceof ApiError ? error.message : NETWORK_ERROR_MESSAGE;
}

/**
 * @param {{ document: Document, window: Window, api: Api }} deps
 * @returns {Promise<void>} resolves once the initial list has been rendered
 */
export function startApp({ document, window, api }) {
  const input = /** @type {HTMLInputElement} */ (document.getElementById('new-title'));
  const addButton = /** @type {HTMLButtonElement} */ (document.getElementById('add-button'));
  const hint = /** @type {HTMLElement} */ (document.getElementById('new-title-hint'));
  const list = /** @type {HTMLUListElement} */ (document.getElementById('todo-list'));
  const remaining = /** @type {HTMLElement} */ (document.getElementById('remaining-count'));
  const clearButton = /** @type {HTMLButtonElement} */ (document.getElementById('clear-completed'));
  const filterLinks = /** @type {HTMLAnchorElement[]} */ ([
    ...document.querySelectorAll('.filters a'),
  ]);
  const banner = /** @type {HTMLElement} */ (document.getElementById('error-banner'));

  /** @type {Todo[]} */
  let todos = [];

  // Counts local changes the server has accepted. A list response that started before the
  // latest change may not include it, so it is fetched again rather than trusted (R5).
  let changes = 0;

  /** @param {Todo[]} next */
  function commitTodos(next) {
    todos = next;
    changes += 1;
    render();
  }

  // Replaces local state with a fresh list. If a change landed while the request was in
  // flight, the response may be older than that change, so the list is requested again.
  // Each retry starts after a change, so the loop ends once the user stops changing things.
  // Errors propagate to the caller.
  async function loadList() {
    let started;
    let loaded;
    do {
      started = changes;
      loaded = await api.list('all');
    } while (started !== changes);
    todos = loaded;
    render();
  }

  function showError(message) {
    banner.textContent = message;
    banner.hidden = false;
  }

  function clearError() {
    banner.textContent = '';
    banner.hidden = true;
  }

  // Every API action goes through here (AC-UI-8). Local state changes only after the server
  // accepted the request. On failure the list is re-rendered from local state, which undoes
  // an optimistic checkbox flip, then the message is shown and the list is re-fetched, so the
  // DOM matches the server again. The returned promise never rejects, so no call site leaks an
  // unhandled rejection.
  async function perform(action) {
    try {
      await action();
      clearError();
    } catch (error) {
      render();
      showError(errorMessage(error));
      await resync();
    }
  }

  async function resync() {
    try {
      await loadList();
    } catch (error) {
      // The re-fetch itself failed (for example, the server is down). Keep the local state
      // and report the new error. Do not retry, so a dead server does not cause a loop.
      showError(errorMessage(error));
    }
  }
  // The full list is kept in memory and filtered locally, so switching filters never
  // needs a request. The initial filter comes from the URL hash (AC-UI-6).
  /** @type {Filter} */
  let filter = parseFilterFromHash(window.location.hash);

  function render() {
    list.replaceChildren(...filterTodos(todos, filter).map(renderItem));
    remaining.textContent = `${countRemaining(todos)}개 남음`;
    renderFilterLinks();
  }

  function renderFilterLinks() {
    for (const link of filterLinks) {
      const selected = parseFilterFromHash(link.getAttribute('href') ?? '') === filter;
      link.classList.toggle('selected', selected);
      if (selected) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    }
  }

  function applyHash() {
    filter = parseFilterFromHash(window.location.hash);
    render();
  }

  /**
   * @param {Todo} todo
   * @returns {HTMLLIElement}
   */
  function renderItem(todo) {
    const item = document.createElement('li');
    item.dataset.id = todo.id;
    item.classList.toggle('completed', todo.completed);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'todo-toggle';
    checkbox.checked = todo.completed;
    checkbox.setAttribute('aria-label', `완료: ${todo.title}`);
    checkbox.addEventListener('change', () => {
      setCompleted(todo.id, checkbox.checked);
    });

    const title = document.createElement('span');
    title.className = 'todo-title';
    title.textContent = todo.title;
    title.addEventListener('dblclick', () => {
      startEdit(todo.id);
    });

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'todo-edit-button';
    edit.textContent = '수정';
    edit.setAttribute('aria-label', `수정: ${todo.title}`);
    edit.addEventListener('click', () => {
      startEdit(todo.id);
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'todo-delete';
    remove.textContent = '삭제';
    remove.setAttribute('aria-label', `삭제: ${todo.title}`);
    remove.addEventListener('click', () => {
      removeTodo(todo.id);
    });

    item.append(checkbox, title, edit, remove);
    return item;
  }

  // Replaces the title with an edit input (AC-UI-7). Enter commits, Esc and blur cancel.
  // `finished` makes the first outcome win. Removing the editor can fire a blur, and that
  // blur must not cancel or send a second action after Enter/Esc already did.
  // The item is looked up by id, not captured, because an earlier blur may have re-rendered
  // the list before this runs (for example, a double-click on a different item).
  function startEdit(id) {
    const todo = todos.find((t) => t.id === id);
    const item = [...list.children].find((li) => li.dataset.id === id);
    const titleSpan = item?.querySelector('.todo-title');
    if (!todo || !titleSpan) {
      return;
    }

    const editor = document.createElement('input');
    editor.type = 'text';
    editor.className = 'todo-edit';
    editor.value = todo.title;
    editor.setAttribute('aria-label', `제목 수정: ${todo.title}`);
    let finished = false;

    function cancel() {
      if (finished) return;
      finished = true;
      render();
    }

    async function commit() {
      if (finished) return;
      finished = true;
      const result = resolveEdit(todo.title, editor.value);
      if (result.action === 'cancel') {
        render();
        return;
      }
      await perform(async () => {
        const updated = await api.update(todo.id, { title: result.value });
        commitTodos(mergeUpdated(todos, updated));
      });
    }

    editor.addEventListener('keydown', (event) => {
      // Enter during IME composition confirms a syllable; it must not commit (as in add).
      if (event.isComposing) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    });
    editor.addEventListener('blur', cancel);

    titleSpan.replaceWith(editor);
    editor.focus();
    editor.select();
  }

  // Waits for the server before changing local state, so the list always mirrors what
  // the server accepted. Local state is replaced by the server's copy (its updatedAt).
  function setCompleted(id, completed) {
    return perform(async () => {
      const updated = await api.update(id, { completed });
      commitTodos(mergeUpdated(todos, updated));
    });
  }

  function removeTodo(id) {
    return perform(async () => {
      await api.remove(id);
      commitTodos(todos.filter((todo) => todo.id !== id));
    });
  }

  function clearCompleted() {
    return perform(async () => {
      await api.clearCompleted();
      commitTodos(todos.filter((todo) => !todo.completed));
    });
  }

  // True while a create is in flight. The input is cleared only after the POST resolves, so
  // without this flag a second click or Enter would send the same title again (R8).
  let adding = false;

  async function submit() {
    if (adding) return;
    const result = validateTitle(input.value);
    if (!result.ok) {
      hint.textContent = result.message;
      return;
    }
    // On failure the typed title stays in the input, so the user can retry.
    adding = true;
    try {
      await perform(async () => {
        const created = await api.create(result.value);
        commitTodos(upsertTodo(todos, created));
        input.value = '';
        hint.textContent = '';
      });
    } finally {
      adding = false;
    }
  }

  input.addEventListener('keydown', (event) => {
    // Enter during IME composition (Korean input) confirms a syllable; it must not submit.
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      submit();
    }
  });

  addButton.addEventListener('click', () => {
    submit();
  });

  clearButton.addEventListener('click', () => {
    clearCompleted();
  });

  for (const link of filterLinks) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      window.location.hash = link.getAttribute('href') ?? '#/';
      // Apply now too: a hash change may not fire a hashchange event in every environment,
      // and applying twice is harmless.
      applyHash();
    });
  }

  // Back/forward and manually edited hashes also change the filter.
  window.addEventListener('hashchange', applyHash);

  // A failed first load shows the banner and leaves the list empty. It is not retried here.
  return loadList().catch((error) => {
    showError(errorMessage(error));
  });
}
