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

  // The open inline edit (AC-UI-7), kept here rather than in the DOM, so that any re-render
  // rebuilds the editor with the same draft. `element` is the editor that is currently shown.
  // `null` means no edit is open. Another item's response must not end an edit (R11).
  /** @type {{ id: string, title: string, draft: string, element?: HTMLInputElement } | null} */
  let editing = null;

  // True only while render() replaces the list. Removing the focused editor can fire blur,
  // and that blur is not the user leaving the editor, so it must not cancel the edit.
  let rendering = false;

  // Ids whose DELETE is in flight (R16). A second click on 삭제 must not send a second DELETE,
  // and a toggle or edit of the same item would only get a 404 for the item already removed.
  /** @type {Set<string>} */
  const deleting = new Set();

  // Counts local changes the server has accepted. A list response that started before the
  // latest change may not include it, so it is fetched again rather than trusted (R5).
  let changes = 0;

  // True after a list fetch failed, until one succeeds. The local list may then differ from the
  // server, so the next action the server accepts re-fetches it (R15). A first load that is
  // still pending does not set it, because that load will fetch the list itself.
  let listStale = false;

  // The control that focus should land on after the next render (R18). Set when an edit ends with
  // Enter or Esc, because the editor that had focus is removed. Consumed by the next render().
  /** @type {{ id: string, className: string } | null} */
  let focusTarget = null;

  /** @param {Todo[]} next */
  function commitTodos(next) {
    todos = next;
    changes += 1;
    render();
  }

  // Replaces local state with a fresh list. If a change landed while the request was in
  // flight, the response may be older than that change, so the list is requested again.
  // Each retry starts after a change, so the loop ends once the user stops changing things.
  // Errors propagate to the caller, and mark the list stale (R15).
  async function loadList() {
    let started;
    let loaded;
    try {
      do {
        started = changes;
        loaded = await api.list('all');
      } while (started !== changes);
    } catch (error) {
      listStale = true;
      throw error;
    }
    todos = loaded;
    listStale = false;
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
  // DOM matches the server again. On success the banner clears, and if the list is stale
  // (a list fetch failed earlier), it is re-fetched now that the server has accepted an action
  // (R15). The returned promise never rejects, so no call site leaks an unhandled rejection.
  async function perform(action) {
    try {
      await action();
      clearError();
      if (listStale) {
        await resync();
      }
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
    const visible = filterTodos(todos, filter);
    // An edit whose item is hidden by the filter or gone ends without a request, as a blur
    // would (its item cannot be reached any more).
    const previous = editing?.element;
    const hadFocus = previous !== undefined && document.activeElement === previous;
    const caret = hadFocus ? [previous.selectionStart, previous.selectionEnd] : undefined;
    // Rebuilding the list detaches the focused control, and focus would fall to <body> (R18).
    const control = focusTarget ?? focusedControl();
    // Where the focused item sat before the rebuild. If it leaves the list, focus moves to the
    // item now in that position (R20). -1 when the item was not in the list.
    const oldIndex = control
      ? [...list.children].findIndex(
          (li) => /** @type {HTMLElement} */ (li).dataset.id === control.id,
        )
      : -1;
    focusTarget = null;
    if (editing && !visible.some((todo) => todo.id === editing?.id)) {
      editing = null;
    }
    rendering = true;
    try {
      list.replaceChildren(...visible.map(renderItem));
    } finally {
      rendering = false;
    }
    // Keep the typing position when the editor is rebuilt under the user's cursor.
    if (hadFocus && editing?.element && caret) {
      editing.element.focus();
      editing.element.setSelectionRange(caret[0], caret[1]);
    } else if (control) {
      focusControl(control, oldIndex);
    }
    remaining.textContent = `${countRemaining(todos)}개 남음`;
    renderFilterLinks();
  }

  // The per-item controls that keep keyboard focus across a re-render (R18).
  const CONTROL_CLASSES = ['todo-toggle', 'todo-edit-button', 'todo-delete'];

  // The item control that has focus, as its item id and class. null when focus is elsewhere
  // (including inside an inline editor, which is handled separately).
  function focusedControl() {
    const active = document.activeElement;
    const item = /** @type {HTMLElement | null} */ (active?.closest('#todo-list > li') ?? null);
    const className = CONTROL_CLASSES.find((name) => active?.classList.contains(name));
    if (!item?.dataset.id || !className) return null;
    return { id: item.dataset.id, className };
  }

  // Focuses the same control of the same item in the rebuilt list. If the item is no longer
  // shown (deleted or filtered out), focus moves to the same control class on the item now at
  // its old position, else the previous item. An empty list focuses the add input (R20).
  /**
   * @param {{ id: string, className: string }} control
   * @param {number} oldIndex position of the item before the rebuild, or -1
   */
  function focusControl({ id, className }, oldIndex) {
    const items = /** @type {HTMLElement[]} */ ([...list.children]);
    let item = items.find((li) => li.dataset.id === id);
    if (!item) {
      if (items.length === 0) {
        input.focus();
        return;
      }
      if (oldIndex < 0) return;
      item = items[Math.min(oldIndex, items.length - 1)];
    }
    const target = /** @type {HTMLElement | null | undefined} */ (
      item?.querySelector(`.${className}`)
    );
    target?.focus();
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

    const titleNode = editing?.id === todo.id ? createEditor(todo) : renderTitle(todo);
    item.append(checkbox, titleNode, edit, remove);
    return item;
  }

  /**
   * The read-only title span of an item. Double-click opens the inline editor.
   *
   * @param {Todo} todo
   * @returns {HTMLSpanElement}
   */
  function renderTitle(todo) {
    const title = document.createElement('span');
    title.className = 'todo-title';
    title.textContent = todo.title;
    title.addEventListener('dblclick', () => {
      startEdit(todo.id);
    });
    return title;
  }

  // Builds the edit input for `todo` (AC-UI-7). Enter commits, Esc and blur cancel, and each
  // ends the edit with no request when it is not a save. Once the edit has ended, `editing`
  // no longer points at this input, so a later key or blur from it does nothing. That is what
  // stops a blur from removing the editor from sending a second action.
  function createEditor(todo) {
    const editor = document.createElement('input');
    editor.type = 'text';
    editor.className = 'todo-edit';
    editor.value = editing?.draft ?? todo.title;
    editor.setAttribute('aria-label', `제목 수정: ${todo.title}`);
    if (editing) editing.element = editor;

    editor.addEventListener('input', () => {
      if (editing?.element === editor) editing.draft = editor.value;
    });
    editor.addEventListener('keydown', (event) => {
      // Enter during IME composition confirms a syllable; it must not commit (as in add).
      if (event.isComposing || editing?.element !== editor) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        commit(editor);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    });
    editor.addEventListener('blur', () => {
      if (!rendering && editing?.element === editor) cancelOnBlur(editor);
    });
    return editor;
  }

  // Blur cancels the edit (AC-UI-7). The focus usually moved to another list control, and a
  // mousedown on it is still in progress, so the rest of the list must stay in place: only the
  // editor is swapped back for the title (R17). A full render() would detach that control, and
  // the click would be lost. If the item is no longer shown, render() is needed to remove it.
  function cancelOnBlur(editor) {
    const id = editing?.id;
    editing = null;
    const todo = todos.find((t) => t.id === id);
    if (todo && filterTodos(todos, filter).some((t) => t.id === todo.id) && editor.isConnected) {
      editor.replaceWith(renderTitle(todo));
      return;
    }
    render();
  }

  // Opens the edit for `id`. The item is looked up by id at call time, because an earlier
  // blur may have re-rendered the list before a double-click lands.
  function startEdit(id) {
    const todo = todos.find((t) => t.id === id);
    if (deleting.has(id) || !todo || !filterTodos(todos, filter).some((t) => t.id === id)) {
      return;
    }
    editing = { id, title: todo.title, draft: todo.title };
    render();
    editing?.element?.focus();
    editing?.element?.select();
  }

  function cancel() {
    const { id } = editing;
    editing = null;
    focusTarget = { id, className: 'todo-edit-button' };
    render();
  }

  async function commit(editor) {
    const { id, title } = editing;
    editing = null;
    // The editor is removed once the edit ends, so focus goes to the item's 수정 button (R18).
    focusTarget = { id, className: 'todo-edit-button' };
    const result = resolveEdit(title, editor.value);
    if (result.action === 'cancel') {
      render();
      return;
    }
    await perform(async () => {
      const updated = await api.update(id, { title: result.value });
      commitTodos(mergeUpdated(todos, updated));
    });
  }

  // Waits for the server before changing local state, so the list always mirrors what
  // the server accepted. Local state is replaced by the server's copy (its updatedAt).
  // An item whose DELETE is in flight is ignored (R16), so the server's 404 for the item it
  // already removed is not shown as an error.
  function setCompleted(id, completed) {
    if (deleting.has(id)) return;
    return perform(async () => {
      const updated = await api.update(id, { completed });
      commitTodos(mergeUpdated(todos, updated));
    });
  }

  function removeTodo(id) {
    if (deleting.has(id)) return;
    return perform(async () => {
      deleting.add(id);
      try {
        await api.remove(id);
      } finally {
        deleting.delete(id);
      }
      commitTodos(todos.filter((todo) => todo.id !== id));
    });
  }

  // The server decides which items the bulk delete removed (R12). Local completed flags can be
  // stale while a toggle is in flight, so the list is re-fetched instead of filtered locally.
  function clearCompleted() {
    return perform(async () => {
      await api.clearCompleted();
      await loadList();
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
    // The input is cleared only if it still holds what was submitted. Text typed while the
    // POST was in flight belongs to the user, not to this add (R14).
    const submitted = input.value;
    adding = true;
    try {
      await perform(async () => {
        const created = await api.create(result.value);
        commitTodos(upsertTodo(todos, created));
        if (input.value === submitted) {
          input.value = '';
          hint.textContent = '';
        }
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
