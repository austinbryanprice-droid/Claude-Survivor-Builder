# Multiplayer

Up to four players share one world. One of them hosts: their browser is the authority for everything that changes the world, and the other three connect to it over WebRTC. This page says how that works, what the player sees, how to try it, and what the tests do and do not prove. The spec's rules are in [section 6](spec/SPEC.md); the owner's decisions are in [decisions](decisions.md#phase-3-multiplayer-foundation-2026-10-21).

## What a player does

1. Open the game. The start screen has a **Play together** card.
2. **Host a room** asks the matchmaking server for a five-character code (letters and digits, no `I`, `O`, `0` or `1`), for example `K7M2Q`. The card then shows the code, an invite link, and who is in the room.
3. Friends either type the code into the card's **Room code** field and press **Join**, or open the invite link, which joins on load.
4. Everyone clicks **Play** and builds together. The host's **Close room** ends the session for everyone (it asks first when others are in).

**If the host leaves, the session ends for everyone.** There is no host migration and no automatic reconnection in this version (spec sections 6 and 14). Guests see a full-screen notice, **The host left the game** (the host closed the room or the tab) or **Lost the connection to the host** (the host's browser stopped answering for ten seconds), with two choices: **Play alone**, which keeps the world exactly as it was when the room closed, or join another room. The start card, the room card and the README all say this up front. When saves arrive (Phase 6) the host will be offered a save at this point, and a resumed save starts a new room with a new code.

**What you can see together today.** Each other (a suit in the seat's colour with a name tag, walking and turning as its owner does), the room list with pings, the host-left screen, and the blocks: the host validates each edit, everyone applies it, and every world draws it (Phase 2c). The game has no build controls yet; those are Phase 2d, and 2d calls the same `sendCommand` the tests use. Until then a block is placed through the `?debug` hook (`window.__ashbound.mp.placeNear(0, 3, 257)` asks for a scrap cube three cells along +z from where you stand), and the tests compare a fingerprint of every world.

![The host's start screen with a full room](phase-3/room-host.jpg)

![Four players in the valley, seen by the host](phase-3/room-playing.jpg)

![What a guest sees when the host closes the room](phase-3/host-left.jpg)

The screenshots are four real pages talking through a local PeerJS server in headless Chromium on software rendering, so they show the layout and the look, not the frame rate.

A page that reloads goes back into its room by itself: while a player is in a room the address carries `?join=CODE`, and the host gives the same seat back to the same browser tab (see [tokens](#tokens-and-seats)).

## How it fits together

```
        game page (src/app/multiplayer.ts)
        ┌────────────────────────────────────────────────────────────────────┐
 input ─┤ SessionHub ── Lobby ── HostSession ──┐        room panel (src/ui)    │
        │      │          │      GuestSession ─┤        draws Lobby.state      │
        │      │          └─ PeerTransport ────┼── PeerJS ── WebRTC ── others  │
        │  PlayerSync, remote avatars          │                               │
        └──────────────────────────────────────┴───────────────────────────────┘
```

| Piece                                | Where                                                           | Job                                                                                                                                                                                         |
| ------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protocol, wire codec, tuning table   | `src/shared/protocol.ts`, `wire.ts`, `net-config.ts`            | Message shapes, bytes on the wire, and every number in one table (`NET`).                                                                                                                   |
| Clock, interpolation, movement check | `src/shared/clock-sync.ts`, `interpolation.ts`, `move-guard.ts` | Pure code, tested on virtual time.                                                                                                                                                          |
| `HostSession`                        | `src/net/host-session.ts`                                       | The authority. Also plays single-player with no room open.                                                                                                                                  |
| `GuestSession`                       | `src/net/guest-session.ts`                                      | Dials a room, builds the host's world from the snapshot, requests edits, applies events.                                                                                                    |
| `Transport`                          | `src/net/transport.ts`, `loopback.ts`, `peer-transport.ts`      | What the sessions need from a network. The loopback runs rooms in memory for tests; `PeerTransport` is the real one.                                                                        |
| `Lobby`, `SessionHub`                | `src/net/lobby.ts`, `hub.ts`                                    | Alone, hosting or visiting, and the buttons between them. The hub is the one `GameSession` the rest of the game holds, whichever session is behind it.                                      |
| Room panel                           | `src/ui/room-panel.ts`                                          | The card, the in-game roster and the host-left screen. It draws `Lobby.state` and calls the lobby; it has no network code.                                                                  |
| Game glue                            | `src/app/multiplayer.ts`, `player-sync.ts`, `seat-spawn.ts`     | Sends the player's movement, applies the host's corrections, draws the other players (`src/engine/remote-players.ts`), says where each seat starts, and leaves the room when the page goes. |
| Hook into the game                   | `src/app/attach-multiplayer.ts`                                 | The one file that knows `Game`: hands the glue the player, the world, the scene and the mouse, and runs it once a frame. Loaded on demand by `create-app.ts`.                               |

The layer rules hold: `src/shared`, `src/net`, `src/world` and `src/systems` import no three.js and touch no DOM. `src/net` reaches PeerJS only through a small structural interface (`PeerLike`). Nothing multiplayer is in the first download: the game page loads the glue (`attach-multiplayer`, about 20 kB compressed) after the game has started, PeerJS (about 31 kB compressed) only when a room is first opened, and `?bench=1` loads neither, so the benchmark measures the game alone.

## Rooms and connections

- **Codes.** The host registers the PeerJS id `ashbound-` plus the code. If the matchmaking server says the id is taken, another code is drawn, up to eight times. The prefix keeps ids from other apps on a shared server from clashing. Guests connect under random ids of their own.
- **Two lanes per guest.** `ctl` is reliable and ordered and carries JSON control frames (hello, welcome, snapshot, commands, events, refusals, pings, goodbyes). `fast` is unordered and carries the small binary state packets, so one late packet never holds up the newer ones behind it. Until `fast` opens, state rides on `ctl`. Both use PeerJS's `raw` serialization, so every control frame stays under 20,000 characters (`NET.maxFrameLength`); snapshots are split into frames of at most 1,000 edits.
- **Matchmaking and relays.** The public PeerJS server only introduces peers; after that, players talk directly. By default PeerJS's own list of ICE servers is used (a public STUN server and a free shared TURN relay). The URL can point the game at another server or other relays (see [URL switches](#url-switches)).
- **Heartbeat.** Guests ping the host every two seconds, and the pings carry each guest's measured round trip back out so the room list can show everyone's ping. Ten seconds of silence ends a link: a guest then shows **Lost the connection to the host**, and the host drops the guest and tells the others. A link that closes cleanly, or a goodbye frame, ends the session at once. A page that was itself blocked (a long script, a suspended tab) does not blame the other side: a session tick that runs more than two seconds late (`NET.stallMs`) forgives the silence that overlapped it, because the packets that arrived meanwhile are only read afterwards. A background tab whose timer ticks once a second is late by less than that, so a link that really died is still dropped on time (`tests/unit/session-stall.test.ts`).

## One command path

Placing and breaking go through one path for everyone, the host included, and single-player is the same path with nobody else in the room:

1. Input calls `sendCommand({ type: 'place' | 'break', x, y, z, state })` on the session.
2. The host validates it: a guest's rate (12 a second, a burst of 24), reach (6 blocks from the eyes plus 3 of slack for the host's slightly old idea of where the player is), no block inside any player's body, and then the world's own rules (`BlockWorld.checkPlace` and `checkBreak`: inside the build area, empty, not buried, resting on the ground or a block, a known piece).
3. If it passes, the host applies `setBlock` and sends the same numbered `set` event to every guest, the sender included. Events are state, not deltas, so applying one twice is harmless. A refusal goes back to the sender alone, with a short reason (`occupied`, `unsupported`, `out of reach`, `too fast`, `a player is in the way`).
4. Guests apply the event to their own world and only then tell listeners, so listeners (the renderer, sounds) only react.

Content and balance live in data tables (`src/shared/blocks.ts` for shapes and materials, `NET` for network numbers). Cell states are opaque to the network layer, so new shapes and tiers change no message.

## Joining late

A guest that says hello gets a `welcome` with the world seed, its seat, the room list, the event counter and where to start, then the player-made blocks as `snap` frames. The guest builds the same terrain from the seed (terrain never travels over the wire), places the edits, applies any events that arrived meanwhile, and only then becomes `open`. The host's own copy is the source: the snapshot is whatever `forEachEdit` visits, in a fixed order. A test places 2,600 blocks and checks that a late joiner ends with an identical world (same count, same fingerprint).

## Movement

Each client owns its own movement, as decided: the controller runs locally with no lag and the host sanity-checks it.

- **Sending.** The game reports the player every frame; the session sends about 20 times a second. A state packet is 31 bytes: a sequence number, an epoch, the feet position (1/256 block), velocity, yaw, pitch and flags (on the ground, reset).
- **Relaying.** The host sends everyone's latest state to every guest about 20 times a second, with each entry's age, so guests can place samples on the right moment of the timeline.
- **Drawing.** Other players are drawn 100 milliseconds behind their newest sample, so two samples nearly always bracket the draw time and motion is smooth. A late stream is carried forward on its velocity for at most 250 milliseconds. A jump of more than six blocks with no reset flag, or any reset flag, is drawn as a teleport. A clock-offset estimate keeps the host's and each guest's timelines together.
- **The host's check (`MoveGuard`).** A guest may move at the controller's top speed times 1.35 horizontally, jump speed times 1.35 upward and the terminal fall speed times 1.35 downward, with up to 1.5 seconds of unspent movement banked so a burst of late packets passes. A guest that breaks the limit, or whose body sits inside a solid block for 600 milliseconds, is moved back to its last accepted position: the host sends a `fix` frame and bumps the guest's epoch so stale packets are ignored, and the guest teleports there. This is a sanity check against glitches and honest mistakes, not anti-cheat. A determined player can still, for example, dive below the world and then claim a respawn anywhere. Version 1 plays with friends, so that is accepted.
- **Respawns and spawn points.** Falling out of the world or being placed at a spawn is reported with the reset flag, so everyone draws a jump instead of a glide. Each seat has a colour and a starting spot.

## Tokens and seats

Each browser tab keeps a random token in session storage and sends it with its hello. The host remembers the last sixteen guests that left, by token: the same tab that returns (a reload, or a brief loss followed by joining again) gets its old seat, with the same player id, colour and last safe position. A second tab of the same browser has its own token, so it is a second player. If a live member with that token was heard from in the last three seconds, the newcomer is a new player instead. The name is kept in local storage. Persistent tokens across browser restarts arrive with saves in Phase 6.

## URL switches

None are needed to play. They exist for tests, for a private server, and for a host on a strict network.

| Switch                               | Meaning                                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `?join=K7M2Q`                        | Join this room on load. A pasted invite link works in the code field too.                                                                   |
| `?name=Ada`                          | The name for this page.                                                                                                                     |
| `?broker=localhost:9000`             | Use another PeerJS-compatible server: `host[:port][/path]`, or with a scheme (`https://peers.example.com/app`). `&brokerKey=` sets its key. |
| `?ice=none`                          | Direct connections only (no STUN or TURN): for tests on one machine.                                                                        |
| `?ice=stun:host:3478,turn:host:3478` | Use these relays. `&iceUser=` and `&iceCred=` give TURN credentials. `?ice=default` restores PeerJS's list.                                 |

The invite link the card builds keeps these network switches, so a room on a private server is found on the same one, and leaves out the rest (your name, debug switches). When the network is not the usual one, the card says so, because a link can point the game at another server.

## What is tested, and what is not

**Proven in this repository's tests:**

- The whole protocol on virtual time over an in-memory network with latency, jitter, packet loss, reordering and links that die silently: hosts, guests, rooms of two to four, late joins, the movement check, interpolation under bad networks, returning seats, the host leaving or vanishing, and the lobby's states.
- The PeerJS transport against a fake PeerJS that behaves like the real library (lanes opening at different times, the matchmaking server dropping out, a code collision, a missing room).
- The sessions against the real voxel world: the placement rules, and a 2,600-block snapshot arriving identical.
- The host's movement check against the real controller on the real valley: a scripted sprint-and-hop tour over hills, lake floor and edge wall, delivered smoothly and in late bursts, and a 60-block fall, with every report accepted (and refused when the check is made stricter than the controller, so the test can fail).
- **Real browsers:** Playwright opens a local PeerServer and four Chromium pages of the real game. One hosts, three join by typing the code, they see each other's avatars and room list, place and break blocks until all four worlds carry the same fingerprint, a fifth is refused, a reload gets its seat back, a latecomer receives the whole world, and closing the host's tab shows the host-left message to the three guests, who can play on alone. Other tests cover a host whose page hangs (**Lost the connection to the host** after ten seconds), a missing room code, and an unreachable matchmaking server. Software WebGL draws about two frames a second and five pages starve each other, so each page here draws one frame every 1.5 seconds at a small size (the game, the network and the timers run as they always do), and the tests wait on state, never on time. They are a Playwright project of their own (`multiplayer` in `playwright.config.ts`) that runs after the other browser tests: next to them, a slow page load on a four-core machine silenced a guest for ten seconds, and the host rightly dropped it. To run only these, use `npx playwright test --project=multiplayer --no-deps`.

**Not proven here, because the sandbox cannot reach them:**

- The public PeerJS server and PeerJS's STUN and TURN servers. The tests use a local server and no ICE servers, so connections are direct on one machine.
- Real network paths: two machines, home routers, strict or carrier-grade NATs, VPNs. A connection that needs a relay depends on a free, shared TURN service that can be slow or full. If a room does not connect across the internet, the player sees "Could not connect to the host" with the likely reason.
- Frame rate. Headless software WebGL says nothing about it; `?bench=1` on a real machine does, and it never loads the multiplayer code.

## Known limits

- **A hidden host tab slows the room.** Browsers throttle timers in tabs that are hidden or covered, and the host's tab does the relaying. The card tells the host to keep the tab visible. Moving the host's loop into a Worker is a natural follow-up (Phase 4's host Worker will do most of it).
- **A wrong code takes about five seconds to report.** The matchmaking server holds the introduction for five seconds before it answers that there is no such room. A broker that is down is reported at once.
- **No kick, no spectators, no chat.** Not in the spec's Phase 3.
- **The movement check is a sanity check** (see above).
- **Everyone must run the same build.** A host and a guest on different protocol versions refuse each other and say why.

## For later phases

- New commands (upgrade a block, place a module, set a hotbar) are new `BlockCommand` shapes validated in `HostSession.refusal`; new world changes are new event types with the same numbered, idempotent delivery.
- Enemies, waves, health and resources become host state that rides the same `ev` stream or a sibling frame, and the host's Worker (Phase 4) can call the same session methods.
- Saves (Phase 6) hook the same moments the host-left screen does: the **Close room** button and `pagehide`. The spec asks the host to attempt an auto-save before the session ends when it can.
