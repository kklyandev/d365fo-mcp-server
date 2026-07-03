import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { createHash } from 'crypto';

/**
 * Rate limiter configuration for different endpoint types
 */

/**
 * Safely parse an integer environment variable.
 * Returns defaultVal when the value is missing, non-numeric, or outside [min, max].
 */
function parseEnvInt(key: string, defaultVal: number, min: number, max: number): number {
  const raw = process.env[key];
  if (raw === undefined) return defaultVal;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed < min || parsed > max) {
    console.warn(`[rateLimiter] Invalid ${key}="${raw}" (expected ${min}–${max}), using default ${defaultVal}`);
    return defaultVal;
  }
  return parsed;
}

/**
 * Rate-limit key generator.
 *
 * Two deployment shapes, two strategies:
 *
 * 1. API_KEY set (recommended): every authenticated request carries the SAME
 *    shared key, so the Authorization header is useless as a per-user
 *    identity — keying on it would put the whole team into one bucket.
 *    apiKeyAuth already 401s unauthenticated requests before the limiter
 *    runs, so the limiter is pure per-source DoS protection → key by IP.
 *
 * 2. API_KEY not set: the Authorization header carries a per-user token
 *    (GitHub Copilot OAuth), which correctly separates developers behind a
 *    shared corporate VPN/NAT egress IP. Caveat: an anonymous attacker can
 *    rotate forged headers to mint fresh buckets (hashing does NOT prevent
 *    this — any change produces a new key), so the token key is scoped to
 *    the client IP. Rotation still only multiplies buckets within one IP;
 *    exposing the endpoint without API_KEY remains discouraged.
 *
 * The header is SHA-256 hashed so the secret never reaches logs or lives in
 * memory beyond the sync hash computation.
 */
const AUTH_ENABLED = !!process.env.API_KEY?.trim();

function ipKey(req: Request): string {
  const rawIp = req.ip || req.socket.remoteAddress || 'unknown';
  const ipWithoutPort = rawIp.replace(/:\d+$/, '');
  return ipKeyGenerator(ipWithoutPort);
}

function generateKey(req: Request): string {
  if (AUTH_ENABLED) {
    return 'ip:' + ipKey(req);
  }

  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.length > 8) {
    const digest = createHash('sha256').update(authHeader).digest('hex');
    return `ip:${ipKey(req)}|tok:${digest.slice(0, 32)}`;
  }

  return 'ip:' + ipKey(req);
}

/**
 * General API rate limiter
 * Default: 500 requests per 15 minutes per user token (or IP as fallback).
 * GitHub Copilot is chatty: a single interaction (e.g. get_object_info + search
 * + batch_search) can easily consume 10–20 requests. With 10 developers the old
 * default of 100 / 15 min was hit within 1–2 minutes per user.
 * Override via RATE_LIMIT_MAX_REQUESTS env var.
 */
export const apiRateLimiter = rateLimit({
  windowMs: parseEnvInt('RATE_LIMIT_WINDOW_MS', 900000, 10000, 86400000), // 10s–24h
  max: parseEnvInt('RATE_LIMIT_MAX_REQUESTS', 500, 1, 100000),
  keyGenerator: generateKey,
  validate: {
    // We safely use ipKeyGenerator in our custom generateKey function
    keyGeneratorIpFallback: false,
  },
  message: {
    error: 'Too many requests for this user or IP, please try again later.',
    retryAfter: 'Please check the Retry-After header.',
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      error: 'Too many requests',
      message: 'You have exceeded the rate limit. Please try again later.',
      retryAfter: res.getHeader('Retry-After'),
    });
  },
  skip: (req: Request) => {
    // Skip rate limiting for health check endpoint
    return req.path === '/health';
  },
});

