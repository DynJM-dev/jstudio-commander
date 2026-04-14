export type SessionStatus = 'idle' | 'working' | 'waiting' | 'stopped' | 'error';

export interface Session {
  id: string;
  name: string;
  tmuxSession: string;
  projectPath: string | null;
  claudeSessionId: string | null;
  status: SessionStatus;
  model: string;
  createdAt: string;
  updatedAt: string;
  stoppedAt: string | null;
  stationId: string | null;
  agentRole: string | null;
  effortLevel: string;
  parentSessionId: string | null;
  teamName: string | null;
}

export interface Teammate {
  sessionId: string;
  sessionName: string;
  role: string;
  teamName: string;
  parentSessionId: string;
  color?: string;
  tmuxPaneId?: string;
}

export interface SessionEvent {
  id: number;
  sessionId: string;
  event: 'created' | 'started' | 'stopped' | 'killed' | 'command_sent' | 'error';
  detail: string | null;
  timestamp: string;
}
