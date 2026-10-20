# Architecture rules

Multiplayer arrives in Phase 3, before any gameplay exists, so the code is network-ready from Phase 2. These rules keep that from becoming a rewrite. Change one only with a note in [decisions.md](decisions.md).

## Layers

Each layer may import only the layers listed. ESLint enforces the boundaries (`eslint.config.js`).

| Folder        | Holds                                                                            | May import                   |
| ------------- | -------------------------------------------------------------------------------- | ---------------------------- |
| `src/shared`  | Pure TypeScript: hashing, seeded random numbers, math, URL flags, protocol types | nothing else in `src`        |
| `src/engine`  | Renderer, camera, input, game loop, anything that touches three.js or the DOM    | `shared`, three              |
| `src/world`   | Voxel data, seeded terrain, chunks, meshing, materials                           | `shared`                     |
| `src/systems` | Survival, waves, economy, upgrades: the host simulation                          | `shared`, `world`            |
| `src/net`     | Transports (loopback and PeerJS), commands, events, snapshots                    | `shared`, `world`, `systems` |
| `src/ui`      | HUD, menus, overlays in HTML and CSS                                             | every layer                  |

`world`, `systems` and `net` never import three.js or touch the DOM, so they run in a Worker and under Vitest. The thin render adapters in `src/world/render` are the exception: they may import `engine` and three.js.

## The rules

1. **One command path.** Every change to the world is a command (place, break, upgrade, harvest, attack). The host validates it and turns it into events, and every peer, the host included, applies the same events. Single-player and tests use a loopback transport; PeerJS is a second transport. This is built in Phase 2, not Phase 3.
2. **Terrain is a function of a seed.** Integer-hash noise (`src/shared/hash.ts`), never `Math.sin` tricks or `Math.random`, so every browser generates identical terrain. A late-join snapshot and a save are the seed plus edited chunks, entities and the economy: kilobytes, not megabytes. Retry reuses the seed; New Run draws a new one.
3. **Two meshing paths.** Terrain is a smooth surface-nets mesh with baked vertex AO. Player structures get per-face inset and chamfer geometry with no greedy merging, so panel seams stay. `InstancedMesh` serves modules, enemies, projectiles and particles. Only dirty chunks and their neighbors are remeshed.
4. **Content is data.** Blocks, tiers, modules, costs, enemies, waves and timers live in plain TypeScript tables. A headless balance simulator in Vitest prints income against cost per night, so tuning is checked rather than guessed.
5. **Fixed-step host.** The host simulates at 20 Hz in a Web Worker so a hidden tab does not freeze everyone. Rendering runs at display rate with interpolation. The host sees a warning when its tab is hidden.
6. **Two channels.** An ordered channel carries edits and events. An unordered one (PeerJS `reliable: false`) carries player transforms (about 20 Hz) and enemy transforms (about 10 Hz) as quantized binary, and stale packets are dropped by sequence number. PeerJS cannot give truly lossy delivery. Clients own their movement and the host sanity-checks it; the host owns blocks, costs, enemies, waves, health and research. Broker and ICE servers are configurable by URL parameter, and room codes are prefixed and retried on collision.
7. **Tunable and testable.** One balance file, URL switches for development (`?night=5`, `?bench=1`, `?debug`), and no gameplay that needs the console.
