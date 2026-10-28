import { describe, expect, it } from 'vitest';
import {
  ENEMY_FLAG,
  ENEMY_KIND,
  createEnemyPose,
  type EnemyPose,
} from '../../src/shared/enemy-state';
import { Fall, MachineEdges } from '../../src/shared/fight-edges';

function machine(id: number, flags = 0, kind: number = ENEMY_KIND.crawler, x = 10): EnemyPose {
  return { ...createEnemyPose(), id, kind, flags, x, y: 11, z: -4 };
}

/** What the moments of a look were, as plain values, since the list and what is in it are used again. */
const moments = (edges: MachineEdges, machines: EnemyPose[]) =>
  edges.look(machines).map(({ what, id, kind }) => ({ what, id, kind }));

describe('what the machines did between two looks', () => {
  it('only learns how things stand on the first look, whatever it finds', () => {
    const edges = new MachineEdges();
    expect(moments(edges, [machine(1), machine(2, ENEMY_FLAG.attack)])).toEqual([]);
    // And it knows them now: nothing is new, and the one winding up is not winding up again.
    expect(moments(edges, [machine(1), machine(2, ENEMY_FLAG.attack)])).toEqual([]);
  });

  it('hears a machine that was not there before come out of the ground, with its kind and place', () => {
    const edges = new MachineEdges();
    edges.look([machine(1)]);
    const found = edges.look([machine(1), machine(7, 0, ENEMY_KIND.flyer, 33)]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      what: 'rose',
      id: 7,
      kind: ENEMY_KIND.flyer,
      x: 33,
      y: 11,
      z: -4,
    });
  });

  it('hears a machine begin to wind up when its flag comes up, and land the blow when it goes down', () => {
    const edges = new MachineEdges();
    edges.look([machine(1, 0, ENEMY_KIND.armored)]);
    expect(moments(edges, [machine(1, ENEMY_FLAG.attack, ENEMY_KIND.armored)])).toEqual([
      { what: 'windup', id: 1, kind: ENEMY_KIND.armored },
    ]);
    // Still winding up: nothing to hear.
    expect(moments(edges, [machine(1, ENEMY_FLAG.attack, ENEMY_KIND.armored)])).toEqual([]);
    expect(moments(edges, [machine(1, ENEMY_FLAG.hurt, ENEMY_KIND.armored)])).toEqual([
      { what: 'bit', id: 1, kind: ENEMY_KIND.armored },
    ]);
    expect(moments(edges, [machine(1, 0, ENEMY_KIND.armored)])).toEqual([]);
  });

  it('takes no notice of a machine being struck, which only raises its other flag', () => {
    const edges = new MachineEdges();
    edges.look([machine(1)]);
    expect(moments(edges, [machine(1, ENEMY_FLAG.hurt)])).toEqual([]);
    expect(moments(edges, [machine(1, 0)])).toEqual([]);
    // Struck while it winds up: still winding up, no second wind-up.
    expect(moments(edges, [machine(1, ENEMY_FLAG.attack)])).toHaveLength(1);
    expect(moments(edges, [machine(1, ENEMY_FLAG.attack | ENEMY_FLAG.hurt)])).toEqual([]);
    expect(moments(edges, [machine(1, ENEMY_FLAG.attack)])).toEqual([]);
  });

  it('does not take a machine that is gone for one that landed a blow, and still knows its kind', () => {
    const edges = new MachineEdges();
    edges.look([machine(1, ENEMY_FLAG.attack, ENEMY_KIND.breacher)]);
    expect(moments(edges, [])).toEqual([]);
    // The word of its end comes a moment after it is gone from the screen, and names it.
    for (let frame = 0; frame < 30; frame++) edges.look([]);
    expect(edges.kindOf(1)).toBe(ENEMY_KIND.breacher);
    expect(edges.kindOf(99)).toBe(-1);
  });

  it('remembers the latest few hundred machines and lets the oldest go', () => {
    const edges = new MachineEdges();
    edges.look([]);
    for (let id = 1; id <= 400; id++) edges.look([machine(id, 0, id % 4)]);
    expect(edges.kindOf(400)).toBe(0);
    expect(edges.kindOf(399)).toBe(3);
    expect(edges.kindOf(250)).toBe(2);
    expect(edges.kindOf(1)).toBe(-1);
  });

  it('reports several machines in the order of the sample, and many things at once', () => {
    const edges = new MachineEdges();
    edges.look([machine(1), machine(2, ENEMY_FLAG.attack)]);
    const found = moments(edges, [
      machine(1, ENEMY_FLAG.attack),
      machine(2, 0),
      machine(3),
      machine(4, ENEMY_FLAG.attack, ENEMY_KIND.breacher),
    ]);
    expect(found).toEqual([
      { what: 'windup', id: 1, kind: ENEMY_KIND.crawler },
      { what: 'bit', id: 2, kind: ENEMY_KIND.crawler },
      { what: 'rose', id: 3, kind: ENEMY_KIND.crawler },
      { what: 'rose', id: 4, kind: ENEMY_KIND.breacher },
    ]);
  });

  it('starts over after a reset: the next look only learns, and nothing is remembered', () => {
    const edges = new MachineEdges();
    edges.look([machine(1, ENEMY_FLAG.attack, ENEMY_KIND.flyer)]);
    edges.reset();
    expect(edges.kindOf(1)).toBe(-1);
    // A machine with the same number in the next run is a new machine, which the first look does not call new.
    expect(moments(edges, [machine(1, 0)])).toEqual([]);
    expect(moments(edges, [machine(1, ENEMY_FLAG.attack)])).toEqual([
      { what: 'windup', id: 1, kind: ENEMY_KIND.crawler },
    ]);
  });

  it('uses the same list and the same moments again, so that a frame costs nothing to look', () => {
    const edges = new MachineEdges();
    edges.look([machine(1)]);
    const first = edges.look([machine(1), machine(2)]);
    const moment = first[0];
    const second = edges.look([machine(1), machine(2), machine(3)]);
    expect(second).toBe(first);
    expect(second[0]).toBe(moment);
    expect(second[0]).toMatchObject({ what: 'rose', id: 3 });
  });
});

describe('what a meter lost between two looks', () => {
  it('says how many points it fell by, and nothing when it rose or held', () => {
    const fall = new Fall();
    expect(fall.look(100)).toBe(0);
    expect(fall.look(100)).toBe(0);
    expect(fall.look(92)).toBe(8);
    expect(fall.look(92)).toBe(0);
    // Coming back is not a loss.
    expect(fall.look(100)).toBe(0);
    expect(fall.look(60)).toBe(40);
    expect(fall.look(0)).toBe(60);
  });

  it('only learns on the first look, so that a meter found low is not a blow just dealt', () => {
    const fall = new Fall();
    expect(fall.look(30)).toBe(0);
    expect(fall.look(30)).toBe(0);
  });

  it('forgets what it saw when there is no meter to show, and when told to', () => {
    const fall = new Fall();
    fall.look(100);
    expect(fall.look(Number.NaN)).toBe(0);
    // The meter comes back lower than it went: that is a new meter, not a loss.
    expect(fall.look(40)).toBe(0);
    expect(fall.look(35)).toBe(5);
    fall.reset();
    expect(fall.look(10)).toBe(0);
  });
});
