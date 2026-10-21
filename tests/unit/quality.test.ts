import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUALITY,
  QUALITY_NAMES,
  QUALITY_PRESETS,
  isQualityName,
  nextQuality,
  type QualityName,
} from '../../src/shared/quality';

const ORDER: readonly QualityName[] = ['low', 'balanced', 'ultra'];

describe('quality presets', () => {
  it('names each preset by its key and defaults to Balanced', () => {
    for (const name of ORDER) expect(QUALITY_PRESETS[name].name).toBe(name);
    expect(DEFAULT_QUALITY).toBe('balanced');
  });

  it('grows more expensive from Low to Ultra', () => {
    const [low, balanced, ultra] = ORDER.map((n) => QUALITY_PRESETS[n]);
    for (const key of [
      'renderScale',
      'shadowMapSize',
      'shadowDistance',
      'reflectionScale',
      'viewChunks',
      'foliageDensity',
      'grassDistance',
      'treeNearDistance',
    ] as const) {
      expect(low?.[key]).toBeLessThanOrEqual(balanced?.[key] ?? -1);
      expect(balanced?.[key]).toBeLessThanOrEqual(ultra?.[key] ?? -1);
    }
  });

  it('keeps the view distance inside the 8 to 12 chunks the spec allows', () => {
    for (const name of ORDER) {
      expect(QUALITY_PRESETS[name].viewChunks).toBeGreaterThanOrEqual(8);
      expect(QUALITY_PRESETS[name].viewChunks).toBeLessThanOrEqual(12);
    }
  });

  it('lets only Low and Balanced adapt their resolution, within a sane range', () => {
    expect(QUALITY_PRESETS.ultra.adaptiveScale).toBe(false);
    for (const name of ORDER) {
      const q = QUALITY_PRESETS[name];
      expect(q.minRenderScale).toBeLessThanOrEqual(q.renderScale);
      expect(q.minRenderScale).toBeGreaterThanOrEqual(0.5);
      expect(q.renderScale).toBeLessThanOrEqual(1);
    }
  });

  it('recognizes only the three preset names', () => {
    expect(isQualityName('balanced')).toBe(true);
    expect(isQualityName('medium')).toBe(false);
    expect(isQualityName(null)).toBe(false);
  });

  it('lists the presets lowest first and cycles through them', () => {
    expect(QUALITY_NAMES).toEqual(ORDER);
    expect(nextQuality('low')).toBe('balanced');
    expect(nextQuality('balanced')).toBe('ultra');
    expect(nextQuality('ultra')).toBe('low');
  });
});
