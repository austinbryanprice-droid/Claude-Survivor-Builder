# Voxel Bevel / Refined Geometry Approach

The visual goal is to avoid pure sharp Minecraft cubes while keeping grid-based placement.

## Recommended Approaches (in order of practicality)

1. **Geometry-level chamfer / bevel (preferred for clarity)**
   - When generating chunk meshes (greedy or otherwise), offset edge vertices inward slightly (0.05–0.12 units) along the face or generate small chamfer faces on edges.
   - This produces a visible but subtle rounded or beveled edge on structural voxels.
   - Remesh only dirty chunks + neighbors when blocks change.

2. **Strong ambient occlusion + detailed materials**
   - Even with modest geometry changes, good AO, soft shadows, and non-pixelated PBR-style textures significantly reduce the “pure Minecraft” read.
   - Combine with approach 1.

3. **Hybrid models for functional pieces**
   - Structural walls/floors remain refined voxels.
   - Turrets, generators, storage, research terminal, beds, and characters are proper optimized glTF models that snap to the grid.
   - This is the strongest way to differentiate the look.

## Implementation Notes
- Chunk size: 16×16×16 is a reasonable starting point.
- Use InstancedMesh or efficient buffer geometry for performance.
- Mark chunks dirty on place/break and remesh only those.
- Keep bevel subtle so building remains precise and readable.

## What Success Looks Like
Structures should read as engineered modular panels or refined blocks rather than classic Minecraft cubes. Lighting and materials should approach the quality of the reference images in the `references/` folder.
