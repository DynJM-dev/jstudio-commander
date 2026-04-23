import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Deterministic chunk splits to keep main bundle minimal per KB-P1.14.
        // Preferences UI (Dialog/Tabs + xterm probe) lazy-loads as separate chunks.
        manualChunks: (id) => {
          if (id.includes('node_modules/@tanstack/react-router')) return 'router';
          if (id.includes('node_modules/@tanstack/react-query')) return 'router';
          if (id.includes('node_modules/react-dom')) return 'react';
          if (id.includes('node_modules/react')) return 'react';
        },
      },
    },
    // Surface the warning at 500 KB per dispatch §2 T6 — not enforced as error
    // here; PHASE_REPORT §3 captures actual sizes.
    chunkSizeWarningLimit: 500,
  },
});
