# world

Voxel data, seeded terrain, chunks, meshing and materials. No three.js or DOM here, so meshing can run in a Worker; the thin render adapters go in `render/`.

- `terrain/` is the valley as data: the seeded field, the baked grid, surface-nets meshing and terrain collision. `terrain.ts` bakes all of it from a seed. `viewpoints.ts` holds the named camera shots and the benchmark's flight route.
- `voxels/` is the player-built part: `world.ts` holds the chunked store (`VoxelWorld`, built by `createWorld(seed)`), the placement rules and the dirty-chunk list; `chunk.ts` has the 16 by 16 by 16 chunk and its keys. `VoxelWorld` implements `BlockWorld` (`src/shared/block-world.ts`), which is all the net layer sees.
- `scatter.ts` places trees and grass from the seed.
- `render/` adapts all of it to three.js. `valley-view.ts` puts the terrain, backdrop, lake, trees and grass into a stage in one call.

Terrain is static in version 1, so every cell in the voxel world is a player edit, and a late-join snapshot is the seed plus `forEachEdit`. Movement reads two queries: the terrain's `GroundQuery` and the voxel world's cell `SolidQuery`.
