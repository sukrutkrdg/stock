import { composeSlate, composeConfigured, ComposeError } from "@/lib/compose";

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

  try {
    const result = await composeSlate(prompt);
    return Response.json(result);
  } catch (error) {
    if (error instanceof ComposeError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("[compose] failed", error);
    return Response.json({ error: "Could not compose a slate right now." }, { status: 502 });
  }
}
