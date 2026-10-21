# engine

The renderer, camera, input and game loop. This layer may use three.js and the DOM, and it must not import the game layers (`world`, `systems`, `net`, `ui`). See [architecture rules](../../docs/architecture.md).

- `game.ts`: builds the scene and runs the frame loop (fixed-step ticks, camera, render, timing).
- `input.ts`: keyboard and pointer lock, by physical key, with the F5 rule.
- `camera-rig.ts`: first and third person, boom clearance, sprint field-of-view kick, landing dip.
- `bench.ts` and `bench-script.ts`: the `?bench=1` benchmark and its flythrough route. The look page flies the same state machine through the valley with `advance()` instead of a player.
- `proving-ground-layout.ts`, `proving-ground.ts`: the Phase 1 test deck, as pure data and as meshes.
- `environment.ts`, `textures.ts`, `avatar.ts`: sun, sky, fog and shadows; procedural textures; the third-person body.
- `stage.ts`: the renderer, scene and camera, and the render loop.
- `remote-players.ts`: the other players in a room: a suit per seat in the seat's colour, walking and turning as its owner does, with a name tag. Poses come already interpolated from the network layer.
