# player-hud

The in-game HUD, after reference 07: vitals, status icons, compass, objective banner and hotbar. It is a pure view. `PlayerHud.update(state)` takes the whole `PlayerHudState` and touches the DOM only where a value changed, so a system can call it every frame.

- `player-hud.ts` is the component and its state types.
- `player-hud.css` has the styles, drawn for 1280 by 720 and scaled by `--u`.
- `icons.ts` is an SVG sprite of original icons, the four block icons of the hotbar among them.
- `format.ts` holds the pure helpers (compass math, distance and clock text, segment fills, scale) that the unit tests cover.

The state also carries the caption above the hotbar (`prompt`), the crosshair (`none`, `place` or `blocked`) and whether Build Mode is on; `../build-hud.ts` works those out from the player's building hands.

Colors, sizes and layout are described in [art direction](../../../docs/art-direction.md#hud). The class prefix is `ph-`.
