import { describe, expect, it } from 'vitest';
import { resolveListenOptions } from '../src/config.ts';

// Spec 03 (src/server.ts): PORT defaults to 3000, HOST defaults to 127.0.0.1. An empty value
// (for example `PORT=` or `HOST=` in a .env file) counts as unset, the same rule as R6 for
// DB_PATH. Before this fix, `PORT=''` gave port 0 (a random port) and `HOST=''` was passed to
// listen unchanged, which binds every interface, exposing the single-user service (R23).
describe('resolveListenOptions (R23)', () => {
  it('uses the spec defaults when PORT and HOST are unset', () => {
    expect(resolveListenOptions({})).toEqual({ port: 3000, host: '127.0.0.1' });
  });

  it('R23: an empty PORT falls back to 3000 instead of a random port', () => {
    expect(resolveListenOptions({ PORT: '' })).toEqual({ port: 3000, host: '127.0.0.1' });
  });

  it('R23: a whitespace-only HOST falls back to 127.0.0.1 instead of all interfaces', () => {
    expect(resolveListenOptions({ HOST: '  ' })).toEqual({ port: 3000, host: '127.0.0.1' });
  });

  it('R23: an empty HOST never reaches listen as the unspecified address', () => {
    expect(resolveListenOptions({ HOST: '' }).host).not.toBe('');
    expect(resolveListenOptions({ HOST: '' }).host).not.toBe('0.0.0.0');
  });

  it('keeps explicit PORT and HOST values', () => {
    expect(resolveListenOptions({ PORT: '8080', HOST: '0.0.0.0' })).toEqual({
      port: 8080,
      host: '0.0.0.0',
    });
  });
});
