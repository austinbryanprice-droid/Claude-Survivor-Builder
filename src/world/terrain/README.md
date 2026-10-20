# terrain

The valley as data. No three.js and no DOM, so all of it can run in a Worker.

- `field.ts` is the seeded terrain: a ground height, 29 rock outcrops as signed-distance features and the painted ground cover. It uses integer-hash noise and no trigonometry, so every browser builds the same valley from the same seed.
- `grid.ts` bakes the field to a 1 m grid of signed distances. Meshing and collision both read this grid.
- `surface-nets.ts` meshes the grid into smooth chunks with normals from the field gradient and baked ambient occlusion.
- `heightfield.ts` is the cheaper fallback the spike measured surface nets against (`?terrain=heightfield`).
- `collision.ts` pushes a stack of spheres out of the ground along the field gradient.

Terrain is static in version 1, so nothing here remeshes at run time.
