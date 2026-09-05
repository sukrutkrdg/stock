import { sql } from "./db";
import { databaseConfigured } from "./db";

/**
 * Fixed-window rate limiting, backed by Postgres.
 *
 * This exists because `/api/compose` spends real money on every call and takes
 * no credential to reach. An unmetered public LLM endpoint is an open tab on
 * someone's card: the per-call cost is small, and a hundred thousand calls are
 * not. In-memory counters would not do — serverless instances do not share
 * state, so each one would grant the full allowance.
 */
export type RateLimitResult = {
  ok: boolean;
  /** Calls left in the current window. */
  remaining: number;
  /** Seconds until the window rolls over. */
  resetIn: number;
};

export type RateLimitRule = {
  /** Identifier for the thing being limited, e.g. `compose:1.2.3.4`. */
  key: string;
  limit: number;
  windowSeconds: number;
};

/**
 * Count one hit against a rule.
 *
 * Fails **open** on a database error. A limiter that takes the feature down
 * whenever Postgres hiccups trades a cost risk for an availability one, and the
 * global cap below is the backstop that actually bounds the bill.
 */
export async function rateLimit(rule: RateLimitRule): Promise<RateLimitResult> {
  if (!databaseConfigured()) return { ok: true, remaining: rule.limit, resetIn: 0 };

  const now = Math.floor(Date.now() / 1000);
  const window = Math.floor(now / rule.windowSeconds);
  const bucket = `${rule.key}:${window}`;
  const resetIn = (window + 1) * rule.windowSeconds - now;

  try {
    const db = sql();
    const rows = (await db`
      insert into rate_limits (bucket, hits, expires_at)
      values (${bucket}, 1, to_timestamp(${(window + 1) * rule.windowSeconds}))
      on conflict (bucket) do update set hits = rate_limits.hits + 1
      returning hits
    `) as { hits: number }[];

    const hits = rows[0]?.hits ?? 1;
    return { ok: hits <= rule.limit, remaining: Math.max(0, rule.limit - hits), resetIn };
  } catch (error) {
    console.error("[ratelimit] check failed, allowing through", error);
    return { ok: true, remaining: rule.limit, resetIn };
  }
}

/**
 * The caller's address, as Vercel reports it.
 *
 * `x-forwarded-for` can carry a chain; the first entry is the client. Falls
 * back to a single shared bucket rather than to "unlimited" — a request whose
 * origin cannot be identified should still be counted against something.
 */
export function callerKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip");
  return ip || "unknown";
}

/** Opportunistic cleanup so the table does not grow without bound. */
export async function sweepRateLimits(probability = 0.02): Promise<void> {
  if (!databaseConfigured() || Math.random() > probability) return;
  try {
    await sql()`delete from rate_limits where expires_at < now()`;
  } catch {
    // Cleanup is housekeeping; never let it fail a request.
  }
}
