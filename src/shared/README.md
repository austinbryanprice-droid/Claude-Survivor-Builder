# shared

Pure TypeScript with no DOM, no three.js and no imports from other layers: hashing, seeded random numbers, math helpers, URL flags and, later, the command and event types. Anything here must behave identically in every browser and in a Worker.

- `solid.ts`: the `SolidQuery` interface the movement code reads the world through, and a sparse cell store for tests and the proving ground.
- `collision.ts`, `movement.ts`, `look.ts`, `fixed-step.ts`: swept box collision, the player controller and its tuning, view angles, and the fixed-step clock.
- `block-world.ts`, `blocks.ts`: the `BlockWorld` interface the net layer and the game use to reach the voxel world, and the shape and material tables with the 16-bit cell state they pack into.
- `settings.ts`: player preferences and their limits.
- `frame-stats.ts`, `bench-report.ts`: frame-time statistics and the benchmark report.
- `hash.ts`, `flags.ts`: integer hashing and seeded random numbers; URL switches.
