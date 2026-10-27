import { describe, expect, it } from 'vitest';
import {
  BUDGET,
  EARSHOT,
  Governor,
  KINDS,
  SPOT,
  costOf,
  createHeard,
  dropFor,
  effectForEdit,
  effectForHarvest,
  effectForRefusal,
  effectsForPower,
  hearAt,
  placeCues,
  type Effect,
  type Listener,
} from '../../src/shared/effect-sound';
import {
  MATERIAL,
  MODULE,
  SHAPE,
  moduleShape,
  packState,
  slabShape,
  wedgeShape,
} from '../../src/shared/blocks';
import type { HarvestEvent } from '../../src/shared/economy';
import type { MusicCue } from '../../src/shared/game-sound';
import { lookDirection, rightVector } from '../../src/shared/look';
import { NO_PLAYER, type BlockSetEvent } from '../../src/shared/protocol';

const SCRAP = packState(SHAPE.cube, MATERIAL.scrap);
const COMPOSITE = packState(SHAPE.cube, MATERIAL.composite);
const ALLOY = packState(SHAPE.cube, MATERIAL.alloy);
const ENERGY = packState(SHAPE.cube, MATERIAL.energy);

const HERE: Listener = { x: 0, y: 0, z: 0, yaw: 0 };

function edit(state: number, by = 2, x = 5, y = 3, z = -7): BlockSetEvent {
  return { type: 'set', x, y, z, state, by };
}

function voices(effect: Effect | null | undefined): string[] {
  return (effect?.cues ?? []).map(({ cue }) => cue.voice);
}

describe('how far a sound carries', () => {
  it('loses nothing within arm’s reach, then falls off to the edge of earshot', () => {
    expect(dropFor(0)).toBe(0);
    expect(dropFor(3)).toBe(0);
    expect(dropFor(8)).toBe(-6);
    expect(dropFor(16)).toBe(-12.5);
    expect(dropFor(80)).toBe(-44);
    expect(dropFor(500)).toBe(-44);
    // Between two points of the table it is a straight line.
    expect(dropFor(12)).toBeCloseTo(-9.25, 6);
    expect(dropFor(5.5)).toBeCloseTo(-3, 6);
  });

  it('never gets louder with distance', () => {
    let last = 0;
    for (let distance = 0; distance <= 100; distance += 0.5) {
      const drop = dropFor(distance);
      expect(drop).toBeLessThanOrEqual(last + 1e-9);
      last = drop;
    }
  });
});

describe('where a sound is heard from', () => {
  const heard = createHeard();

  it('puts a sound on the side of the ear it comes from, whichever way the view is turned', () => {
    // With the view toward -z, +x is to the right and -x to the left.
    expect(hearAt(HERE, 10, 0, 0, heard)).toBe(true);
    expect(heard.pan).toBeGreaterThan(0.5);
    expect(hearAt(HERE, -10, 0, 0, heard)).toBe(true);
    expect(heard.pan).toBeLessThan(-0.5);
    // Straight ahead and straight behind are in the middle.
    hearAt(HERE, 0, 0, -10, heard);
    expect(heard.pan).toBeCloseTo(0, 6);
    hearAt(HERE, 0, 0, 10, heard);
    expect(heard.pan).toBeCloseTo(0, 6);
    // Turned a quarter to the left, what was ahead is on the right.
    hearAt({ ...HERE, yaw: Math.PI / 2 }, 0, 0, -10, heard);
    expect(heard.pan).toBeGreaterThan(0.5);
  });

  it('agrees with the camera: a sound the view’s right-hand vector points at is on the right', () => {
    const right = { x: 0, y: 0, z: 0 };
    const ahead = { x: 0, y: 0, z: 0 };
    for (const yaw of [-2.5, -1, 0, 0.7, 2, 3.1]) {
      rightVector(yaw, right);
      lookDirection(yaw, 0, ahead);
      const listener = { x: 4, y: 2, z: -3, yaw };
      expect(hearAt(listener, 4 + right.x * 9, 2, -3 + right.z * 9, heard)).toBe(true);
      expect(heard.pan).toBeCloseTo(SPOT.pan, 6);
      expect(hearAt(listener, 4 - right.x * 9, 2, -3 - right.z * 9, heard)).toBe(true);
      expect(heard.pan).toBeCloseTo(-SPOT.pan, 6);
      hearAt(listener, 4 + ahead.x * 9, 2, -3 + ahead.z * 9, heard);
      expect(heard.pan).toBeCloseTo(0, 6);
    }
  });

  it('keeps a sound at the player’s feet in the middle, and one overhead too', () => {
    hearAt(HERE, 0.4, 0, 0, heard);
    expect(Math.abs(heard.pan)).toBeLessThan(0.1);
    hearAt(HERE, 0, 12, 0, heard);
    expect(heard.pan).toBe(0);
    expect(heard.drop).toBeLessThan(-6);
  });

  it('is quieter, duller and roomier the farther it is', () => {
    const at = (distance: number) => {
      hearAt(HERE, distance, 0, 0, heard);
      return { ...heard };
    };
    const near = at(2);
    const middle = at(30);
    const far = at(70);
    expect(near.drop).toBe(0);
    expect(near.muffle).toBe(0);
    expect(near.room).toBeLessThan(middle.room);
    expect(middle.drop).toBeGreaterThan(far.drop);
    expect(middle.muffle).toBeGreaterThan(near.muffle);
    expect(far.muffle).toBeGreaterThan(middle.muffle);
    expect(far.muffle).toBeLessThanOrEqual(1);
    expect(far.room).toBeLessThanOrEqual(SPOT.room);
  });

  it('dulls a sound behind the listener', () => {
    hearAt(HERE, 0, 0, -20, heard);
    const ahead = heard.muffle;
    hearAt(HERE, 0, 0, 20, heard);
    expect(heard.muffle).toBeGreaterThan(ahead);
  });

  it('makes nothing of a sound beyond earshot, or for a listener that is nowhere', () => {
    const untouched = { drop: -1, pan: 0.5, muffle: 0.5, room: 0.5 };
    const out = { ...untouched };
    expect(hearAt(HERE, EARSHOT + 1, 0, 0, out)).toBe(false);
    expect(hearAt(HERE, EARSHOT, 0, 0, out)).toBe(true);
    const lost = { ...untouched };
    expect(hearAt({ ...HERE, x: Number.NaN }, 1, 0, 0, lost)).toBe(false);
    expect(lost).toEqual(untouched);
  });
});

describe('placing the cues of an effect', () => {
  const cues: MusicCue[] = [
    { after: 0, cue: { voice: 'step', level: -14, hz: 120, seed: 1 } },
    { after: 0.1, cue: { voice: 'tick', level: -30, hz: 1500, seed: 2, muffle: 0.9, room: 0.1 } },
  ];

  it('lowers every cue by the loss, places it and keeps its time', () => {
    const placed = placeCues(cues, { drop: -10, pan: 0.4, muffle: 0.5, room: 0.2 });
    expect(placed.map((entry) => entry.after)).toEqual([0, 0.1]);
    expect(placed[0]?.cue).toMatchObject({ voice: 'step', level: -24, pan: 0.4, muffle: 0.5 });
    expect(placed[0]?.cue.room).toBeCloseTo(0.2, 9);
    // A cue that was duller than the air makes it stays so, and the room adds up.
    expect(placed[1]?.cue.muffle).toBe(0.9);
    expect(placed[1]?.cue.room).toBeCloseTo(0.3, 9);
  });

  it('does not touch the cues it was given', () => {
    const before = JSON.stringify(cues);
    placeCues(cues, { drop: -5, pan: -0.3, muffle: 0.2, room: 0.1 });
    expect(JSON.stringify(cues)).toBe(before);
  });

  it('leaves out a cue that could not be heard', () => {
    const placed = placeCues(cues, { drop: -35, pan: 0, muffle: 0.7, room: 0.25 });
    expect(placed.map((entry) => entry.cue.voice)).toEqual(['step']);
  });

  it('never leaves a cue exactly in the middle, which would skip the panner and be 3 dB louder', () => {
    const [only] = placeCues(cues, { drop: 0, pan: 0, muffle: 0, room: 0 });
    expect(only?.cue.pan).not.toBe(0);
    expect(only?.cue.pan).toBeTruthy();
    expect(Math.abs(only?.cue.pan ?? 1)).toBeLessThan(1e-3);
  });
});

describe('the governor', () => {
  it('lets a kind sound again only after its gap, per source', () => {
    const governor = new Governor();
    const gap = KINDS.place.gap;
    expect(governor.admit('place', 1, 10, 7)).toBe(true);
    expect(governor.admit('place', 1, 10 + gap / 2, 7)).toBe(false);
    // Another source of the same kind has its own gap.
    expect(governor.admit('place', 1, 10 + gap / 2, 8)).toBe(true);
    expect(governor.admit('place', 1, 10 + gap * 1.01, 7)).toBe(true);
    // And another kind has its own.
    expect(governor.admit('break', 1, 10 + gap * 1.01, 7)).toBe(true);
  });

  it('keeps the voices that are sounding within the budget, turning the least important away first', () => {
    const governor = new Governor(10);
    // Priority 1 (a block set down) may fill 65% of ten.
    let admitted = 0;
    for (let i = 0; i < 20; i++) if (governor.admit('place', 1, 100 + i * 0.001, i)) admitted++;
    expect(admitted).toBe(6);
    // A refusal is of priority 3 and may use all of it, while the six are still sounding.
    expect(governor.admit('refuse', 1, 100.1)).toBe(true);
    expect(governor.load(100.1)).toBe(7);
    let more = 0;
    for (let i = 0; i < 20; i++) if (governor.admit('refuse', 1, 101 + i, 0)) more++;
    expect(more).toBe(20);
  });

  it('counts a voice again only for as long as it sounds', () => {
    const governor = new Governor(10);
    for (let i = 0; i < 6; i++) governor.admit('place', 1, 50 + i * 0.001, i);
    expect(governor.admit('place', 1, 50.02, 99)).toBe(false);
    expect(governor.load(50.02)).toBe(6);
    // The effects have died away by now.
    expect(governor.load(50 + KINDS.place.life + 0.01)).toBe(0);
    expect(governor.admit('place', 1, 50 + KINDS.place.life + 0.01, 99)).toBe(true);
  });

  it('lets what must always be heard use a little beyond the budget', () => {
    const governor = new Governor(10);
    for (let i = 0; i < 10; i++) governor.admit('refuse', 1, 5 + i * 0.001, i);
    expect(governor.admit('refuse', 1, 5.02, 77)).toBe(false);
    expect(BUDGET.share[BUDGET.share.length - 1]).toBe(1);
  });

  it('forgets old sources, so that a long game does not grow it without end', () => {
    const governor = new Governor();
    for (let i = 0; i < 3000; i++) governor.admit('place', 0.1, i * 0.5, i);
    expect(governor.remembered).toBeLessThan(700);
  });

  it('has a rule for every kind that the budget can read', () => {
    for (const rule of Object.values(KINDS)) {
      expect(rule.gap).toBeGreaterThan(0);
      expect(rule.life).toBeGreaterThan(0);
      expect(Number.isInteger(rule.priority)).toBe(true);
      expect(rule.priority).toBeLessThan(BUDGET.share.length);
    }
  });

  it('prices a snap of noise at a fraction of a held note', () => {
    const crackles: MusicCue[] = Array.from({ length: 5 }, (_, i) => ({
      after: 0,
      cue: { voice: 'crackle', level: -10, seed: i },
    }));
    expect(costOf(crackles)).toBeCloseTo(1, 9);
    expect(costOf([{ after: 0, cue: { voice: 'pad', level: -10, seed: 1 } }])).toBe(1);
  });
});

describe('what building sounds like', () => {
  it('sets a block down with a knock, and a crackle of scrap or a tap of a better material', () => {
    const scrap = effectForEdit(edit(SCRAP), 0);
    expect(scrap).toMatchObject({ kind: 'place', at: { x: 5.5, y: 3.5, z: -6.5 } });
    expect(voices(scrap)).toEqual(['step', 'crackle']);
    expect(voices(effectForEdit(edit(COMPOSITE), 0))).toEqual(['step', 'tick']);
    expect(voices(effectForEdit(edit(ALLOY), 0))).toEqual(['step', 'tick']);
    // The best material has a glassy note on top.
    expect(voices(effectForEdit(edit(ENERGY), 0))).toEqual(['step', 'tick', 'pluck']);
  });

  it('knocks lower on a better material and higher on a lighter piece', () => {
    const knock = (state: number): number => {
      const effect = effectForEdit(edit(state), 0);
      return effect?.cues[0]?.cue.hz ?? 0;
    };
    // Each is within the 5% a seed moves it by.
    expect(knock(SCRAP)).toBeGreaterThan(120 * 0.95);
    expect(knock(SCRAP)).toBeLessThan(120 * 1.05);
    expect(knock(ENERGY)).toBeGreaterThan(180 * 0.95);
    expect(knock(ENERGY)).toBeLessThan(180 * 1.05);
    const slab = knock(packState(slabShape(false), MATERIAL.scrap));
    const wedge = knock(packState(wedgeShape(0), MATERIAL.scrap));
    expect(slab).toBeGreaterThan(120 * 1.16 * 0.95);
    expect(slab).toBeLessThan(120 * 1.16 * 1.05);
    expect(wedge).toBeGreaterThan(120 * 1.08 * 0.95);
    expect(wedge).toBeLessThan(120 * 1.08 * 1.05);
  });

  it('breaks a block with a snap of debris and a collapse, and a machine’s bite adds the earth', () => {
    const player = effectForEdit(edit(0, 2), SCRAP);
    expect(player?.kind).toBe('break');
    expect(voices(player)).toEqual(['crackle', 'crackle', 'crackle', 'crackle', 'thud']);
    const machine = effectForEdit(edit(0, NO_PLAYER), SCRAP);
    expect(voices(machine)).toEqual([...voices(player), 'rumble']);
    // A better material rings as it falls.
    expect(voices(effectForEdit(edit(0, 2), ALLOY))).toContain('tick');
    expect(voices(player)).not.toContain('tick');
  });

  it('is told apart from setting down by what the cell held, not by what it holds', () => {
    const set = effectForEdit(edit(COMPOSITE), 0);
    const raised = effectForEdit(edit(COMPOSITE), SCRAP);
    const broken = effectForEdit(edit(0), COMPOSITE);
    expect([set?.kind, raised?.kind, broken?.kind]).toEqual(['place', 'raise', 'break']);
  });

  it('raises a piece with a whirr and a chime that has more notes for a higher level', () => {
    const notes = (state: number, previous: number): number =>
      voices(effectForEdit(edit(state), previous)).filter((voice) => voice === 'pluck').length;
    expect(notes(COMPOSITE, SCRAP)).toBe(2);
    expect(notes(ALLOY, COMPOSITE)).toBe(3);
    expect(notes(ENERGY, ALLOY)).toBe(4);
    expect(voices(effectForEdit(edit(COMPOSITE), SCRAP))[0]).toBe('servo');
    // The chime rises: each note after the first is at least the one before it.
    const hz = (effectForEdit(edit(ENERGY), ALLOY)?.cues ?? [])
      .filter(({ cue }) => cue.voice === 'pluck')
      .map(({ cue }) => cue.hz ?? 0);
    expect([...hz].sort((a, b) => a - b)).toEqual(hz);
  });

  it('sounds every module differently when it is set down, and a heavier knock than a block', () => {
    const seen = new Set<string>();
    for (const module of Object.values(MODULE)) {
      const state = packState(moduleShape(module, 0), 1);
      const effect = effectForEdit(edit(state), 0);
      expect(effect?.kind).toBe('module');
      expect(voices(effect)[0]).toBe('step');
      seen.add(JSON.stringify(voices(effect)));
    }
    expect(seen.size).toBeGreaterThanOrEqual(6);
    const generator = effectForEdit(edit(packState(moduleShape(MODULE.generator, 0), 1)), 0);
    expect(voices(generator)).toContain('whoom');
    const terminal = effectForEdit(edit(packState(moduleShape(MODULE.terminal, 2), 1)), 0);
    expect(voices(terminal).filter((voice) => voice === 'blip')).toHaveLength(3);
  });

  it('raises a module with a heavy knock first, and takes one apart with a collapse and a motor running down', () => {
    const turret = packState(moduleShape(MODULE.turret, 1), 1);
    const better = packState(moduleShape(MODULE.turret, 1), 2);
    const raised = effectForEdit(edit(better), turret);
    expect(raised?.kind).toBe('raise');
    expect(voices(raised).slice(0, 2)).toEqual(['step', 'servo']);
    const broken = effectForEdit(edit(0), better);
    expect(broken?.kind).toBe('module');
    expect(voices(broken)).toContain('thud');
    const falling = broken?.cues.find(({ cue }) => cue.voice === 'servo')?.cue;
    expect(falling?.to).toBeLessThan(falling?.hz ?? 0);
  });

  it('makes no sound for a change that changes nothing', () => {
    expect(effectForEdit(edit(SCRAP), SCRAP)).toBeNull();
    expect(effectForEdit(edit(0), 0)).toBeNull();
  });

  it('is the same sound on every screen for the same word, and a different one for another cell', () => {
    const one = effectForEdit(edit(ALLOY), 0);
    const two = effectForEdit(edit(ALLOY), 0);
    expect(two).toEqual(one);
    const elsewhere = effectForEdit(edit(ALLOY, 2, 9, 3, -7), 0);
    expect(elsewhere?.key).not.toBe(one?.key);
    expect(elsewhere?.cues[0]?.cue.seed).not.toBe(one?.cues[0]?.cue.seed);
  });

  it('tells what was done to a cell apart, so that a module broken just after it was set down is not taken for a repeat', () => {
    const generator = packState(moduleShape(MODULE.generator, 0), MATERIAL.scrap);
    const placed = effectForEdit(edit(generator), 0);
    const broken = effectForEdit(edit(0), generator);
    expect([placed?.kind, broken?.kind]).toEqual(['module', 'module']);
    expect(broken?.key).not.toBe(placed?.key);
    // Through a governor: the second is heard at once, and a repeat of the first is not.
    const governor = new Governor();
    expect(governor.admit('module', 2, 10, placed?.key)).toBe(true);
    expect(governor.admit('module', 2, 10.01, broken?.key)).toBe(true);
    expect(governor.admit('module', 2, 10.02, placed?.key)).toBe(false);
  });

  it('writes only cues that are quieter than the voice’s own full level and start within a second', () => {
    const effects: (Effect | null)[] = [
      effectForEdit(edit(SCRAP), 0),
      effectForEdit(edit(ENERGY), 0),
      effectForEdit(edit(0, NO_PLAYER), ENERGY),
      effectForEdit(edit(ENERGY), ALLOY),
      effectForRefusal(),
      effectForHarvest(harvest(), { x: 0, y: 0, z: 0 }),
      ...effectsForPower(
        [
          { x: 1, y: 2, z: 3, on: true },
          { x: 4, y: 5, z: 6, on: false },
        ],
        HERE,
      ),
      ...Object.values(MODULE).flatMap((module) => [
        effectForEdit(edit(packState(moduleShape(module, 0), 1)), 0),
        effectForEdit(edit(0), packState(moduleShape(module, 0), 1)),
      ]),
    ];
    for (const effect of effects) {
      expect(effect).not.toBeNull();
      expect(effect?.cues.length).toBeGreaterThan(0);
      for (const { after, cue } of effect?.cues ?? []) {
        expect(cue.level).toBeLessThan(0);
        expect(cue.level).toBeGreaterThan(-50);
        expect(after).toBeGreaterThanOrEqual(0);
        expect(after).toBeLessThan(1);
        expect(Number.isInteger(cue.seed)).toBe(true);
        expect(cue.hz === undefined || cue.hz > 0).toBe(true);
      }
    }
  });
});

describe('what power sounds like', () => {
  const flip = (x: number, on: boolean) => ({ x, y: 0, z: 0, on });

  it('winds up for the nearest module that came on and down for the nearest that went dark', () => {
    const effects = effectsForPower(
      [flip(30, true), flip(6, true), flip(12, false), flip(50, false), flip(20, true)],
      HERE,
    );
    expect(effects.map((effect) => effect.kind)).toEqual(['power', 'power']);
    expect(effects[0]?.at).toEqual({ x: 6.5, y: 0.5, z: 0.5 });
    expect(effects[1]?.at).toEqual({ x: 12.5, y: 0.5, z: 0.5 });
    expect(voices(effects[0])).toEqual(['servo', 'blip']);
    expect(voices(effects[1])).toEqual(['servo']);
    const up = effects[0]?.cues[0]?.cue;
    const down = effects[1]?.cues[0]?.cue;
    expect(up?.to).toBeGreaterThan(up?.hz ?? 0);
    expect(down?.to).toBeLessThan(down?.hz ?? 0);
    // The two directions are different sources for the governor.
    expect(effects[0]?.key).not.toBe(effects[1]?.key);
  });

  it('makes one sound for a direction with a listener unknown, and none for none', () => {
    expect(effectsForPower([], HERE)).toEqual([]);
    expect(effectsForPower([flip(1, true), flip(2, true)], null)).toHaveLength(1);
    expect(effectsForPower([flip(1, false)], null)).toHaveLength(1);
  });
});

function harvest(rest: Partial<HarvestEvent> = {}): HarvestEvent {
  return { by: 2, node: 4, material: 1, gained: 3, left: 2, full: false, ...rest };
}

describe('what a refusal and a harvest sound like', () => {
  it('turns a click away with two dull knocks, in the head', () => {
    const effect = effectForRefusal();
    expect(effect.kind).toBe('refuse');
    expect(effect.at).toBeUndefined();
    expect(voices(effect)).toEqual(['step', 'step', 'tick']);
    expect(effect.cues[1]?.cue.hz).toBeLessThan(effect.cues[0]?.cue.hz ?? 0);
  });

  it('strips a heap with a snap of scrap and a ring that is higher for a better grade', () => {
    const at = { x: 3, y: 1, z: 2 };
    const ring = (material: number): number => {
      const effect = effectForHarvest(harvest({ material }), at);
      return effect.cues.find(({ cue }) => cue.voice === 'tick')?.cue.hz ?? 0;
    };
    expect(ring(1)).toBeLessThan(ring(2));
    expect(ring(2)).toBeLessThan(ring(3));
    expect(ring(3)).toBeLessThan(ring(4));
    const effect = effectForHarvest(harvest(), at);
    expect(effect).toMatchObject({ kind: 'harvest', at, key: 4 });
    expect(voices(effect).filter((voice) => voice === 'crackle')).toHaveLength(3);
  });

  it('knocks dully where a full pool takes nothing, and drops the heap when it is gone', () => {
    const at = { x: 0, y: 0, z: 0 };
    const full = effectForHarvest(harvest({ full: true }), at);
    expect(voices(full)).not.toContain('tick');
    const gone = effectForHarvest(harvest({ left: 0 }), at);
    expect(voices(gone)).toEqual(expect.arrayContaining(['thud', 'rumble']));
    expect(voices(effectForHarvest(harvest({ left: 1 }), at))).not.toContain('thud');
  });
});
