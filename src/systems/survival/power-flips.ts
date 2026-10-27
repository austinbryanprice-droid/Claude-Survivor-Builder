import type { PowerFlip } from '../../shared/effect-sound';
import { cellKey } from '../../shared/solid';

/** Visits each module that takes part in power, with whether it has power: what `PowerGrid.forEach` does. */
export type PowerModules = (visit: (x: number, y: number, z: number, on: boolean) => void) => void;

/**
 * Which modules came on or went dark between one look at the power grid and the next. Only a module
 * that stood at both looks counts: one that was just set down, or just broken, did not change its
 * power, it came or went, and has its own sound. The first look only learns how things stand.
 */
export class PowerFlips {
  private last = new Map<number, boolean>();
  private next = new Map<number, boolean>();
  private readonly flips: PowerFlip[] = [];
  private learned = false;

  /** Looks at the modules again. The list it returns is used again by the next look. */
  look(modules: PowerModules): readonly PowerFlip[] {
    const { last, next, flips } = this;
    flips.length = 0;
    next.clear();
    modules((x, y, z, on) => {
      const key = cellKey(x, y, z);
      next.set(key, on);
      if (this.learned && last.get(key) === !on) flips.push({ x, y, z, on });
    });
    this.last = next;
    this.next = last;
    this.learned = true;
    return flips;
  }
}
