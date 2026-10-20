# Ashbound Outpost

A browser co-op survivor-builder for two to four players. By day you scavenge the wreckage of a crashed orbital station and build a shared outpost from refined, beveled blocks and modular machines. By night rogue machines attack in waves that grow every night.

> **Status: early development.** The project setup (Phase 0) is in place and the game itself is not playable yet. The [roadmap](docs/roadmap.md) lists what comes next.

## Play

Once the first deploy finishes, the game is served by GitHub Pages at <https://austinbryanprice-droid.github.io/Claude-Survivor-Builder/>. The repository owner has to set Settings, Pages, Source to **GitHub Actions** once for that to work.

## Develop

You need Node 22.12 or newer.

```sh
npm ci            # install exactly what package-lock.json says
npm run dev       # dev server on http://localhost:5173
npm run check     # typecheck, lint, format check, unit tests and a production build
npm run test:e2e  # builds, then runs the Playwright smoke test
```

The smoke test needs a Chromium that Playwright can find. On a fresh machine run `npx playwright install chromium` first. Headless runs use software WebGL (SwiftShader), so they prove correctness but say nothing about frame rate.

URL switches for development: `?debug` exposes `window.__ashbound`. More arrive with the features that use them (`?night=5`, `?bench=1`, `?quality=`).

## How multiplayer will work

A room has one host and up to three guests. The host creates a room and shares a short code; friends join over PeerJS and WebRTC. The host's browser runs the authoritative simulation, so **the host must keep the game tab open**: if the host leaves, the session ends for everyone. The host can save to the browser (IndexedDB) and later resume with a fresh code. There are no accounts and no host migration in version 1.

## Project layout

```
src/shared    pure TypeScript shared by every layer (hashing, seeded random numbers, URL flags)
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
