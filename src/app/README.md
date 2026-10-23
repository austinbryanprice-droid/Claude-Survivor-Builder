# app

The composition root: the one place that knows the engine, the world and the interface together. `main.ts` calls `createApp`, which builds the stage, the game loop and the HUD and puts the valley into them. Nothing here is game logic; it is wiring.

- `create-app.ts` reads the URL switches and the saved settings, builds the `Stage`, creates the `Game` with a `createWorld` callback, adds the HUD and starts the loop. With `?debug` it exposes `window.__ashbound` (`{ stage, game, build }`, and `mp` once multiplayer has loaded). Unless `?bench=1` is on, it then loads `attach-multiplayer.ts` on demand, so the benchmark page and the first paint never pay for the networking code.
- `valley-world.ts` builds a `ValleyWorld` for a seed: the baked terrain, the `VoxelWorld` on top of it (the `BlockWorld` the net layer builds on; empty, unless `?demo=` raises a structure), the `ValleyView` that draws the terrain, lake, trees, grass and blocks, and the collision, spawn and benchmark route the game reads through the engine's `GameWorld` interface. `Game.loadWorld(seed)` calls the same callback again for a new seed.
- `attach-multiplayer.ts` is the one file that knows both the game and the net glue. It hands `multiplayer.ts` the game's player, world, mouse and scene as narrow views and runs it once a frame (`game.onBeforeRender`). Joining a room calls `game.loadWorld(seed)` (unless the valley with that seed is already up with nothing built on it), empties any `?demo=` blocks the new valley raised, and the host's edits are applied to the new world's `BlockWorld`.
- With the run: `attach-multiplayer.ts` also hands the lobby a new `SurvivalSim` whenever the player is on their own (starting at nightfall of night N with `?night=N`) and, unless the page holds a moment (`?time=`, `?shot=`) or runs the demo clock (`?clock`), makes the sky follow the run's clock (`Stage.setSkyDriver`). `create-app.ts` gives the HUD the session's survival view. With `?debug`, `window.__ashbound.mp.clock()` reads the run and `warp(seconds)` jumps it ahead. The sim is given the valley's ground to walk (`valleyNavigation`), so the machines come with it (and the nights' waves, unless `?waves=0`), and `multiplayer.ts` draws them (`enemy-render.ts`) from whichever session is behind the hub; with `?debug`, `mp.spawnCrawlers(n)`, `mp.spawnCrawlerAt(x, z)`, `mp.clearEnemies()` and `mp.enemies()` send them in, remove them and list what is on screen, and `mp.hurtPlayer(n, id?)`, `mp.setRespawns(n)` and `mp.warp(seconds)` fell a player, set the crew's charges and play out the wait for the Core to bring them back.
- `multiplayer.ts` builds the lobby, the room panel, the player's movement over the network and the other players' avatars, and leaves the room when the page goes. `createMultiplayer` takes the narrow views and is updated once a frame; it never touches `Game` directly, so it can be driven from tests.
- `build-controller.ts` is the player's building hands (and the pulse blaster in slot 5: with it in hand the left button fires along the camera's view instead of breaking, at the blaster's pace, and the host's `sh` report of a hit marks the HUD), with no DOM and no three.js: the hotbar selection, the kind of shape (block, slab or wedge) and how it is turned, Build Mode, what the cursor would do (`src/shared/build-aim.ts`), held-button repeat, and the commands. A click becomes a `BlockCommand` for the session and nothing else; the world changes when the host's event comes back, and a refusal comes back as words for the HUD.
- `build-controls.ts` puts those hands on the running game: the mouse buttons, the number keys, the wheel, B, Q and R from `Input`; the aim from the camera each frame; the ghost block (in the shape a click would place) and the break outline (in the shape of the block it marks) on the valley view; the session (`setSession`, set when the network code has loaded) and its refusals. It also gets the blocks ready (`warmUp`) when Build Mode starts, or three seconds after the mouse is first taken, whichever comes first.
- `shot-effects.ts` decides what the pulse blaster's shots look like on this screen: the player's own bolt is drawn at the click from what the screen shows, the host's report adds the burst of a machine that fell, and everyone else's bolts leave the shooter's avatar when the report arrives. `multiplayer.ts` owns it and the light (`shot-fx.ts`); with `?debug`, `mp.fire()`, `mp.fireAtMachine()` and `mp.shots()` fire, aim at the nearest machine and list what was drawn.
- `vitals-effects.ts` carries the player's Energy and Health into how they move and work: once a frame it reads their meters and hands the scale to the legs (`Game.setSpeedScale`) and to the hands (`BuildController.setHandScale`), holds the legs and idles the hands while the player is down (`Game.setFrozen`, `BuildController.setDown`), and puts everything back to normal when it stops. `create-app.ts` starts it for the session's own meters and gives the same view to the HUD.
- `player-sync.ts` sends the local player to the session each frame, flags teleports, and puts the player back where the host says.
- `seat-spawn.ts` says where each of the four seats starts: in a row beside the spawn point, above anything built there.
- `browser-storage.ts` is storage that never throws (private windows, blocked cookies).

## Keys

Click the page to take the mouse; Esc gives it back.

| Key                   | Does                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| W A S D, Shift, Space | Walk, sprint, jump                                                                                        |
| V, F5                 | First or third person (F5 will not reload the page while the mouse is in)                                 |
| P                     | Cycle the graphics preset: Low, Balanced, Ultra (saved)                                                   |
| F3                    | Show or hide the frame overlay                                                                            |
| Right click           | Place the selected block (hold: repeat)                                                                   |
| Left click            | Break the block under the cursor (hold: repeat); with the pulse blaster in hand (key 5), fire it          |
| 1 to 8, mouse wheel   | Pick a hotbar slot (slots 1 to 4 are blocks, 5 is the pulse blaster; the tools after it are placeholders) |
| Q                     | Choose block, slab or wedge for every block slot                                                          |
| R                     | Turn the slab or wedge from the way the aim would put it                                                  |
| B                     | Build Mode: ghost block, caption and key list                                                             |
| Esc                   | Free the mouse, and stop a running benchmark                                                              |

## URL switches

| Switch                         | Does                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `bench=1`                      | Run the benchmark at load (see below)                                                                         |
| `benchSeconds`, `benchPresets` | Length of the route per preset (default 30), presets to run (`low,ultra`)                                     |
| `debug`                        | Expose `window.__ashbound` for tests and scripts; show the frame overlay                                      |
| `quality=low\|balanced\|ultra` | Preset for this visit; it is not saved (the pause panel and P save)                                           |
| `shot=<name>`                  | Photo mode: hold the camera at a named viewpoint (see `viewpoints.ts`)                                        |
| `time=<moment>`                | Fix the time of day (the sky otherwise follows the run's clock); `clock` runs a compressed demo cycle instead |
| `night=<n>`                    | Start the run at nightfall of night n (1 to 99), to try the later nights                                      |
| `waves=0`                      | Keep the nights empty: no waves, for pictures and tests that want a quiet night                               |
| `seed=<n>`                     | Build another valley                                                                                          |
| `demo=outpost\|swatch\|hall`   | Raise a demo structure before the first frame (`demo` alone: the outpost)                                     |
| `terrain=heightfield`          | Mesh the terrain as a smoothed heightfield instead of surface nets                                            |
| `scale=<0..1>`                 | Force the internal resolution and switch the adaptive governor off                                            |
| `hud=0`                        | Hide the whole HUD (player HUD, panels, overlay, room card), for clean shots                                  |
| `stats=0`                      | Keep the frame overlay off even when `bench` or `debug` would show it                                         |
| `freeze=1`                     | Freeze clouds, wind and water, and draw only when something changes                                           |
| `join=CODE`, `name=Ada`        | Join a room on load; the name to play under                                                                   |
| `broker=host:port`, `ice=...`  | Another PeerJS server; STUN and TURN servers (`none` for direct only)                                         |

The viewpoints are `lake`, `valley`, `canopy`, `crash`, `core` and `reactor` (the Outpost Core from the rim and from a few steps away), `trail`, `outcrop`, `noon`, `sunset`, `dusk`, `night` and seven that look at the demo structures: `outpost` and `gate` for `demo=outpost`, `swatch` and `closeup` for `demo=swatch`, `hall`, `hallside` and `eaves` for `demo=hall`. A viewpoint brings its own time of day unless `time=` says otherwise. For example, `/?shot=lake&quality=balanced&hud=0&stats=0&freeze=1` draws the same frame every time.

## Benchmark

`?bench=1` flies the valley once for each preset (Low, Balanced, Ultra) with the adaptive governor off. Each run is the state machine in `src/engine/bench.ts`: two unmeasured warm-up seconds, then a fixed route (30 seconds by default) counted in simulation ticks, so every machine sees the same views. The route lifts over hills, so the camera never dips under the ground. The pass mark is at least 57 FPS on average and a 95th percentile frame time of at most 18.5 ms. A banner shows progress, Esc stops the run, and at the end a card shows one row per preset with a button that copies the report. The report is Markdown with the graphics adapter, browser, canvas, route, valley build times, and for each preset the internal size, average FPS, 95th percentile, slowest 1 percent, CPU time, GPU time (where the browser offers timer queries), draw calls and triangles. A window larger than 1080p still reports honestly: the internal size column says what was drawn.

A display that refreshes faster than 60 Hz caps the average at its refresh rate, so on a fast machine every preset can read the same (the report states the display rate); the GPU time column is the only one that tells them apart, and it is noisy at the cap. On a laptop with two GPUs, check the report's graphics adapter line: the numbers mean something only if the browser ran on the dedicated GPU (Windows Settings, System, Display, Graphics, High performance for the browser).

Frame cost cannot be measured in the cloud sandbox (software rendering only), so the numbers in the docs for the sandbox are static budgets and relative software costs; the real ones come from this report on real hardware. The first real report, from the look spike, is recorded in [art direction](../../docs/art-direction.md#first-real-measurement).
