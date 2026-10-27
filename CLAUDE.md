# Working on Ashbound Outpost

Read these first: [docs/spec/SPEC.md](docs/spec/SPEC.md) is the spec, and sections 1 (non-negotiables) and 14 (scope guardrails) are locked. [docs/decisions.md](docs/decisions.md) records what the owner approved where the spec was open. [docs/architecture.md](docs/architecture.md) has the layer rules, [docs/art-direction.md](docs/art-direction.md) the look target and HUD, and [docs/roadmap.md](docs/roadmap.md) the pull request plan.

## Commands

```sh
npm ci                # install
npm run dev           # dev server
npm run check         # typecheck, lint, format check, unit tests, build (run before every PR)
npm run test:e2e      # builds, then runs the Playwright browser tests
npm run balance       # prints the balance report (what the economy gives against what it costs, a day at a time)
npm run format        # Prettier, writes files
```

## Rules

- Where the spec and a convenient shortcut disagree, the spec wins. If a choice conflicts with a locked section, stop and flag it instead of deviating quietly.
- Keep the source layers apart: `src/shared`, `src/world`, `src/systems` and `src/net` never import three.js or touch the DOM (ESLint enforces it).
- Every world change is a command that the host validates and applies as events. Terrain comes from a seed. Content and balance numbers live in data tables, not scattered constants.
- No reference images, screenshots of other games, or unlicensed assets in the repository. List every external asset in `CREDITS.md`.
- Small draft pull requests, one concern each. Run `npm run check` first, and attach screenshots for visual changes.

## Testing in the cloud sandbox

- Headless WebGL 2 works through SwiftShader. Playwright's launch flags are in `playwright.config.ts`. It gives correct screenshots and no frame rate; real frame rate comes from the `?bench=1` switch on a real machine.
- Multiplayer tests use a local PeerServer (the `peer` package) with `iceServers: []`. The public PeerJS broker, STUN and TURN servers are blocked there.
- Free asset sites (Kenney, Poly Haven, OpenGameArt and similar) are blocked, so assets are generated in code.
- Playwright is pinned to 1.56 to match the sandbox's Chromium build; bump both together.
