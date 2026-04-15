import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';

// Adds the small set of headers that meaningfully harden Commander when
// served through the Cloudflare tunnel. Kept conservative: this is a
// same-origin SPA, no third-party scripts, no embedding use-case.
//
// CSP highlights:
//   - default-src 'self'  → block third-party origins
//   - 'unsafe-inline' on style-src is required by Tailwind v4 + inline
//     styles we use throughout the app; remove only when those are gone
//   - data: + blob: on img-src for inlined SVG / file previews
//   - connect-src includes ws/wss self for the WebSocket upgrade

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export const securityHeadersMiddleware = (
  _request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction,
): void => {
  reply.header('Content-Security-Policy', CSP);
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  // Cloudflare terminates TLS, so HSTS via the trycloudflare.com host
  // would be ignored by browsers (preload list owns that domain). Skip.
  done();
};
