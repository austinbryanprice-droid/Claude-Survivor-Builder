import { defineConfig, devices } from '@playwright/test';

const port = 4173;
// A local PeerJS signalling server for the multiplayer tests (the public one is out of reach in
// CI and in the cloud sandbox). The tests pass it to the game with `?broker=`.
const peerPort = 9000;

const multiplayerTests = '**/multiplayer.spec.ts';
const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } };

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  // Every test runs a software-rendered 3D loop that already uses several cores, so more workers
  // slow the frame rate until waits time out.
  workers: process.env.CI ? 1 : 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    launchOptions: {
      // Software WebGL, so headless runs (CI and the cloud sandbox) have a GPU stand-in.
      args: [
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        '--use-gl=angle',
        // Keep real local addresses in WebRTC offers: browsers on one machine find each other
        // directly (the tests turn STUN and TURN off), instead of through .local names.
        '--disable-features=WebRtcHideLocalIpsWithMdns',
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: multiplayerTests,
      use: desktop,
    },
    {
      // Five pages talk to each other here, and a page that gets no turn for ten seconds looks
      // like a host or a guest that has gone. Next to the other tests on a four-core machine,
      // loading a page did exactly that, so these wait until the rest are done and have the
      // machine to themselves.
      name: 'multiplayer',
      testMatch: multiplayerTests,
      dependencies: ['chromium'],
      use: desktop,
    },
  ],
  // Tests run against the production build; `npm run test:e2e` builds first.
  webServer: [
    {
      command: `npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
      url: `http://127.0.0.1:${port}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'node tests/e2e/support/peer-server.mjs',
      url: `http://127.0.0.1:${peerPort}/`,
      env: { PEER_PORT: String(peerPort) },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
