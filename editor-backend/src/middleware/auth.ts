import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Authentication + subscription-tier enforcement.
 *
 * @clerk/express is loaded lazily so the server still boots in DEMO mode
 * when the package isn't installed or no CLERK_SECRET_KEY is configured.
 * In production, set REQUIRE_AUTH=true to refuse to run open.
 */

// @ts-ignore - optional dependency, resolved at runtime
let clerk: any = null;
try {
  // @ts-ignore
  clerk = require('@clerk/express');
} catch {
  clerk = null;
}

export type SubscriptionTier = 'free' | 'pro' | 'enterprise';

const TIER_RANK: Record<SubscriptionTier, number> = {
  free: 0,
  pro: 1,
  enterprise: 2,
};

/** Per-tier upload ceiling (bytes). Mirrors the frontend useMaxVideoSizeMb. */
export const TIER_MAX_UPLOAD_BYTES: Record<SubscriptionTier, number> = {
  free: 256 * 1024 ** 2,
  pro: 1024 * 1024 ** 2,
  enterprise: 4096 * 1024 ** 2,
};

export const authConfigured: boolean =
  !!process.env.CLERK_SECRET_KEY && !!clerk?.clerkMiddleware;

const requireAuthEnv = process.env.REQUIRE_AUTH === 'true';

if (!authConfigured) {
  if (requireAuthEnv) {
    console.error(
      'FATAL: REQUIRE_AUTH=true but Clerk is not configured ' +
        '(set CLERK_SECRET_KEY and install @clerk/express).',
    );
    process.exit(1);
  }
  console.warn(
    'WARNING: running in DEMO mode — API endpoints are UNAUTHENTICATED. ' +
      'Set CLERK_SECRET_KEY (and REQUIRE_AUTH=true) before exposing publicly.',
  );
} else {
  console.log('Auth: Clerk middleware enabled');
}

/** Global middleware that attaches Clerk auth context (no-op in demo mode). */
export function clerkBootstrap(): RequestHandler {
  if (authConfigured) {
    return clerk.clerkMiddleware();
  }
  return (_req, _res, next) => next();
}

/** Resolve the caller's tier from Clerk session claims; 'free' by default. */
export function getTier(req: Request): SubscriptionTier {
  if (!authConfigured) return 'free';
  try {
    const auth = clerk.getAuth(req);
    const claims = auth?.sessionClaims ?? {};
    const tier =
      claims?.metadata?.tier ??
      claims?.publicMetadata?.tier ??
      claims?.tier ??
      'free';
    return (['free', 'pro', 'enterprise'].includes(tier) ? tier : 'free') as SubscriptionTier;
  } catch {
    return 'free';
  }
}

export function getUserId(req: Request): string | null {
  if (!authConfigured) return null;
  try {
    return clerk.getAuth(req)?.userId ?? null;
  } catch {
    return null;
  }
}

/** Gate: caller must be signed in (passes through in demo mode). */
export function requireAuth(): RequestHandler {
  if (!authConfigured) {
    return (_req, _res, next) => next();
  }
  return (req: Request, res: Response, next: NextFunction) => {
    if (!getUserId(req)) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    next();
  };
}

/** Gate: caller's tier must be >= the required tier (passes through in demo mode). */
export function requireTier(min: SubscriptionTier): RequestHandler {
  if (!authConfigured) {
    return (_req, _res, next) => next();
  }
  return (req: Request, res: Response, next: NextFunction) => {
    if (!getUserId(req)) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const tier = getTier(req);
    if (TIER_RANK[tier] < TIER_RANK[min]) {
      return res.status(403).json({
        error: `This feature requires the "${min}" plan or higher (you are on "${tier}").`,
      });
    }
    next();
  };
}
