import {
  BufferAttribute,
  BufferGeometry,
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
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { BAKE_FRAGMENT, BAKE_VERTEX } from './glsl/bake.glsl';

/** Procedural textures shared by every material. All of them tile. */
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
  /** Resolution of the ground layers; 512 gives crisp close-ups, 256 saves memory on Low. */
  readonly groundSize: number;
  readonly anisotropy: number;
}

export function bakeTextures(renderer: WebGLRenderer, options: BakeOptions): BakedTextures {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  );
  const material = new ShaderMaterial({
    vertexShader: BAKE_VERTEX,
    fragmentShader: BAKE_FRAGMENT,
    uniforms: { uLayer: { value: 0 }, uSeed: { value: 0 } },
    depthTest: false,
    depthWrite: false,
  });
  const quad = new Mesh(geometry, material);
  quad.frustumCulled = false;
  const scene = new Scene();
  scene.add(quad);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

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
  geometry.dispose();
  material.dispose();

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
