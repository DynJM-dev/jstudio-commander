export interface TerminalSession {
  sessionId: string;
  cols: number;
  rows: number;
  active: boolean;
}

export interface TerminalResize {
  sessionId: string;
  cols: number;
  rows: number;
}
