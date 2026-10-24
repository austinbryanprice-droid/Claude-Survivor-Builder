# ui

HUD, menus and overlays in HTML and CSS, on top of the canvas. The look follows [art direction](../../docs/art-direction.md).

- `hud.ts`, `hud.css`: builds the HUD and keeps it in step with pointer lock, the benchmark, the camera and the graphics preset.
- `player-hud/`: the in-game HUD of the reference (vitals, compass, objective, hotbar) as a pure view. `placeholder-hud.ts` drives it with the game's real heading, the player's own Health and Energy, the player's building hands (the hotbar selection, the crosshair, Build Mode and the caption), the pulse blaster's sight and hit marker, and made-up numbers for what does not exist yet (the hotbar's tools after the blaster).
- `vitals-hud.ts`: how the HUD shows the player's meters, as plain data in and out: the Health segments and the Energy bar, the tone each turns when it runs low, and the "Charging", "Low energy" and "Out of energy" icons.
- `run-hud.ts`: how the HUD shows the run, as plain data in and out: the day and night pill by the compass, the Outpost Core's gauge under it, the objective in the banner, the line on the pause card and the message when the light changes, a wave is coming or the Core falls.
- `build-hud.ts`: how the HUD shows the building hands, as plain data in and out so Vitest can run it: which icon each block gets (in the shape it will have), the words for why a click would do nothing, the caption above the hotbar (the piece in hand and its cost, the blaster and what a shot takes, or the reason in red) and the key list of Build Mode.
- `pause-panel.ts`: the click-to-play card with the controls, the run's clock, the graphics preset and the settings (with `?debug`, a time-of-day preview too).
- `status-panel.ts`: the key hints and the camera and graphics readout while playing; in Build Mode the hints give way to the keys of Build Mode.
- `frame-overlay.ts`: the F3 frame-time overlay.
- `bench-panel.ts`: the benchmark banner and the results card.
- `toast.ts`: a short message that fades (for example, "Graphics: Balanced").
- `settings-store.ts`, `dom.ts`: reading and saving preferences; a tiny element helper.
- `room-panel.ts`, `room-panel.css`: multiplayer. The Play together card on the start screen, the small roster while playing, and the full-screen notice when a room ends. It draws `Lobby.state` and has no network code; it sits above the HUD layers so clicking it never counts as "click to play".
