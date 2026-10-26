# player-hud

The in-game HUD, after reference 07: vitals, status icons, compass, objective banner and hotbar. It is a pure view. `PlayerHud.update(state)` takes the whole `PlayerHudState` and touches the DOM only where a value changed, so a system can call it every frame.

- `player-hud.ts` is the component and its state types.
- `player-hud.css` has the styles, drawn for 1280 by 720 and scaled by `--u`.
- `icons.ts` is an SVG sprite of original icons, the block icons of the hotbar among them: a block, a slab and a wedge in each of the four materials, the slab and the wedge cut from the block's own paint.
- `research-ladder.ts` is the panel of a Research Terminal (5d2) and the state types it draws: `HudLadder`, with a `HudLadderRow` for each material.
- `format.ts` holds the pure helpers (compass math, distance and clock text, segment fills, scale) that the unit tests cover.

The top-left vitals are the player's own: `health` and `energy` (0 to 1), a tone for each (`healthTone` is `ok` or `low`, `energyTone` is `ok`, `low` or `empty`) and a column of `statuses`, round icons with a caption and a good or bad tone. A wound flashes the bar and reddens the edges of the screen. `../vitals-hud.ts` works those out from a `VitalsReading`.

The state also carries the run's day and night pill and, under it, the Outpost Core's gauge and the crew's respawn pips (`clock`, `core` and `charges`; each is hidden while the state has none), the crew's research as a third pill in that column (`research`: the points, a bar toward the next row of the ladder and the words, which flashes when the points rise), what a player who is down sees (`down`: the title, the line under it and the seconds, which draw over the whole screen and dim the hotbar), the caption above the hotbar (`prompt`), the crosshair (`none`, `place` or `blocked`) and whether Build Mode is on; `../build-hud.ts` works those out from the player's building hands. A hotbar slot can be `locked` (a material that is not researched yet): its icon is dim behind a padlock and it shows no count. `../research-hud.ts` works out the pill and the padlocks. The state can carry the research ladder a Research Terminal shows (`ladder`: the points, a bar and a row for each material, drawn beside the crosshair by `research-ladder.ts`, which `PlayerHud` owns); `../terminal-hud.ts` works it out.

Colors, sizes and layout are described in [art direction](../../../docs/art-direction.md#hud). The class prefix is `ph-`.
