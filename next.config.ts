import type { NextConfig } from "next";

/**
 * The one origin this app answers on.
 *
 * A Mini App manifest is signed against a single domain, and every absolute URL
 * the app emits has to agree with it. Any other hostname that still resolves —
 * a project's auto-generated `*.vercel.app` name, a previous domain — serves a
 * manifest that claims to be somewhere else, and a client validating it sees a
 * mismatch rather than an app.
 */
const CANONICAL_HOST = process.env.NEXT_PUBLIC_URL
  ? new URL(process.env.NEXT_PUBLIC_URL).host
  : undefined;

/**
 * Hostnames that used to serve this app and must not serve it any more.
 *
 * Each entry is filtered against the canonical host below, so a name can be
 * listed before it is retired: while it *is* canonical the rule is skipped, and
 * it starts redirecting the moment `NEXT_PUBLIC_URL` moves on. That makes a
 * domain switch a single env change rather than a code change that has to land
 * at exactly the right moment.
 */
const RETIRED_HOSTS = ["slate-lake-six.vercel.app", "slatebaskets.vercel.app"];

const nextConfig: NextConfig = {
  // Next blocks dev-resource requests from hosts it does not recognise, which
  // silently breaks HMR and hydration when the app is opened on a loopback IP
  // or a tunnel host instead of `localhost`. Mini App development always
  // involves at least one of those, since Base App has to reach the dev server
  // over a public URL.
  allowedDevOrigins: ["127.0.0.1", "*.ngrok-free.app", "*.trycloudflare.com"],

  async redirects() {
    if (!CANONICAL_HOST) return [];

    // 308 rather than 302: the move is permanent, and it keeps the method and
    // body so an already-shared link or a cached embed still lands correctly.
    return RETIRED_HOSTS.filter((host) => host !== CANONICAL_HOST).map((host) => ({
      source: "/:path*",
      has: [{ type: "host" as const, value: host }],
      destination: `https://${CANONICAL_HOST}/:path*`,
      permanent: true,
    }));
  },
};

export default nextConfig;
