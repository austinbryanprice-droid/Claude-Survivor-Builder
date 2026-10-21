# ui

HUD, menus and overlays in HTML and CSS, on top of the canvas. The look follows [art direction](../../docs/art-direction.md).

- `hud.ts`, `hud.css`: builds the HUD and keeps it in step with pointer lock, the benchmark, the camera and the graphics preset.
- `player-hud/`: the in-game HUD of the reference (vitals, compass, objective, hotbar) as a pure view. `placeholder-hud.ts` drives it with the game's real heading and sprint and made-up numbers for what does not exist yet.
- `pause-panel.ts`: the click-to-play card with the controls, graphics preset and time of day, and the settings.
- `status-panel.ts`: the key hints and the camera and graphics readout while playing.
- `frame-overlay.ts`: the F3 frame-time overlay.
- `bench-panel.ts`: the benchmark banner and the results card.
- `toast.ts`: a short message that fades (for example, "Graphics: Balanced").
- `settings-store.ts`, `dom.ts`: reading and saving preferences; a tiny element helper.
