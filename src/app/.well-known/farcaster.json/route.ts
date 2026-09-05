import { minikitConfig } from "../../../../minikit.config";

/**
 * Base App and other Farcaster clients fetch this to discover the Mini App.
 * Served from a route rather than a static file so the URLs inside it follow
 * the deployment, and so the account association can come from env vars.
 */
export const dynamic = "force-static";
export const revalidate = 300;

export function GET() {
  return Response.json(minikitConfig);
}
