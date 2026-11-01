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
      todos = await api.list('all');
      render();
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
        todos = todos.map((t) => (t.id === updated.id ? updated : t));
        render();
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
      todos = todos.map((todo) => (todo.id === updated.id ? updated : todo));
      render();
    });
  }

  function removeTodo(id) {
    return perform(async () => {
      await api.remove(id);
      todos = todos.filter((todo) => todo.id !== id);
      render();
    });
  }

  function clearCompleted() {
    return perform(async () => {
      await api.clearCompleted();
      todos = todos.filter((todo) => !todo.completed);
      render();
    });
  }

  async function submit() {
    const result = validateTitle(input.value);
    if (!result.ok) {
      hint.textContent = result.message;
      return;
    }
    // On failure the typed title stays in the input, so the user can retry.
    await perform(async () => {
      const created = await api.create(result.value);
      todos = [...todos, created];
      input.value = '';
      hint.textContent = '';
      render();
    });
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
  return api.list('all').then(
    (loaded) => {
      todos = loaded;
      render();
    },
    (error) => {
      showError(errorMessage(error));
    },
  );
}
