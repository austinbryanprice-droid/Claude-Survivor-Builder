# shared

Pure TypeScript with no DOM, no three.js and no imports from other layers: hashing, seeded random numbers, math helpers, URL flags and, later, the command and event types. Anything here must behave identically in every browser and in a Worker.

- `solid.ts`: the `SolidQuery` interface the movement code reads the world through (which cells are solid, and for slabs and wedges the boxes inside them), and a sparse cell store for tests.
- `ground.ts`: the `GroundQuery` interface for smooth terrain (distance, push-out, snap-down), which sits beside `SolidQuery` in `CollisionWorld`.
- `collision.ts`, `movement.ts`, `look.ts`, `fixed-step.ts`: swept box collision (with the step-up a grounded body takes onto a slab or a ramp), the player controller and its tuning, view angles, and the fixed-step clock.
- `block-world.ts`, `blocks.ts`: the `BlockWorld` interface the net layer and the game use to reach the voxel world, and the shape and material tables (names and costs too) with the 16-bit cell state they pack into. A shape id names a kind and its turn: the cube, a slab in the lower or upper half of the cell, and a wedge that rises toward one of four directions, right way up or upside down.
- `shapes.ts`: what each of those shapes is as geometry, built once from the ids: the faces the mesher draws, the boxes movement collides with, and the parts of a cell's sides a shape fills, so a neighbor knows which of its faces are hidden.
- `raycast.ts`, `build-aim.ts`: the grid ray (which cell a look ray enters first, and through which face) and the aim rules built on it: what the cursor is on, the cell a block would fill, and why a click would not work (out of reach, a player in the way, or the world's own reasons).
- `settings.ts`: player preferences and their limits.
- `quality.ts`, `daycycle.ts`, `camera-pose.ts`: the graphics presets and their numbers, the day-cycle palette, and the pose type the photo mode and the benchmark route share.
- `frame-stats.ts`, `bench-report.ts`, `sweep-report.ts`: frame-time statistics, the benchmark report, and the report for a run over all presets.
- `hash.ts`, `noise.ts`: integer hashing, seeded random numbers and noise.
- `flags.ts`, `view-flags.ts`: URL switches for development and for how the world looks and what the benchmark runs.
- `protocol.ts`, `wire.ts`, `net-config.ts`: the multiplayer message shapes (commands, events, control frames, why a room ended and what to tell the player), the codec that turns them into bytes and back (everything from the other side is untrusted and checked), and every network number in one table.
- `clock-sync.ts`, `interpolation.ts`, `move-guard.ts`: the clock offset between host and guest, how other players are drawn smoothly from late and lost samples, and the host's sanity check of a guest's own movement.
- `room-code.ts`, `names.ts`, `net-flags.ts`, `player-colors.ts`: room codes and what players type, names and tokens, the `?join=`, `?broker=` and `?ice=` switches and invite links, and one colour per seat.
- `block-digest.ts`: a fingerprint of every player-made block, to compare worlds.
