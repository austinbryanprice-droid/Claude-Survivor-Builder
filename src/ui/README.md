# ui

HUD, menus and overlays in HTML and CSS, on top of the canvas. The look follows [art direction](../../docs/art-direction.md).

- `hud.ts`, `hud.css`: builds the HUD and keeps it in step with pointer lock, the benchmark and the camera.
- `pause-panel.ts`: the click-to-play card with the controls and settings.
- `frame-overlay.ts`: the F3 frame-time overlay.
- `bench-panel.ts`: the benchmark banner and the results card.
- `settings-store.ts`, `dom.ts`: reading and saving preferences; a tiny element helper.
