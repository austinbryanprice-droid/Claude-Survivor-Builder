import { describe, expect, it } from 'vitest';
import { DEFAULT_BENCH_SECONDS, readFlags } from '../../src/shared/flags';

describe('readFlags', () => {
  it('is off by default', () => {
    expect(readFlags('')).toEqual({
      debug: false,
      bench: false,
      benchSeconds: DEFAULT_BENCH_SECONDS,
    });
  });

  it('turns debug on when the switch is present', () => {
    expect(readFlags('?debug').debug).toBe(true);
    expect(readFlags('?foo=1&debug=1').debug).toBe(true);
  });

  it('turns the benchmark on for ?bench=1 and ?bench, and off for 0 or false', () => {
    expect(readFlags('?bench=1').bench).toBe(true);
    expect(readFlags('?bench').bench).toBe(true);
    expect(readFlags('?bench=0').bench).toBe(false);
    expect(readFlags('?bench=false').bench).toBe(false);
  });

  it('reads the benchmark length, keeping it between 1 and 300 seconds', () => {
    expect(readFlags('?bench=1&benchSeconds=12').benchSeconds).toBe(12);
    expect(readFlags('?benchSeconds=12.9').benchSeconds).toBe(12);
    expect(readFlags('?benchSeconds=100000').benchSeconds).toBe(300);
    expect(readFlags('?benchSeconds=0').benchSeconds).toBe(DEFAULT_BENCH_SECONDS);
    expect(readFlags('?benchSeconds=abc').benchSeconds).toBe(DEFAULT_BENCH_SECONDS);
  });
});
