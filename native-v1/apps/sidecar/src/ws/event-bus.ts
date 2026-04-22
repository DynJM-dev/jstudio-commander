// Typed event bus — single emitter, channel-multiplexed subscriptions.
// Per ARCHITECTURE_SPEC v1.2 §5.5 + §5.6: every event is typed, every
// subscription filters by channel, cross-session leakage is impossible
// because a subscription matches exactly one channel string.

import type { WsEvent } from '@jstudio-commander/shared';

export type ChannelName = 'global' | `session:${string}` | `project:${string}` | 'workspace';

export type Subscriber = (channel: ChannelName, event: WsEvent) => void;

export interface Subscription {
  channel: ChannelName;
  handler: Subscriber;
}

export class EventBus {
  private subs = new Set<Subscription>();

  subscribe(channel: ChannelName, handler: Subscriber): () => void {
    const sub: Subscription = { channel, handler };
    this.subs.add(sub);
    return () => this.subs.delete(sub);
  }

  emit(channel: ChannelName, event: WsEvent): void {
    for (const sub of this.subs) {
      if (sub.channel === channel) {
        try {
          sub.handler(channel, event);
        } catch (err) {
          console.error('[event-bus] subscriber threw', err);
        }
      }
    }
  }

  size(): number {
    return this.subs.size;
  }

  clear(): void {
    this.subs.clear();
  }
}

export function channelForSession(sessionId: string): ChannelName {
  return `session:${sessionId}` as const;
}

export function channelForProject(projectId: string): ChannelName {
  return `project:${projectId}` as const;
}
