export type SessionStatus = 'idle' | 'working' | 'waiting' | 'stopped' | 'error';

// Commander effort matrix per ~/.claude/skills/jstudio-pm/SKILL.md.
// Legacy rows ('low', 'medium') are healed to 'xhigh' on boot —
// any fresh write from Commander must land in this union.
export const EFFORT_LEVELS = ['high', 'xhigh', 'max'] as const;
export type EffortLevel = typeof EFFORT_LEVELS[number];

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
  effortLevel: EffortLevel;
  parentSessionId: string | null;
  teamName: string | null;
  // 'pm' sessions auto-invoke /pm after Claude boots. 'raw' sessions are
  // plain Claude Code — no bootstrap. Defaults to 'raw' for rows created
  // before this field existed.
  sessionType: 'pm' | 'raw';
  // Ordered list of JSONL transcript absolute paths this session owns.
  // Appended once per hook event. Chat rendering concatenates messages
  // across every path in this list in order — so /compact, /clear, model
  // switches, or any other rotation produces additional entries here
  // rather than replacing the previous transcript.
  transcriptPaths: string[];
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
