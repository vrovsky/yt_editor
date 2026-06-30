import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Dependency-free security middleware: CORS allowlist, security headers,
 * and an in-memory fixed-window rate limiter.
 *
 * NOTE: the rate limiter stores buckets in process memory. For a
 * horizontally-scaled deployment, back it with a shared store (e.g. Redis).
 */

// ─── CORS (allowlist, never wildcard-with-credentials) ───────────────

export function buildCors(): RequestHandler {
  const raw = process.env.CORS_ORIGIN ?? 'http://localhost:3000';
  const allowAll = raw.trim() === '*';
  const allowlist = new Set(
    raw
      .split(',')
      .map((o) => o.trim().replace(/\/$/, ''))
      .filter(Boolean),
  );

  if (allowAll) {
    console.warn(
      'WARNING: CORS_ORIGIN=* — allowing all origins WITHOUT credentials. ' +
        'Set an explicit comma-separated allowlist for production.',
    );
  }

  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    res.setHeader('Vary', 'Origin');

    if (allowAll) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (origin && allowlist.has(origin.replace(/\/$/, ''))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization',
    );

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  };
}

// ─── Security headers (no helmet dependency) ─────────────────────────

export function securityHeaders(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()',
    );
    // Only assert HSTS when the request arrived over HTTPS (behind a proxy).
    if (
      req.secure ||
      req.headers['x-forwarded-proto'] === 'https'
    ) {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=15552000; includeSubDomains',
      );
    }
    next();
  };
}

// ─── In-memory fixed-window rate limiter ─────────────────────────────

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Optional label used in the 429 message. */
  name?: string;
}

export function createRateLimiter(opts: RateLimitOptions): RequestHandler {
  const { windowMs, max, name } = opts;
  const buckets = new Map<string, Bucket>();

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(key);
    }
  }, windowMs);
  // Don't keep the process alive just for cleanup.
  (cleanup as any).unref?.();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader(
      'X-RateLimit-Remaining',
      String(Math.max(0, max - bucket.count)),
    );

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: `Too many requests${name ? ` to ${name}` : ''}. Retry in ${retryAfter}s.`,
      });
    }
    next();
  };
}
