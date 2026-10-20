import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  type Texture,
} from 'three';
import { createRng } from '../../shared/hash';

/** Painted, alpha-cut plant textures. All shapes come from a seeded generator. */
export interface FoliageTextures {
  /** A conifer frond: stem and needles, base at the bottom edge. */
  readonly frond: Texture;
  /** A cluster of broad leaves for tree canopies. */
  readonly leaves: Texture;
  /** A tuft of grass blades, base at the bottom edge. */
  readonly grass: Texture;
  /** A grass tuft with flower heads painted white so the shader can tint them. */
  readonly flowers: Texture;
  dispose(): void;
}

type Rng = () => number;
type Mode = 'color' | 'mask';

interface Painter {
  readonly ctx: CanvasRenderingContext2D;
  readonly mode: Mode;
  readonly rng: Rng;
  readonly size: number;
  /** Fill style for a shape: the mask is always white. */
  paint(color: string): string;
}

/** Linear mix of two [r, g, b] triples written as a CSS color. */
function rgb(a: readonly number[], b: readonly number[], t: number): string {
  const c = (i: number): number =>
    Math.round((a[i] as number) + ((b[i] as number) - (a[i] as number)) * t);
  return `rgb(${c(0)}, ${c(1)}, ${c(2)})`;
}

function bake(size: number, seed: number, anisotropy: number, draw: (p: Painter) => void): Texture {
  const read = (mode: Mode): Uint8ClampedArray => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas is unavailable');
    const painter: Painter = {
      ctx,
      mode,
      rng: createRng(seed),
      size,
      paint: (color) => (mode === 'mask' ? '#fff' : color),
    };
    ctx.fillStyle = mode === 'mask' ? '#000' : 'rgb(40, 70, 32)';
    ctx.fillRect(0, 0, size, size);
    draw(painter);
    return ctx.getImageData(0, 0, size, size).data;
  };
  const color = read('color');
  const mask = read('mask');
  // Canvas rows run top to bottom, texture rows bottom to top: flip while packing.
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = ((size - 1 - y) * size + x) * 4;
      out[dst] = color[src] as number;
      out[dst + 1] = color[src + 1] as number;
      out[dst + 2] = color[src + 2] as number;
      out[dst + 3] = mask[src] as number;
    }
  }
  const texture = new DataTexture(out, size, size, RGBAFormat, UnsignedByteType);
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** One needle-bearing conifer frond. */
function paintFrond(p: Painter): void {
  const { ctx, rng, size } = p;
  const s = size / 512;
  const stem = (t: number): [number, number] => [(256 + 26 * t * t) * s, (506 - 492 * t) * s];
  const tangent = (t: number): [number, number] => {
    const dx = 52 * t * s;
    const dy = -492 * s;
    const l = Math.hypot(dx, dy);
    return [dx / l, dy / l];
  };
  const length = (t: number): number =>
    168 * s * Math.pow(1 - t, 0.5) * (0.34 + 0.66 * smooth(0, 0.18, t));

  const dark: readonly number[] = [14, 34, 24];
  const mid: readonly number[] = [34, 68, 38];
  const light: readonly number[] = [84, 116, 54];

  // A solid core keeps the frond readable at a distance, where thin needles would vanish.
  ctx.fillStyle = p.paint(rgb(dark, mid, 0.35));
  ctx.beginPath();
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const [x, y] = stem(t);
    ctx.lineTo(x - length(t) * 0.5, y + length(t) * 0.18);
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const [x, y] = stem(t);
    ctx.lineTo(x + length(t) * 0.5, y + length(t) * 0.18);
  }
  ctx.closePath();
  ctx.fill();

  // Needles, longest at the lower third, in two passes (back layer darker).
  for (let pass = 0; pass < 2; pass++) {
    const count = pass === 0 ? 90 : 120;
    for (let i = 0; i < count; i++) {
      const t = Math.pow((i + rng() * 0.8) / count, 0.9);
      const [x, y] = stem(t);
      const [tx, ty] = tangent(t);
      for (const side of [-1, 1]) {
        const spread = (54 - 24 * t + (rng() - 0.5) * 14) * (Math.PI / 180) * side;
        const c = Math.cos(spread);
        const sn = Math.sin(spread);
        const dx = tx * c - ty * sn;
        const dy = tx * sn + ty * c;
        const len = length(t) * (0.72 + 0.32 * rng()) * (pass === 0 ? 0.92 : 1);
        const w = (pass === 0 ? 8.5 : 6) * s * (1 - 0.35 * t);
        const shade = (pass === 0 ? 0.1 : 0.42) + 0.5 * rng() * (0.5 + 0.5 * t);
        ctx.fillStyle = p.paint(rgb(dark, light, shade));
        ctx.beginPath();
        ctx.moveTo(x - dy * w * 0.5, y + dx * w * 0.5);
        ctx.lineTo(x + dy * w * 0.5, y - dx * w * 0.5);
        ctx.lineTo(x + dx * len + dy * 0.8 * s, y + dy * len + 2.5 * s);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  // Brighter new growth at the tip.
  ctx.fillStyle = p.paint(rgb(mid, light, 0.8));
  ctx.beginPath();
  ctx.ellipse(stem(1)[0], stem(1)[1] + 26 * s, 8 * s, 30 * s, 0.06, 0, Math.PI * 2);
  ctx.fill();
  // The stem itself.
  ctx.strokeStyle = p.paint('rgb(38, 36, 22)');
  ctx.lineWidth = 3.5 * s;
  ctx.beginPath();
  for (let i = 0; i <= 12; i++) {
    const [x, y] = stem(i / 12);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/** A round cluster of leaves, dense at the middle and broken at the rim. */
function paintLeaves(p: Painter): void {
  const { ctx, rng, size } = p;
  const s = size / 512;
  const cx = 256 * s;
  const cy = 256 * s;
  const radius = 226 * s;

  const shadow: readonly number[] = [13, 32, 18];
  const body: readonly number[] = [34, 68, 30];
  const lit: readonly number[] = [86, 118, 44];

  // Solid core.
  ctx.fillStyle = p.paint(rgb(shadow, body, 0.5));
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.6, 0, Math.PI * 2);
  ctx.fill();

  const leaf = (
    x: number,
    y: number,
    rot: number,
    len: number,
    wid: number,
    shade: number,
  ): void => {
    ctx.fillStyle = p.paint(rgb(shadow, lit, shade));
    ctx.beginPath();
    ctx.ellipse(x, y, len * 0.5, wid * 0.5, rot, 0, Math.PI * 2);
    ctx.fill();
  };
  for (let layer = 0; layer < 3; layer++) {
    const count = layer === 0 ? 70 : layer === 1 ? 90 : 70;
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const r = radius * Math.sqrt(rng()) * (layer === 2 ? 0.92 : 1);
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      // Leaves point outward with some scatter, drooping a little.
      const rot = a + (rng() - 0.5) * 1.5 + 0.35;
      const len = (50 + 24 * rng()) * s;
      const wid = (24 + 10 * rng()) * s;
      // Upper layers and the upper-left of the card catch the light.
      const lightSide = 0.5 + 0.5 * (-Math.cos(a) - Math.sin(a)) * 0.7;
      const shade = Math.min(1, layer * 0.28 + 0.12 + 0.34 * lightSide * rng() + 0.2 * rng());
      leaf(x, y, rot, len, wid, shade);
      if (layer > 0 && rng() < 0.4) {
        // A pale midrib on some leaves reads as leaf detail up close.
        ctx.strokeStyle = p.paint(rgb(body, lit, 0.85));
        ctx.lineWidth = 1.6 * s;
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(rot) * len * 0.4, y - Math.sin(rot) * len * 0.4);
        ctx.lineTo(x + Math.cos(rot) * len * 0.4, y + Math.sin(rot) * len * 0.4);
        ctx.stroke();
      }
    }
  }
}

function blade(
  p: Painter,
  x: number,
  base: number,
  height: number,
  lean: number,
  width: number,
  dark: readonly number[],
  light: readonly number[],
): void {
  const { ctx } = p;
  const tipX = x + lean;
  const tipY = base - height;
  const gradient = ctx.createLinearGradient(0, base, 0, tipY);
  if (p.mode === 'mask') {
    gradient.addColorStop(0, '#fff');
    gradient.addColorStop(1, '#fff');
  } else {
    gradient.addColorStop(0, rgb(dark, dark, 0));
    gradient.addColorStop(0.55, rgb(dark, light, 0.55));
    gradient.addColorStop(1, rgb(dark, light, 1));
  }
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(x - width / 2, base + 4);
  ctx.quadraticCurveTo(x - width * 0.35 + lean * 0.25, base - height * 0.58, tipX, tipY);
  ctx.quadraticCurveTo(
    x + width * 0.35 + lean * 0.3,
    base - height * 0.55,
    x + width / 2,
    base + 4,
  );
  ctx.closePath();
  ctx.fill();
}

/** A tuft of curved blades rising from the bottom edge. */
function paintGrass(p: Painter, blades: number, tall: number): void {
  const { rng, size } = p;
  const s = size / 512;
  const dark: readonly number[] = [18, 42, 20];
  const light: readonly number[] = [100, 124, 54];
  // Short, dense blades behind, tall ones in front.
  for (let i = 0; i < blades; i++) {
    const back = i < blades * 0.45;
    const x = (256 + (rng() - 0.5) * 250) * s;
    const height = (back ? 170 + 130 * rng() : 250 + 240 * rng()) * s * tall;
    const lean = (rng() - 0.5) * height * 0.55;
    const width = (back ? 26 : 22) * s * (0.8 + 0.5 * rng());
    blade(p, x, 508 * s, height, lean, width, dark, light);
  }
}

/** Grass blades with a few flowers on stems; petals are pure white for the shader to tint. */
function paintFlowers(p: Painter): void {
  const { ctx, rng, size } = p;
  const s = size / 512;
  paintGrass(p, 14, 0.62);
  const heads = 4;
  for (let i = 0; i < heads; i++) {
    const x0 = (256 + (rng() - 0.5) * 150) * s;
    const hx = x0 + (rng() - 0.5) * 70 * s;
    const hy = (110 + rng() * 150) * s;
    ctx.strokeStyle = p.paint('rgb(54, 100, 36)');
    ctx.lineWidth = 6 * s;
    ctx.beginPath();
    ctx.moveTo(x0, 508 * s);
    ctx.quadraticCurveTo(x0 + (hx - x0) * 0.2, (508 * s + hy) / 2, hx, hy);
    ctx.stroke();
    const petals = 5;
    const r = (34 + 12 * rng()) * s;
    const rot = rng() * Math.PI;
    ctx.fillStyle = p.paint('rgb(255, 255, 255)');
    for (let k = 0; k < petals; k++) {
      const a = rot + (k / petals) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(
        hx + Math.cos(a) * r * 0.62,
        hy + Math.sin(a) * r * 0.62,
        r * 0.55,
        r * 0.42,
        a,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.fillStyle = p.paint('rgb(250, 208, 70)');
    ctx.beginPath();
    ctx.arc(hx, hy, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function bakeFoliageTextures(seed: number, anisotropy: number): FoliageTextures {
  const frond = bake(512, seed + 1, anisotropy, paintFrond);
  const leaves = bake(512, seed + 2, anisotropy, paintLeaves);
  const grass = bake(512, seed + 3, anisotropy, (p) => paintGrass(p, 26, 1));
  const flowers = bake(512, seed + 4, anisotropy, paintFlowers);
  return {
    frond,
    leaves,
    grass,
    flowers,
    dispose: () => {
      frond.dispose();
      leaves.dispose();
      grass.dispose();
      flowers.dispose();
    },
  };
}
