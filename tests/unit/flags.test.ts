import { describe, expect, it } from 'vitest';
import { readFlags } from '../../src/shared/flags';

describe('readFlags', () => {
  it('is off by default', () => {
    expect(readFlags('')).toEqual({ debug: false });
  });

  it('turns debug on when the switch is present', () => {
    expect(readFlags('?debug')).toEqual({ debug: true });
    expect(readFlags('?foo=1&debug=1')).toEqual({ debug: true });
  });
});
