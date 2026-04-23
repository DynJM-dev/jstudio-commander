import { useEffect, useRef, useState } from 'react';

export type SessionStreamStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'closed';

export interface HookEventEnvelope {
  session_id: string;
  event_name: string;
  event_uuid: string;
  timestamp: string;
  payload: unknown;
}

export interface UseSessionStreamOpts {
  /** Target session id. `null` disables the hook (no subscription). */
  sessionId: string | null;
  /** Sidecar port. Null disables the hook. */
  port: number | null;
  /** Bearer token (passed as `?access_token=` per N2 D2 WS auth carrier). */
  bearer: string | null;
  /**
   * Called for each PTY byte chunk on `pty:<session_id>`. Side-effectful —
   * xterm's `term.write(Uint8Array)` is the typical consumer. Invoked from
   * the WebSocket message handler; do not trigger React renders inside it.
   */
  onPtyData?: (bytes: Uint8Array, stream: 'stdout' | 'stderr') => void;
  /**
   * Upper bound on hookEvents retained in memory. Older events drop off
   * the back when the cap fills. Default 50.
   */
  hookEventCap?: number;
}

interface WsIncomingEvent {
  kind: 'event';
  topic: string;
  data: unknown;
}

interface WsIncomingAck {
  kind: 'subscribed' | 'unsubscribed';
  topic: string;
}

type WsIncoming = WsIncomingEvent | WsIncomingAck | { kind: string; [k: string]: unknown };

/**
 * Per-session WebSocket subscriber for `hook:<session_id>` + `pty:<session_id>`
 * topics per KB-P1.13. Opens one connection per hook instance (no shared
 * pool yet — N4+ optimization if needed), subscribes on `open`, unsubscribes
 * + closes on unmount.
 *
 * Returns hook events as React state (capped at `hookEventCap`). PTY bytes
 * route through `onPtyData` callback — side-effectful target (xterm
 * `term.write`) avoids re-renders per chunk, which for chatty streams would
 * tank the frame budget.
 *
 * KB-P4.2 v1.2 explicit-dispose lifecycle — the cleanup return is LOAD-
 * BEARING here + at every xterm mount. React reconciliation does NOT own
 * the WS connection; this hook does.
 */
export function useSessionStream(opts: UseSessionStreamOpts): {
  status: SessionStreamStatus;
  hookEvents: HookEventEnvelope[];
  reset: () => void;
} {
  const { sessionId, port, bearer, onPtyData, hookEventCap = 50 } = opts;

  const [status, setStatus] = useState<SessionStreamStatus>('idle');
  const [hookEvents, setHookEvents] = useState<HookEventEnvelope[]>([]);

  // Latch the PTY callback in a ref so it can change across renders without
  // tearing down the WS.
  const onPtyDataRef = useRef(onPtyData);
  useEffect(() => {
    onPtyDataRef.current = onPtyData;
  }, [onPtyData]);

  useEffect(() => {
    if (!sessionId || !port || !bearer) {
      setStatus('idle');
      return;
    }
    setStatus('connecting');

    const wsUrl = `ws://127.0.0.1:${port}/ws?access_token=${encodeURIComponent(bearer)}`;
    const ws = new WebSocket(wsUrl);
    const hookTopic = `hook:${sessionId}`;
    const ptyTopic = `pty:${sessionId}`;

    ws.addEventListener('open', () => {
      setStatus('connected');
      ws.send(JSON.stringify({ kind: 'subscribe', topic: hookTopic }));
      ws.send(JSON.stringify({ kind: 'subscribe', topic: ptyTopic }));
    });

    ws.addEventListener('message', (evt: MessageEvent) => {
      let parsed: WsIncoming;
      try {
        parsed = JSON.parse(String(evt.data)) as WsIncoming;
      } catch {
        return;
      }
      if (parsed.kind !== 'event') return;
      const event = parsed as WsIncomingEvent;

      if (event.topic === hookTopic) {
        const hookEvt = event.data as HookEventEnvelope;
        if (hookEvt && typeof hookEvt.event_uuid === 'string') {
          setHookEvents((prev) => {
            const next = [hookEvt, ...prev];
            return next.length > hookEventCap ? next.slice(0, hookEventCap) : next;
          });
        }
      } else if (event.topic === ptyTopic) {
        const ptyEvt = event.data as {
          kind?: string;
          stream?: 'stdout' | 'stderr';
          bytes?: string;
        };
        if (ptyEvt && ptyEvt.kind === 'data' && typeof ptyEvt.bytes === 'string') {
          const decoded = decodeBase64(ptyEvt.bytes);
          onPtyDataRef.current?.(decoded, ptyEvt.stream ?? 'stdout');
        }
      }
    });

    ws.addEventListener('close', () => setStatus('closed'));
    ws.addEventListener('error', () => setStatus('error'));

    return () => {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ kind: 'unsubscribe', topic: hookTopic }));
          ws.send(JSON.stringify({ kind: 'unsubscribe', topic: ptyTopic }));
        }
        ws.close();
      } catch {
        // socket already closed
      }
    };
  }, [sessionId, port, bearer, hookEventCap]);

  const reset = () => setHookEvents([]);

  return { status, hookEvents, reset };
}

function decodeBase64(b64: string): Uint8Array {
  // atob returns a binary string; each char is a byte. Round-trip safe
  // for UTF-8 bytes encoded via scrollback-codec.encodeScrollbackBase64.
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}
