// UI controller (spec 02). `startApp` wires the DOM to the API client. It has no side
// effects on import: the caller passes the document, window and api, so tests can drive it
// with a DOM harness and a fake fetch. The pure rules (title validation, filtering) come
// from state.js. Each action re-renders the whole list from the in-memory copy of server state.

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

  /** @type {Todo[]} */
  let todos = [];
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
      const updated = await api.update(todo.id, { title: result.value });
      todos = todos.map((t) => (t.id === updated.id ? updated : t));
      render();
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
  async function setCompleted(id, completed) {
    const updated = await api.update(id, { completed });
    todos = todos.map((todo) => (todo.id === updated.id ? updated : todo));
    render();
  }

  async function removeTodo(id) {
    await api.remove(id);
    todos = todos.filter((todo) => todo.id !== id);
    render();
  }

  async function clearCompleted() {
    await api.clearCompleted();
    todos = todos.filter((todo) => !todo.completed);
    render();
  }

  async function submit() {
    const result = validateTitle(input.value);
    if (!result.ok) {
      hint.textContent = result.message;
      return;
    }
    const created = await api.create(result.value);
    todos = [...todos, created];
    input.value = '';
    hint.textContent = '';
    render();
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

  return api.list('all').then((loaded) => {
    todos = loaded;
    render();
  });
}
