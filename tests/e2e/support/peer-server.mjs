// A local PeerJS signalling server for the multiplayer browser tests. The public one is not
// reachable from CI or the cloud sandbox, and the tests should not depend on it anyway.
import { PeerServer } from 'peer';

const port = Number(process.env.PEER_PORT ?? 9000);

PeerServer({
  host: '127.0.0.1',
  port,
  path: '/',
  // Tests close pages abruptly; free the id soon so the next run can reuse the code.
  alive_timeout: 15000,
  corsOptions: { origin: true },
});

console.warn(`PeerServer listening on http://127.0.0.1:${port}`);
