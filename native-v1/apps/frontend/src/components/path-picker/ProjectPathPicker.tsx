// ProjectPathPicker — N2.1 §2.3 composite picker.
//
// Single input field that opens a dropdown with three sections:
//   1. Recent — last 10 spawn paths from preferences.recentProjectPaths,
//      with basename + relative timestamp ("2 hours ago"). Empty-state
//      placeholder when zero entries.
//   2. Projects — one-level directory listing under ~/Desktop/Projects/
//      with a lightweight project-type badge from the sidecar's scan
//      endpoint. TanStack-Query-cached 60s.
//   3. Browse... — opens the native macOS directory picker via
//      @tauri-apps/plugin-dialog.
//
// Keyboard nav: ↑/↓ through flattened visible items, Enter selects, Esc
// closes. Filter box at the top substring-filters Recent + Projects (case-
// insensitive, matches basename OR full path). Browse... is always last.
//
// The field renders the current selection as truncated absolute path with a
// tooltip (title attribute) showing the full path. Clicking anywhere on the
// input opens the dropdown.

import { useEffect, useMemo, useRef, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useRecentProjectPaths, useProjectsScan } from '../../queries/projectPaths.js';

const M = 'Montserrat, system-ui, sans-serif';

interface Props {
  value: string;
  onChange: (nextPath: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

type ItemKind = 'recent' | 'project' | 'browse';

interface FlatItem {
  kind: ItemKind;
  path: string;        // absolute path (empty for browse)
  name: string;        // display name
  subtitle?: string;   // secondary line
  badge?: string | null;
}

export function ProjectPathPicker({ value, onChange, placeholder, autoFocus }: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const recent = useRecentProjectPaths();
  const scan = useProjectsScan();

  // Flatten into one navigable list so ↑/↓ work across sections.
  const items: FlatItem[] = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const match = (path: string, name: string) =>
      !needle ||
      name.toLowerCase().includes(needle) ||
      path.toLowerCase().includes(needle);

    const recentItems: FlatItem[] = (recent.data ?? [])
      .filter((r) => match(r.path, basename(r.path)))
      .slice(0, 10)
      .map((r) => ({
        kind: 'recent' as const,
        path: r.path,
        name: basename(r.path),
        subtitle: `${truncate(r.path, 52)} · ${relTime(r.lastUsedAt)}`,
      }));

    const scanEntries = scan.data?.entries ?? [];
    const projectItems: FlatItem[] = scanEntries
      .filter((e) => match(e.path, e.name))
      .map((e) => ({
        kind: 'project' as const,
        path: e.path,
        name: e.name,
        subtitle: truncate(e.path, 52),
        badge: e.detectedType,
      }));

    const browseItem: FlatItem = {
      kind: 'browse',
      path: '',
      name: 'Browse…',
      subtitle: 'Pick a directory via the native file dialog',
    };
    return [...recentItems, ...projectItems, browseItem];
  }, [recent.data, scan.data?.entries, filter]);

  // Clamp highlight to visible range whenever items change.
  useEffect(() => {
    if (highlightedIndex >= items.length) setHighlightedIndex(Math.max(0, items.length - 1));
  }, [items, highlightedIndex]);

  // Close dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const commitPath = async (item: FlatItem) => {
    if (item.kind === 'browse') {
      try {
        const picked = await openDialog({ directory: true, multiple: false });
        if (typeof picked === 'string' && picked) {
          onChange(picked);
        }
      } catch (err) {
        console.warn('[path-picker] native dialog failed:', (err as Error).message);
      }
    } else {
      onChange(item.path);
    }
    setOpen(false);
    setFilter('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[highlightedIndex];
      if (item) void commitPath(item);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {/*
        N2.1.1 Task 3 auto-close fix: previous code had both
        onFocus={setOpen(true)} AND onClick={setOpen(o => !o)} on this
        readOnly input. Clicking the input fired focus first (opened the
        dropdown) then click (toggled the open state back to false),
        producing the "dropdown briefly appears then closes on first click"
        symptom Jose observed. Fix: onClick is now monotonic setOpen(true);
        closing is handled exclusively by outside-mousedown, Esc, or an
        explicit item commit. Clicking the input a second time is a no-op.
        A user can still close the dropdown via Esc, Browse…, or any
        click outside the picker container.
      */}
      <input
        ref={inputRef}
        type="text"
        readOnly
        value={truncate(value, 56) || ''}
        placeholder={placeholder ?? 'Pick a project path…'}
        title={value || 'No path selected'}
        autoFocus={autoFocus}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(true)}
        style={{
          width: '100%',
          padding: '8px 10px',
          fontSize: 13,
          fontFamily: M,
          background: 'var(--color-muted)',
          color: 'var(--color-foreground)',
          border: '1px solid var(--color-border-strong)',
          borderRadius: 8,
          outline: 'none',
          cursor: 'pointer',
        }}
      />
      {open ? (
        <div
          style={{
            position: 'absolute',
            zIndex: 20,
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border-strong)',
            borderRadius: 8,
            maxHeight: 360,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.45)',
          }}
        >
          <input
            type="text"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setHighlightedIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Filter by name or path…"
            autoFocus
            style={{
              fontFamily: M,
              fontSize: 12,
              padding: '8px 10px',
              background: 'transparent',
              color: 'var(--color-foreground)',
              border: 'none',
              borderBottom: '1px solid var(--color-border)',
              outline: 'none',
            }}
          />
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <Section title="Recent">
              {items.filter((i) => i.kind === 'recent').length === 0 ? (
                <Empty text="No recent projects" />
              ) : (
                items
                  .map((it, idx) => (it.kind === 'recent' ? renderItem(it, idx, highlightedIndex, commitPath) : null))
                  .filter(Boolean)
              )}
            </Section>
            <Section title="Projects">
              {scan.isLoading ? (
                <Empty text="Scanning ~/Desktop/Projects/…" />
              ) : items.filter((i) => i.kind === 'project').length === 0 ? (
                <Empty text={scan.data?.exists === false ? 'Root directory missing' : 'No matches'} />
              ) : (
                items
                  .map((it, idx) => (it.kind === 'project' ? renderItem(it, idx, highlightedIndex, commitPath) : null))
                  .filter(Boolean)
              )}
            </Section>
            {items
              .map((it, idx) => (it.kind === 'browse' ? renderItem(it, idx, highlightedIndex, commitPath) : null))
              .filter(Boolean)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function renderItem(
  item: FlatItem,
  index: number,
  highlightedIndex: number,
  onCommit: (it: FlatItem) => void,
) {
  const highlighted = index === highlightedIndex;
  return (
    <button
      key={`${item.kind}:${item.path}:${index}`}
      type="button"
      onMouseDown={(e) => {
        // Prevent the outer mousedown handler from closing before click fires.
        e.preventDefault();
        void onCommit(item);
      }}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        width: '100%',
        gap: 10,
        padding: '8px 10px',
        fontFamily: M,
        fontSize: 12,
        textAlign: 'left',
        background: highlighted ? 'var(--color-muted)' : 'transparent',
        color: 'var(--color-foreground)',
        border: 'none',
        cursor: 'pointer',
      }}
    >
      <span style={{ width: 18, textAlign: 'center', opacity: 0.65 }}>
        {item.kind === 'browse' ? '📁' : item.kind === 'recent' ? '🕘' : '▸'}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
          {item.badge ? (
            <span
              style={{
                fontSize: 9,
                padding: '1px 6px',
                borderRadius: 4,
                background: 'var(--color-muted)',
                border: '1px solid var(--color-border-strong)',
                opacity: 0.85,
              }}
            >
              {item.badge}
            </span>
          ) : null}
        </div>
        {item.subtitle ? (
          <div style={{ fontSize: 10, opacity: 0.55, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.subtitle}
          </div>
        ) : null}
      </div>
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          opacity: 0.5,
          padding: '8px 10px 2px',
          fontFamily: M,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: '6px 12px', fontSize: 11, opacity: 0.5, fontFamily: M }}>{text}</div>;
}

function basename(p: string): string {
  const ix = p.replace(/\/$/, '').lastIndexOf('/');
  return ix >= 0 ? p.slice(ix + 1) : p;
}

function truncate(s: string, n: number): string {
  if (!s) return s;
  if (s.length <= n) return s;
  return '…' + s.slice(s.length - n + 1);
}

function relTime(ms: number): string {
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ms).toLocaleDateString();
}
