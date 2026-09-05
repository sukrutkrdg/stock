import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/**
 * Neon Postgres, provisioned through the Vercel Marketplace.
 *
 * Initialised lazily. `neon()` throws when `DATABASE_URL` is missing, and
 * Next.js evaluates module top-level code during `next build` — so creating the
 * client eagerly would break the first deploy, before the integration has
 * injected its env vars.
 */
let client: NeonQueryFunction<false, false> | null = null;

export function sql(): NeonQueryFunction<false, false> {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set. Run `vercel integration add neon` and then `vercel env pull .env.local --yes`.",
      );
    }
    client = neon(url);
  }
  return client;
}

export function databaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
