import { EventEmitter } from 'node:events';
import type { Session, SessionStatus, SessionActivity, ChatMessage, Project, TokenUsageEntry, Teammate, SessionTick } from '@commander/shared';

export interface StatusEmitExtras {
  from?: SessionStatus;
  to?: SessionStatus;
  evidence?: string;
  activity?: SessionActivity | null;
  at?: string;
}

class CommanderEventBus extends EventEmitter {
  // Session events
  emitSessionCreated(session: Session): void {
    this.emit('session:created', session);
  }

  emitSessionUpdated(session: Session): void {
    this.emit('session:updated', session);
  }

  emitSessionStatus(sessionId: string, status: SessionStatus, extras: StatusEmitExtras = {}): void {
    this.emit('session:status', sessionId, status, extras);
  }

  emitSessionDeleted(sessionId: string): void {
    this.emit('session:deleted', sessionId);
  }

  // Chat events
  emitChatMessage(sessionId: string, message: ChatMessage): void {
    this.emit('chat:message', sessionId, message);
  }

  emitChatMessages(sessionId: string, messages: ChatMessage[]): void {
    this.emit('chat:messages', sessionId, messages);
  }

  // Project events
  emitProjectUpdated(project: Project): void {
    this.emit('project:updated', project);
  }

  emitProjectsScanned(projects: Project[]): void {
    this.emit('project:scanned', projects);
  }

  // Analytics events
  emitAnalyticsToken(entry: TokenUsageEntry): void {
    this.emit('analytics:token', entry);
  }

  // Tunnel events
  emitTunnelStarted(url: string): void {
    this.emit('tunnel:started', url);
  }

  emitTunnelStopped(): void {
    this.emit('tunnel:stopped');
  }

  // Teammate events
  emitTeammateSpawned(teammate: Teammate): void {
    this.emit('teammate:spawned', teammate);
  }

  emitTeammateDismissed(sessionId: string): void {
    this.emit('teammate:dismissed', sessionId);
  }

  // Session tick (Phase M — statusline forwarder).
  emitSessionTick(sessionId: string, tick: SessionTick): void {
    this.emit('session:tick', sessionId, tick);
  }

  // Phase N.0 Patch 3 — lightweight proof-of-life pulse. Fired on every
  // inbound signal (hook, tick, JSONL append, poller flip). Payload is
  // just the session id + epoch-ms so the UI can recompute "Xs ago"
  // without refetching the full session row.
  emitSessionHeartbeat(sessionId: string, ts: number): void {
    this.emit('session:heartbeat', sessionId, ts);
  }

  // System events
  emitSystemError(error: string): void {
    this.emit('system:error', error);
  }

  emitSystemEvent(event: string, data: unknown): void {
    this.emit('system:event', event, data);
  }
}

export const eventBus = new CommanderEventBus();
// Increase limit since we have many listeners
eventBus.setMaxListeners(50);
