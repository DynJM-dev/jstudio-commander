import { EventEmitter } from 'node:events';
import type { Session, SessionStatus, ChatMessage, Project, TokenUsageEntry } from '@commander/shared';

class CommanderEventBus extends EventEmitter {
  // Session events
  emitSessionCreated(session: Session): void {
    this.emit('session:created', session);
  }

  emitSessionUpdated(session: Session): void {
    this.emit('session:updated', session);
  }

  emitSessionStatus(sessionId: string, status: SessionStatus): void {
    this.emit('session:status', sessionId, status);
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
