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

## Toolchain

- **TypeScript 6.0, not 7.0.** `typescript-eslint` 8.72 supports TypeScript below 6.1 only. Revisit when it supports 7.
- **Playwright 1.56 is pinned.** It matches Chromium build 1194, which the cloud sandbox ships. Bump it together with the sandbox image.
- **CI runs on `ubuntu-24.04`.** `ubuntu-latest` now maps to Ubuntu 26.04, which Playwright 1.56 does not support. Move back to `ubuntu-latest` after a Playwright bump that supports it.
- **Vite uses a relative base (`./`).** The Pages address is `austinbryanprice-droid.github.io/Claude-Survivor-Builder/`, a subpath.
- **Vitest runs unit tests in Node.** Rendering and multiplayer are covered by Playwright against the production build.
