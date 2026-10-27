import { Color, Vector4, type IUniform, type Vector3 } from 'three';

/**
 * The light of the crew's Lights, the lamps. The scene has no three.js lights (the atmosphere carries
 * the sun and the sky), so a lamp is a handful of numbers every lit shader reads: where it leaves the
 * lens, which way it is aimed, and how it spreads. The game layers say which lamps burn (`set`) and the
 * stage picks the few nearest the camera each frame (`update`), so a base full of Lights costs no more
 * than the nearest `LAMP_SLOTS` of them. The shader side is `lampLight` in `glsl/atmosphere.glsl.ts`.
 */

/** The most lamps one frame is lit by: the length of the uniform arrays the shaders loop over. */
export const LAMP_SLOTS = 8;

/**
 * What a lamp's light is like. Chosen by eye at night, side by side with the lens that gives it, in the
 * pictures of docs/art-direction.md; every number here is read by the shader through the shared
 * uniforms, so tuning it is a change to this table and nothing else.
 */
export const LAMP_LIGHT = {
  /** The lens's own glow and the light it throws are one color (sRGB). */
  color: '#ffc778',
  /** How bright it burns at night: the light a surface square on to it and a block off takes in. */
  intensity: 7,
  /** The share of that it keeps in full day: a floodlight does nothing to the sun. */
  day: 0.1,
  /** The distance, in blocks, at which a lamp has fallen to half of its brightness at the lens. */
  half: 2.6,
  /** The distance, in blocks, past which a lamp gives nothing. */
  range: 15,
  /** The half-angle of its beam, in degrees: inside it a lamp is at full strength, and it fades to the spill by here. */
  cone: 62,
  /** The share of the light that goes outside the beam, so the ground beside and behind a Light is not black. */
  spill: 0.1,
  /** How far past square a surface still takes light (0 is plain Lambert), so a pool of light on flat ground reads. */
  wrap: 0.5,
} as const;

/** One lamp as the stage gets it from the game: where the light leaves and which way it is aimed. */
export interface LampSource {
  /** Where the light leaves, in meters. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The way it is aimed, as a unit vector. */
  readonly ax: number;
  readonly ay: number;
  readonly az: number;
}

/** The shared uniforms the lamps live in; `Atmosphere` holds them with the rest, so every lit material has them. */
export interface LampUniforms {
  /** xyz where the light leaves, w its strength (1 for a lamp in use). */
  uLampA: IUniform<Vector4[]>;
  /** xyz the unit direction it is aimed, w the cosine of the half-angle where its beam ends. */
  uLampB: IUniform<Vector4[]>;
  /** The lamps' color times their brightness, turned down by day. */
  uLampColor: IUniform<Color>;
  /** x the distance a lamp has fallen to half at, y the distance it ends at, z the spill, w the wrap. */
  uLampShape: IUniform<Vector4>;
  /** How many of the slots are in use. */
  uLampCount: IUniform<number>;
}

export function createLampUniforms(): LampUniforms {
  const slots = (): Vector4[] => Array.from({ length: LAMP_SLOTS }, () => new Vector4());
  return {
    uLampA: { value: slots() },
    uLampB: { value: slots() },
    uLampColor: { value: new Color(0, 0, 0) },
    uLampShape: {
      value: new Vector4(LAMP_LIGHT.half, LAMP_LIGHT.range, LAMP_LIGHT.spill, LAMP_LIGHT.wrap),
    },
    uLampCount: { value: 0 },
  };
}

/** A lamp and how far it is from the camera, kept between frames so choosing the nearest allocates nothing. */
interface Ranked {
  source: LampSource;
  d2: number;
}

const nearest = (a: Ranked, b: Ranked): number => a.d2 - b.d2;

/**
 * The lamps that burn, and the nearest of them as the shaders see them. The game layers hand in the whole
 * list whenever it changes; each frame the stage says where the camera is and how dark it is.
 */
export class LampField {
  private sources: readonly LampSource[] = [];
  private limit = LAMP_SLOTS;
  private lit = 0;
  private readonly ranked: Ranked[] = [];
  /** The lamps' color as a linear value, before brightness. */
  private readonly color = new Color(LAMP_LIGHT.color);
  private readonly cone = Math.cos((LAMP_LIGHT.cone * Math.PI) / 180);

  constructor(private readonly uniforms: LampUniforms) {}

  /** Replaces the lamps that burn. */
  set(sources: readonly LampSource[]): void {
    this.sources = sources;
  }

  /** How many lamps burn, wherever they are. */
  get burning(): number {
    return this.sources.length;
  }

  /** How many of them the last frame was lit by: the nearest few, up to the quality's limit. */
  get active(): number {
    return this.lit;
  }

  /** The most lamps a frame is lit by, from 0 to `LAMP_SLOTS`: the quality preset says. */
  setLimit(limit: number): void {
    this.limit = Number.isFinite(limit) ? Math.max(0, Math.min(LAMP_SLOTS, Math.floor(limit))) : 0;
  }

  /** Picks the nearest lamps to the camera and writes them, and the color for how dark it is (`night` runs 0 to 1). */
  update(camera: Vector3, night: number): void {
    const u = this.uniforms;
    const dark = Math.min(1, Math.max(0, night));
    u.uLampColor.value
      .copy(this.color)
      .multiplyScalar(LAMP_LIGHT.intensity * (LAMP_LIGHT.day + (1 - LAMP_LIGHT.day) * dark));

    const sources = this.sources;
    const ranked = this.ranked;
    ranked.length = Math.min(ranked.length, sources.length);
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i] as LampSource;
      const dx = source.x - camera.x;
      const dy = source.y - camera.y;
      const dz = source.z - camera.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const slot = ranked[i];
      if (slot) {
        slot.source = source;
        slot.d2 = d2;
      } else {
        ranked[i] = { source, d2 };
      }
    }
    if (ranked.length > this.limit) ranked.sort(nearest);

    const count = Math.min(ranked.length, this.limit);
    for (let i = 0; i < count; i++) {
      const { source } = ranked[i] as Ranked;
      u.uLampA.value[i]?.set(source.x, source.y, source.z, 1);
      u.uLampB.value[i]?.set(source.ax, source.ay, source.az, this.cone);
    }
    u.uLampCount.value = count;
    this.lit = count;
  }
}
