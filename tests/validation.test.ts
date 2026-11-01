import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors.ts';
import {
  isUuid,
  parseBulkDeleteQuery,
  parseCreateBody,
  parseFilter,
  parsePatchBody,
  parseTitle,
} from '../src/validation.ts';

// Every rejection must be an AppError with code VALIDATION_ERROR and HTTP 400,
// so the central error handler maps it to the spec 01 envelope.
function expectValidationError(fn: () => unknown): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AppError);
  expect(caught).toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
}

describe('parseTitle', () => {
  it('AC-API-2: trims surrounding whitespace', () => {
    expect(parseTitle('  우유 사기  ')).toBe('우유 사기');
  });

  it('AC-API-3: rejects an empty string', () => {
    expectValidationError(() => parseTitle(''));
  });

  it('AC-API-3: rejects a whitespace-only string', () => {
    expectValidationError(() => parseTitle('   \t '));
  });

  it('AC-API-3: accepts exactly 200 characters', () => {
    const title = 'a'.repeat(200);
    expect(parseTitle(title)).toBe(title);
  });

  it('AC-API-3: rejects 201 characters', () => {
    expectValidationError(() => parseTitle('a'.repeat(201)));
  });

  it('AC-API-11: accepts 200 emoji (one code point each)', () => {
    const title = '😀'.repeat(200);
    expect(parseTitle(title)).toBe(title);
  });

  it('AC-API-11: rejects 201 emoji', () => {
    expectValidationError(() => parseTitle('😀'.repeat(201)));
  });

  it('counts the length after trimming, so padding does not push a title over the limit', () => {
    expect(parseTitle(`  ${'a'.repeat(200)}  `)).toBe('a'.repeat(200));
  });

  it('rejects non-string titles', () => {
    for (const value of [1, null, undefined, true, ['a'], { title: 'a' }]) {
      expectValidationError(() => parseTitle(value));
    }
  });
});

describe('parseCreateBody', () => {
  it('returns the trimmed title from a valid body', () => {
    expect(parseCreateBody({ title: '  빨래  ' })).toEqual({ title: '빨래' });
  });

  it('rejects unknown fields', () => {
    expectValidationError(() => parseCreateBody({ title: 'a', completed: true }));
  });

  it('rejects a missing title', () => {
    expectValidationError(() => parseCreateBody({}));
  });

  it('rejects non-object bodies (array, null, string)', () => {
    for (const body of [[{ title: 'a' }], null, 'a']) {
      expectValidationError(() => parseCreateBody(body));
    }
  });
});

describe('parsePatchBody', () => {
  it('accepts title alone', () => {
    expect(parsePatchBody({ title: ' 새 제목 ' })).toEqual({ title: '새 제목' });
  });

  it('accepts completed alone, including false', () => {
    expect(parsePatchBody({ completed: true })).toEqual({ completed: true });
    expect(parsePatchBody({ completed: false })).toEqual({ completed: false });
  });

  it('accepts both fields together', () => {
    expect(parsePatchBody({ title: 'x', completed: true })).toEqual({
      title: 'x',
      completed: true,
    });
  });

  it('AC-API-9: rejects an empty object', () => {
    expectValidationError(() => parsePatchBody({}));
  });

  it('rejects unknown fields', () => {
    expectValidationError(() => parsePatchBody({ completed: true, id: 'x' }));
  });

  it('rejects a non-boolean completed', () => {
    for (const value of ['yes', 1, null, 'true']) {
      expectValidationError(() => parsePatchBody({ completed: value }));
    }
  });

  it('validates title with the same rules as create', () => {
    expectValidationError(() => parsePatchBody({ title: '   ' }));
    expectValidationError(() => parsePatchBody({ title: 'a'.repeat(201) }));
  });

  it('rejects non-object bodies', () => {
    for (const body of [[], null, 'x']) {
      expectValidationError(() => parsePatchBody(body));
    }
  });
});

describe('parseFilter', () => {
  it('defaults to all when filter is absent', () => {
    expect(parseFilter({})).toBe('all');
  });

  it('accepts all, active and completed', () => {
    expect(parseFilter({ filter: 'all' })).toBe('all');
    expect(parseFilter({ filter: 'active' })).toBe('active');
    expect(parseFilter({ filter: 'completed' })).toBe('completed');
  });

  it('rejects unknown filter values', () => {
    for (const value of ['', 'ALL', 'done', ['active', 'all']]) {
      expectValidationError(() => parseFilter({ filter: value }));
    }
  });

  it('ignores unknown query keys', () => {
    expect(parseFilter({ foo: '1', filter: 'active' })).toBe('active');
    expect(parseFilter({ foo: '1' })).toBe('all');
  });
});

describe('parseBulkDeleteQuery', () => {
  it('accepts exactly completed=true', () => {
    expect(parseBulkDeleteQuery({ completed: 'true' })).toEqual({ completed: true });
  });

  it('AC-API-10: rejects a missing completed param', () => {
    expectValidationError(() => parseBulkDeleteQuery({}));
  });

  it('AC-API-10: rejects completed=false', () => {
    expectValidationError(() => parseBulkDeleteQuery({ completed: 'false' }));
  });

  it('rejects other truthy-looking values and repeated params', () => {
    for (const value of ['1', 'TRUE', '', ['true', 'true']]) {
      expectValidationError(() => parseBulkDeleteQuery({ completed: value }));
    }
  });
});

describe('isUuid', () => {
  it('accepts a canonical UUID', () => {
    expect(isUuid('123e4567-e89b-42d3-a456-426614174000')).toBe(true);
  });

  it('accepts uppercase hex', () => {
    expect(isUuid('123E4567-E89B-42D3-A456-426614174000')).toBe(true);
  });

  it('rejects malformed ids', () => {
    for (const id of [
      'abc',
      '',
      '123e4567e89b42d3a456426614174000',
      'z23e4567-e89b-42d3-a456-426614174000',
    ]) {
      expect(isUuid(id)).toBe(false);
    }
  });
});
