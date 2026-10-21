/** Floats in [0, 1) from the browser's cryptographic source, or `Math.random` where there is none. */
export function cryptoRandom(): () => number {
  const source = globalThis.crypto;
  if (!source?.getRandomValues) return Math.random;
  const buffer = new Uint32Array(1);
  return () => {
    source.getRandomValues(buffer);
    return (buffer[0] as number) / 4_294_967_296;
  };
}

/** A random string of `length` symbols from `alphabet`. */
export function randomString(random: () => number, alphabet: string, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.min(alphabet.length - 1, Math.floor(random() * alphabet.length))];
  }
  return out;
}
