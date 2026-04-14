import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/connection.js';
import { terminalService } from '../services/terminal.service.js';

interface TerminalMessage {
  type: 'input' | 'resize';
  data?: string;
  cols?: number;
  rows?: number;
}

export const terminalRoutes = async (app: FastifyInstance) => {
  app.get<{ Params: { sessionId: string } }>(
    '/ws/terminal/:sessionId',
    { websocket: true },
    (socket, request) => {
      const { sessionId } = request.params as { sessionId: string };
      const ws = socket as unknown as import('ws').WebSocket;

      // Look up session
      const db = getDb();
      const row = db.prepare('SELECT tmux_session, status FROM sessions WHERE id = ?')
        .get(sessionId) as { tmux_session: string; status: string } | undefined;

      if (!row) {
        ws.close(4004, 'Session not found');
        return;
      }

      if (row.status === 'stopped') {
        ws.close(4001, 'Session is stopped');
        return;
      }

      // Attach to tmux session
      const terminalId = `term-${sessionId}`;
      let terminal;
      try {
        terminal = terminalService.attach(terminalId, row.tmux_session);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to attach';
        ws.close(4002, msg);
        return;
      }

      // Pipe terminal output → WebSocket
      terminal.onData((data: string) => {
        try {
          if (ws.readyState === 1) { // OPEN
            ws.send(data);
          }
        } catch {
          // WebSocket may have closed
        }
      });

      // Pipe terminal exit → close WebSocket
      terminal.onExit(() => {
        try {
          ws.close(1000, 'Process exited');
        } catch {
          // Already closed
        }
      });

      // Pipe WebSocket messages → terminal
      ws.on('message', (raw: Buffer | string) => {
        const str = raw.toString();

        // Try to parse as JSON command
        try {
          const msg = JSON.parse(str) as TerminalMessage;
          if (msg.type === 'resize' && msg.cols && msg.rows) {
            terminal.resize(msg.cols, msg.rows);
            return;
          }
          if (msg.type === 'input' && msg.data) {
            terminal.write(msg.data);
            return;
          }
        } catch {
          // Not JSON — treat as raw terminal input
        }

        // Raw input
        terminal.write(str);
      });

      // Cleanup on WebSocket close
      ws.on('close', () => {
        terminal.kill();
      });

      ws.on('error', () => {
        terminal.kill();
      });
    }
  );
};
