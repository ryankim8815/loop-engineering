// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mountApp } from './helpers/dom.ts';

// Accessibility and responsive checks (spec 02 "접근성·반응형"). happy-dom has no layout engine,
// so the 360px no-horizontal-scroll rule is checked as the CSS properties that guarantee it,
// not measured. The CSS rules are matched against rendered elements with `element.matches`,
// so a rule that targets the wrong element (for example `label` where the title is a span)
// fails here.

const indexHtml = readFileSync(resolve('public/index.html'), 'utf8');
const css = readFileSync(resolve('public/styles.css'), 'utf8');

type Rule = { selectors: string[]; body: string };

function parseRules(source: string): Rule[] {
  const rules: Rule[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of source.matchAll(pattern)) {
    const selectors = (match[1] ?? '').split(',').map((s) => s.trim());
    rules.push({ selectors, body: match[2] ?? '' });
  }
  return rules;
}

const rules = parseRules(css);

// Rules whose body contains `declaration`, returned as their plain (non-pseudo) selectors.
function selectorsDeclaring(declaration: RegExp): string[] {
  return rules
    .filter((rule) => declaration.test(rule.body))
    .flatMap((rule) => rule.selectors)
    .filter((selector) => !selector.includes(':'));
}

function hasAccessibleName(control: HTMLElement): boolean {
  if ((control.getAttribute('aria-label') ?? '').trim() !== '') return true;
  const id = control.id;
  if (id && control.ownerDocument.querySelector(`label[for="${id}"]`)) return true;
  // A button's visible text is its accessible name.
  return control.tagName === 'BUTTON' && (control.textContent ?? '').trim() !== '';
}

function controls(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('input, button, select, textarea')];
}

describe('accessibility and responsive layout', () => {
  it('every control in index.html has a label or aria-label', async () => {
    const { document } = await mountApp([]);
    const found = controls(document);
    expect(found.length).toBeGreaterThan(0);
    const unnamed = found.filter((control) => !hasAccessibleName(control));
    expect(unnamed.map((control) => control.outerHTML)).toEqual([]);
  });

  it('every control in a rendered item (checkbox, edit, delete) has a label or aria-label', async () => {
    const { document } = await mountApp([
      {
        id: '00000000-0000-4000-8000-000000000001',
        title: '우유 사기',
        completed: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const item = document.querySelector('#todo-list > li');
    expect(item).not.toBeNull();
    const itemControls = controls(item as HTMLElement);
    expect(itemControls.map((c) => c.tagName)).toEqual(['INPUT', 'BUTTON', 'BUTTON']);
    expect(itemControls.filter((control) => !hasAccessibleName(control))).toEqual([]);
  });

  it('the inline edit input has an accessible name while open (AC-UI-7 path)', async () => {
    const { document } = await mountApp([
      {
        id: '00000000-0000-4000-8000-000000000001',
        title: '우유 사기',
        completed: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    document.querySelector<HTMLButtonElement>('.todo-edit-button')?.click();
    const editor = document.querySelector<HTMLInputElement>('#todo-list .todo-edit');
    expect(editor).not.toBeNull();
    expect(hasAccessibleName(editor as HTMLElement)).toBe(true);
  });

  it('no control is removed from the tab order with tabindex="-1"', async () => {
    const { document } = await mountApp([
      {
        id: '00000000-0000-4000-8000-000000000001',
        title: '우유 사기',
        completed: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const all = [...document.querySelectorAll<HTMLElement>('a, input, button, select, textarea')];
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((el) => el.getAttribute('tabindex') === '-1')).toEqual([]);
  });

  it('index.html has a viewport meta tag for mobile widths', () => {
    // Regex over the source, not DOMParser: parsing the page would try to load styles.css.
    const meta = /<meta\s+name="viewport"\s+content="([^"]*)"/.exec(indexHtml);
    expect(meta?.[1]).toContain('width=device-width');
  });

  it('a completed item title is struck through (rule matches the rendered title span)', async () => {
    const { document } = await mountApp([
      {
        id: '00000000-0000-4000-8000-000000000001',
        title: '끝난 일',
        completed: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const title = document.querySelector('#todo-list > li.completed .todo-title') as HTMLElement;
    expect(title).not.toBeNull();
    const selectors = selectorsDeclaring(/text-decoration:\s*line-through/);
    expect(selectors.some((selector) => title.matches(selector))).toBe(true);
  });

  it('the selected filter has a visible style (rule matches the selected link)', async () => {
    const { document } = await mountApp([]);
    const selected = document.querySelector('.filters a[aria-current="page"]') as HTMLElement;
    expect(selected).not.toBeNull();
    const selectors = rules
      .filter((rule) => /font-weight|text-decoration|background|outline/.test(rule.body))
      .flatMap((rule) => rule.selectors)
      .filter((selector) => !selector.includes(':focus'));
    expect(selectors.some((selector) => selected.matches(selector))).toBe(true);
  });

  it('keyboard focus has a visible outline on buttons, links and inputs', () => {
    const focusRule = rules.find((rule) =>
      rule.selectors.some((s) => s.includes(':focus-visible')),
    );
    expect(focusRule).toBeDefined();
    const joined = (focusRule?.selectors ?? []).join(',');
    for (const element of ['button', 'a', 'input']) {
      expect(joined).toContain(`${element}:focus-visible`);
    }
    expect(focusRule?.body).toMatch(/outline:\s*\S+/);
  });

  it('long titles wrap instead of forcing horizontal scroll at 360px', async () => {
    const { document } = await mountApp([
      {
        id: '00000000-0000-4000-8000-000000000001',
        title: 'a'.repeat(200),
        completed: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const title = document.querySelector('#todo-list > li .todo-title') as HTMLElement;
    const wrapping = selectorsDeclaring(/overflow-wrap:\s*anywhere/);
    expect(wrapping.some((selector) => title.matches(selector))).toBe(true);
  });

  it('box-sizing is border-box and controls cannot exceed their container width', () => {
    const universal = rules.find((rule) => rule.selectors.includes('*'));
    expect(universal?.body).toMatch(/box-sizing:\s*border-box/);
    const maxWidthSelectors = selectorsDeclaring(/max-width:\s*100%/);
    expect(maxWidthSelectors).toEqual(expect.arrayContaining(['input', 'button']));
  });

  it('R28: a long title cannot shrink the item buttons (rule matches the rendered 수정/삭제)', async () => {
    // Without this rule, `.todo-title` (flex: 1 1 auto) and the buttons (default flex-shrink: 1)
    // share the row, and a 200-emoji title squeezed 수정/삭제 to one-character-wide buttons with
    // the label wrapped per character. The fix keeps the buttons at their content width.
    const { document } = await mountApp([
      {
        id: '00000000-0000-4000-8000-000000000001',
        title: '😀'.repeat(200),
        completed: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const buttons = [...document.querySelectorAll<HTMLElement>('#todo-list > li > button')];
    expect(buttons.map((b) => b.className)).toEqual(['todo-edit-button', 'todo-delete']);
    const noShrink = selectorsDeclaring(/flex:\s*none|flex-shrink:\s*0/);
    for (const button of buttons) {
      expect(noShrink.some((selector) => button.matches(selector))).toBe(true);
    }
  });
});
