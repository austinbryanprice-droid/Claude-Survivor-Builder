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

| Switch                                        | Does                                                                |
| --------------------------------------------- | ------------------------------------------------------------------- |
| `quality=low\|balanced\|ultra`                | Starting preset                                                     |
| `shot=<name>`                                 | Start at a named camera shot (see `shots.ts`)                       |
| `time=<moment>`                               | Fix the time of day (`clock` runs the day-night cycle instead)      |
| `seed=<n>`                                    | Build another valley                                                |
| `terrain=heightfield`                         | Mesh the terrain as a smoothed heightfield instead of surface nets  |
| `scale=<0..1>`                                | Force the internal resolution and switch the governor off           |
| `hud=0`                                       | Hide the HUD and the stats                                          |
| `stats=0`                                     | Hide only the stats and the key list, for clean HUD screenshots     |
| `freeze=1`                                    | Freeze clouds, wind and water, and draw only when something changes |
| `bench=1`                                     | Run the benchmark at load                                           |
| `benchSeconds`, `benchWarmup`, `benchPresets` | Length of the route, warm-up frames, presets to run                 |
| `debug`                                       | Expose `window.__look` for tests and screenshot scripts             |

## Benchmark

`?bench=1` flies one fixed route per preset (12 seconds by default, counted in frames so every machine sees the same views) with the adaptive governor off, then shows a table and a Copy report button. The report has the graphics adapter, internal size, FPS, average and 95th percentile frame time, CPU time, GPU time (when the browser offers timer queries), draw calls and triangles per preset, and whether the preset holds 60 FPS. A browser run in a window larger than 1080p still reports honestly: the internal size column says what was drawn.

Frame cost cannot be measured in the cloud sandbox (software rendering only), so the numbers in the docs for the sandbox are static budgets and the real ones come from this report on real hardware.

## Files

- `look-main.ts` wires the page: scene, HUD, stats, benchmark and keys.
- `look-scene.ts` builds the valley from the engine and world modules.
- `controls.ts` is a spike-local first-person controller and the benchmark camera path.
- `shots.ts` holds the named camera poses.
- `bench.ts`, `bench-report.ts` and `panels.ts` are the benchmark driver, its report and its UI.
- `hud-demo.ts` drives the player HUD with made-up numbers.
