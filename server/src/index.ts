import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { config } from './config.js';
import { getDb, closeDb } from './db/connection.js';
import { sessionRoutes } from './routes/session.routes.js';
import { systemRoutes } from './routes/system.routes.js';
import { chatRoutes } from './routes/chat.routes.js';
import { projectRoutes } from './routes/project.routes.js';
import { analyticsRoutes } from './routes/analytics.routes.js';
import { projectScannerService } from './services/project-scanner.service.js';
import { fileWatcherService } from './services/file-watcher.service.js';
import { statusPollerService } from './services/status-poller.service.js';
import { setupWebSocket, stopWebSocketTimers } from './ws/index.js';
import { setupWatcherBridge } from './services/watcher-bridge.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = Fastify({
  logger: {
    level: 'info',
  },
});

// CORS for dev
await app.register(cors, {
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
});

// Serve client dist in production
const clientDist = join(__dirname, '..', '..', 'client', 'dist');
if (existsSync(clientDist)) {
  await app.register(fastifyStatic, {
    root: clientDist,
    prefix: '/',
    wildcard: false,
  });
}

// Initialize database
getDb();

// WebSocket server (must register before routes that need it)
await setupWebSocket(app);

// Register routes
await app.register(systemRoutes);
await app.register(sessionRoutes);
await app.register(chatRoutes);
await app.register(projectRoutes);
await app.register(analyticsRoutes);

// Initial project scan
projectScannerService.runInitialScan();

// Start file watchers + bridge to event bus
fileWatcherService.start();
setupWatcherBridge();

// Start status poller
statusPollerService.start();

// Graceful shutdown
const shutdown = async () => {
  console.log('\n[server] Shutting down...');
  statusPollerService.stop();
  stopWebSocketTimers();
  fileWatcherService.stop();
  closeDb();
  await app.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start server
try {
  await app.listen({ port: config.port, host: config.host });
  console.log(`[server] JStudio Commander running on http://localhost:${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
