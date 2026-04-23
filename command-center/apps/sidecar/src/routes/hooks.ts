import type { FastifyPluginAsync } from 'fastify';
import type { CommanderDb } from '../db/client';
import { runHookPipeline } from '../services/hook-pipeline';
import type { WsBus } from '../services/ws-bus';

export interface HookRoutesOpts {
  db: CommanderDb;
  bus: WsBus;
}

/**
 * 13 Claude Code hook events mapped to kebab-case URL suffixes. Event names
 * are the canonical PascalCase per KB-P3.1; URL paths are kebab-case per the
 * dispatch §2 T1 convention so the plugin `hooks.json` stays stable across
 * Claude Code versions.
 */
const HOOK_EVENTS: ReadonlyArray<readonly [path: string, name: string]> = [
  ['session-start', 'SessionStart'],
  ['user-prompt-submit', 'UserPromptSubmit'],
  ['pre-tool-use', 'PreToolUse'],
  ['post-tool-use', 'PostToolUse'],
  ['notification', 'Notification'],
  ['stop', 'Stop'],
  ['subagent-start', 'SubagentStart'],
  ['subagent-stop', 'SubagentStop'],
  ['task-created', 'TaskCreated'],
  ['task-completed', 'TaskCompleted'],
  ['session-end', 'SessionEnd'],
  ['pre-compact', 'PreCompact'],
  ['post-compact', 'PostCompact'],
] as const;

export const hookRoutes: FastifyPluginAsync<HookRoutesOpts> = async (app, opts) => {
  for (const [path, eventName] of HOOK_EVENTS) {
    app.post(`/hooks/${path}`, async (req, reply) => {
      try {
        const response = await runHookPipeline(
          { db: opts.db, bus: opts.bus, logger: app.log },
          eventName,
          req.body,
        );
        return response;
      } catch (err) {
        app.log.error({ err, eventName }, 'hook pipeline failed');
        reply.status(500);
        return {
          ok: false,
          error: {
            code: 'HOOK_PIPELINE_ERROR',
            message: err instanceof Error ? err.message : 'unknown',
          },
        };
      }
    });
  }
};
