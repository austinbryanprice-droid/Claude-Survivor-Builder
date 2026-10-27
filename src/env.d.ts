/// <reference types="vite/client" />

import type { SoundDebug } from './app/attach-sound';
import type { BuildControlsDebug } from './app/build-controls';
import type { IntroController } from './app/intro';
import type { MultiplayerDebug } from './app/multiplayer';
import type { EffectRenderOptions } from './app/render-effect-sound';
import type { ValleyRenderOptions } from './app/render-valley-sound';
import type { TitleController } from './app/title';
import type { AudioHub } from './engine/audio/hub';
import type { Game } from './engine/game';
import type { RenderedSound, RenderOptions } from './engine/intro/sound-render';
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
      title?: TitleController;
      sound?: SoundDebug;
      audio?: {
        hub: AudioHub;
        render(options?: RenderOptions): Promise<RenderedSound>;
        renderValley(options?: ValleyRenderOptions): Promise<RenderedSound>;
        renderEffects(options: EffectRenderOptions): Promise<RenderedSound>;
      };
    };
  }
}
