import { describe, expect, it } from 'vitest';
import { createCueCursor } from '../../src/shared/cue-cursor';

const cue = (at: number, name = `c${at}`) => ({ at, name });

describe('createCueCursor', () => {
  it('hands out every cue that starts at or before the time asked for, once, in order', () => {
    const cursor = createCueCursor([cue(1), cue(2), cue(3), cue(5)]);
    const seen: string[] = [];
    cursor.take(0.5, (c) => seen.push(c.name));
    expect(seen).toEqual([]);
    cursor.take(2, (c) => seen.push(c.name));
    expect(seen).toEqual(['c1', 'c2']);
    cursor.take(2, (c) => seen.push(c.name));
    expect(seen).toEqual(['c1', 'c2']);
    cursor.take(10, (c) => seen.push(c.name));
    expect(seen).toEqual(['c1', 'c2', 'c3', 'c5']);
    expect(cursor.remaining).toBe(0);
  });

  it('puts an unsorted score in order, and keeps cues at the same moment in the order they were given', () => {
    const cursor = createCueCursor([cue(3, 'late'), cue(1, 'first'), cue(1, 'second'), cue(2)]);
    const seen: string[] = [];
    cursor.take(Number.POSITIVE_INFINITY, (c) => seen.push(c.name));
    expect(seen).toEqual(['first', 'second', 'c2', 'late']);
  });

  it('counts down what is left, and skipping marks cues taken without handing them out', () => {
    const cursor = createCueCursor([cue(1), cue(2), cue(3), cue(4)]);
    expect(cursor.remaining).toBe(4);
    cursor.skip(2);
    expect(cursor.remaining).toBe(2);
    const seen: string[] = [];
    cursor.take(10, (c) => seen.push(c.name));
    expect(seen).toEqual(['c3', 'c4']);
    expect(cursor.remaining).toBe(0);
  });

  it('does not change the list it was made from', () => {
    const cues = [cue(2), cue(1)];
    createCueCursor(cues).take(5, () => undefined);
    expect(cues.map((c) => c.at)).toEqual([2, 1]);
  });

  it('copes with an empty score', () => {
    const cursor = createCueCursor([]);
    cursor.take(5, () => {
      throw new Error('nothing to hand out');
    });
    cursor.skip(5);
    expect(cursor.remaining).toBe(0);
  });
});
