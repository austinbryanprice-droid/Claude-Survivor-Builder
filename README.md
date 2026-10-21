# Ashbound Outpost

A browser co-op survivor-builder for two to four players. By day you scavenge the wreckage of a crashed orbital station and build a shared outpost from refined, beveled blocks and modular machines. By night rogue machines attack in waves that grow every night.

> **Status: early development.** You can run, jump and look around a walled test deck (Phase 1). The real world, building and enemies are not in yet. The [roadmap](docs/roadmap.md) lists what comes next.

## Play

Once the first deploy finishes, the game is served by GitHub Pages at <https://austinbryanprice-droid.github.io/Claude-Survivor-Builder/>. The repository owner has to set Settings, Pages, Source to **GitHub Actions** once for that to work.

## Controls

Click the page to take the mouse. Esc gives it back.

| Key     | Action                                                              |
| ------- | ------------------------------------------------------------------- |
| W A S D | Move                                                                |
| Space   | Jump (hold it to keep hopping)                                      |
| Shift   | Sprint                                                              |
| V or F5 | Switch between first and third person (F5 will not reload mid-game) |
| F3      | Show or hide the frame-time overlay                                 |
| Esc     | Free the mouse (and stop a running benchmark)                       |

Mouse sensitivity, field of view and inverted look are on the pause panel and are remembered in the browser.

To check the frame rate, open the game with `?bench=1`. It flies a fixed 30-second route (walking, sprinting, jumping, third person), then shows the average frame rate, the 95th percentile frame time and the graphics adapter, with a button that copies the report. `?bench=1&benchSeconds=60` changes the length.

The look spike page, `look.html`, shows the valley in the target look. Its `?bench=1` is the same benchmark, with the same report and pass mark, flown through the valley once each for Low, Balanced and Ultra. That run is the frame-rate check for the look; the game page measures the movement test deck until the valley moves into the game in Phase 2.

## Develop

You need Node 22.12 or newer.

```sh
npm ci            # install exactly what package-lock.json says
npm run dev       # dev server on http://localhost:5173
npm run check     # typecheck, lint, format check, unit tests and a production build
npm run test:e2e  # builds, then runs the Playwright browser tests
```

The browser tests need a Chromium that Playwright can find. On a fresh machine run `npx playwright install chromium` first. Headless runs use software WebGL (SwiftShader), so they prove correctness but say nothing about frame rate. The multiplayer tests start a local PeerJS server (`tests/e2e/support/peer-server.mjs`) so they need no internet.

URL switches: `?bench=1` runs the benchmark, and `?debug` exposes `window.__ashbound` and shows the frame overlay from the start. The multiplayer switches are above. More arrive with the features that use them (`?night=5`, `?quality=`).

## Multiplayer

Two to four players share one world. Open the game and use the **Play together** card on the start screen:

- **Host a room** gives you a five-character code (for example `K7M2Q`) and an invite link. Friends type the code into **Room code** and press **Join**, or open the link.
- Everyone sees each other, and every block anyone places or breaks appears for all of them.

**The host must keep the game tab open, and visible.** The host's browser is the authority for the world, so if the host leaves or closes the tab, the session ends for everyone. Guests see a message saying so and can keep playing alone in the world as it was. There are no accounts and no host migration or automatic reconnection in version 1 (spec sections 6 and 14). The host will be able to save to the browser (IndexedDB) and later resume with a fresh code when saves arrive in Phase 6.

Rooms are set up through the free public PeerJS server and connect directly between browsers over WebRTC. Strict firewalls and some mobile networks block direct connections; if a friend cannot join, try again or let them host. To try it yourself, open the game in two browser windows side by side: host in one, join from the other with the code.

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
