import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { StackPill, StackCategory, RecentCommit } from '@commander/shared';

const execFileAsync = promisify(execFile);

interface StackMapping {
  match: string;
  label: string;
  category: StackCategory;
}

// Ordered longest-prefix-first so `@react-pdf/renderer` hits before `react`.
const STACK_MAP: StackMapping[] = [
  // frameworks — web (JS)
  { match: '@remix-run/react', label: 'Remix', category: 'framework' },
  { match: 'react-native', label: 'React Native', category: 'framework' },
  { match: '@nestjs/core', label: 'NestJS', category: 'framework' },
  { match: 'next', label: 'Next.js', category: 'framework' },
  { match: 'nuxt', label: 'Nuxt', category: 'framework' },
  { match: 'react', label: 'React', category: 'framework' },
  { match: 'vue', label: 'Vue', category: 'framework' },
  { match: 'svelte', label: 'Svelte', category: 'framework' },
  { match: 'solid-js', label: 'Solid', category: 'framework' },
  { match: 'electron', label: 'Electron', category: 'framework' },
  // frameworks — python
  { match: 'django', label: 'Django', category: 'framework' },
  { match: 'flask', label: 'Flask', category: 'framework' },
  { match: 'fastapi', label: 'FastAPI', category: 'framework' },
  // frameworks — rust
  { match: 'actix-web', label: 'Actix', category: 'framework' },
  { match: 'rocket', label: 'Rocket', category: 'framework' },
  // frameworks — go
  { match: 'github.com/gin-gonic/gin', label: 'Gin', category: 'framework' },
  { match: 'github.com/gofiber/fiber', label: 'Fiber', category: 'framework' },
  // frameworks — ruby
  { match: 'rails', label: 'Rails', category: 'framework' },
  { match: 'sinatra', label: 'Sinatra', category: 'framework' },
  // frameworks — php
  { match: 'laravel/framework', label: 'Laravel', category: 'framework' },
  { match: 'symfony/symfony', label: 'Symfony', category: 'framework' },
  // flutter handled separately in pubspec parser
  // backend
  { match: 'fastify', label: 'Fastify', category: 'backend' },
  { match: 'express', label: 'Express', category: 'backend' },
  { match: '@supabase/supabase-js', label: 'Supabase', category: 'backend' },
  { match: 'firebase', label: 'Firebase', category: 'backend' },
  // database / orm
  { match: 'prisma', label: 'Prisma', category: 'database' },
  { match: 'drizzle-orm', label: 'Drizzle', category: 'database' },
  { match: 'mongoose', label: 'MongoDB', category: 'database' },
  { match: 'better-sqlite3', label: 'SQLite', category: 'database' },
  { match: 'pg', label: 'PostgreSQL', category: 'database' },
  // tools
  { match: '@react-pdf/renderer', label: '@react-pdf', category: 'tool' },
  { match: 'tailwindcss', label: 'Tailwind', category: 'tool' },
  { match: 'vite', label: 'Vite', category: 'tool' },
  { match: 'webpack', label: 'Webpack', category: 'tool' },
  { match: 'turbo', label: 'Turborepo', category: 'tool' },
  { match: 'tokio', label: 'Tokio', category: 'tool' },
  { match: 'pandas', label: 'Pandas', category: 'tool' },
];

const mapDep = (dep: string): StackMapping | null => {
  const key = dep.trim().toLowerCase();
  for (const entry of STACK_MAP) {
    if (key === entry.match || key.startsWith(entry.match + '/')) return entry;
  }
  return null;
};

const addPill = (pills: StackPill[], seen: Set<string>, pill: StackPill): void => {
  const k = `${pill.category}:${pill.label}`;
  if (seen.has(k)) return;
  seen.add(k);
  pills.push(pill);
};

const readText = (p: string): string | null => {
  try {
    return readFileSync(p, 'utf-8');
  } catch {
    return null;
  }
};

const parsePackageJson = (content: string, pills: StackPill[], seen: Set<string>): void => {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return;
  }
  if (!json || typeof json !== 'object') return;
  const j = json as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const deps = { ...(j.dependencies ?? {}), ...(j.devDependencies ?? {}) };
  const depKeys = Object.keys(deps);

  addPill(pills, seen, {
    label: 'typescript' in deps ? 'TypeScript' : 'JavaScript',
    category: 'language',
  });

  for (const dep of depKeys) {
    const mapped = mapDep(dep);
    if (mapped) addPill(pills, seen, { label: mapped.label, category: mapped.category });
  }
};

const parsePyproject = (content: string, pills: StackPill[], seen: Set<string>): void => {
  addPill(pills, seen, { label: 'Python', category: 'language' });
  // Regex-lite: pull any token inside the dependencies array/table that looks
  // like a package name. Covers both PEP-621 [project].dependencies and
  // [tool.poetry.dependencies].
  const depsBlock = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/)?.[1]
    ?? content.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\n\[|\n*$)/)?.[1]
    ?? '';
  if (!depsBlock) return;
  const nameRe = /["']([a-zA-Z0-9_\-.]+)["']|^\s*([a-zA-Z0-9_\-.]+)\s*=/gm;
  let m: RegExpExecArray | null;
  while ((m = nameRe.exec(depsBlock)) !== null) {
    const name = (m[1] ?? m[2])?.trim();
    if (!name || name === 'python') continue;
    const mapped = mapDep(name);
    if (mapped) addPill(pills, seen, { label: mapped.label, category: mapped.category });
  }
};

const parseCargoToml = (content: string, pills: StackPill[], seen: Set<string>): void => {
  addPill(pills, seen, { label: 'Rust', category: 'language' });
  const depsBlock = content.match(/\[dependencies\]([\s\S]*?)(?:\n\[|\n*$)/)?.[1] ?? '';
  if (!depsBlock) return;
  const re = /^\s*([a-zA-Z0-9_\-]+)\s*=/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(depsBlock)) !== null) {
    const mapped = mapDep(m[1]!);
    if (mapped) addPill(pills, seen, { label: mapped.label, category: mapped.category });
  }
};

const parseGoMod = (content: string, pills: StackPill[], seen: Set<string>): void => {
  addPill(pills, seen, { label: 'Go', category: 'language' });
  // Both `require foo v1.2.3` (single-line) and `require ( ... )` blocks.
  const singleLines = Array.from(content.matchAll(/^\s*require\s+([^\s()]+)\s+v/gm)).map((m) => m[1]!);
  const blockMatch = content.match(/require\s*\(([\s\S]*?)\)/)?.[1] ?? '';
  const blockLines = Array.from(blockMatch.matchAll(/^\s*([^\s()]+)\s+v/gm)).map((m) => m[1]!);
  for (const pkg of [...singleLines, ...blockLines]) {
    const mapped = mapDep(pkg);
    if (mapped) addPill(pills, seen, { label: mapped.label, category: mapped.category });
  }
};

const parseGemfile = (content: string, pills: StackPill[], seen: Set<string>): void => {
  addPill(pills, seen, { label: 'Ruby', category: 'language' });
  const re = /^\s*gem\s+['"]([^'"]+)['"]/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const mapped = mapDep(m[1]!);
    if (mapped) addPill(pills, seen, { label: mapped.label, category: mapped.category });
  }
};

const parseComposerJson = (content: string, pills: StackPill[], seen: Set<string>): void => {
  addPill(pills, seen, { label: 'PHP', category: 'language' });
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return;
  }
  if (!json || typeof json !== 'object') return;
  const j = json as { require?: Record<string, string>; ['require-dev']?: Record<string, string> };
  const deps = { ...(j.require ?? {}), ...(j['require-dev'] ?? {}) };
  for (const dep of Object.keys(deps)) {
    const mapped = mapDep(dep);
    if (mapped) addPill(pills, seen, { label: mapped.label, category: mapped.category });
  }
};

const parsePubspec = (content: string, pills: StackPill[], seen: Set<string>): void => {
  addPill(pills, seen, { label: 'Dart', category: 'language' });
  const depsBlock = content.match(/^dependencies:([\s\S]*?)(?:^[a-zA-Z_]|\n*$)/m)?.[1] ?? '';
  if (/(^|\s)flutter:/m.test(depsBlock)) {
    addPill(pills, seen, { label: 'Flutter', category: 'framework' });
  }
  const re = /^\s{2}([a-zA-Z0-9_]+)\s*:/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(depsBlock)) !== null) {
    const mapped = mapDep(m[1]!);
    if (mapped) addPill(pills, seen, { label: mapped.label, category: mapped.category });
  }
};

const MANIFEST_PARSERS: Array<[string, (c: string, p: StackPill[], s: Set<string>) => void]> = [
  ['package.json', parsePackageJson],
  ['pyproject.toml', parsePyproject],
  ['Cargo.toml', parseCargoToml],
  ['go.mod', parseGoMod],
  ['Gemfile', parseGemfile],
  ['composer.json', parseComposerJson],
  ['pubspec.yaml', parsePubspec],
];

const parseManifestsIn = (dir: string, pills: StackPill[], seen: Set<string>): void => {
  for (const [name, parser] of MANIFEST_PARSERS) {
    const full = join(dir, name);
    if (!existsSync(full)) continue;
    const content = readText(full);
    if (!content) continue;
    try {
      parser(content, pills, seen);
    } catch {
      // swallow — one malformed manifest shouldn't kill the rest
    }
  }
};

// Resolve workspace subdirs for pnpm/npm/yarn monorepos.
// pnpm: `pnpm-workspace.yaml` with a `packages:` list of globs.
// npm/yarn: `workspaces` field in package.json (array or { packages: [] }).
// We support `pkg`, `pkg/*`, and `pkg/**` shallow globs (two common forms).
const resolveWorkspaceDirs = (rootPath: string): string[] => {
  const results = new Set<string>();
  const patterns: string[] = [];

  const pnpmYaml = readText(join(rootPath, 'pnpm-workspace.yaml'));
  if (pnpmYaml) {
    for (const m of pnpmYaml.matchAll(/^\s*-\s*['"]?([^'"\n]+)['"]?\s*$/gm)) {
      patterns.push(m[1]!.trim());
    }
  }

  const rootPkg = readText(join(rootPath, 'package.json'));
  if (rootPkg) {
    try {
      const parsed = JSON.parse(rootPkg) as { workspaces?: string[] | { packages?: string[] } };
      const ws = Array.isArray(parsed.workspaces)
        ? parsed.workspaces
        : (parsed.workspaces?.packages ?? []);
      for (const p of ws) patterns.push(p);
    } catch {
      // bad json, ignore
    }
  }

  for (const raw of patterns) {
    const pattern = raw.replace(/\/+$/, '');
    if (pattern.endsWith('/*') || pattern.endsWith('/**')) {
      const parentRel = pattern.replace(/\/\*+$/, '');
      const parent = join(rootPath, parentRel);
      if (!existsSync(parent)) continue;
      try {
        for (const entry of readdirSync(parent)) {
          if (entry.startsWith('.')) continue;
          const child = join(parent, entry);
          if (statSync(child).isDirectory()) results.add(child);
        }
      } catch {
        // skip inaccessible
      }
    } else {
      const abs = join(rootPath, pattern);
      if (existsSync(abs)) {
        try {
          if (statSync(abs).isDirectory()) results.add(abs);
        } catch {
          // skip
        }
      }
    }
  }

  return [...results];
};

export const detectStack = (projectPath: string): StackPill[] => {
  const pills: StackPill[] = [];
  const seen = new Set<string>();

  parseManifestsIn(projectPath, pills, seen);

  // Monorepo workspace packages — their manifests carry the real deps
  // for root-level projects whose top-level package.json is just
  // tooling (pnpm-workspace / yarn workspaces style).
  const workspaces = resolveWorkspaceDirs(projectPath);
  for (const ws of workspaces) {
    parseManifestsIn(ws, pills, seen);
  }

  return pills;
};

export const getRecentCommits = async (
  projectPath: string,
  limit = 10,
): Promise<RecentCommit[]> => {
  if (!existsSync(join(projectPath, '.git'))) return [];
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', projectPath, 'log', '--no-merges', `--format=%h|%s|%cI`, '-n', String(limit)],
      { timeout: 3000, maxBuffer: 256 * 1024 },
    );
    return stdout
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const [sha, subject, date] = line.split('|');
        return {
          sha: (sha ?? '').trim(),
          subject: (subject ?? '').trim(),
          date: (date ?? '').trim(),
        };
      })
      .filter((c) => c.sha && c.subject && c.date);
  } catch {
    return [];
  }
};
