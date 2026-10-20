import {
  CanvasTexture,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import { createRng } from '../shared/hash';

/**
 * Procedural textures, drawn once at startup with seeded randomness so every browser makes the
 * same ones. They stand in for the shared material library that arrives with the voxel system.
 */

function makeCanvas(size: number): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2D canvas is not available');
  return { canvas, g };
}

function finish(canvas: HTMLCanvasElement, maxAnisotropy: number, repeat: boolean): Texture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = maxAnisotropy;
  if (repeat) {
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
  }
  return texture;
}

function speckle(
  g: CanvasRenderingContext2D,
  rng: () => number,
  size: number,
  count: number,
  strength: number,
): void {
  for (let i = 0; i < count; i++) {
    const dark = rng() < 0.55;
    g.fillStyle = dark ? `rgba(0,0,0,${strength})` : `rgba(255,255,255,${strength * 0.8})`;
    g.fillRect(rng() * size, rng() * size, 1 + rng() * 2.5, 1 + rng() * 2.5);
  }
}

/**
 * A light, neutral armor plate for one block face: a dark seam, a raised bevel, a recessed inner
 * panel and four rivets. Instance colors tint it per feature, so the base stays pale.
 */
export function createPlateTexture(maxAnisotropy: number): Texture {
  const size = 128;
  const { canvas, g } = makeCanvas(size);
  const rng = createRng(7);

  g.fillStyle = '#b9c0c8';
  g.fillRect(0, 0, size, size);
  speckle(g, rng, size, 1400, 0.05);

  // Faint brushed streaks.
  for (let i = 0; i < 26; i++) {
    const y = rng() * size;
    g.fillStyle = `rgba(255,255,255,${0.03 + rng() * 0.04})`;
    g.fillRect(rng() * size * 0.4, y, size * (0.3 + rng() * 0.6), 1);
  }

  // Raised bevel: light on the top and left, shade on the bottom and right.
  const bevel = 7;
  g.fillStyle = 'rgba(255,255,255,0.28)';
  g.fillRect(0, 0, size, bevel);
  g.fillRect(0, 0, bevel, size);
  g.fillStyle = 'rgba(0,0,0,0.30)';
  g.fillRect(0, size - bevel, size, bevel);
  g.fillRect(size - bevel, 0, bevel, size);

  // Recessed inner panel.
  const inset = 17;
  g.fillStyle = 'rgba(0,0,0,0.10)';
  g.fillRect(inset, inset, size - inset * 2, size - inset * 2);
  g.strokeStyle = 'rgba(0,0,0,0.32)';
  g.lineWidth = 2;
  g.strokeRect(inset, inset, size - inset * 2, size - inset * 2);
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.strokeRect(inset + 2, inset + 2, size - inset * 2 - 4, size - inset * 2 - 4);

  // Rivets.
  for (const [cx, cy] of [
    [11, 11],
    [size - 11, 11],
    [11, size - 11],
    [size - 11, size - 11],
  ] as const) {
    g.fillStyle = 'rgba(0,0,0,0.38)';
    g.beginPath();
    g.arc(cx + 0.8, cy + 0.8, 3.2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath();
    g.arc(cx - 0.4, cy - 0.4, 2.4, 0, Math.PI * 2);
    g.fill();
  }

  // The seam where two plates meet.
  g.strokeStyle = 'rgba(0,0,0,0.65)';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, size - 3, size - 3);

  return finish(canvas, maxAnisotropy, false);
}

/**
 * Deck plating that tiles every four blocks: a faint line at every block and a stronger one at
 * every fourth, so speed and distance read at a glance.
 */
export function createDeckTexture(maxAnisotropy: number): Texture {
  const size = 256;
  const cell = size / 4;
  const { canvas, g } = makeCanvas(size);
  const rng = createRng(11);

  g.fillStyle = '#76808b';
  g.fillRect(0, 0, size, size);

  // Each block-sized plate is a touch lighter or darker than its neighbors.
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const tone = rng() - 0.5;
      g.fillStyle = tone > 0 ? `rgba(255,255,255,${tone * 0.07})` : `rgba(0,0,0,${-tone * 0.16})`;
      g.fillRect(col * cell, row * cell, cell, cell);
    }
  }
  speckle(g, rng, size, 2600, 0.06);

  for (let i = 0; i <= 4; i++) {
    const major = i % 4 === 0;
    g.fillStyle = major ? 'rgba(255,214,150,0.30)' : 'rgba(255,255,255,0.10)';
    const w = major ? 3 : 2;
    g.fillRect(i * cell - w / 2, 0, w, size);
    g.fillRect(0, i * cell - w / 2, size, w);
  }
  // Small rivets at the block corners.
  g.fillStyle = 'rgba(0,0,0,0.30)';
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      for (const [dx, dy] of [
        [8, 8],
        [cell - 8, 8],
        [8, cell - 8],
        [cell - 8, cell - 8],
      ] as const) {
        g.beginPath();
        g.arc(col * cell + dx, row * cell + dy, 2, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  return finish(canvas, maxAnisotropy, true);
}
