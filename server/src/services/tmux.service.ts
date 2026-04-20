import { execFileSync } from 'node:child_process';

export interface TmuxSessionInfo {
  name: string;
  createdAt: number;
  attached: boolean;
  lastActivity: number;
}

const exec = (args: string[]): string => {
  try {
    return execFileSync('tmux', args, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
  } catch (err: unknown) {
    const error = err as { status?: number; stderr?: string; message?: string };
    // tmux returns exit code 1 when server not running or session not found
    if (error.stderr?.includes('no server running') ||
        error.stderr?.includes('no current client') ||
        error.stderr?.includes('session not found')) {
      return '';
    }
    throw new Error(`tmux command failed: ${error.message ?? 'unknown error'}`);
  }
};

export const tmuxService = {
  listSessions(): TmuxSessionInfo[] {
    const output = exec([
      'list-sessions',
      '-F',
      '#{session_name}|#{session_created}|#{session_attached}|#{session_activity}',
    ]);
    if (!output) return [];

    return output.split('\n').filter(Boolean).map((line) => {
      const [name, created, attached, activity] = line.split('|');
      return {
        name: name!,
        createdAt: parseInt(created!, 10),
        attached: attached === '1',
        lastActivity: parseInt(activity!, 10),
      };
    });
  },

  createSession(name: string, cwd?: string): string {
    const args = ['new-session', '-d', '-s', name];
    if (cwd) {
      args.push('-c', cwd);
    }
    exec(args);
    return name;
  },

  // Phase S.1 Patch 1 — resolve the first (top) pane id owned by a tmux
  // session. Commander stores this as `sessions.tmux_session` so every
  // subsequent `send-keys -t %NN` routes to THAT pane, not whichever pane
  // happens to be active when the user clicks around inside the session.
  //
  // Before this helper existed, createSession stored the session NAME
  // (`jsc-<uuid>`) in the column. `tmux send-keys -t jsc-<uuid>` targets
  // the session's currently-active pane, which drifts when users split
  // or navigate — PM messages leaked into a sibling coder pane the moment
  // the coder pane became active. See OvaGas PM bug in Phase S.1.
  //
  // Idempotent: when called with a value that already starts with `%` it
  // returns the input unchanged — so callers can safely pass anything
  // they stored in `tmux_session` without pre-branching. Returns null
  // when the session has no panes (shouldn't happen post-new-session)
  // or doesn't exist.
  resolveFirstPaneId(sessionName: string): string | null {
    if (sessionName.startsWith('%')) return sessionName;
    try {
      const out = exec(['list-panes', '-t', sessionName, '-F', '#{pane_id}']);
      if (!out) return null;
      const first = out.split('\n')[0]?.trim();
      return first && first.startsWith('%') ? first : null;
    } catch {
      return null;
    }
  },

  killSession(name: string): void {
    exec(['kill-session', '-t', name]);
  },

  sendKeys(name: string, keys: string): void {
    // Phase S.1 Patch 3 — target guard. Accept pane ids (`%NN`) and the
    // `retired:` sentinel (no-op targets on dead rows). Anything else —
    // raw session names, `agent:` sentinels, empty strings — is a
    // routing foot-gun: `send-keys -t <session-name>` targets whichever
    // pane is currently active in that session, which is non-
    // deterministic when the user splits or navigates.
    //
    // DEV throws so the regression surfaces in tests; PROD logs + still
    // attempts the send so a misrouted write-path doesn't crash a live
    // server. Commander-generated session names (`jsc-*`) are allowed
    // through in PROD with a warn — we don't want to hard-break legacy
    // rows that haven't been healed yet.
    if (!name.startsWith('%') && !name.startsWith('retired:')) {
      const msg =
        `[tmux] sendKeys target '${name}' is not a pane id — ` +
        `may route to an unexpected pane inside the session.`;
      if (process.env.NODE_ENV !== 'production') {
        throw new Error(msg);
      }
      console.warn(msg);
    }
    // Retired targets are explicit no-ops — the row is stopped and its
    // pane was freed. Writing would either fail or hit a foreign pane.
    if (name.startsWith('retired:')) return;

    // Send literal text with -l flag (prevents special key interpretation),
    // then send Enter separately to ensure reliable delivery
    if (keys) {
      exec(['send-keys', '-t', name, '-l', keys]);
    }
    exec(['send-keys', '-t', name, 'Enter']);
  },

  sendRawKey(name: string, key: string): void {
    // Send a single key without appending Enter — for Escape, Tab, Enter, etc.
    exec(['send-keys', '-t', name, key]);
  },

  // Phase T — `preserveAnsi: true` adds tmux's `-e` flag so escape
  // sequences (colors, bold, cursor hints) stay in the output. Default
  // is unchanged (ANSI-stripped) because `classifyStatusFromPane` + the
  // activity/regex surface expect raw text and would break on escape
  // sequences. The mirror-pane tee path (status-poller) opts in per
  // call; every other caller is unaffected.
  capturePane(name: string, lines = 50, opts?: { preserveAnsi?: boolean }): string {
    const args = ['capture-pane', '-t', name, '-p', '-S', `-${lines}`];
    if (opts?.preserveAnsi) args.push('-e');
    return exec(args);
  },

  hasSession(name: string): boolean {
    try {
      // Pane IDs (e.g. "%35") are targets for send-keys but not valid for
      // has-session. Verify them via display-message instead; it accepts any
      // tmux target and prints the pane_id on success.
      if (name.startsWith('%')) {
        const out = exec(['display-message', '-p', '-t', name, '#{pane_id}']);
        return out === name;
      }
      exec(['has-session', '-t', name]);
      return true;
    } catch {
      return false;
    }
  },

  sessionExists(name: string): boolean {
    return this.hasSession(name);
  },

  getPaneCommand(name: string): string {
    return exec(['list-panes', '-t', name, '-F', '#{pane_current_command}']);
  },

  // Issue 6 — resolve a pane's current working directory. Used at session
  // spawn so Commander can store the real cwd in `sessions.project_path`
  // when the caller didn't supply one. Without this the spawn-bind
  // watcher early-returns (no cwd → can't predict Claude's JSONL dir)
  // and resolveOwner's cwd-exclusive strategy can't match hook events.
  // Returns null on any tmux error — caller falls back to user input.
  resolvePaneCwd(target: string): string | null {
    try {
      const out = exec(['display-message', '-p', '-t', target, '#{pane_current_path}']);
      const trimmed = out.trim();
      return trimmed.length > 0 ? trimmed : null;
    } catch {
      return null;
    }
  },

  // Enumerate every pane across every tmux session. Used to resolve sentinel
  // targets (sessions with no known pane) back to a real pane id by matching
  // on cwd.
  listAllPanes(): Array<{ paneId: string; cwd: string; sessionName: string; command: string }> {
    const out = exec([
      'list-panes',
      '-a',
      '-F',
      '#{pane_id}|#{pane_current_path}|#{session_name}|#{pane_current_command}',
    ]);
    if (!out) return [];
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [paneId, cwd, sessionName, command] = line.split('|');
        return { paneId: paneId!, cwd: cwd!, sessionName: sessionName!, command: command! };
      });
  },
};
