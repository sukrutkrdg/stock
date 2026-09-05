import { getSlate, hideSlate } from "@/lib/repo";
import { databaseConfigured } from "@/lib/db";
import { AuthError, verifyUnlistIntent } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: RouteContext<"/api/slates/[id]">) {
  const { id } = await ctx.params;

  if (!databaseConfigured()) {
    return Response.json({ error: "Slate storage is not configured." }, { status: 503 });
  }

  try {
    const slate = await getSlate(id);
    if (!slate) return Response.json({ error: "No such slate." }, { status: 404 });
    return Response.json({ slate });
  } catch (error) {
    console.error("[slates] read failed", error);
    return Response.json({ error: "Could not load the slate." }, { status: 500 });
  }
}

/**
 * Unlist a slate: remove it from the public feed.
 *
 * Not a delete. `slate_holders`, `buy_events` and `dca_plans` all cascade from
 * this row, and `buy_events` is what keeps recording a buy idempotent — erasing
 * it would let an old transaction hash be replayed to re-inflate a holder
 * count. Anyone already holding the basket keeps it, and every link ever shared
 * keeps working; what stops is the basket appearing in the feed.
 *
 * Authorisation is a wallet signature, not a claimed address. `creator_address`
 * arrives in a request body that nobody signs, so matching against it alone
 * would let any caller unlist any slate.
 */
export async function DELETE(request: Request, ctx: RouteContext<"/api/slates/[id]">) {
  const { id } = await ctx.params;

  if (!databaseConfigured()) {
    return Response.json({ error: "Slate storage is not configured." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a signed request." }, { status: 400 });
  }

  try {
    const owner = await verifyUnlistIntent(id, body as never);

    const slate = await getSlate(id);
    if (!slate) return Response.json({ error: "No such slate." }, { status: 404 });

    if (!slate.creatorAddress) {
      return Response.json(
        { error: "This basket has no creator on record, so it cannot be unlisted." },
        { status: 403 },
      );
    }
    if (slate.creatorAddress.toLowerCase() !== owner.toLowerCase()) {
      return Response.json({ error: "Only the creator can unlist this basket." }, { status: 403 });
    }

    const hidden = await hideSlate(id, owner);
    if (!hidden) {
      // The signature checked out and the creator matches, so the only way to
      // get here is that it was already unlisted. That is the desired state.
      return Response.json({ slate, alreadyHidden: true });
    }

    return Response.json({ slate: hidden, alreadyHidden: false });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: 401 });
    }
    console.error("[slates] unlist failed", error);
    return Response.json({ error: "Could not unlist the basket." }, { status: 500 });
  }
}
