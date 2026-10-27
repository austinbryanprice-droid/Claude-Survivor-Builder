/// <reference types="vite/client" />

import type { BuildControlsDebug } from './app/build-controls';
import type { IntroController } from './app/intro';
import type { MultiplayerDebug } from './app/multiplayer';
import type { Game } from './engine/game';
import type { Stage } from './engine/stage';

declare global {
  /** Short commit id injected by vite.config.ts ("dev" outside CI). */
  const __BUILD_ID__: string;

  interface Window {
    /** Present only with the `?debug` URL switch. */
    __ashbound?: {
      stage: Stage;
      game: Game;
      build?: BuildControlsDebug;
      mp?: MultiplayerDebug;
      intro?: IntroController;
    };
  }
}
