# shared

Pure TypeScript with no DOM, no three.js and no imports from other layers: hashing, seeded random numbers, math helpers, URL flags and, later, the command and event types. Anything here must behave identically in every browser and in a Worker.

- `solid.ts`: the `SolidQuery` interface the movement code reads the world through, and a sparse cell store for tests.
- `ground.ts`: the `GroundQuery` interface for smooth terrain (distance, push-out, snap-down), which sits beside `SolidQuery` in `CollisionWorld`.
- `collision.ts`, `movement.ts`, `look.ts`, `fixed-step.ts`: swept box collision, the player controller and its tuning, view angles, and the fixed-step clock.
- `block-world.ts`, `blocks.ts`: the `BlockWorld` interface the net layer and the game use to reach the voxel world, and the shape and material tables with the 16-bit cell state they pack into.
- `settings.ts`: player preferences and their limits.
- `quality.ts`, `daycycle.ts`, `camera-pose.ts`: the graphics presets and their numbers, the day-cycle palette, and the pose type the photo mode and the benchmark route share.
- `frame-stats.ts`, `bench-report.ts`, `sweep-report.ts`: frame-time statistics, the benchmark report, and the report for a run over all presets.
- `hash.ts`, `noise.ts`: integer hashing, seeded random numbers and noise.
- `flags.ts`, `view-flags.ts`: URL switches for development and for how the world looks and what the benchmark runs.
