# glsl

Shader chunks shared by the lit materials, kept as TypeScript strings so Vite bundles them without a loader.

- `atmosphere.glsl.ts` is the sky, height fog, mist pockets and sun glow every material applies last.
- `lighting.glsl.ts` is the sun shadow lookup, hemisphere ambient light and detail normals.
- `bake.glsl.ts` generates the ground, rock, dirt, ash and sand textures on the GPU at load, so there are no image files.
