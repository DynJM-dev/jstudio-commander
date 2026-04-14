import type { SessionStatus } from '../types/session.js';

export const SESSION_STATUSES: SessionStatus[] = ['idle', 'working', 'waiting', 'stopped', 'error'];

export const STATUS_COLORS: Record<SessionStatus, string> = {
  working: '#22C55E',
  idle:    '#F59E0B',
  // Yellow — same hex as idle. Distinguished at render time by the glow +
  // pulse treatment applied when status === 'waiting'.
  waiting: '#F59E0B',
  error:   '#EF4444',
  stopped: '#6B7280',
};

export const STATUS_LABELS: Record<SessionStatus, string> = {
  working: 'Working',
  idle:    'Idle',
  waiting: 'Waiting',
  error:   'Error',
  stopped: 'Stopped',
};
