import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Read the server port from the user's Commander config so the proxy
// always targets wherever the server is actually binding. Falls back
// to the Phase D default (11002) on missing/malformed file.
const resolveServerPort = (): number => {
  try {
    const raw = readFileSync(join(homedir(), '.jstudio-commander', 'config.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { port?: unknown };
    if (typeof parsed.port === 'number' && Number.isFinite(parsed.port)) return parsed.port;
  } catch {
    /* fall through */
  }
  return 11002;
};

const SERVER_PORT = resolveServerPort();

// Unique Vite port for Commander — 11573 in the same 11k range as the
// server port (11002) to stay clear of the 5173/5174 default
// ecosystem. strictPort fails loud if taken rather than drifting to a
// sibling port where a stale process could silently shadow us.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 11573,
    strictPort: true,
    host: 'localhost',
    proxy: {
      '/api': {
        target: `http://localhost:${SERVER_PORT}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `ws://localhost:${SERVER_PORT}`,
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
