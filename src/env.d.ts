/// <reference types="vite/client" />

import type { Stage } from './engine/stage';

declare global {
  /** Short commit id injected by vite.config.ts ("dev" outside CI). */
  const __BUILD_ID__: string;

  interface Window {
    /** Present only with the `?debug` URL switch. */
    __ashbound?: { stage: Stage };
  }
}
