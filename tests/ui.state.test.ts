import { describe, expect, it } from 'vitest';
import {
  countRemaining,
  filterTodos,
  parseFilterFromHash,
  resolveEdit,
  validateTitle,
} from '../public/state.js';
import { parseTitle } from '../src/validation.ts';

// The UI state module is pure, so these run on the node environment with no DOM.
// AC-UI-3: filtering, remaining-count and input validation live here and are unit-tested.

const todos = [
  { id: 'a', title: 'one', completed: false },
  { id: 'b', title: 'two', completed: true },
  { id: 'c', title: 'three', completed: false },
  { id: 'd', title: 'four', completed: true },
];

describe('AC-UI-3: filterTodos', () => {
  it('all returns every item in original order', () => {
    expect(filterTodos(todos, 'all').map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('active returns only incomplete items', () => {
    expect(filterTodos(todos, 'active').map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('completed returns only completed items', () => {
    expect(filterTodos(todos, 'completed').map((t) => t.id)).toEqual(['b', 'd']);
  });

  it('does not mutate the input array', () => {
    const copy = structuredClone(todos);
    filterTodos(todos, 'active');
    filterTodos(todos, 'all').pop();
    expect(todos).toEqual(copy);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterTodos([], 'active')).toEqual([]);
    expect(filterTodos([{ id: 'x', title: 'x', completed: false }], 'completed')).toEqual([]);
  });
});

describe('AC-UI-3: countRemaining', () => {
  it('counts incomplete items', () => {
    expect(countRemaining(todos)).toBe(2);
  });

  it('is 0 for an empty list and for an all-completed list', () => {
    expect(countRemaining([])).toBe(0);
    expect(countRemaining([{ id: 'x', title: 'x', completed: true }])).toBe(0);
  });
});

describe('AC-UI-3: validateTitle', () => {
  it('trims surrounding whitespace and returns the trimmed value', () => {
    expect(validateTitle('  buy milk \n')).toEqual({ ok: true, value: 'buy milk' });
  });

  it('rejects empty and whitespace-only input with a message', () => {
    for (const raw of ['', '   ', '\t\n']) {
      const result = validateTitle(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message.length).toBeGreaterThan(0);
      }
    }
  });

  it('rejects non-string input', () => {
    expect(validateTitle(undefined).ok).toBe(false);
    expect(validateTitle(42).ok).toBe(false);
  });

  it('accepts exactly 200 characters and rejects 201', () => {
    expect(validateTitle('a'.repeat(200)).ok).toBe(true);
    expect(validateTitle('a'.repeat(201)).ok).toBe(false);
  });

  it('counts code points, so 200 emoji pass and 201 emoji fail (AC-API-11 parity)', () => {
    // Each emoji is 2 UTF-16 units, so 200 emoji is 400 units. It must still pass.
    expect(validateTitle('😀'.repeat(200)).ok).toBe(true);
    expect(validateTitle('😀'.repeat(201)).ok).toBe(false);
  });

  it('measures length after trimming, so padding does not count', () => {
    expect(validateTitle(`  ${'a'.repeat(200)}  `).ok).toBe(true);
  });

  it('agrees with the server rule in src/validation.ts for the same inputs', () => {
    const samples: unknown[] = [
      '',
      '   ',
      ' x ',
      'a'.repeat(200),
      'a'.repeat(201),
      '😀'.repeat(200),
      '😀'.repeat(201),
      '  padded  ',
    ];
    for (const raw of samples) {
      const ui = validateTitle(raw);
      let serverValue: string | undefined;
      try {
        serverValue = parseTitle(raw);
      } catch {
        serverValue = undefined;
      }
      expect(ui.ok, `input ${JSON.stringify(raw)}`).toBe(serverValue !== undefined);
      if (ui.ok) {
        expect(ui.value).toBe(serverValue);
      }
    }
  });
});

describe('AC-UI-3: parseFilterFromHash', () => {
  it('maps #/active and #/completed to their filters', () => {
    expect(parseFilterFromHash('#/active')).toBe('active');
    expect(parseFilterFromHash('#/completed')).toBe('completed');
  });

  it('falls back to all for the root hash, an empty hash and unknown hashes', () => {
    expect(parseFilterFromHash('#/')).toBe('all');
    expect(parseFilterFromHash('')).toBe('all');
    expect(parseFilterFromHash('#/nope')).toBe('all');
    expect(parseFilterFromHash('#active')).toBe('all');
  });
});

describe('AC-UI-3: resolveEdit (used by AC-UI-7)', () => {
  it('saves the trimmed new value when it differs from the original', () => {
    expect(resolveEdit('old', '  new title ')).toEqual({ action: 'save', value: 'new title' });
  });

  it('cancels on empty or whitespace-only input', () => {
    expect(resolveEdit('old', '')).toEqual({ action: 'cancel' });
    expect(resolveEdit('old', '   ')).toEqual({ action: 'cancel' });
  });

  it('cancels when the value is unchanged, even with surrounding spaces', () => {
    expect(resolveEdit('same', 'same')).toEqual({ action: 'cancel' });
    expect(resolveEdit('same', '  same  ')).toEqual({ action: 'cancel' });
  });
});
