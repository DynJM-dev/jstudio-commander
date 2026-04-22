// Tests for /api/projects/scan + detectProjectType heuristic.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initDatabase } from '@jstudio-commander/db';
import { EventBus } from '../ws/event-bus.js';
import { UnimplementedOrchestrator } from './sessions.js';
import { createServer } from '../server.js';
import { detectProjectType } from './projects.js';

describe('detectProjectType', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'detect-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('identifies Tauri projects by src-tauri/', () => {
    mkdirSync(join(tmp, 'src-tauri'));
    expect(detectProjectType(tmp)).toBe('Tauri');
  });

  it('identifies Supabase projects by supabase/', () => {
    mkdirSync(join(tmp, 'supabase'));
    expect(detectProjectType(tmp)).toBe('Supabase');
  });

  it('identifies React from package.json dependencies', () => {
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({ dependencies: { react: '19.0.0' } }),
    );
    expect(detectProjectType(tmp)).toBe('React');
  });

  it('returns null for empty dirs', () => {
    expect(detectProjectType(tmp)).toBeNull();
  });

  it('identifies Rust by Cargo.toml', () => {
    writeFileSync(join(tmp, 'Cargo.toml'), '[package]\nname = "x"');
    expect(detectProjectType(tmp)).toBe('Rust');
  });
});

describe('/api/projects/scan', () => {
  let tmp: string;
  let scanRoot: string;
  let db: ReturnType<typeof initDatabase>;
  let app: ReturnType<typeof createServer>;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'scan-test-'));
    scanRoot = join(tmp, 'Projects');
    mkdirSync(scanRoot);
    db = initDatabase({ dbPath: join(tmp, 'test.db') });
    app = createServer({
      db,
      bus: new EventBus(),
      orchestrator: new UnimplementedOrchestrator(),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.raw.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('lists subdirectories, filters to dirs only, skips dotfiles', async () => {
    mkdirSync(join(scanRoot, 'one'));
    mkdirSync(join(scanRoot, 'two'));
    mkdirSync(join(scanRoot, '.hidden'));
    writeFileSync(join(scanRoot, 'not-a-dir.txt'), 'x');

    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/scan?root=${encodeURIComponent(scanRoot)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { exists: boolean; entries: Array<{ name: string }> };
    expect(body.exists).toBe(true);
    const names = body.entries.map((e) => e.name).sort();
    expect(names).toEqual(['one', 'two']);
  });

  it('returns exists=false when root is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/scan?root=${encodeURIComponent('/nonexistent-path-xyz-12345')}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ exists: false, entries: [] });
  });

  it('attaches detectedType to entries when detectable', async () => {
    const reactDir = join(scanRoot, 'my-react-app');
    mkdirSync(reactDir);
    writeFileSync(
      join(reactDir, 'package.json'),
      JSON.stringify({ dependencies: { react: '19.0.0' } }),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/scan?root=${encodeURIComponent(scanRoot)}`,
    });
    const body = res.json() as { entries: Array<{ name: string; detectedType: string | null }> };
    const react = body.entries.find((e) => e.name === 'my-react-app');
    expect(react?.detectedType).toBe('React');
  });
});
