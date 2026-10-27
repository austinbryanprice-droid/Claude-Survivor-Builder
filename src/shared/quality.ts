/**
 * Quality presets. Balanced is the default and the one that must hold 60 FPS at 1080p on a
 * mid-range laptop; Low gives back headroom; Ultra goes closest to the reference look. The
 * numbers are starting values, kept in one table so tuning is a data change. See
 * docs/art-direction.md for what each row means.
 */

export type QualityName = 'low' | 'balanced' | 'ultra';

export type ShadowMode = 'blob' | 'single' | 'cascades';
export type WaterMode = 'flat' | 'ripples' | 'planar';
export type AntiAlias = 'none' | 'fxaa' | 'msaa';
export type BloomMode = 'off' | 'half' | 'full';

export interface QualitySettings {
  readonly name: QualityName;
  /** Internal resolution as a fraction of the canvas. The adaptive governor moves within the range. */
  readonly renderScale: number;
  readonly minRenderScale: number;
  readonly adaptiveScale: boolean;
  readonly shadows: ShadowMode;
  readonly shadowMapSize: number;
  /** How far the shadow map reaches from the camera, in meters. */
  readonly shadowDistance: number;
  readonly antiAlias: AntiAlias;
  readonly bloom: BloomMode;
  readonly lightShafts: boolean;
  readonly water: WaterMode;
  /** Resolution of the planar reflection relative to the render size. */
  readonly reflectionScale: number;
  /** Terrain view distance in 16-meter chunks (8 to 12 per the spec). */
  readonly viewChunks: number;
  readonly detailNormals: boolean;
  /** Fraction of the grass, flowers and trees drawn. */
  readonly foliageDensity: number;
  /** Distance in meters out to which grass is drawn. */
  readonly grassDistance: number;
  /** Distance in meters out to which the high-detail tree model is used. */
  readonly treeNearDistance: number;
  /** Whether sky clouds use the full lit model. */
  readonly richClouds: boolean;
  readonly mist: boolean;
  /** How many of the crew's Lights a frame is lit by: the nearest ones to the camera (at most 8, the shaders' slots). */
  readonly lamps: number;
}

export const QUALITY_PRESETS: Readonly<Record<QualityName, QualitySettings>> = {
  low: {
    name: 'low',
    renderScale: 0.75,
    minRenderScale: 0.6,
    adaptiveScale: true,
    shadows: 'blob',
    shadowMapSize: 1024,
    shadowDistance: 60,
    antiAlias: 'none',
    bloom: 'off',
    lightShafts: false,
    water: 'flat',
    reflectionScale: 0,
    viewChunks: 8,
    detailNormals: false,
    foliageDensity: 0.25,
    grassDistance: 22,
    treeNearDistance: 28,
    richClouds: false,
    mist: false,
    lamps: 2,
  },
  balanced: {
    name: 'balanced',
    renderScale: 1,
    minRenderScale: 0.7,
    adaptiveScale: true,
    shadows: 'single',
    shadowMapSize: 2048,
    shadowDistance: 90,
    antiAlias: 'fxaa',
    bloom: 'half',
    lightShafts: false,
    water: 'planar',
    reflectionScale: 0.3,
    viewChunks: 10,
    detailNormals: true,
    foliageDensity: 0.6,
    grassDistance: 34,
    treeNearDistance: 44,
    richClouds: true,
    mist: true,
    lamps: 6,
  },
  ultra: {
    name: 'ultra',
    renderScale: 1,
    minRenderScale: 1,
    adaptiveScale: false,
    shadows: 'cascades',
    shadowMapSize: 2048,
    shadowDistance: 160,
    antiAlias: 'msaa',
    bloom: 'full',
    lightShafts: true,
    water: 'planar',
    reflectionScale: 0.5,
    viewChunks: 12,
    detailNormals: true,
    foliageDensity: 1,
    grassDistance: 52,
    treeNearDistance: 70,
    richClouds: true,
    mist: true,
    lamps: 8,
  },
};

export const DEFAULT_QUALITY: QualityName = 'balanced';

export function isQualityName(value: string | null | undefined): value is QualityName {
  return value === 'low' || value === 'balanced' || value === 'ultra';
}

/** Every preset, lowest first: the order the quality key cycles through and the benchmark flies. */
export const QUALITY_NAMES: readonly QualityName[] = ['low', 'balanced', 'ultra'];

/** The preset after `name`, wrapping from the last one back to the first. */
export function nextQuality(name: QualityName): QualityName {
  const index = QUALITY_NAMES.indexOf(name);
  return QUALITY_NAMES[(index + 1) % QUALITY_NAMES.length] ?? DEFAULT_QUALITY;
}
