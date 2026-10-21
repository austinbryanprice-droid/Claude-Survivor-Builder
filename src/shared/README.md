# shared

Pure TypeScript with no DOM, no three.js and no imports from other layers: hashing, seeded random numbers, math helpers, URL flags and, later, the command and event types. Anything here must behave identically in every browser and in a Worker.

- `solid.ts`: the `SolidQuery` interface the movement code reads the world through, and a sparse cell store for tests and the proving ground.
- `collision.ts`, `movement.ts`, `look.ts`, `fixed-step.ts`: swept box collision, the player controller and its tuning, view angles, and the fixed-step clock.
- `block-world.ts`, `blocks.ts`: the `BlockWorld` interface the net layer and the game use to reach the voxel world, and the shape and material tables with the 16-bit cell state they pack into.
- `settings.ts`: player preferences and their limits.
- `frame-stats.ts`, `bench-report.ts`: frame-time statistics and the benchmark report.
- `hash.ts`, `flags.ts`: integer hashing and seeded random numbers; URL switches.
- `protocol.ts`, `wire.ts`, `net-config.ts`: the multiplayer message shapes (commands, events, control frames, why a room ended and what to tell the player), the codec that turns them into bytes and back (everything from the other side is untrusted and checked), and every network number in one table.
- `clock-sync.ts`, `interpolation.ts`, `move-guard.ts`: the clock offset between host and guest, how other players are drawn smoothly from late and lost samples, and the host's sanity check of a guest's own movement.
- `room-code.ts`, `names.ts`, `net-flags.ts`, `player-colors.ts`: room codes and what players type, names and tokens, the `?join=`, `?broker=` and `?ice=` switches and invite links, and one colour per seat.
- `block-digest.ts`: a fingerprint of every player-made block, to compare worlds.
