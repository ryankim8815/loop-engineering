// UI controller (spec 02). `startApp` wires the DOM to the API client. It has no side
// effects on import: the caller passes the document and the api, so tests can drive it
// with a DOM harness and a fake fetch. The pure rules (title validation) come from state.js.
// Each action re-renders the whole list from the in-memory copy of server state.

import { validateTitle } from './state.js';

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

  /** @type {Todo[]} */
  let todos = [];

  function render() {
    list.replaceChildren(...todos.map(renderItem));
  }

  /**
   * @param {Todo} todo
   * @returns {HTMLLIElement}
   */
  function renderItem(todo) {
    const item = document.createElement('li');
    item.dataset.id = todo.id;
    const title = document.createElement('span');
    title.className = 'todo-title';
    title.textContent = todo.title;
    item.append(title);
    return item;
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
