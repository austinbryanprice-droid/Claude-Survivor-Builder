import { describe, expect, it } from 'vitest';
import { createVitalsReading, type VitalsReading } from '../../src/shared/vitals-state';
import { speedScaleFor } from '../../src/systems/survival/vitals';
import { FULL_VITALS, HEALTH_LOW_BELOW, vitalsForHud } from '../../src/ui/vitals-hud';

/** A player's meters as the host would report them: points of a hundred. */
function meters(health: number, energy: number, charging = false): VitalsReading {
  return {
    ...createVitalsReading(),
    health,
    healthMax: 100,
    energy,
    energyMax: 100,
    speedScale: speedScaleFor(energy / 100),
    charging,
  };
}

describe('the vitals corner of the HUD', () => {
  it('draws full bars and no icons where there is nothing to read yet', () => {
    expect(vitalsForHud(createVitalsReading())).toBe(FULL_VITALS);
    expect(FULL_VITALS).toMatchObject({ health: 1, energy: 1, healthTone: 'ok', energyTone: 'ok' });
    expect(FULL_VITALS.statuses).toEqual([]);
  });

  it('draws each bar as its share of the full bar', () => {
    const drawn = vitalsForHud(meters(78, 41));
    expect(drawn.health).toBeCloseTo(0.78, 10);
    expect(drawn.energy).toBeCloseTo(0.41, 10);
    expect(drawn.statuses).toEqual([]);
  });

  it('shows Health as low below a quarter of the bar and not at it', () => {
    expect(vitalsForHud(meters(100, 100)).healthTone).toBe('ok');
    expect(vitalsForHud(meters(HEALTH_LOW_BELOW * 100, 100)).healthTone).toBe('ok');
    expect(vitalsForHud(meters(HEALTH_LOW_BELOW * 100 - 1, 100)).healthTone).toBe('low');
    expect(vitalsForHud(meters(0, 100)).healthTone).toBe('low');
  });

  it('shows Energy as low exactly when it is slowing the player', () => {
    // The low mark is a quarter of the bar: at it nothing is slowed yet, below it the slowing begins.
    expect(vitalsForHud(meters(100, 80)).energyTone).toBe('ok');
    expect(vitalsForHud(meters(100, 25)).energyTone).toBe('ok');
    expect(vitalsForHud(meters(100, 24)).energyTone).toBe('low');
    expect(vitalsForHud(meters(100, 1)).energyTone).toBe('low');
    expect(vitalsForHud(meters(100, 0)).energyTone).toBe('empty');
  });

  it('says Low energy, or Out of energy, with an amber icon', () => {
    const low = vitalsForHud(meters(100, 10)).statuses;
    expect(low).toEqual([{ icon: 'bolt', label: 'Low energy', tone: 'bad' }]);
    const spent = vitalsForHud(meters(100, 0)).statuses;
    expect(spent).toEqual([{ icon: 'bolt', label: 'Out of energy', tone: 'bad' }]);
  });

  it('says Charging in the Core field, ahead of any warning', () => {
    expect(vitalsForHud(meters(100, 60, true)).statuses).toEqual([
      { icon: 'core', label: 'Charging', tone: 'good' },
    ]);
    expect(vitalsForHud(meters(100, 10, true)).statuses.map((status) => status.label)).toEqual([
      'Charging',
      'Low energy',
    ]);
  });

  it('tolerates a meter that is more than full or less than empty', () => {
    const drawn = vitalsForHud(meters(250, -5));
    expect(drawn.health).toBe(1);
    expect(drawn.energy).toBe(0);
  });
});
