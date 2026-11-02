// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createApi } from '../public/api.js';
import { startApp } from '../public/app.js';
import { createFakeServer, flush, loadIndexBody, mountApp, type Todo } from './helpers/dom.ts';

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

  it('AC-UI-8: a failed clear shows the banner and keeps the completed items it could not delete', async () => {
    const { document, server } = await mountApp([existing, done]);
    server.failNext('DELETE', {
      status: 500,
      code: 'INTERNAL_ERROR',
      message: '서버 오류가 발생했습니다.',
    });

    document.querySelector<HTMLButtonElement>('#clear-completed')?.click();
    await flush();

    expect(bannerText(document)).toBe('서버 오류가 발생했습니다.');
    expect(listTitles(document)).toEqual(['existing', 'done']);
  });
});

const elsewhere: Todo = {
  id: '33333333-3333-4333-8333-333333333333',
  title: 'added elsewhere',
  completed: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const NETWORK_MESSAGE = '서버에 연결할 수 없습니다. 연결을 확인해 주세요.';

function bannerText(document: Document): string {
  return document.querySelector('#error-banner')?.textContent ?? '';
}

function bannerShown(document: Document): boolean {
  const banner = document.querySelector<HTMLElement>('#error-banner');
  if (!banner) throw new Error('#error-banner missing');
  return !banner.hidden;
}

describe('AC-UI-8: API errors show a banner and re-sync the list', () => {
  it('a failed toggle shows the envelope message, reverts the checkbox, and re-fetches the list', async () => {
    const { document, server } = await mountApp([existing]);
    // Another client changed the server. The UI only learns about it from the re-fetch.
    server.todos.push(elsewhere);
    server.failNext('PATCH', {
      status: 500,
      code: 'INTERNAL_ERROR',
      message: '서버 오류가 발생했습니다.',
    });

    itemFor(document, 'existing').querySelector<HTMLInputElement>('.todo-toggle')?.click();
    await flush();

    const banner = document.querySelector<HTMLElement>('#error-banner');
    expect(banner?.getAttribute('role')).toBe('alert');
    expect(bannerShown(document)).toBe(true);
    expect(bannerText(document)).toBe('서버 오류가 발생했습니다.');
    expect(server.requests.slice(-2).map((r) => `${r.method} ${r.url}`)).toEqual([
      `PATCH /api/todos/${existing.id}`,
      'GET /api/todos?filter=all',
    ]);
    expect(listTitles(document)).toEqual(['existing', 'added elsewhere']);
    expect(
      itemFor(document, 'existing').querySelector<HTMLInputElement>('.todo-toggle')?.checked,
    ).toBe(false);
  });

  it('a failed add keeps the typed title in the input, appends nothing, and re-fetches the list', async () => {
    const { document, server } = await mountApp([existing]);
    server.failNext('POST', {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: '제목이 올바르지 않습니다.',
    });
    const input = document.querySelector<HTMLInputElement>('#new-title');
    if (!input) throw new Error('#new-title missing');

    input.value = 'buy milk';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flush();

    expect(bannerText(document)).toBe('제목이 올바르지 않습니다.');
    expect(input.value).toBe('buy milk');
    expect(listTitles(document)).toEqual(['existing']);
    expect(server.requests.at(-1)).toEqual({
      method: 'GET',
      url: '/api/todos?filter=all',
      body: undefined,
    });
  });

  it('a failed delete shows the banner and keeps the item the server still has', async () => {
    const { document, server } = await mountApp([existing]);
    server.failNext('DELETE', {
      status: 500,
      code: 'INTERNAL_ERROR',
      message: '서버 오류가 발생했습니다.',
    });

    itemFor(document, 'existing').querySelector<HTMLButtonElement>('.todo-delete')?.click();
    await flush();

    expect(bannerText(document)).toBe('서버 오류가 발생했습니다.');
    expect(listTitles(document)).toEqual(['existing']);
  });

  it('a failed inline edit restores the original title and leaves no editor behind', async () => {
    const { document, server } = await mountApp([existing]);
    server.failNext('PATCH', {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: '제목이 올바르지 않습니다.',
    });
    titleSpan(document, 'existing').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    editorIn(document).value = 'changed';
    editorIn(document).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flush();

    expect(bannerText(document)).toBe('제목이 올바르지 않습니다.');
    expect(document.querySelector('.todo-edit')).toBeNull();
    expect(listTitles(document)).toEqual(['existing']);
  });

  it('a network failure (fetch rejects) shows a connection message and re-fetches the list', async () => {
    const { document, server } = await mountApp([existing]);
    server.failNext('PATCH', 'network');

    itemFor(document, 'existing').querySelector<HTMLInputElement>('.todo-toggle')?.click();
    await flush();

    expect(bannerShown(document)).toBe(true);
    expect(bannerText(document)).toBe(NETWORK_MESSAGE);
    expect(server.requests.at(-1)?.method).toBe('GET');
    expect(listTitles(document)).toEqual(['existing']);
  });

  it('when the re-fetch also fails, the banner shows that error and the local list stays', async () => {
    const { document, server } = await mountApp([existing]);
    server.failNext('PATCH', {
      status: 500,
      code: 'INTERNAL_ERROR',
      message: '서버 오류가 발생했습니다.',
    });
    server.failNext('GET', 'network');

    itemFor(document, 'existing').querySelector<HTMLInputElement>('.todo-toggle')?.click();
    await flush();

    expect(bannerText(document)).toBe(NETWORK_MESSAGE);
    expect(listTitles(document)).toEqual(['existing']);
  });

  it('a failed first load shows the banner and does not throw', async () => {
    const { document } = await mountApp([existing], (server) => {
      server.failNext('GET', {
        status: 500,
        code: 'INTERNAL_ERROR',
        message: '서버 오류가 발생했습니다.',
      });
    });

    expect(bannerShown(document)).toBe(true);
    expect(bannerText(document)).toBe('서버 오류가 발생했습니다.');
    expect(listTitles(document)).toEqual([]);
  });

  it('the banner clears on the next successful action', async () => {
    const { document, server } = await mountApp([existing]);
    server.failNext('POST', {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: '제목이 올바르지 않습니다.',
    });
    const input = document.querySelector<HTMLInputElement>('#new-title');
    const button = document.querySelector<HTMLButtonElement>('#add-button');
    if (!input || !button) throw new Error('#new-title or #add-button missing');

    input.value = 'buy milk';
    button.click();
    await flush();
    expect(bannerShown(document)).toBe(true);

    input.value = 'buy milk';
    button.click();
    await flush();

    expect(bannerShown(document)).toBe(false);
    expect(bannerText(document)).toBe('');
    expect(listTitles(document)).toEqual(['existing', 'buy milk']);
  });
});

describe('a late list response (R5)', () => {
  // The first GET is answered from a snapshot taken before the add, but the response is
  // held. Before the fix that stale list replaced local state when it arrived, so the item
  // the server had just accepted disappeared from the screen until a reload. Now a list that
  // started before the latest change is fetched again instead of being trusted.
  it('R5: a late initial list does not drop an item added while it was in flight', async () => {
    loadIndexBody();
    const server = createFakeServer([]);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let heldFirstList = false;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET' && !heldFirstList) {
        heldFirstList = true;
        const snapshot = await server.fetch(input, init);
        await gate;
        return snapshot;
      }
      return server.fetch(input, init);
    }) as typeof fetch;

    const started = startApp({ document, window, api: createApi(fetchImpl) });
    await settle();

    const input = document.getElementById('new-title') as HTMLInputElement;
    input.value = '우유 사기';
    (document.getElementById('add-button') as HTMLButtonElement).click();
    await settle();
    expect(listTitles(document)).toEqual(['우유 사기']);

    release();
    await started;
    await settle();

    expect(listTitles(document)).toEqual(['우유 사기']);
    expect(remainingText(document)).toBe('1개 남음');
    expect(server.requests.filter((request) => request.method === 'GET')).toHaveLength(2);
  });
});

describe('duplicate add while a create is in flight (R8)', () => {
  // The POST is sent right away and its response is held until release(). Before the fix
  // the input was cleared only after the POST resolved, so a second click or Enter sent the
  // same title again and one user action created two todos.
  function holdFirstPost() {
    loadIndexBody();
    const server = createFakeServer([]);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let heldFirstPost = false;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'POST' && !heldFirstPost) {
        heldFirstPost = true;
        const response = await server.fetch(input, init);
        await gate;
        return response;
      }
      return server.fetch(input, init);
    }) as typeof fetch;
    return { server, fetchImpl, release: () => release() };
  }

  it('R8: a second click on 추가 while the POST is in flight sends no second request', async () => {
    const { server, fetchImpl, release } = holdFirstPost();
    const started = startApp({ document, window, api: createApi(fetchImpl) });
    await settle();

    const input = document.getElementById('new-title') as HTMLInputElement;
    const add = document.getElementById('add-button') as HTMLButtonElement;
    input.value = '우유 사기';
    add.click();
    add.click();
    await settle();

    expect(writes(server.requests)).toHaveLength(1);
    release();
    await started;
    await settle();

    expect(listTitles(document)).toEqual(['우유 사기']);
    expect(input.value).toBe('');
  });

  it('R8: pressing Enter again while the POST is in flight sends no second request', async () => {
    const { server, fetchImpl, release } = holdFirstPost();
    const started = startApp({ document, window, api: createApi(fetchImpl) });
    await settle();

    const input = document.getElementById('new-title') as HTMLInputElement;
    input.value = '우유 사기';
    const enter = () =>
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    enter();
    enter();
    await settle();

    expect(writes(server.requests)).toHaveLength(1);
    release();
    await started;
    await settle();

    expect(listTitles(document)).toEqual(['우유 사기']);
  });

  it('R8: the guard is released after a failed add, so a retry is sent', async () => {
    loadIndexBody();
    const server = createFakeServer([]);
    server.failNext('POST', {
      status: 500,
      code: 'INTERNAL_ERROR',
      message: '서버 오류가 발생했습니다.',
    });
    await startApp({ document, window, api: createApi(server.fetch) });
    await settle();

    const input = document.getElementById('new-title') as HTMLInputElement;
    input.value = '우유 사기';
    (document.getElementById('add-button') as HTMLButtonElement).click();
    await settle();
    expect(writes(server.requests)).toHaveLength(1);
    expect(listTitles(document)).toEqual([]);

    (document.getElementById('add-button') as HTMLButtonElement).click();
    await settle();
    expect(writes(server.requests)).toHaveLength(2);
    expect(listTitles(document)).toEqual(['우유 사기']);
  });
});

describe('out-of-order PATCH responses (R10)', () => {
  // Two toggles of one item are in flight. The server applies each change at once, but the
  // responses are held and released in reverse order. Before the fix the older response,
  // which arrived last, overwrote the newer local state, so the checkbox disagreed with the server.
  it('R10: the older PATCH response does not overwrite the newer one', async () => {
    loadIndexBody();
    const server = createFakeServer([existing]);
    let patches = 0;
    const held: (() => void)[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      if ((init?.method ?? 'GET') !== 'PATCH') return server.fetch(input, init);
      const index = patches;
      patches += 1;
      const response = await server.fetch(input, init);
      await new Promise<void>((resolve) => {
        held[index] = resolve;
      });
      return response;
    }) as typeof fetch;
    const started = startApp({ document, window, api: createApi(fetchImpl) });
    await settle();

    itemFor(document, 'existing').querySelector<HTMLInputElement>('.todo-toggle')?.click();
    await settle();
    itemFor(document, 'existing').querySelector<HTMLInputElement>('.todo-toggle')?.click();
    await settle();
    expect(patches).toBe(2);

    held[1]?.();
    await settle();
    held[0]?.();
    await settle();
    await started;

    expect(server.todos[0]?.completed).toBe(false);
    expect(
      itemFor(document, 'existing').querySelector<HTMLInputElement>('.todo-toggle')?.checked,
    ).toBe(false);
    expect(itemFor(document, 'existing').classList.contains('completed')).toBe(false);
    expect(remainingText(document)).toBe('1개 남음');
  });
});

describe('a resync that overlaps an add (R9)', () => {
  // The POST for `새 항목` is held after the server has stored it. A failed toggle of `existing`
  // then resyncs, and that GET already contains the new todo. Before the fix, releasing the POST
  // appended the created todo to the resynced list again, so the same id was shown twice and the
  // counter was off by one.
  it('R9: a POST that resolves after a resync shows the created todo once', async () => {
    loadIndexBody();
    const server = createFakeServer([existing]);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let heldPost = false;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'POST' && !heldPost) {
        heldPost = true;
        const response = await server.fetch(input, init);
        await gate;
        return response;
      }
      return server.fetch(input, init);
    }) as typeof fetch;
    const started = startApp({ document, window, api: createApi(fetchImpl) });
    await settle();

    const input = document.getElementById('new-title') as HTMLInputElement;
    input.value = '새 항목';
    (document.getElementById('add-button') as HTMLButtonElement).click();
    await settle();

    server.failNext('PATCH', {
      status: 404,
      code: 'NOT_FOUND',
      message: '리소스를 찾을 수 없습니다.',
    });
    const checkbox = itemFor(document, 'existing').querySelector<HTMLInputElement>('.todo-toggle');
    if (!checkbox) throw new Error('no checkbox for "existing"');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    await settle();
    expect(listTitles(document)).toEqual(['existing', '새 항목']);

    release();
    await started;
    await settle();

    expect(listTitles(document)).toEqual(['existing', '새 항목']);
    expect(remainingText(document)).toBe('2개 남음');
    expect(server.todos).toHaveLength(2);
  });
});

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await flush();
  }
}
