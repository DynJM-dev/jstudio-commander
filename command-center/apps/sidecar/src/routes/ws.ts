import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { requireBearerOrTauriOrigin } from '../middleware/auth';
import type { WsBus, WsBusClient } from '../services/ws-bus';

export interface WsRouteOpts {
  bus: WsBus;
  expectedToken: string;
}

interface SubscribeMessage {
  kind: 'subscribe';
  topic: string;
}
interface UnsubscribeMessage {
  kind: 'unsubscribe';
  topic: string;
}
type IncomingWsMessage = SubscribeMessage | UnsubscribeMessage;

function parseWsMessage(raw: string): IncomingWsMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const msg = parsed as Record<string, unknown>;
    if (
      (msg.kind === 'subscribe' || msg.kind === 'unsubscribe') &&
      typeof msg.topic === 'string' &&
      msg.topic.length > 0
    ) {
      return msg as unknown as IncomingWsMessage;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * `/ws` endpoint implementing subscribe/unsubscribe protocol per
 * ARCHITECTURE_SPEC §7.5. N2 exercises only `hook:<session_id>` topics (hook
 * events emitted by the pipeline land here). Other topics — `pty:*`,
 * `status:*`, `approval:*`, `tool-result:*` — are scaffolded by the bus but
 * not exercised until N3+.
 *
 * Bearer auth runs as a preHandler on the HTTP upgrade request; unauthorized
 * upgrades get 401 without ever completing the WS handshake.
 */
export const wsRoute: FastifyPluginAsync<WsRouteOpts> = async (app, opts) => {
  const auth = requireBearerOrTauriOrigin({ expectedToken: opts.expectedToken });

  app.get('/ws', { websocket: true, preHandler: auth }, (socket /* WebSocket */, req) => {
    const clientId = randomUUID();
    const client: WsBusClient = {
      id: clientId,
      send: (payload: string) => {
        try {
          socket.send(payload);
        } catch (err) {
          app.log.warn({ err, clientId }, 'ws send failed');
        }
      },
    };

    app.log.debug({ clientId, remoteAddress: req.ip }, 'ws client connected');

    socket.on('message', (raw: Buffer | string) => {
      const text = typeof raw === 'string' ? raw : raw.toString('utf8');
      const msg = parseWsMessage(text);
      if (!msg) {
        socket.send(
          JSON.stringify({ kind: 'error', error: 'malformed message — expected {kind, topic}' }),
        );
        return;
      }
      if (msg.kind === 'subscribe') {
        opts.bus.subscribe(client, msg.topic);
        socket.send(JSON.stringify({ kind: 'subscribed', topic: msg.topic }));
      } else {
        opts.bus.unsubscribe(client, msg.topic);
        socket.send(JSON.stringify({ kind: 'unsubscribed', topic: msg.topic }));
      }
    });

    socket.on('close', () => {
      opts.bus.unsubscribeAll(client);
      app.log.debug({ clientId }, 'ws client disconnected');
    });

    socket.on('error', (err: Error) => {
      app.log.warn({ err, clientId }, 'ws socket error');
      opts.bus.unsubscribeAll(client);
    });
  });
};
