import { readMarket } from "@/lib/market";

/**
 * Prices and multipliers for every tokenized stock.
 *
 * Cached briefly at the edge rather than per-user: the numbers are identical
 * for everyone, and thirteen Chainlink reads per visitor would be a needless
 * multicall storm on the RPC.
 */
export const revalidate = 20;

export async function GET() {
  try {
    const market = await readMarket();
    return Response.json(market, {
      headers: { "cache-control": "public, s-maxage=20, stale-while-revalidate=120" },
    });
  } catch (error) {
    console.error("[market] read failed", error);
    return Response.json({ error: "Could not read Base right now." }, { status: 502 });
  }
}
