import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoColorSpace,
  OrthographicCamera,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  UnsignedByteType,
  WebGLArrayRenderTarget,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { MATERIALS, TILE_LAYOUTS } from '../shared/blocks';
import { BAKE_FRAGMENT, BAKE_VERTEX } from './glsl/bake.glsl';
import { STRUCTURE_BAKE_FRAGMENT } from './glsl/structure-bake.glsl';

/**
 * What a block face shows: `TILE_LAYOUTS` tiles for each material tier, in the order of
 * `MATERIALS`, so a tile is layer `tier * TILE_LAYOUTS + layout`. Each layer is one face's tile,
 * with the bevel in its outer band; the tiles do not tile across blocks.
 */
export interface StructureTextures {
  /** sRGB albedo with height in alpha. */
  readonly albedo: Texture;
  /** R gloss, G metalness, B emissive strength. Linear data. */
  readonly data: Texture;
}

/** Procedural textures shared by every material. The noise and ground layers tile. */
export interface BakedTextures {
  /** RGBA noise: R, G fbm; B fine fbm; A Worley. Linear data. */
  readonly noise: Texture;
  /** Water ripples: RG slope, B height. Linear data. */
  readonly ripple: Texture;
  /** Ground layers: sRGB albedo with height in alpha. */
  readonly grass: Texture;
  readonly rock: Texture;
  readonly dirt: Texture;
  readonly ash: Texture;
  readonly sand: Texture;
  dispose(): void;
}

const LAYERS = ['noise', 'ripple', 'grass', 'rock', 'dirt', 'ash', 'sand'] as const;

export interface BakeOptions {
  /** Resolution of the ground layers and block tiles; 512 gives crisp close-ups, 256 saves memory on Low. */
  readonly groundSize: number;
  readonly anisotropy: number;
}

/** One full-screen triangle that draws a bake shader over a whole render target. */
function createBakePass(fragmentShader: string, uniforms: ShaderMaterial['uniforms']) {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  );
  const material = new ShaderMaterial({
    vertexShader: BAKE_VERTEX,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new Mesh(geometry, material);
  quad.frustumCulled = false;
  const scene = new Scene();
  scene.add(quad);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return {
    material,
    scene,
    camera,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

export function bakeTextures(renderer: WebGLRenderer, options: BakeOptions): BakedTextures {
  const { material, scene, camera, dispose } = createBakePass(BAKE_FRAGMENT, {
    uLayer: { value: 0 },
    uSeed: { value: 0 },
  });

  const previousTarget = renderer.getRenderTarget();
  const targets: WebGLRenderTarget[] = [];
  const out: Record<string, Texture> = {};

  LAYERS.forEach((name, layer) => {
    const isGround = layer >= 2;
    const size = isGround ? options.groundSize : 256;
    const target = new WebGLRenderTarget(size, size, {
      type: UnsignedByteType,
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
    });
    target.texture.wrapS = RepeatWrapping;
    target.texture.wrapT = RepeatWrapping;
    target.texture.anisotropy = isGround ? options.anisotropy : 1;
    target.texture.colorSpace = isGround ? SRGBColorSpace : NoColorSpace;
    (material.uniforms.uLayer as { value: number }).value = layer;
    material.uniformsNeedUpdate = true;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    targets.push(target);
    out[name] = target.texture;
  });

  renderer.setRenderTarget(previousTarget);
  dispose();

  return {
    noise: out.noise as Texture,
    ripple: out.ripple as Texture,
    grass: out.grass as Texture,
    rock: out.rock as Texture,
    dirt: out.dirt as Texture,
    ash: out.ash as Texture,
    sand: out.sand as Texture,
    dispose: () => targets.forEach((t) => t.dispose()),
  };
}

/** The block tiles, and the way to free their video memory. */
export interface BakedStructure extends StructureTextures {
  dispose(): void;
}

/**
 * Bakes the block tiles: one array layer for each material tier and tile layout, an albedo array
 * and a data array. It is apart from `bakeTextures` so that a page that never draws a block does
 * not pay for them: the tiles are 16 layers of video memory twice over, and under software
 * rendering they take seconds. The stage calls this the first time a block is about to be drawn.
 */
export function bakeStructureTextures(
  renderer: WebGLRenderer,
  options: BakeOptions,
): BakedStructure {
  const { material, scene, camera, dispose } = createBakePass(STRUCTURE_BAKE_FRAGMENT, {
    uTier: { value: 0 },
    uLayout: { value: 0 },
    uPass: { value: 0 },
  });
  const previousTarget = renderer.getRenderTarget();
  const tierCount = MATERIALS.length;
  const bakeTiles = (pass: number, srgb: boolean): WebGLArrayRenderTarget => {
    const target = new WebGLArrayRenderTarget(
      options.groundSize,
      options.groundSize,
      tierCount * TILE_LAYOUTS,
      {
        type: UnsignedByteType,
        depthBuffer: false,
        generateMipmaps: true,
        minFilter: LinearMipmapLinearFilter,
        magFilter: LinearFilter,
      },
    );
    target.texture.wrapS = ClampToEdgeWrapping;
    target.texture.wrapT = ClampToEdgeWrapping;
    target.texture.anisotropy = options.anisotropy;
    target.texture.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
    (material.uniforms.uPass as { value: number }).value = pass;
    for (let tier = 0; tier < tierCount; tier++) {
      for (let layout = 0; layout < TILE_LAYOUTS; layout++) {
        (material.uniforms.uTier as { value: number }).value = tier;
        (material.uniforms.uLayout as { value: number }).value = layout;
        material.uniformsNeedUpdate = true;
        renderer.setRenderTarget(target, tier * TILE_LAYOUTS + layout);
        renderer.render(scene, camera);
      }
    }
    return target;
  };
  const albedo = bakeTiles(0, true);
  const data = bakeTiles(1, false);

  renderer.setRenderTarget(previousTarget);
  dispose();

  return {
    albedo: albedo.texture,
    data: data.texture,
    dispose: () => {
      albedo.dispose();
      data.dispose();
    },
  };
}
