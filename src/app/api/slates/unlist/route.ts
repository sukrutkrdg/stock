import { getSlate, removeSlate } from "@/lib/repo";
import { databaseConfigured } from "@/lib/db";
import { AuthError, verifyUnlistIntent } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Unlist one or more baskets with a single signature.
 *
 * Clearing a handful of test baskets should not mean approving a wallet prompt
 * once per basket. The signed message names every id, so one signature covers
 * exactly that set and no other — and each basket is still checked against its
 * own creator before it is touched.
 */
export async function POST(request: Request) {
  if (!databaseConfigured()) {
    return Response.json({ error: "Slate storage is not configured." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a signed request." }, { status: 400 });
  }

  const input = body as { ids?: string[] };
  const ids = (input.ids ?? []).filter((id) => typeof id === "string" && id.length > 0);

  try {
    const owner = await verifyUnlistIntent(ids, body as never);

    const deleted: string[] = [];
    const unlisted: string[] = [];
    const refused: { id: string; reason: string }[] = [];

    for (const id of ids) {
      const slate = await getSlate(id);
      if (!slate) {
        refused.push({ id, reason: "no such basket" });
        continue;
      }
      if (!slate.creatorAddress) {
        refused.push({ id, reason: "no creator on record" });
        continue;
      }
      if (slate.creatorAddress.toLowerCase() !== owner.toLowerCase()) {
        refused.push({ id, reason: "not yours" });
        continue;
      }
      const { removed } = await removeSlate(id, owner);
      if (removed === "deleted") deleted.push(id);
      else if (removed === "unlisted") unlisted.push(id);
      else if (slate.hidden) unlisted.push(id); // already withdrawn
      else refused.push({ id, reason: "could not be removed" });
    }

    if (deleted.length === 0 && unlisted.length === 0) {
      return Response.json(
        { error: refused[0]?.reason ?? "Nothing could be removed.", refused },
        { status: 403 },
      );
    }

    return Response.json({ deleted, unlisted, refused });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: 401 });
    }
    console.error("[slates] bulk unlist failed", error);
    return Response.json({ error: "Could not unlist those baskets." }, { status: 500 });
  }
}
