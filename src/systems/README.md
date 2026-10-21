# systems

Survival, waves, economy and upgrades: the host simulation. No three.js, DOM, engine or net imports, so it runs in a Worker and under Vitest. Phases 4 and 5 fill this in.

- `survival/sim.ts`: `SurvivalSim`, the run as the host plays it. It advances in fixed 20 Hz steps (`SIM_HZ`), fed real time by `advance(dt)` (a gap past `maxCatchUpSeconds` is dropped, not replayed) or jumped by `warp(seconds)` for tests and the debug hook, and it announces each change of light as an event. Today it is the day and night clock; the Core, the vitals, the machines and the waves arrive in the next parts of Phase 4.
- `survival/balance.ts`: the table of numbers that shape the loop. The length of the day and the night is `DAY_SECONDS` and `NIGHT_SECONDS` in `src/shared/daycycle.ts`, because the sky reads them too.
