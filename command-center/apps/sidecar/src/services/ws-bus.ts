import type { Logger } from '@commander/shared';

/**
 * Minimal pub/sub topic bus. Per-session topics per KB-P1.13 — never multiplex
 * into a single global firehose. Frontend subscribes only to topics for
 * currently-mounted panes; this bus enforces the write-side contract by
 * making subscribe/unsubscribe explicit per (client, topic) tuple.
 *
 * Transport-agnostic: `WsBusClient` is just anything with a `send(payload: string)`
 * and a unique `id`. Fastify's `@fastify/websocket` WebSocket instances fit
 * directly — `send` writes a frame; `id` we assign at connection-accept time.
 */

export interface WsBusClient {
  id: string;
  send(payload: string): void;
}

export interface BusEventEnvelope {
  kind: 'event';
  topic: string;
  data: unknown;
}

export class WsBus {
  private readonly topicToClients = new Map<string, Set<WsBusClient>>();
  private readonly clientToTopics = new WeakMap<WsBusClient, Set<string>>();

  constructor(private readonly logger: Logger) {}

  subscribe(client: WsBusClient, topic: string): void {
    let clients = this.topicToClients.get(topic);
    if (!clients) {
      clients = new Set();
      this.topicToClients.set(topic, clients);
    }
    clients.add(client);

    let topics = this.clientToTopics.get(client);
    if (!topics) {
      topics = new Set();
      this.clientToTopics.set(client, topics);
    }
    topics.add(topic);

    this.logger.debug({ clientId: client.id, topic }, 'ws.subscribe');
  }

  unsubscribe(client: WsBusClient, topic: string): void {
    this.topicToClients.get(topic)?.delete(client);
    this.clientToTopics.get(client)?.delete(topic);
    this.logger.debug({ clientId: client.id, topic }, 'ws.unsubscribe');
  }

  unsubscribeAll(client: WsBusClient): void {
    const topics = this.clientToTopics.get(client);
    if (!topics) return;
    for (const topic of topics) {
      this.topicToClients.get(topic)?.delete(client);
    }
    this.clientToTopics.delete(client);
    this.logger.debug({ clientId: client.id }, 'ws.unsubscribeAll');
  }

  publish(topic: string, data: unknown): void {
    const clients = this.topicToClients.get(topic);
    if (!clients || clients.size === 0) return;

    const envelope: BusEventEnvelope = { kind: 'event', topic, data };
    const payload = JSON.stringify(envelope);

    for (const client of clients) {
      try {
        client.send(payload);
      } catch (err) {
        this.logger.warn({ err, clientId: client.id, topic }, 'ws.publish failed');
      }
    }
  }

  subscriberCount(topic: string): number {
    return this.topicToClients.get(topic)?.size ?? 0;
  }
}
