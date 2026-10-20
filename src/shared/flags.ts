/** URL switches for development and testing, for example `?debug`. */
export interface Flags {
  /** Exposes `window.__ashbound` so tests and the console can reach the engine. */
  readonly debug: boolean;
  /** `?bench=1` runs a scripted flythrough after load and reports frame times to paste back. */
  readonly bench: boolean;
  /** Length of the flythrough in seconds (`?benchSeconds=10`); the default is 30. */
  readonly benchSeconds: number;
}

export const DEFAULT_BENCH_SECONDS = 30;
const MAX_BENCH_SECONDS = 300;

function isOn(value: string | null): boolean {
  return value !== null && value !== '0' && value.toLowerCase() !== 'false';
}

export function readFlags(search: string): Flags {
  const params = new URLSearchParams(search);
  const seconds = Number(params.get('benchSeconds'));
  return {
    debug: params.has('debug'),
    bench: isOn(params.get('bench')),
    benchSeconds:
      Number.isFinite(seconds) && seconds >= 1
        ? Math.min(MAX_BENCH_SECONDS, Math.floor(seconds))
        : DEFAULT_BENCH_SECONDS,
  };
}
