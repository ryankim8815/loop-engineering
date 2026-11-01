// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { flush, mountApp, type Todo } from './helpers/dom.ts';

// DOM tests for public/app.js against public/index.html, with a fake API (see helpers/dom.ts).

function listTitles(document: Document): string[] {
  return [...document.querySelectorAll('#todo-list > li')].map((li) => li.textContent ?? '');
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
