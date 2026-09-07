import type { Address, Hex } from "viem";
import { recordSell } from "@/lib/repo";
import { databaseConfigured } from "@/lib/db";
import { verifySell } from "@/lib/verifyBuy";
import { USDC_DECIMALS } from "@/lib/chain";

export const dynamic = "force-dynamic";

/**
 * Called once a sale confirms. Verified on Base before it is recorded — the
 * same standard a buy is held to, for the same reason: the client's word about
 * what happened onchain is not evidence.
 */
export async function POST(request: Request) {
  if (!databaseConfigured()) {
    return Response.json({ error: "Storage is not configured." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const input = body as { owner?: string; txHash?: string };
  if (!input.owner || !input.txHash) {
    return Response.json({ error: "owner and txHash are required." }, { status: 400 });
  }

  try {
    const verified = await verifySell({
      txHash: input.txHash as Hex,
      owner: input.owner as Address,
    });
    if ("error" in verified) return Response.json({ error: verified.error }, { status: 422 });

    const result = await recordSell({
      owner: input.owner,
      txHash: input.txHash,
      symbols: verified.sold,
      proceedsUsdc: (Number(verified.proceeds) / 10 ** USDC_DECIMALS).toFixed(6),
    });

    return Response.json({ ...result, sold: verified.sold });
  } catch (error) {
    console.error("[sells] record failed", error);
    return Response.json({ error: "Could not record the sale." }, { status: 500 });
  }
}
