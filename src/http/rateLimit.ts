import { HTTPException } from 'hono/http-exception';
import { RATE_LIMITED_CODE } from '@general-quiz/contracts';
import { problemResponse } from './problem';

export type RateLimitRule = { limit: number; windowMs: number };

/**
 * A per-key fixed-window counter kept in memory (one API process, AD-8). Good enough to stop
 * spam from one account; it resets on restart.
 */
export function createRateLimiter(now: () => Date = () => new Date()) {
  const windows = new Map<string, { start: number; count: number }>();
  let checks = 0;
  return {
    /** Counts one hit; returns the seconds to wait when `key` is over `rule`, else 0. */
    hit(key: string, rule: RateLimitRule): number {
      const time = now().getTime();
      // Drop expired windows now and then so the map stays small.
      if (++checks % 1000 === 0) for (const [k, w] of windows) if (time - w.start >= rule.windowMs) windows.delete(k);
      const current = windows.get(key);
      if (!current || time - current.start >= rule.windowMs) {
        windows.set(key, { start: time, count: 1 });
        return 0;
      }
      if (current.count >= rule.limit) return Math.max(1, Math.ceil((current.start + rule.windowMs - time) / 1000));
      current.count += 1;
      return 0;
    },
    /** Throws a 429 problem+json `rateLimited` (with `Retry-After`) when `key` is over `rule`. */
    enforce(key: string, rule: RateLimitRule, instance?: string): void {
      const retryAfter = this.hit(key, rule);
      if (retryAfter === 0) return;
      const res = problemResponse(
        { status: 429, code: RATE_LIMITED_CODE, title: 'Too many requests', detail: `Try again in ${retryAfter} seconds.` },
        instance,
      );
      res.headers.set('Retry-After', String(retryAfter));
      throw new HTTPException(429, { res });
    },
  };
}
export type RateLimiter = ReturnType<typeof createRateLimiter>;

const HOUR = 60 * 60 * 1000;

/** Per-account limits (Stories 6.1, 6.3). */
export const RATE_LIMITS = {
  report: { limit: 10, windowMs: HOUR },
} satisfies Record<string, RateLimitRule>;
