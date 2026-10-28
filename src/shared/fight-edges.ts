import { ENEMY_FLAG, type EnemyPose } from './enemy-state';
import type { MachineHeard, MachineMoment } from './fight-sound';

/**
 * What changed in the fight from one look at it to the next, for the sounds that follow a change
 * (`fight-sound.ts`): which machines came out of the ground, began to wind up a blow and landed it,
 * and how many points a meter has fallen by. The screen is only ever told how things stand, so the
 * moments are found by comparing a look with the one before; the first look after a start, or after
 * `reset`, only learns how things stand, since what was already there did not just happen.
 */

interface Moment {
  what: MachineMoment;
  id: number;
  kind: number;
  x: number;
  y: number;
  z: number;
}

/** How many machines' kinds are remembered: a few waves' worth, so that the word of an end finds its machine however late it comes. */
const REMEMBERED_KINDS = 256;

export class MachineEdges {
  private last = new Map<number, number>();
  private next = new Map<number, number>();
  private readonly kinds = new Map<number, number>();
  private readonly pool: Moment[] = [];
  private readonly found: Moment[] = [];
  private learned = false;

  /**
   * Looks at the machines again and says what each did since the last look. A machine that is new
   * rose; one whose `attack` flag has come up began to wind up (a breacher, to charge); one whose
   * flag has gone down while it still stands landed its blow (a breacher that goes off is gone
   * instead, and the host says so). The list and what is in it are used again by the next look.
   */
  look(machines: readonly EnemyPose[]): readonly MachineHeard[] {
    const { last, next, found, kinds } = this;
    next.clear();
    found.length = 0;
    for (const machine of machines) {
      const before = last.get(machine.id);
      next.set(machine.id, machine.flags);
      if (!kinds.has(machine.id)) this.remember(machine);
      if (!this.learned) continue;
      if (before === undefined) {
        this.note('rose', machine);
        continue;
      }
      const wasWinding = (before & ENEMY_FLAG.attack) !== 0;
      const isWinding = (machine.flags & ENEMY_FLAG.attack) !== 0;
      if (isWinding && !wasWinding) this.note('windup', machine);
      else if (wasWinding && !isWinding) this.note('bit', machine);
    }
    this.last = next;
    this.next = last;
    this.learned = true;
    return found;
  }

  /**
   * The kind of a machine it has seen in this run, or -1: a felled machine is gone from the screen
   * by the time its end is heard, and the word can come a few frames after the machine went.
   */
  kindOf(id: number): number {
    return this.kinds.get(id) ?? -1;
  }

  /** Forgets what it has seen: the next look only learns. For a new run, and for a screen that was not listening. */
  reset(): void {
    this.last.clear();
    this.next.clear();
    this.kinds.clear();
    this.found.length = 0;
    this.learned = false;
  }

  private remember(machine: EnemyPose): void {
    const { kinds } = this;
    kinds.set(machine.id, machine.kind);
    if (kinds.size > REMEMBERED_KINDS) {
      // The oldest first: a map keeps its keys in the order they came.
      for (const old of kinds.keys()) {
        kinds.delete(old);
        if (kinds.size <= REMEMBERED_KINDS * 0.75) break;
      }
    }
  }

  private note(what: MachineMoment, machine: EnemyPose): void {
    const at = this.found.length;
    const moment = (this.pool[at] ??= { what, id: 0, kind: 0, x: 0, y: 0, z: 0 });
    moment.what = what;
    moment.id = machine.id;
    moment.kind = machine.kind;
    moment.x = machine.x;
    moment.y = machine.y;
    moment.z = machine.z;
    this.found.push(moment);
  }
}

/**
 * A meter that is watched for what it loses: how many points it has fallen by since the last look,
 * 0 if it has not fallen, risen (a respawn, a new run) or is being looked at for the first time. A
 * value that is not a number (no meter to show) forgets what was seen.
 */
export class Fall {
  private last = Number.NaN;

  look(value: number): number {
    const fell = this.last > value ? this.last - value : 0;
    this.last = value;
    return fell;
  }

  reset(): void {
    this.last = Number.NaN;
  }
}
