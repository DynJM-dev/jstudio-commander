import type { FastifyInstance } from 'fastify';
import {
  loadConfig,
  pinsMatch,
  recordPinAttempt,
  pinLockoutRemainingMs,
} from '../middleware/pin-auth.js';

export const authRoutes = async (app: FastifyInstance) => {
  app.post<{ Body: { pin: string } }>('/api/auth/verify-pin', async (request, reply) => {
    const { pin } = request.body ?? { pin: '' };
    const config = loadConfig();
    const ip = request.ip;

    // No PIN configured = local-only mode; refuse to validate anything
    // because it could mislead the client into thinking remote access is
    // protected when it isn't.
    if (!config.pin) {
      return reply.status(403).send({
        valid: false,
        error: 'PIN auth disabled. Configure a PIN before accessing remotely.',
      });
    }

    const lockoutMs = pinLockoutRemainingMs(ip);
    if (lockoutMs > 0) {
      return reply.status(429).send({
        valid: false,
        error: 'Too many attempts. Try again in a few minutes.',
        retryAfterMs: lockoutMs,
      });
    }

    const ok = typeof pin === 'string' && pinsMatch(pin, config.pin);
    const result = recordPinAttempt(ip, ok);

    if (!ok && result.lockedUntil) {
      return reply.status(429).send({
        valid: false,
        error: 'Too many attempts. Try again in a few minutes.',
        retryAfterMs: result.lockedUntil - Date.now(),
      });
    }

    return { valid: ok };
  });
};
