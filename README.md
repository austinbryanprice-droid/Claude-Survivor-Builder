# Ashbound Outpost

A browser co-op survivor-builder for two to four players. By day you scavenge the wreckage of a crashed orbital station and build a shared outpost from refined, beveled blocks and modular machines. By night rogue machines attack in waves that grow every night.

> **Status: early development.** You can run, jump and look around the Ashbound Valley: seeded terrain, a lake, trees and a golden-hour sky. You can build in it: right click places a beveled block, a slab or a wedge, left click breaks one, and the hotbar holds the four materials (Q changes the shape, so a roof is a row of wedges). Up to four players can share the valley (one hosts a room, the others join with a code), see each other move and see every block anyone builds. The nights are in: a day and night clock, the Outpost Core, machines that come for it in waves, a pulse blaster, going down and coming back, and the Outpost Overrun card when a run is lost. The economy has started: heaps of wreckage lie in the valley, E strips them into the crew's shared pool of materials, and building spends from it (a block costs one of its material, breaking it gives that back, and a heap keeps its ground clear). Surviving nights earns research points, which open the better materials one row at a time (Reinforced Composite, then Advanced Alloy, from a few better heaps), and the first functional module can be built, the Research Terminal in hotbar slot 6, which does nothing yet (an unlock will need one next). `/?demo=outpost` raises a finished base to look at. The [roadmap](docs/roadmap.md) lists what comes next.

## Play

Once the first deploy finishes, the game is served by GitHub Pages at <https://austinbryanprice-droid.github.io/Claude-Survivor-Builder/>. The repository owner has to set Settings, Pages, Source to **GitHub Actions** once for that to work.

## Controls

Click the page to take the mouse. Esc gives it back.

| Key                 | Action                                                               |
| ------------------- | -------------------------------------------------------------------- |
| W A S D             | Move                                                                 |
| Space               | Jump (hold it to keep hopping)                                       |
| Shift               | Sprint                                                               |
| V or F5             | Switch between first and third person (F5 will not reload mid-game)  |
| Right click         | Place the selected block where the cursor is (hold it to keep going) |
| Left click          | Break the block under the cursor (hold it to keep going)             |
| 1 to 8, mouse wheel | Choose a hotbar slot; the first four hold the four materials         |
| E                   | Strip the heap of debris under the cursor into the crew's pool       |
| Q                   | Choose block, slab or wedge for every slot                           |
| R                   | Turn the slab or wedge (a wedge rises away from you by default)      |
| B                   | Build Mode: a ghost of the next block, its name and cost, the keys   |
| P                   | Cycle the graphics preset: Low, Balanced, Ultra                      |
| F3                  | Show or hide the frame-time overlay                                  |
| Esc                 | Free the mouse (and stop a running benchmark)                        |

A block goes on the ground or on another block, within six blocks of you, and never inside a player. A slab goes in the half of its cell the surface you aim at points to; a wedge rises away from you, so a row of them is a ramp you can walk up, and R turns it. The cursor sees a little farther than a click reaches and says "Out of reach" in red there. Build Mode only adds the ghost, the caption and the key list; the clicks work with or without it.

Mouse sensitivity, field of view, inverted look, the graphics preset and the time of day are on the pause panel. All but the time of day are remembered in the browser.

To check the frame rate, open the game with `?bench=1`. It flies the valley once for each graphics preset (30 seconds each, with a two-second warm-up), then shows the average frame rate, the 95th percentile frame time and the graphics adapter for each, with a button that copies the report. `?bench=1&benchSeconds=60` changes the length and `&benchPresets=balanced` picks the presets. [The app README](src/app/README.md) lists every key and URL switch.

## Develop

You need Node 22.12 or newer.

```sh
npm ci            # install exactly what package-lock.json says
npm run dev       # dev server on http://localhost:5173
npm run check     # typecheck, lint, format check, unit tests and a production build
npm run test:e2e  # builds, then runs the Playwright browser tests
```

The browser tests need a Chromium that Playwright can find. On a fresh machine run `npx playwright install chromium` first. Headless runs use software WebGL (SwiftShader), so they prove correctness but say nothing about frame rate. The multiplayer tests start a local PeerJS server (`tests/e2e/support/peer-server.mjs`) so they need no internet.

URL switches: `?bench=1` runs the benchmark, `?debug` exposes `window.__ashbound` and shows the frame overlay from the start, `?quality=low` picks a graphics preset for one visit, and `?shot=lake` holds the camera at a named viewpoint for screenshots. The multiplayer switches are above. The full list is in [the app README](src/app/README.md). More arrive with the features that use them (`?night=5`).

## Multiplayer

Two to four players share one world. Open the game and use the **Play together** card on the start screen:

- **Host a room** gives you a five-character code (for example `K7M2Q`) and an invite link. Friends type the code into **Room code** and press **Join**, or open the link.
- Everyone sees each other, and every block anyone places or breaks appears for all of them.

**The host must keep the game tab open, and visible.** The host's browser is the authority for the world, so if the host leaves or closes the tab, the session ends for everyone. Guests see a message saying so and can keep playing alone in the world as it was. There are no accounts and no host migration or automatic reconnection in version 1 (spec sections 6 and 14). The host will be able to save to the browser (IndexedDB) and later resume with a fresh code when saves arrive in Phase 6.

Rooms are set up through the free public PeerJS server and connect directly between browsers over WebRTC. On strict networks the connection falls back to PeerJS's free shared relay, which is best effort; if a friend still cannot join, try again or let them host. To try it yourself, open the game in two browser windows side by side: host in one, join from the other with the code.

For testing or a private server, the address takes a few switches: `?join=CODE`, `?name=Ada`, `?broker=host:port` (another PeerJS server) and `?ice=none` or `?ice=stun:host:3478,turn:host:3478` (relay servers). [docs/multiplayer.md](docs/multiplayer.md) has the details, what the tests prove, and what they cannot.

## Project layout

```
src/shared    pure TypeScript shared by every layer (hashing, seeded random numbers, URL flags, movement and collision)
src/engine    renderer, camera, input and the game loop
src/world     voxel data, seeded terrain, chunks, meshing, materials
src/systems   survival, waves, economy and upgrades (the host simulation)
src/net       transports, sessions, commands, events and snapshots (multiplayer)
src/app       the game page's glue: multiplayer, the player's movement over the network
src/ui        HUD, menus and overlays
src/app       the composition root that wires the layers together
assets/       generated or licensed assets (none yet)
public/       files copied as-is into the build
tests/        unit tests (Vitest) and browser tests (Playwright)
docs/         spec, architecture, decisions, art direction and roadmap
```

## Documentation

- [Spec](docs/spec/SPEC.md): the owner's design. Sections 1 and 14 are locked.
- [Architecture rules](docs/architecture.md): how the layers fit together.
- [Decisions](docs/decisions.md): answers to the open questions in the spec.
- [Art direction](docs/art-direction.md): the look target and the HUD.
- [Multiplayer](docs/multiplayer.md): rooms, the host's authority, sync, tests and limits.
- [Roadmap](docs/roadmap.md): phases and pull requests.

## License and credits

Code is released under the [MIT License](LICENSE). Assets are generated in code or are CC0 or clearly licensed; [CREDITS.md](CREDITS.md) lists every external one.
