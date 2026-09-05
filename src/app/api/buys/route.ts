import type { Address, Hex } from "viem";
import { getSlate, recordBuy } from "@/lib/repo";
import { databaseConfigured } from "@/lib/db";
import { verifyBuy } from "@/lib/verifyBuy";

export const dynamic = "force-dynamic";

/**
 * Called once a slate buy confirms. Verifies the transaction on Base before it
 * touches the holder count — the client's word is not evidence.
 */
export async function POST(request: Request) {
  if (!databaseConfigured()) {
    return Response.json({ error: "Slate storage is not configured." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const input = body as { slateId?: string; owner?: string; txHash?: string; amountUsdc?: string };
  if (!input.slateId || !input.owner || !input.txHash) {
    return Response.json({ error: "slateId, owner and txHash are required." }, { status: 400 });
  }

  try {
    const slate = await getSlate(input.slateId);
    if (!slate) return Response.json({ error: "No such slate." }, { status: 404 });

    const verified = await verifyBuy({
      txHash: input.txHash as Hex,
      owner: input.owner as Address,
      expectSymbols: slate.legs.map((leg) => leg.symbol),
    });

    if ("error" in verified) {
      return Response.json({ error: verified.error }, { status: 422 });
    }

    const result = await recordBuy({
      slateId: slate.id,
      owner: input.owner,
      txHash: input.txHash,
      amountUsdc: input.amountUsdc ?? "0",
    });

    return Response.json({ ...result, received: verified.received });
  } catch (error) {
    console.error("[buys] record failed", error);
    return Response.json({ error: "Could not record the buy." }, { status: 500 });
  }
}
