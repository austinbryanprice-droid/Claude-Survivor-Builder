/** URL switches for development and testing, for example `?debug`. */
export interface Flags {
  /** Exposes `window.__ashbound` so tests and the console can reach the engine. */
  readonly debug: boolean;
}

export function readFlags(search: string): Flags {
  const params = new URLSearchParams(search);
  return { debug: params.has('debug') };
}
