import { composeSlate, composeConfigured, ComposeError } from "@/lib/compose";
import { callerKey, rateLimit, sweepRateLimits } from "@/lib/ratelimit";

/**
 * Two ceilings, because they fail differently.
 *
 * The per-caller limit stops one person hammering the endpoint. The global one
 * is the backstop for what that cannot see: a distributed flood, where every
 * address stays under its own allowance and the bill still runs away. Composing
 * costs roughly $0.014, so the daily cap is a spend ceiling in requests —
 * 2,000 of them is about $28 a day, and hitting it degrades one feature rather
 * than emptying an account.
 */
const PER_CALLER = { limit: 10, windowSeconds: 60 * 60 };
const GLOBAL = { limit: 2_000, windowSeconds: 24 * 60 * 60 };

export const dynamic = "force-dynamic";
// A composed slate is a couple of seconds of model time; the default 15s cap on
// some plans is too tight when the market read and the model call are serial.
export const maxDuration = 60;

export async function GET() {
  // Lets the builder hide the composer entirely rather than offering an input
  // that fails on submit.
  return Response.json({ available: composeConfigured() });
}

export async function POST(request: Request) {
  if (!composeConfigured()) {
    return Response.json({ error: "The composer is not configured." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const prompt = (body as { prompt?: string }).prompt ?? "";

  const caller = await rateLimit({ key: `compose:${callerKey(request)}`, ...PER_CALLER });
  if (!caller.ok) {
    return Response.json(
      { error: "You have composed a lot of slates. Try again in a little while." },
      { status: 429, headers: { "retry-after": String(caller.resetIn) } },
    );
  }

  const global = await rateLimit({ key: "compose:global", ...GLOBAL });
  if (!global.ok) {
    return Response.json(
      { error: "The composer is resting for today. Build a slate by hand in the meantime." },
      { status: 429, headers: { "retry-after": String(global.resetIn) } },
    );
  }

  void sweepRateLimits();

  try {
    const { usage, ...result } = await composeSlate(prompt);

    // Logged, never returned: the client has no use for it and the bill does.
    // Grep the deployment logs for "[compose]" to see spend per request.
    console.log(
      `[compose] ${usage.inputTokens}in ${usage.outputTokens}out ` +
        `${(usage.latencyMs / 1000).toFixed(1)}s $${usage.usd.toFixed(5)}`,
    );

    return Response.json(result);
  } catch (error) {
    if (error instanceof ComposeError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("[compose] failed", error);
    return Response.json({ error: "Could not compose a slate right now." }, { status: 502 });
  }
}
