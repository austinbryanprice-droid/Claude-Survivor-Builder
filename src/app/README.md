# app

The composition root: the one place that knows the engine, the world and the interface together. `main.ts` calls `createApp`, which builds the stage, the game loop and the HUD and puts the valley into them. Nothing here is game logic; it is wiring.

- `create-app.ts` reads the URL switches and the saved settings, builds the `Stage`, creates the `Game` with a `createWorld` callback, adds the HUD and starts the loop. With `?debug` it exposes `window.__ashbound` (`{ stage, game }`).
- `valley-world.ts` builds a `ValleyWorld` for a seed: the baked terrain, the `VoxelWorld` on top of it (the `BlockWorld` the net layer builds on; empty, unless `?demo=` raises a structure), the `ValleyView` that draws the terrain, lake, trees, grass and blocks, and the collision, spawn and benchmark route the game reads through the engine's `GameWorld` interface. `Game.loadWorld(seed)` calls the same callback again for a new seed.

## Keys

Click the page to take the mouse; Esc gives it back.

| Key                   | Does                                                                      |
| --------------------- | ------------------------------------------------------------------------- |
| W A S D, Shift, Space | Walk, sprint, jump                                                        |
| V, F5                 | First or third person (F5 will not reload the page while the mouse is in) |
| P                     | Cycle the graphics preset: Low, Balanced, Ultra (saved)                   |
| F3                    | Show or hide the frame overlay                                            |
| 1 to 8, mouse wheel   | Pick a hotbar slot (the HUD's items are placeholders until the inventory) |
| Esc                   | Free the mouse, and stop a running benchmark                              |

## URL switches

| Switch                         | Does                                                                       |
| ------------------------------ | -------------------------------------------------------------------------- |
| `bench=1`                      | Run the benchmark at load (see below)                                      |
| `benchSeconds`, `benchPresets` | Length of the route per preset (default 30), presets to run (`low,ultra`)  |
| `debug`                        | Expose `window.__ashbound` for tests and scripts; show the frame overlay   |
| `quality=low\|balanced\|ultra` | Preset for this visit; it is not saved (the pause panel and P save)        |
| `shot=<name>`                  | Photo mode: hold the camera at a named viewpoint (see `viewpoints.ts`)     |
| `time=<moment>`                | Fix the time of day; `clock` runs the day and night cycle instead          |
| `seed=<n>`                     | Build another valley                                                       |
| `demo=outpost\|swatch`         | Raise a demo structure before the first frame (`demo` alone: the outpost)  |
| `terrain=heightfield`          | Mesh the terrain as a smoothed heightfield instead of surface nets         |
| `scale=<0..1>`                 | Force the internal resolution and switch the adaptive governor off         |
| `hud=0`                        | Hide the whole HUD (player HUD, panels and overlay), for clean screenshots |
| `stats=0`                      | Keep the frame overlay off even when `bench` or `debug` would show it      |
| `freeze=1`                     | Freeze clouds, wind and water, and draw only when something changes        |

The viewpoints are `lake`, `valley`, `canopy`, `crash`, `trail`, `outcrop`, `noon`, `sunset`, `dusk`, `night` and four that look at the demo structures: `outpost` and `gate` for `demo=outpost`, `swatch` and `closeup` for `demo=swatch`. A viewpoint brings its own time of day unless `time=` says otherwise. For example, `/?shot=lake&quality=balanced&hud=0&stats=0&freeze=1` draws the same frame every time.

## Benchmark

`?bench=1` flies the valley once for each preset (Low, Balanced, Ultra) with the adaptive governor off. Each run is the state machine in `src/engine/bench.ts`: two unmeasured warm-up seconds, then a fixed route (30 seconds by default) counted in simulation ticks, so every machine sees the same views. The route lifts over hills, so the camera never dips under the ground. The pass mark is at least 57 FPS on average and a 95th percentile frame time of at most 18.5 ms. A banner shows progress, Esc stops the run, and at the end a card shows one row per preset with a button that copies the report. The report is Markdown with the graphics adapter, browser, canvas, route, valley build times, and for each preset the internal size, average FPS, 95th percentile, slowest 1 percent, CPU time, GPU time (where the browser offers timer queries), draw calls and triangles. A window larger than 1080p still reports honestly: the internal size column says what was drawn.

A display that refreshes faster than 60 Hz caps the average at its refresh rate, so on a fast machine every preset can read the same (the report states the display rate); the GPU time column is the only one that tells them apart, and it is noisy at the cap. On a laptop with two GPUs, check the report's graphics adapter line: the numbers mean something only if the browser ran on the dedicated GPU (Windows Settings, System, Display, Graphics, High performance for the browser).

Frame cost cannot be measured in the cloud sandbox (software rendering only), so the numbers in the docs for the sandbox are static budgets and relative software costs; the real ones come from this report on real hardware. The first real report, from the look spike, is recorded in [art direction](../../docs/art-direction.md#first-real-measurement).
