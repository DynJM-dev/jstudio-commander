import { createServer } from 'node:net';

export const SIDECAR_PORT_RANGE = { start: 11002, end: 11011 } as const;

export async function scanPort(
  start = SIDECAR_PORT_RANGE.start,
  end = SIDECAR_PORT_RANGE.end,
): Promise<number | null> {
  for (let port = start; port <= end; port += 1) {
    if (await isAvailable(port)) return port;
  }
  return null;
}

function isAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => {
      srv.close(() => resolve(true));
    });
    srv.listen(port, '127.0.0.1');
  });
}
