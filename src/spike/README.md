# spike

The look spike: a throwaway scene that proves the visual target. Open `look.html` (`npm run dev`, then `/look.html`) to fly through the valley; nothing here is meant to survive into the game except the ideas it settled (see [decisions](../../docs/decisions.md#look-spike-2026-10-20)). The engine, terrain, scatter and HUD modules it exercises are the parts to keep.

## Keys

| Key                   | Does                                                        |
| --------------------- | ----------------------------------------------------------- |
| W A S D, Shift, Space | Walk, sprint, jump (click the canvas to look)               |
| F                     | Toggle free flight                                          |
| 1 to 8, mouse wheel   | Pick a hotbar slot                                          |
| P                     | Cycle Low, Balanced, Ultra                                  |
| T                     | Cycle golden, morning, noon, afternoon, sunset, dusk, night |
| N                     | Next camera shot                                            |
| H, V                  | Hide the HUD, hide the stats panel                          |
| B, Esc                | Start the benchmark, stop it                                |

## URL switches

| Switch                         | Does                                                                |
| ------------------------------ | ------------------------------------------------------------------- |
| `quality=low\|balanced\|ultra` | Starting preset                                                     |
| `shot=<name>`                  | Start at a named camera shot (see `shots.ts`)                       |
| `time=<moment>`                | Fix the time of day (`clock` runs the day-night cycle instead)      |
| `seed=<n>`                     | Build another valley                                                |
| `terrain=heightfield`          | Mesh the terrain as a smoothed heightfield instead of surface nets  |
| `scale=<0..1>`                 | Force the internal resolution and switch the governor off           |
| `hud=0`                        | Hide the HUD and the stats                                          |
| `stats=0`                      | Hide only the stats and the key list, for clean HUD screenshots     |
| `freeze=1`                     | Freeze clouds, wind and water, and draw only when something changes |
| `bench=1`                      | Run the benchmark at load                                           |
| `benchSeconds`, `benchPresets` | Length of the route per preset (default 30), presets to run         |
| `debug`                        | Expose `window.__look` for tests and screenshot scripts             |

## Benchmark

`?bench=1` is the game page's benchmark flown through the valley. Each preset (Low, Balanced, Ultra) gets one run of the shared state machine in `src/engine/bench.ts`: two unmeasured warm-up seconds, then a fixed route (30 seconds by default, `?benchSeconds=` changes it) counted in simulation ticks so every machine sees the same views, with the adaptive governor off. The pass mark is the game page's, at least 57 FPS on average and a 95th percentile frame time of at most 18.5 ms. The card shows one row per preset, and Copy report gives Markdown with the graphics adapter, browser, canvas, route, valley build times, and for each preset the internal size, average FPS, 95th percentile, slowest 1 percent, CPU time, GPU time (when the browser offers timer queries), draw calls and triangles. A browser window larger than 1080p still reports honestly: the internal size column says what was drawn.

A display that refreshes faster than 60 Hz caps the average at its refresh rate, so on a fast machine every preset can read the same (the report says the display rate); the GPU time column is the only one that tells them apart, and it is noisy at the cap. On a laptop with two GPUs, check the report's graphics adapter line: the numbers mean something only if the browser ran on the dedicated GPU (Windows Settings, System, Display, Graphics, High performance for the browser).

Frame cost cannot be measured in the cloud sandbox (software rendering only), so the numbers in the docs for the sandbox are static budgets and relative software costs; the real ones come from this report on real hardware. The first real report is recorded in [art-direction](../../docs/art-direction.md#first-real-measurement).

## Files

- `look-main.ts` wires the page: scene, HUD, stats, benchmark and keys.
- `look-scene.ts` builds the valley from the engine and world modules.
- `controls.ts` is a spike-local first-person controller and the benchmark camera path.
- `shots.ts` holds the named camera poses.
- `bench.ts`, `bench-report.ts` and `panels.ts` run the shared benchmark once per preset, format its report and draw its card.
- `hud-demo.ts` drives the player HUD with made-up numbers.
