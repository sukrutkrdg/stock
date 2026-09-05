/**
 * The app's public origin.
 *
 * The Mini App manifest is signed against a specific domain, so every absolute
 * URL the app emits — manifest fields, embed images, share links — has to agree
 * with it exactly. `NEXT_PUBLIC_URL` is the source of truth; Vercel's own
 * per-deployment URL is the fallback so preview builds still render.
 */
export function appUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  const vercel = process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;

  return "http://localhost:3000";
}

export function appDomain(): string {
  return new URL(appUrl()).host;
}
