# Decisions

Decisions that settle or refine the spec. The spec itself (`docs/spec/SPEC.md`) stays verbatim; sections 1 and 14 are locked. Anything not recorded here follows the spec.

## Owner decisions (2026-10-20)

Austin reviewed the spec analysis and answered as follows.

| #   | Decision      | Answer                                                                                                                                                                                                                                                           |
| --- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Cycle length  | Day 8 minutes and night 4 minutes (the spec's own minimum). Pressure is noticeable by night 4. A full run spans one or two sittings bridged by save and resume.                                                                                                  |
| 2   | Meshing       | No greedy merging for player structures, so every voxel keeps its bevel and seam. Terrain may merge. `InstancedMesh` serves modules, enemies, projectiles and particles only.                                                                                    |
| 3   | Look          | Changed from the analysis default. Everything (graphics, details, textures, aesthetics, fidelity, HUD) matches the references as closely as possible. See [art-direction.md](art-direction.md).                                                                  |
| 4   | References    | The eight third-party screenshots stay out of the public repository and are described in words in `art-direction.md`.                                                                                                                                            |
| 5   | Failure rules | An Outpost Core (the station reactor) with a health bar ends the run at 0. Respawns come from shared charges: 2 per player at the start, 1 more per player each dawn, capped at 3 per player. The run also ends when every player is down and no charges remain. |
| 6   | Assets        | Models are generated in code and exported as `.glb` at build time. All audio is synthesized. CC0 packs are an optional later upgrade.                                                                                                                            |

## Defaults (approved with the above)

- The Research Terminal and Basic Turret cost Scrap only (about 40 and 25), because the notes price them in Composite, which the terminal itself unlocks. Composite first appears with Tier 2 and pays for upgrades.
- Research points are cumulative thresholds that are never spent: 10, 20, 40, 55 and 100, unlocking the Generator and Power Node; Tier 2 Composite with the reinforced wall and auto-turret; module upgrades; Tier 3 Alloy with the electrified wall and heavy turret; and the Tier 4 Energy-Infused capstones.
- Tier 4 cells drop only from special enemies and rare anomaly nodes.
- Ration Packs refill Energy, and Energy regenerates slowly near a powered generator. Storage raises the shared pool cap. The player starts with a multi-tool and a pulse blaster.
- Enemies are the crawler, the armored crawler, the flying skimmer and the base-targeting breacher.
- Power works by radius from a generator or node, with no wiring.
- Waves follow the notes for nights 1 to 4 (6, 8, 10, then 12 with one armored). From night 5 each night adds 2 enemies and about 8 percent health, flyers arrive on night 5 and breachers on night 9.
- One basic block costs 1 Scrap, so a 3 by 3 "Basic Scrap Wall" costs 9.
- Clients own their movement and the host sanity-checks it. Each browser keeps a random player token, and the host save stores inventories by token so a resumed session can restore hotbars.
- Terrain is static in version 1: players place and break structure blocks, not ground.

## Phase 1: engine and camera

- **The local player simulates at 60 Hz, separately from the host's 20 Hz world tick.** The loop takes at most five ticks per frame and drops any backlog, so a stalled tab never spirals. The camera draws the blend between the last two ticks. Mouse look is applied every rendered frame, not per tick, so aiming never waits for a tick.
- **Movement and collision live in `src/shared`** against a `SolidQuery` over unit cells, so they run unchanged under Vitest and in the future host. The player box is 0.6 by 1.8 blocks with the eyes at 1.62, and one block is one meter.
- **Feel numbers** (all in `MOVEMENT`, `src/shared/movement.ts`): walk 4.4 and sprint 7.2 blocks per second; a standing jump rises 1.25 blocks, which clears one block but not two; gravity 30; a jump still works for 0.1 s after walking off an edge and a press is remembered for 0.12 s before landing. Space is held, not tapped: holding it hops again on every landing. A sprinting jump travels about 4.2 blocks and a walking one about 2.6.
- **No step-up yet.** The player collides with whole blocks and must jump onto a one-block rise. Slabs and wedge roofs arrive in Phase 2c and bring sub-block shapes, so a step-up rule is decided there rather than guessed now.
- **Collision is swept per axis against unit cells** (vertical first, then the longer horizontal axis), so no speed can tunnel through a block. A body that already overlaps a block may walk out of it instead of being stuck.
- **The camera key is V or F5 (spec section 5).** F5 normally reloads the page, so while the mouse is taken the game swallows it and uses it to switch the view. With the mouse free it is left alone, and Ctrl, Cmd and Alt combinations always pass through to the browser.
- **Third person is over the right shoulder**, 3.4 blocks back. A clearance probe pulls the camera in front of walls (it snaps in and eases out) and hides the body when the camera is closer than 0.9 blocks.
- **Preferences** (mouse sensitivity, field of view, inverted look) live in `localStorage` under `ashbound.settings.v1`, and bad or missing values fall back to the defaults.
- **`?bench=1` is the frame-rate check.** It plays a fixed route counted in simulation ticks, so a slow machine flies exactly the same route as a fast one, after two unmeasured warm-up seconds. The report counts the frame rate as holding 60 when the average is at least 57 FPS and the 95th percentile frame time is at most 18.5 ms, which allows timer jitter around a 60 Hz refresh. Headless runs use software WebGL, so they test that the flow works and say nothing about speed.
- **The proving ground is a throwaway.** The walled deck in `src/engine/proving-ground-layout.ts` (stairs, jumping gaps, doorways, tunnels, a tower, pillars) exists to test movement and is replaced when Phase 2 brings real terrain. How terrain collision works is settled by the look spike, not here.

## Toolchain

- **TypeScript 6.0, not 7.0.** `typescript-eslint` 8.72 supports TypeScript below 6.1 only. Revisit when it supports 7.
- **Playwright 1.56 is pinned.** It matches Chromium build 1194, which the cloud sandbox ships. Bump it together with the sandbox image.
- **CI runs on `ubuntu-24.04`.** `ubuntu-latest` now maps to Ubuntu 26.04, which Playwright 1.56 does not support. Move back to `ubuntu-latest` after a Playwright bump that supports it.
- **Vite uses a relative base (`./`).** The Pages address is `austinbryanprice-droid.github.io/Claude-Survivor-Builder/`, a subpath.
- **Vitest runs unit tests in Node.** Rendering and multiplayer are covered by Playwright against the production build.

## Look spike (2026-10-20)

The spike lives in `look.html` and `src/spike/`, on top of the new engine and world modules. Open it with `npm run dev` and visit `/look.html`; the switches are listed in `src/spike/README.md`. The spike scene is throwaway, but the engine, terrain, scatter and HUD modules it exercises are written to be kept.

- **Terrain mesher: surface nets.** The seeded density field is baked to a 1 m grid (197 by 73 by 197 nodes) and meshed in 36 chunks of 32 m. The smoothed-heightfield fallback was built too (`?terrain=heightfield`) so the two could be measured on the same field. Surface nets cost 123k triangles and about 170 ms to mesh; the heightfield costs 74k triangles and 60 to 85 ms. Surface nets therefore adds about 50k triangles for each pass that draws the terrain, against a Balanced frame of 0.7 to 0.9 million, and the extra mesh time is a one-off cost at load. The heightfield cannot show rock overhangs: every outcrop and cliff turns into one stretched slope with smeared texture, which is the opposite of the smooth landforms in reference 06 and the rocks in reference 07. Terrain is static in version 1, so remeshing speed does not matter. Decision: surface nets, with the heightfield kept behind the switch as a fallback if a real machine shows the extra 50k triangles matter.
- **Terrain collision: spheres against the baked density grid.** A body is a vertical stack of three spheres (ankle, waist, chest) pushed out of the ground along the field gradient (`src/world/terrain/collision.ts`), so what is drawn is what is stood on, overhangs included. A normal facing up by more than 0.55 counts as ground. Structure blocks stay cell-based: Phase 1's movement already collides with unit cells through `SolidQuery` (`src/shared/solid.ts`), and that stays the query for blocks. Movement therefore needs two queries, one for terrain and one for blocks. `src/shared` sits below `src/world`, so Phase 2 hands the terrain query to the movement code through an interface beside `SolidQuery` instead of importing `resolveTerrain` there.
- **Presets and the frame governor.** Balanced draws at the canvas size (capped at 2.1 million pixels) with one filtered shadow map, half-resolution bloom, FXAA and a planar reflection at 0.3 scale. Low and Balanced adapt their internal resolution (floors 0.6 and 0.7) with a governor that steps down when more than a fifth of recent frames run long and probes back up after a calm spell, backing off when a probe fails. Ultra is fixed at full resolution with 4x MSAA, two shadow cascades and light shafts. The budgets are in [art-direction.md](art-direction.md#look-spike-results).
- **One benchmark.** `?bench=1` on the look page is the game page's benchmark (`src/engine/bench.ts`) flown through the valley instead of the proving ground: the same two unmeasured warm-up seconds, the same route counted in simulation ticks, the same 30 second default (`?benchSeconds=`), the same report format and the same pass mark, at least 57 FPS on average and a 95th percentile of at most 18.5 ms. Phase 1's thresholds are unchanged (`src/shared/bench-report.ts`). The look page runs it once per preset with the governor off and adds GPU time where the browser has timer queries, plus draw calls and triangles; the B key starts it and Esc stops it. The game page keeps measuring the proving ground until Phase 2 puts the valley in the game, and then the look page goes away. The cloud sandbox has no GPU, so Austin's hardware gives the real numbers.
- **Day cycle.** The sun stays between 12 and 45 degrees by day and sinks to minus 26 at midnight; the curve is continuous at every seam (a unit test caught a 12 degree jump at dawn). `src/shared/daycycle.ts` uses trigonometry, so it is visual only: gameplay reads the phase and the cycle constants, never the derived values.
- **Textures.** Detailed, non-pixelated ground, rock, bark and leaf textures baked at load from seeded noise (spec section 4). References 01, 02, 03 and 08 use pixel-cube textures; whether to use those is Austin's call and is still open.
- **HUD.** An HTML, CSS and SVG component (`src/ui/player-hud/`) with original icons, laid out from reference 07 at 1280 by 720 and scaled with the window: torn dark frames, mint health in three segments, a blue stamina bar, round status icons with a timed buff, a compass strip with an orange waypoint diamond, a slate objective banner, and a frosted hotbar. It is a pure view driven by one state object. The spike drives it with made-up numbers; the survival and economy phases will feed it real ones. This replaces the earlier generic description of the HUD.
