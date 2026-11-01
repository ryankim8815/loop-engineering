// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
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
