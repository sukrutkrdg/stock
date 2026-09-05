import { createSlate, listTrending, listByCreator, listHeldBy } from "@/lib/repo";
import { SlateError, validateLegs, validateName } from "@/lib/slate";
import { databaseConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!databaseConfigured()) {
    return Response.json({ slates: [], unconfigured: true });
  }

  const url = new URL(request.url);
  const creator = url.searchParams.get("creator");
  const holder = url.searchParams.get("holder");

  try {
    const slates = creator
      ? await listByCreator(creator)
      : holder
        ? await listHeldBy(holder)
        : await listTrending();
    return Response.json({ slates });
  } catch (error) {
    console.error("[slates] list failed", error);
    return Response.json({ error: "Could not load slates." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const input = body as {
    name?: string;
    legs?: { symbol: string; bps: number }[];
    creatorAddress?: string;
    creatorFid?: number;
    creatorName?: string;
  };

  try {
    const name = validateName(input.name ?? "");
    const legs = validateLegs(input.legs ?? []);

    const slate = await createSlate({
      name,
      legs,
      creatorAddress: input.creatorAddress ?? null,
      creatorFid: input.creatorFid ?? null,
      creatorName: input.creatorName ?? null,
    });

    return Response.json({ slate }, { status: 201 });
  } catch (error) {
    if (error instanceof SlateError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("[slates] create failed", error);
    return Response.json({ error: "Could not save the slate." }, { status: 500 });
  }
}
