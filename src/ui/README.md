# ui

HUD, menus and overlays in HTML and CSS, on top of the canvas. The look follows [art direction](../../docs/art-direction.md).

- `hud.ts`, `hud.css`: builds the HUD and keeps it in step with pointer lock, the benchmark and the camera.
- `pause-panel.ts`: the click-to-play card with the controls and settings.
- `frame-overlay.ts`: the F3 frame-time overlay.
- `bench-panel.ts`: the benchmark banner and the results card.
- `settings-store.ts`, `dom.ts`: reading and saving preferences; a tiny element helper.
- `room-panel.ts`, `room-panel.css`: multiplayer. The Play together card on the start screen, the small roster while playing, and the full-screen notice when a room ends. It draws `Lobby.state` and has no network code; it sits above the HUD layers so clicking it never counts as "click to play".
