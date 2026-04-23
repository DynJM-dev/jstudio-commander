import type { FastifyPluginAsync } from 'fastify';
import type { CommanderDb } from '../db/client';
import { requireBearerOrTauriOrigin } from '../middleware/auth';
import { TOOLS, TOOLS_BY_NAME } from './tools-registry';

/**
 * Minimal Model Context Protocol server — JSON-RPC 2.0 over HTTP POST, one
 * endpoint. Implements `initialize`, `tools/list`, `tools/call`. Hand-rolled
 * instead of `@modelcontextprotocol/sdk` because (a) the SDK's stdio and SSE
 * transports aren't exercised here — we only need the POST-JSON path, (b) the
 * SDK adds dep weight for features we don't use, (c) Bun-compat verification
 * surface is smaller with ~80 LOC of hand-rolled JSON-RPC than with a full
 * SDK adapter. PHASE_REPORT §4 D1 documents the choice with evidence.
 *
 * Routing:
 *   - POST /mcp            → JSON-RPC dispatch (initialize, tools/list, tools/call)
 *   - any /mcp/* path      → bearer preHandler runs first. Unauthed = 401.
 *                            Authed-but-unknown = 404 JSON-RPC-error envelope.
 *
 * The `/mcp/*` wildcard is here so dispatch §2.5's `curl /mcp/tools/list`
 * acceptance returns 401 (bearer preHandler fires) rather than 404 (route
 * missing). External MCP clients use the canonical POST /mcp entry.
 */

export interface McpServerOpts {
  db: CommanderDb;
  expectedToken: string;
}

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
  id?: JsonRpcId;
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: '2.0' as const,
    error: { code, message, ...(data !== undefined ? { data } : {}) } satisfies JsonRpcError,
    id,
  };
}

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: '2.0' as const, result, id };
}

function isJsonRpcRequest(v: unknown): v is JsonRpcRequest {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return r.jsonrpc === '2.0' && typeof r.method === 'string';
}

export const mcpServer: FastifyPluginAsync<McpServerOpts> = async (app, opts) => {
  const auth = requireBearerOrTauriOrigin({ expectedToken: opts.expectedToken });

  await app.register(
    async (scoped) => {
      scoped.addHook('preHandler', auth);

      // Canonical JSON-RPC entry point.
      scoped.post('/', async (req, reply) => {
        const body = req.body;
        if (!isJsonRpcRequest(body)) {
          reply.status(400);
          return rpcError(
            null,
            JSON_RPC_ERRORS.INVALID_REQUEST,
            'malformed JSON-RPC request — expected {jsonrpc:"2.0", method, id?}',
          );
        }

        const { method, id = null, params } = body;

        try {
          if (method === 'initialize') {
            return rpcResult(id, {
              protocolVersion: '2025-06-18',
              capabilities: {
                tools: { listChanged: false },
              },
              serverInfo: {
                name: 'commander-sidecar',
                version: '0.1.0-n2',
              },
            });
          }

          if (method === 'tools/list') {
            return rpcResult(id, {
              tools: TOOLS.map((t) => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
              })),
            });
          }

          if (method === 'tools/call') {
            const p = (params ?? {}) as Record<string, unknown>;
            const toolName = p.name;
            const args = (p.arguments ?? {}) as Record<string, unknown>;
            if (typeof toolName !== 'string') {
              return rpcError(
                id,
                JSON_RPC_ERRORS.INVALID_PARAMS,
                'tools/call requires params.name (string)',
              );
            }
            const tool = TOOLS_BY_NAME.get(toolName);
            if (!tool) {
              return rpcError(id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `unknown tool: ${toolName}`);
            }

            const toolResult = await tool.handler({ db: opts.db }, args);
            // MCP tool response shape: { content: [{type:'text', text}] } OR
            // { isError: true, content: [...] }. We surface our envelope
            // JSON as a single text block so the caller can parse it.
            if (toolResult.ok) {
              return rpcResult(id, {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(toolResult.data, null, 2),
                  },
                ],
              });
            }
            return rpcResult(id, {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ ok: false, error: toolResult.error }, null, 2),
                },
              ],
            });
          }

          return rpcError(id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `unknown method: ${method}`);
        } catch (err) {
          app.log.error({ err, method }, 'mcp dispatch failed');
          return rpcError(
            id,
            JSON_RPC_ERRORS.INTERNAL_ERROR,
            err instanceof Error ? err.message : 'unknown',
          );
        }
      });

      // Catch-all on authed /mcp/* paths: returns 404 JSON-RPC error envelope.
      // Unauthed requests never reach here — preHandler 401s first, which is
      // exactly what acceptance 2.5's curl probe on /mcp/tools/list expects.
      scoped.all('/*', async (req, reply) => {
        reply.status(404);
        return rpcError(
          null,
          JSON_RPC_ERRORS.METHOD_NOT_FOUND,
          `MCP uses POST / with JSON-RPC body; got ${req.method} ${req.url}`,
        );
      });
    },
    { prefix: '/mcp' },
  );
};
