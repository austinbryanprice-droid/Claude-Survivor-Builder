# world/render

The thin three.js adapters for the world: they turn data from `../terrain` and `../scatter` into meshes and materials. This is the only part of `world` that may import three.js.

- `terrain-render.ts` builds the chunk meshes, the triplanar ground material and the ground cover maps.
- `water-render.ts` draws the lake: depth fade, ripples, glitter and the planar reflection.
- `vegetation-render.ts` draws instanced trees (three levels of detail, backlit leaves, wind) and grass and flowers on a separate layer.
- `voxel-render.ts` draws the blocks: one mesh per chunk that holds a block, re-meshed nearest the camera first within a time budget. `structure-material.ts` is the one shader they all share; a block's material id picks its tile from the baked arrays. It takes the terrain's light but tunes it for structures: a cooler, stronger fill in shade, a less orange key on plain surfaces and a little more sky in polished steel (`docs/art-direction.md`, lighting pass).
- `core-render.ts` draws the Outpost Core: a steel plinth with amber trim, four pylons and a frame, and a cyan crystal and ring that turn and bob inside. The crystal is the Core's health in the world (cyan, amber, red; a faster beat and a flicker as it weakens, a flash on a hit, dark and tilted when it has fallen). It reads the health through `follow(source)`, is posed from the stage's animation clock, and is six meshes (11 draws across the passes when it is in view).
- `module-models.ts` and `module-render.ts` draw the functional modules, which are cells of the block world that the mesher leaves out. A model is a few merged parts, one for each look (steel, trim, amber, cyan lights, screen glass, beacon), built in code once and shared by every module of its kind; the Research Terminal is 1,544 triangles with a foundation that reaches below its cell's floor so it stands on a slope. `ModuleRenderer` follows the voxel world's list of modules, puts a group of meshes on each one's cell turned to its facing, and moves the screens, strips and beacon from the stage's animation clock.
- `ghost-render.ts` draws what the player aims with: a translucent ghost of the block a click would place (the model itself, for a module), tinted by whether it would work, and an outline on the block a click would break.
- `foliage-geometry.ts` and `foliage-textures.ts` generate the tree models and their leaf and bark textures in code.
- `backdrop-render.ts` draws the distant forested hills and mountains that close the horizon.
