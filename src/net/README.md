# net

Multiplayer: the host's authority, the guests, and the transports that carry them. One command path serves single-player and rooms alike. This layer imports no three.js and touches no DOM, and it reaches PeerJS only through the small interface in `peer-transport.ts`. [docs/multiplayer.md](../../docs/multiplayer.md) explains the design; the message shapes are in `src/shared/protocol.ts` and `wire.ts`.

- `session.ts`: the `GameSession` interface the game talks to (`sendCommand`, `publishState`, `sampleRemotes`, events, roster, phase) and `WorldBinding`, how a session reaches the game's world.
- `host-session.ts`: the authority. Plays single-player with no room, opens a room, validates every command, fans events out, checks guests' movement, relays everyone's state, remembers departed guests by token. It also runs the survival simulation (`src/systems/survival`) from its own timer and tells the guests the time (`sv`) and each change of light (`se`); alone, the run waits for the player (`setLocalActive`).
- `guest-session.ts`: dials a room, handshakes, builds the host's world from the snapshot, requests edits, applies events, keeps the clock in step.
- `transport.ts`: what the sessions need from a network (`Transport`, `HostEndpoint`, `Link`) and `NetError`.
- `loopback.ts`: that network in memory, with latency, jitter, loss, reordering and silent deaths, for tests and the single-player host.
- `peer-transport.ts`: the real one, over PeerJS and WebRTC. Two lanes per guest, room codes with a prefix and collision retry, the broker dropping out and coming back, configurable broker and ICE.
- `lobby.ts`: alone, hosting or visiting, and the buttons between them (host, join, cancel, leave, play alone), plus why a room ended. The room panel draws its `state`.
- `hub.ts`: `SessionHub`, the one `GameSession` the game holds whichever session is behind it. It forwards the survival view and the player's presence the same way.
- `survival-mirror.ts`: a guest's copy of the survival clock: the host's last `sv` word carried forward on the guest's own timer, never ticking backwards, and the events the host announces. The host reads its simulation directly (`HostSession.survival`), and the screen cannot tell which it has.
- `scheduler.ts`, `emitter.ts`, `random.ts`: timers on real or virtual time, listener sets, and crypto-backed random numbers.
