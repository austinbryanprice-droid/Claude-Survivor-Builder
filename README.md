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

The browser tests need a Chromium that Playwright can find. On a fresh machine run `npx playwright install chromium` first. Headless runs use software WebGL (SwiftShader), so they prove correctness but say nothing about frame rate.

URL switches: `?bench=1` runs the benchmark, and `?debug` exposes `window.__ashbound` and shows the frame overlay from the start. More arrive with the features that use them (`?night=5`, `?quality=`).

## How multiplayer will work

A room has one host and up to three guests. The host creates a room and shares a short code; friends join over PeerJS and WebRTC. The host's browser runs the authoritative simulation, so **the host must keep the game tab open**: if the host leaves, the session ends for everyone. The host can save to the browser (IndexedDB) and later resume with a fresh code. There are no accounts and no host migration in version 1.

## Project layout

```
src/shared    pure TypeScript shared by every layer (hashing, seeded random numbers, URL flags, movement and collision)
src/engine    renderer, camera, input and the game loop
src/world     voxel data, seeded terrain, chunks, meshing, materials
src/systems   survival, waves, economy and upgrades (the host simulation)
src/net       transports, commands, events and snapshots
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
- [Roadmap](docs/roadmap.md): phases and pull requests.

## License and credits

Code is released under the [MIT License](LICENSE). Assets are generated in code or are CC0 or clearly licensed; [CREDITS.md](CREDITS.md) lists every external one.
