# world/render

The thin three.js adapters for the world: they turn data from `../terrain` and `../scatter` into meshes and materials. This is the only part of `world` that may import three.js.

- `terrain-render.ts` builds the chunk meshes, the triplanar ground material and the ground cover maps.
- `water-render.ts` draws the lake: depth fade, ripples, glitter and the planar reflection.
- `vegetation-render.ts` draws instanced trees (three levels of detail, backlit leaves, wind) and grass and flowers on a separate layer.
- `voxel-render.ts` draws the blocks: one mesh per chunk that holds a block, re-meshed nearest the camera first within a time budget. `structure-material.ts` is the one shader they all share; a block's material id picks its tile from the baked arrays.
- `foliage-geometry.ts` and `foliage-textures.ts` generate the tree models and their leaf and bark textures in code.
- `backdrop-render.ts` draws the distant forested hills and mountains that close the horizon.
