import type { Page } from '@playwright/test';
import { TURRET_GUN } from '../../../src/shared/turret';

/** A cell of the world, as the debug hooks give one. */
export interface Cell {
  x: number;
  y: number;
  z: number;
}

/**
 * Where the tip of the barrel of the turret in a cell is on this page, and where the shared gun
 * geometry (`turretMuzzle`) says the muzzle is for the end of the last shot that turret was seen to
 * fire. Both are read in one task, so no shot lands between them. Null while the page has seen no shot
 * from that turret or draws no turret there.
 */
export function barrelOf(page: Page, cell: Cell) {
  return page.evaluate(
    ([x, y, z, reach, pivot]) => {
      const { game, mp } = window.__ashbound!;
      const shot = mp!
        .shots()
        .shots.filter(
          (s) => s.turret && s.turret[0] === x && s.turret[1] === y && s.turret[2] === z,
        )
        .pop();
      const modules = (
        game.world as unknown as {
          view: {
            modules: {
              at(
                x: number,
                y: number,
                z: number,
              ):
                | {
                    getObjectByName(name: string): {
                      position: { clone(): { set(x: number, y: number, z: number): unknown } };
                      updateWorldMatrix(parents: boolean, children: boolean): void;
                      localToWorld(point: unknown): { x: number; y: number; z: number };
                      rotation: { y: number; z: number };
                    } | null;
                  }
                | undefined;
            };
          };
        }
      ).view.modules;
      const head = modules.at(x!, y!, z!)?.getObjectByName('head');
      if (!shot || !head) return null;
      head.updateWorldMatrix(true, false);
      const tip = head.localToWorld(head.position.clone().set(reach!, 0, 0));
      const px = x! + 0.5;
      const py = y! + pivot!;
      const pz = z! + 0.5;
      const length = Math.hypot(shot.x - px, shot.y - py, shot.z - pz);
      return {
        tip: [tip.x, tip.y, tip.z],
        want: [
          px + ((shot.x - px) / length) * reach!,
          py + ((shot.y - py) / length) * reach!,
          pz + ((shot.z - pz) / length) * reach!,
        ],
        turned: [head.rotation.y, head.rotation.z],
      };
    },
    [cell.x, cell.y, cell.z, TURRET_GUN.reach, TURRET_GUN.pivot] as const,
  );
}

/**
 * Sends one crawler in at the first spot on open ground, near a cell and within a turret's range of it,
 * and returns its id, or null when none of the spots is open. Only a host (or single-player) can.
 */
export function sendCrawlerNear(page: Page, cell: Cell): Promise<number | null> {
  return page.evaluate(
    ([x, z]) => {
      const mp = window.__ashbound!.mp!;
      for (const [dx, dz] of [
        [9, 0],
        [0, 9],
        [-9, 0],
        [0, -9],
        [7, 7],
        [7, -7],
        [-7, 7],
        [-7, -7],
        [6, 0],
        [0, 6],
        [-6, 0],
        [0, -6],
      ] as const) {
        const id = mp.spawnCrawlerAt(x! + 0.5 + dx, z! + 0.5 + dz);
        if (id !== null) return id;
      }
      return null;
    },
    [cell.x, cell.z] as const,
  );
}
