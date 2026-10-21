# Credits

The code is released under the MIT License (see [LICENSE](LICENSE)). Assets must be CC0, generated in code, or clearly licensed with attribution, and every external asset is listed here.

## Assets

None yet. Models, textures and audio are generated in code, and so are the HUD icons. No font files ship: the HUD names Merriweather first and falls back to the system serif.

| Asset | Author | Source | License | Used for |
| ----- | ------ | ------ | ------- | -------- |

## Software

| Package                                             | License    | Used for                                                  |
| --------------------------------------------------- | ---------- | --------------------------------------------------------- |
| [three](https://threejs.org/)                       | MIT        | 3D rendering                                              |
| [Vite](https://vite.dev/)                           | MIT        | Build tool and dev server                                 |
| [TypeScript](https://www.typescriptlang.org/)       | Apache-2.0 | Language                                                  |
| [Vitest](https://vitest.dev/)                       | MIT        | Unit tests                                                |
| [Playwright](https://playwright.dev/)               | Apache-2.0 | Browser tests                                             |
| [ESLint](https://eslint.org/) and typescript-eslint | MIT        | Linting                                                   |
| [Prettier](https://prettier.io/)                    | MIT        | Formatting                                                |
| [PeerJS](https://peerjs.com/)                       | MIT        | WebRTC rooms (multiplayer)                                |
| [peer](https://github.com/peers/peerjs-server)      | MIT        | Local signalling server for the multiplayer browser tests |

PeerJS brings its own dependencies into the build: webrtc-adapter (BSD-3-Clause), eventemitter3 (MIT), @msgpack/msgpack (ISC) and peerjs-js-binarypack (MIT).

Rooms are set up through the free public PeerJS server and connect through PeerJS's default STUN and TURN servers. They are services the game talks to, not assets it ships. The game also works with another PeerJS-compatible server and your own relays (see [docs/multiplayer.md](docs/multiplayer.md)).
