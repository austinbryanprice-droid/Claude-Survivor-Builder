import {
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three';
import { hash3, unitFloat } from '../shared/hash';
import { BLOCK, DECK, type ProvingGround } from './proving-ground-layout';
import { createDeckTexture, createPlateTexture } from './textures';

/** Multiplies the pale plate texture, so each feature reads as its own material. */
const TINTS: Record<number, string> = {
  [BLOCK.wall]: '#8d98a5',
  [BLOCK.stairs]: '#d4c3a8',
  [BLOCK.gap]: '#86cddc',
  [BLOCK.tower]: '#a3afbd',
  [BLOCK.towerCap]: '#f6b04a',
  [BLOCK.pyramid]: '#dcae6c',
  [BLOCK.pillar]: '#b3c2d2',
  [BLOCK.gate]: '#939ea9',
  [BLOCK.tunnel]: '#b0b9c4',
  [BLOCK.rail]: '#f6b04a',
};
const FALLBACK_TINT = '#c0c8d0';

export interface ProvingGroundView {
  readonly object: Group;
  dispose(): void;
}

/** Draws the deck and every block of the layout; collision reads the same cells, so what you see is what you hit. */
export function createProvingGroundView(
  world: ProvingGround,
  maxAnisotropy: number,
): ProvingGroundView {
  const group = new Group();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  const deckTexture = track(createDeckTexture(maxAnisotropy));
  const deckSize = DECK.max - DECK.min + 1;
  deckTexture.repeat.set(deckSize / 4, deckSize / 4);
  const deck = new Mesh(
    track(new PlaneGeometry(deckSize, deckSize)),
    track(new MeshStandardMaterial({ map: deckTexture, roughness: 0.82, metalness: 0.25 })),
  );
  deck.rotation.x = -Math.PI / 2;
  deck.position.set((DECK.min + DECK.max + 1) / 2, 0, (DECK.min + DECK.max + 1) / 2);
  deck.receiveShadow = true;
  group.add(deck);

  // Dusty ground beyond the walls, seen from the lookout and lost in the haze.
  const outside = new Mesh(
    track(new PlaneGeometry(1400, 1400)),
    track(new MeshStandardMaterial({ color: '#7a6853', roughness: 1, metalness: 0 })),
  );
  outside.rotation.x = -Math.PI / 2;
  outside.position.y = -0.06;
  outside.receiveShadow = true;
  group.add(outside);

  const count = world.cells.size;
  const blocks = new InstancedMesh(
    track(new BoxGeometry(1, 1, 1)),
    track(
      new MeshStandardMaterial({
        map: track(createPlateTexture(maxAnisotropy)),
        roughness: 0.74,
        metalness: 0.2,
      }),
    ),
    count,
  );
  const matrix = new Matrix4();
  const color = new Color();
  const tints = new Map<number, Color>();
  let index = 0;
  world.cells.forEach((x, y, z, id) => {
    let tint = tints.get(id);
    if (!tint) {
      tint = new Color(TINTS[id] ?? FALLBACK_TINT);
      tints.set(id, tint);
    }
    // A little brightness variation per block keeps big flat walls from looking printed.
    const variation = 0.88 + 0.24 * unitFloat(hash3(99, x, y, z));
    blocks.setMatrixAt(index, matrix.makeTranslation(x + 0.5, y + 0.5, z + 0.5));
    blocks.setColorAt(index, color.copy(tint).multiplyScalar(variation));
    index++;
  });
  blocks.instanceMatrix.needsUpdate = true;
  if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true;
  blocks.castShadow = true;
  blocks.receiveShadow = true;
  group.add(blocks);

  return {
    object: group,
    dispose() {
      blocks.dispose();
      disposables.forEach((item) => item.dispose());
    },
  };
}
