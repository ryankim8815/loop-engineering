// UI controller (spec 02). `startApp` wires the DOM to the API client. It has no side
// effects on import: the caller passes the document and the api, so tests can drive it
// with a DOM harness and a fake fetch. The pure rules (title validation) come from state.js.
// Each action re-renders the whole list from the in-memory copy of server state.

import { countRemaining, validateTitle } from './state.js';

/**
 * @typedef {import('./state.js').Todo} Todo
 * @typedef {ReturnType<typeof import('./api.js').createApi>} Api
 */

/**
 * @param {{ document: Document, api: Api }} deps
 * @returns {Promise<void>} resolves once the initial list has been rendered
 */
export function startApp({ document, api }) {
  const input = /** @type {HTMLInputElement} */ (document.getElementById('new-title'));
  const addButton = /** @type {HTMLButtonElement} */ (document.getElementById('add-button'));
  const hint = /** @type {HTMLElement} */ (document.getElementById('new-title-hint'));
  const list = /** @type {HTMLUListElement} */ (document.getElementById('todo-list'));
  const remaining = /** @type {HTMLElement} */ (document.getElementById('remaining-count'));

  /** @type {Todo[]} */
  let todos = [];

  function render() {
    list.replaceChildren(...todos.map(renderItem));
    remaining.textContent = `${countRemaining(todos)}개 남음`;
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

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'todo-delete';
    remove.textContent = '삭제';
    remove.setAttribute('aria-label', `삭제: ${todo.title}`);
    remove.addEventListener('click', () => {
      removeTodo(todo.id);
    });

    item.append(checkbox, title, remove);
    return item;
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

  return api.list('all').then((loaded) => {
    todos = loaded;
    render();
  });
}
