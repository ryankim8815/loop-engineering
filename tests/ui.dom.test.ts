// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flush, mountApp, type Todo } from './helpers/dom.ts';

// DOM tests for public/app.js against public/index.html, with a fake API (see helpers/dom.ts).

// Reads the title span, not li.textContent, because each item also holds a checkbox and a
// delete button whose text must not count as part of the title.
function listTitles(document: Document): string[] {
  return [...document.querySelectorAll('#todo-list > li .todo-title')].map(
    (span) => span.textContent ?? '',
  );
}

function itemFor(document: Document, title: string): HTMLLIElement {
  const item = [...document.querySelectorAll<HTMLLIElement>('#todo-list > li')].find(
    (li) => li.querySelector('.todo-title')?.textContent === title,
  );
  if (!item) throw new Error(`no item titled "${title}"`);
  return item;
}

function remainingText(document: Document): string {
  return document.querySelector('#remaining-count')?.textContent ?? '';
}

function writes(requests: { method: string }[]) {
  return requests.filter((request) => request.method !== 'GET');
}

const existing: Todo = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'existing',
  completed: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('initial render', () => {
  it('renders the server list in order when the page starts', async () => {
    const { document, server } = await mountApp([existing]);

    expect(listTitles(document)).toEqual(['existing']);
    expect(server.requests).toEqual([
      { method: 'GET', url: '/api/todos?filter=all', body: undefined },
    ]);
  });
});

describe('AC-UI-4: add a todo', () => {
  it('Enter sends one POST with the trimmed title, appends the item last, and clears the input', async () => {
    const { document, server } = await mountApp([existing]);
    const input = document.querySelector<HTMLInputElement>('#new-title');
    if (!input) throw new Error('#new-title missing');

    input.value = '  buy milk  ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flush();

    expect(writes(server.requests)).toEqual([
      { method: 'POST', url: '/api/todos', body: { title: 'buy milk' } },
    ]);
    expect(listTitles(document)).toEqual(['existing', 'buy milk']);
    expect(input.value).toBe('');
  });

  it('Enter with an empty or whitespace-only title sends nothing and shows the hint', async () => {
    const { document, server } = await mountApp();
    const input = document.querySelector<HTMLInputElement>('#new-title');
    const hint = document.querySelector<HTMLElement>('#new-title-hint');
    if (!input || !hint) throw new Error('#new-title or #new-title-hint missing');

    for (const raw of ['', '   ']) {
      input.value = raw;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await flush();
    }

    expect(writes(server.requests)).toEqual([]);
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toBe('제목을 입력하세요.');
  });

  it('clicking 추가 behaves like Enter: one POST, appended, input cleared', async () => {
    const { document, server } = await mountApp();
    const input = document.querySelector<HTMLInputElement>('#new-title');
    const button = document.querySelector<HTMLButtonElement>('#add-button');
    if (!input || !button) throw new Error('#new-title or #add-button missing');

    input.value = 'walk dog';
    button.click();
    await flush();

    expect(writes(server.requests)).toEqual([
      { method: 'POST', url: '/api/todos', body: { title: 'walk dog' } },
    ]);
    expect(listTitles(document)).toEqual(['walk dog']);
    expect(input.value).toBe('');
  });

  it('Enter while an IME composition is open (Korean input) does not submit', async () => {
    const { document, server } = await mountApp();
    const input = document.querySelector<HTMLInputElement>('#new-title');
    if (!input) throw new Error('#new-title missing');

    input.value = '우유';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }));
    await flush();

    expect(writes(server.requests)).toEqual([]);
    expect(input.value).toBe('우유');
  });
});

const done: Todo = {
  id: '22222222-2222-4222-8222-222222222222',
  title: 'done',
  completed: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('AC-UI-5: toggle, delete, and the remaining counter', () => {
  it('shows the remaining count (not completed items) on load', async () => {
    const { document } = await mountApp([existing, done]);

    expect(remainingText(document)).toBe('1개 남음');
  });

  it('toggling the checkbox sends PATCH {completed}, flips the completed class, and updates the counter', async () => {
    const { document, server } = await mountApp([existing, done]);
    const checkbox = itemFor(document, 'existing').querySelector<HTMLInputElement>('.todo-toggle');
    if (!checkbox) throw new Error('.todo-toggle missing');

    checkbox.click();
    await flush();

    expect(writes(server.requests)).toEqual([
      { method: 'PATCH', url: `/api/todos/${existing.id}`, body: { completed: true } },
    ]);
    expect(itemFor(document, 'existing').classList.contains('completed')).toBe(true);
    expect(
      itemFor(document, 'existing').querySelector<HTMLInputElement>('.todo-toggle')?.checked,
    ).toBe(true);
    expect(remainingText(document)).toBe('0개 남음');

    itemFor(document, 'existing').querySelector<HTMLInputElement>('.todo-toggle')?.click();
    await flush();

    expect(writes(server.requests).at(-1)).toEqual({
      method: 'PATCH',
      url: `/api/todos/${existing.id}`,
      body: { completed: false },
    });
    expect(itemFor(document, 'existing').classList.contains('completed')).toBe(false);
    expect(remainingText(document)).toBe('1개 남음');
  });

  it('the delete button sends DELETE, removes the item, and updates the counter', async () => {
    const { document, server } = await mountApp([existing, done]);
    const remove = itemFor(document, 'existing').querySelector<HTMLButtonElement>('.todo-delete');
    if (!remove) throw new Error('.todo-delete missing');

    remove.click();
    await flush();

    expect(writes(server.requests)).toEqual([
      { method: 'DELETE', url: `/api/todos/${existing.id}`, body: undefined },
    ]);
    expect(listTitles(document)).toEqual(['done']);
    expect(remainingText(document)).toBe('0개 남음');
  });
});

describe('AC-UI-6: filters follow the URL hash', () => {
  // The hash is shared window state, so each test starts from the "all" view.
  afterEach(() => {
    window.location.hash = '';
  });

  function filterLink(document: Document, href: string): HTMLAnchorElement {
    const link = document.querySelector<HTMLAnchorElement>(`.filters a[href="${href}"]`);
    if (!link) throw new Error(`filter link ${href} missing`);
    return link;
  }

  it('clicking the 진행 중 filter sets the hash to #/active and shows only active items', async () => {
    const { document, server } = await mountApp([existing, done]);

    filterLink(document, '#/active').click();
    await flush();

    expect(window.location.hash).toBe('#/active');
    expect(listTitles(document)).toEqual(['existing']);
    expect(filterLink(document, '#/active').getAttribute('aria-current')).toBe('page');
    expect(filterLink(document, '#/active').classList.contains('selected')).toBe(true);
    expect(filterLink(document, '#/').hasAttribute('aria-current')).toBe(false);
    // Filtering is local, so switching filters sends no request.
    expect(server.requests).toEqual([
      { method: 'GET', url: '/api/todos?filter=all', body: undefined },
    ]);
  });

  it('opening the page with #/completed applies the completed filter from the first render', async () => {
    window.location.hash = '#/completed';
    const { document } = await mountApp([existing, done]);

    expect(listTitles(document)).toEqual(['done']);
    expect(filterLink(document, '#/completed').getAttribute('aria-current')).toBe('page');
    expect(filterLink(document, '#/').hasAttribute('aria-current')).toBe(false);
  });

  it('a hashchange (back/forward or a typed hash) updates the visible filter', async () => {
    const { document } = await mountApp([existing, done]);

    window.location.hash = '#/completed';
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    expect(listTitles(document)).toEqual(['done']);
    expect(filterLink(document, '#/completed').getAttribute('aria-current')).toBe('page');
  });
});

describe('AC-UI-7: inline edit', () => {
  function titleSpan(document: Document, title: string): HTMLElement {
    const span = itemFor(document, title).querySelector<HTMLElement>('.todo-title');
    if (!span) throw new Error(`no title span for "${title}"`);
    return span;
  }

  function editorIn(document: Document): HTMLInputElement {
    const editor = document.querySelector<HTMLInputElement>('#todo-list .todo-edit');
    if (!editor) throw new Error('no inline editor open');
    return editor;
  }

  it('double-clicking a title opens a focused editor prefilled with the title', async () => {
    const { document, server } = await mountApp([existing]);

    titleSpan(document, 'existing').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    const editor = editorIn(document);
    expect(editor.value).toBe('existing');
    expect(document.activeElement).toBe(editor);
    expect(writes(server.requests)).toEqual([]);
  });

  it('the 수정 button opens the same editor (keyboard path)', async () => {
    const { document, server } = await mountApp([existing]);
    const edit = document.querySelector<HTMLButtonElement>('button[aria-label="수정: existing"]');
    if (!edit) throw new Error('수정 button missing');

    edit.click();

    expect(editorIn(document).value).toBe('existing');
    expect(writes(server.requests)).toEqual([]);
  });

  it('Enter sends one PATCH {title} with the trimmed value and shows the new title', async () => {
    const { document, server } = await mountApp([existing]);
    titleSpan(document, 'existing').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    const editor = editorIn(document);
    editor.value = '  renamed  ';
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flush();

    expect(writes(server.requests)).toEqual([
      { method: 'PATCH', url: `/api/todos/${existing.id}`, body: { title: 'renamed' } },
    ]);
    expect(listTitles(document)).toEqual(['renamed']);
    expect(document.querySelector('#todo-list .todo-edit')).toBeNull();
  });

  it('Esc sends nothing and restores the original title', async () => {
    const { document, server } = await mountApp([existing]);
    titleSpan(document, 'existing').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    const editor = editorIn(document);
    editor.value = 'changed';
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flush();

    expect(writes(server.requests)).toEqual([]);
    expect(listTitles(document)).toEqual(['existing']);
    expect(document.querySelector('#todo-list .todo-edit')).toBeNull();
  });

  it('Enter with an empty or whitespace-only value sends nothing and restores the title', async () => {
    const { document, server } = await mountApp([existing]);

    for (const raw of ['', '   ']) {
      titleSpan(document, 'existing').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      const editor = editorIn(document);
      editor.value = raw;
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await flush();
    }

    expect(writes(server.requests)).toEqual([]);
    expect(listTitles(document)).toEqual(['existing']);
  });

  it('Enter with an unchanged title sends nothing', async () => {
    const { document, server } = await mountApp([existing]);
    titleSpan(document, 'existing').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    editorIn(document).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flush();

    expect(writes(server.requests)).toEqual([]);
    expect(listTitles(document)).toEqual(['existing']);
  });

  it('blur cancels: no request, original title restored', async () => {
    const { document, server } = await mountApp([existing]);
    titleSpan(document, 'existing').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    const editor = editorIn(document);
    editor.value = 'changed';
    editor.dispatchEvent(new FocusEvent('blur'));
    await flush();

    expect(writes(server.requests)).toEqual([]);
    expect(listTitles(document)).toEqual(['existing']);
  });

  it('Enter then the blur from the editor removal sends only one PATCH', async () => {
    const { document, server } = await mountApp([existing]);
    titleSpan(document, 'existing').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    const editor = editorIn(document);
    editor.value = 'renamed';
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    // The editor is removed when the list re-renders; a blur fired then must do nothing.
    editor.dispatchEvent(new FocusEvent('blur'));
    await flush();

    expect(writes(server.requests)).toHaveLength(1);
    expect(listTitles(document)).toEqual(['renamed']);
  });

  it('Esc then the blur from the editor removal sends nothing extra', async () => {
    const { document, server } = await mountApp([existing]);
    titleSpan(document, 'existing').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    const editor = editorIn(document);
    editor.value = 'changed';
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    editor.dispatchEvent(new FocusEvent('blur'));
    await flush();

    expect(writes(server.requests)).toEqual([]);
    expect(listTitles(document)).toEqual(['existing']);
  });

  it('Enter during IME composition does not commit the edit', async () => {
    const { document, server } = await mountApp([existing]);
    titleSpan(document, 'existing').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    const editor = editorIn(document);
    editor.value = '우유';
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }));
    await flush();

    expect(writes(server.requests)).toEqual([]);
    expect(editorIn(document).value).toBe('우유');
  });
});

describe('clear completed', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('sends DELETE ?completed=true, removes completed items, and updates the counter', async () => {
    const { document, server } = await mountApp([existing, done]);
    const button = document.querySelector<HTMLButtonElement>('#clear-completed');
    if (!button) throw new Error('#clear-completed missing');

    button.click();
    await flush();

    expect(writes(server.requests)).toEqual([
      { method: 'DELETE', url: '/api/todos?completed=true', body: undefined },
    ]);
    expect(listTitles(document)).toEqual(['existing']);
    expect(remainingText(document)).toBe('1개 남음');
  });
});
