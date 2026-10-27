import { createAftermathLayer } from './aftermath-layer';
import { createCrawlersLayer } from './crawlers-layer';
import { createFireballLayer } from './fireball-layer';
import { createImpactLayer } from './impact-layer';
import type { IntroContext, IntroLayer } from './layer';

/** Every layer of the film's picture, in the order they are added to the scene. */
export function createLayers(context: IntroContext): IntroLayer[] {
  return [
    createFireballLayer(context),
    createImpactLayer(context),
    createAftermathLayer(context),
    createCrawlersLayer(context),
  ];
}
