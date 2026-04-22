// Right-side drawer per session. Tabs: STATE.md / DECISIONS.md /
// PROJECT_DOCUMENTATION.md / CLAUDE.md. Width + selected tab + collapsed
// state persisted via preferences per session (keys prefixed with
// `session.<id>.drawer.*`).
//
// N2 rendering: react-markdown + remark-gfm (basic tables, lists, code
// blocks, links). Syntax highlighting + full prose styling lands in N3.

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { wsClient } from '../lib/wsClient.js';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../queries/sessions.js';
import { useProjectFile, type ProjectFileName } from '../queries/projectFiles.js';
import { usePreference, useSetPreference } from '../queries/preferences.js';

const M = 'Montserrat, system-ui, sans-serif';
const TABS: ProjectFileName[] = ['STATE.md', 'DECISIONS.md', 'PROJECT_DOCUMENTATION.md', 'CLAUDE.md'];
const DEFAULT_WIDTH = 360;
const MIN_WIDTH = 240;
const MAX_WIDTH = 720;

interface Props {
  sessionId: string;
}

export function StateMdDrawer({ sessionId }: Props) {
  const sessionQuery = useSession(sessionId);
  const projectId = sessionQuery.data?.projectId;

  const tabPrefKey = `session.${sessionId}.drawer.tab`;
  const widthPrefKey = `session.${sessionId}.drawer.width`;
  const collapsedPrefKey = `session.${sessionId}.drawer.collapsed`;

  const tabPref = usePreference(tabPrefKey);
  const widthPref = usePreference(widthPrefKey);
  const collapsedPref = usePreference(collapsedPrefKey);
  const setPref = useSetPreference();

  const initialTab = (tabPref.data?.value as ProjectFileName) || 'STATE.md';
  const initialWidth = Number(widthPref.data?.value) || DEFAULT_WIDTH;
  const initialCollapsed = collapsedPref.data?.value === 'true';

  const [tab, setTab] = useState<ProjectFileName>(initialTab);
  const [width, setWidth] = useState<number>(initialWidth);
  const [collapsed, setCollapsed] = useState<boolean>(initialCollapsed);
  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    if (tabPref.data?.value) setTab(tabPref.data.value as ProjectFileName);
  }, [tabPref.data?.value]);
  useEffect(() => {
    if (widthPref.data?.value) setWidth(Number(widthPref.data.value));
  }, [widthPref.data?.value]);
  useEffect(() => {
    if (collapsedPref.data) setCollapsed(collapsedPref.data.value === 'true');
  }, [collapsedPref.data]);

  const qc = useQueryClient();

  // Invalidate file queries when sidecar emits project:file-changed.
  useEffect(() => {
    if (!projectId) return;
    return wsClient.subscribe(`project:${projectId}`, (event) => {
      if (event.type === 'project:file-changed' && event.projectId === projectId) {
        void qc.invalidateQueries({ queryKey: ['projectFile', projectId, event.file] });
      }
    });
  }, [projectId, qc]);

  const file = useProjectFile(projectId, tab);

  const persistWidth = (w: number) => {
    setPref.mutate({ key: widthPrefKey, value: String(w) });
  };
  const persistTab = (t: ProjectFileName) => {
    setTab(t);
    setPref.mutate({ key: tabPrefKey, value: t });
  };
  const persistCollapsed = (c: boolean) => {
    setCollapsed(c);
    setPref.mutate({ key: collapsedPrefKey, value: c ? 'true' : 'false' });
  };

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;
    const onMove = (ev: PointerEvent) => {
      const dx = startX - ev.clientX;
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + dx));
      setWidth(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      persistWidth(widthRef.current);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => persistCollapsed(false)}
        title="Show drawer"
        style={{
          width: 28,
          fontFamily: M,
          fontSize: 11,
          background: 'var(--color-surface)',
          color: 'var(--color-foreground)',
          border: 'none',
          borderLeft: '1px solid var(--color-border)',
          cursor: 'pointer',
          writingMode: 'vertical-rl',
          textAlign: 'center',
          padding: '10px 0',
          opacity: 0.75,
        }}
      >
        ‹ STATE
      </button>
    );
  }

  return (
    <aside
      style={{
        width,
        minWidth: MIN_WIDTH,
        maxWidth: MAX_WIDTH,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        color: 'var(--color-foreground)',
        fontFamily: M,
        position: 'relative',
      }}
    >
      <div
        onPointerDown={startDrag}
        title="Drag to resize"
        style={{
          position: 'absolute',
          left: -3,
          top: 0,
          width: 6,
          height: '100%',
          cursor: 'col-resize',
          zIndex: 2,
        }}
      />

      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 8px',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => persistTab(t)}
            style={{
              fontFamily: M,
              fontSize: 11,
              fontWeight: tab === t ? 600 : 400,
              padding: '4px 8px',
              background: tab === t ? 'var(--color-muted)' : 'transparent',
              color: 'var(--color-foreground)',
              border: '1px solid',
              borderColor: tab === t ? 'var(--color-border-strong)' : 'transparent',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {t.replace('.md', '')}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => persistCollapsed(true)}
          title="Collapse drawer"
          style={{
            fontFamily: M,
            fontSize: 11,
            padding: '4px 8px',
            background: 'transparent',
            color: 'var(--color-foreground)',
            border: '1px solid var(--color-border-strong)',
            borderRadius: 4,
            cursor: 'pointer',
            opacity: 0.75,
          }}
        >
          ›
        </button>
      </header>

      <div style={{ flex: 1, overflow: 'auto', padding: '12px 14px', fontSize: 13, lineHeight: 1.55 }}>
        {file.isLoading ? (
          <p style={{ opacity: 0.55 }}>Loading {tab}…</p>
        ) : file.data?.exists ? (
          <div className="markdown-body" style={{ fontFamily: M }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{file.data.content}</ReactMarkdown>
          </div>
        ) : file.data && !file.data.exists ? (
          <p style={{ opacity: 0.55, fontSize: 12 }}>
            File not found at <code>{file.data.path}</code>.
          </p>
        ) : file.isError ? (
          <p style={{ color: 'var(--color-danger)', fontSize: 12 }}>
            {(file.error as Error).message}
          </p>
        ) : null}
      </div>
    </aside>
  );
}
