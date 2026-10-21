# engine

The renderer, camera, input and game loop. This layer may use three.js and the DOM, and it must not import the game layers (`world`, `systems`, `net`, `ui`). See [architecture rules](../../docs/architecture.md). The layers above it hand in what it draws and collides with: `src/app` builds a `GameWorld` and passes it to the game.

- `stage.ts`: the renderer, scene, camera and render loop, with the atmosphere, sun, materials, quality presets and the adaptive resolution governor. A stage knows nothing about gameplay; `setMoment` picks the time of day and `onBeforeRender` lets other layers update before each frame; `precompile` compiles an object's shader programs ahead of its first draw.
- `game.ts`: the fixed-step loop on top of a stage: input, the local player, the camera rig, the avatar, timing, and the benchmark sweep. It reads the world through the `GameWorld` interface (collision, spawn, benchmark route, build timings), so the valley, a test deck or an empty plane all fit. `teleport`, `loadWorld`, `onTick` and `onBeforeRender` are the hooks the net layer and the builders use.
- `input.ts`: keyboard and pointer lock, by physical key, with the F5 rule. While the mouse is taken it also reports the two mouse buttons, the number keys and the wheel (`onPointer`, `onHotbar`) B (`toggleBuild`), Q (`cycleShape`) and R (`turnPiece`) to whoever builds.
- `camera-rig.ts`: first and third person, boom clearance against the terrain and the cells, sprint field-of-view kick, landing dip.
- `bench.ts`, `bench-sweep.ts`: the `?bench=1` state machine (warm-up, a route counted in simulation ticks, a report) and the sweep that runs it once for each quality preset, with the governor off.
- `atmosphere.ts`, `lighting.ts`, `sky.ts`, `materials.ts`, `lit-material.ts`, `texture-bake.ts`, `pipeline.ts`, `perf.ts`, `glsl/`, `post/`: sky, haze, sun and shadows, the shared lit shaders, the procedural textures (noise and ground at start-up, the tiles block faces show the first time a block is drawn), the post-processing chain, and the frame governor and GPU timer.
- `avatar.ts`: the third-person body; it takes an accent colour, so the other players in a room wear their seat's.
- `remote-players.ts`: the other players in a room: a suit per seat in the seat's colour, walking and turning as its owner does, with a name tag. Poses come already interpolated from the network layer.
