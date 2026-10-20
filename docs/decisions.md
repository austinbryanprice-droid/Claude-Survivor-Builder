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
