import { isAddress, type Address } from "viem";
import { publicClient, USDC_ADDRESS, USDC_DECIMALS } from "@/lib/chain";
import { b20AssetAbi, WAD, toScaled } from "@/lib/b20";
import { readMarket } from "@/lib/market";
import { STOCKS } from "@/lib/stocks";

export const dynamic = "force-dynamic";

export type Position = {
  symbol: string;
  ticker: string;
  name: string;
  color: string;
  /** Raw token units as stored onchain. */
  raw: string;
  /** Multiplier-adjusted units — what the wallet and the issuer call a balance. */
  tokens: number;
  /** Underlying shares those tokens redeem for right now. */
  shares: number;
  price: number;
  value: number;
  multiplier: string;
  stale: boolean;
};

export type Portfolio = {
  positions: Position[];
  totalValue: number;
  usdc: number;
  marketClosed: boolean;
};

/**
 * A wallet's tokenized-stock holdings.
 *
 * Every figure runs through the B20 multiplier rather than off `balanceOf`
 * directly. One token is not permanently one share: after a split the raw
 * balance is unchanged while the multiplier moves, so a portfolio built on raw
 * balances quietly reports the wrong number of shares — and the wrong value —
 * from the moment the first corporate action lands.
 */
export async function GET(request: Request) {
  const owner = new URL(request.url).searchParams.get("owner");
  if (!owner || !isAddress(owner)) {
    return Response.json({ error: "A wallet address is required." }, { status: 400 });
  }

  try {
    const client = publicClient();
    const account = owner as Address;

    const [market, balances, usdcBalance] = await Promise.all([
      readMarket(),
      client.multicall({
        contracts: STOCKS.map(
          (stock) =>
            ({
              address: stock.address,
              abi: b20AssetAbi,
              functionName: "balanceOf",
              args: [account],
            }) as const,
        ),
        allowFailure: true,
      }),
      client.readContract({
        address: USDC_ADDRESS,
        abi: b20AssetAbi,
        functionName: "balanceOf",
        args: [account],
      }),
    ]);

    const bySymbol = new Map(market.tickers.map((t) => [t.symbol, t]));

    const positions = STOCKS.map((stock, index) => {
      const result = balances[index];
      const raw = result.status === "success" ? (result.result as bigint) : 0n;
      if (raw === 0n) return null;

      const ticker = bySymbol.get(stock.symbol)!;
      const multiplier = BigInt(ticker.multiplier || WAD.toString());
      const scaled = toScaled(raw, multiplier);
      const tokens = Number(scaled) / 10 ** ticker.decimals;

      return {
        symbol: stock.symbol,
        ticker: stock.ticker,
        name: stock.name,
        color: stock.color,
        raw: raw.toString(),
        tokens,
        // The multiplier is exactly the token-to-share ratio, so the scaled
        // balance already is the share count.
        shares: tokens,
        price: ticker.price,
        value: tokens * ticker.price,
        multiplier: ticker.multiplier,
        stale: ticker.stale,
      } satisfies Position;
    }).filter((position): position is Position => position !== null);

    positions.sort((a, b) => b.value - a.value);

    const portfolio: Portfolio = {
      positions,
      totalValue: positions.reduce((sum, position) => sum + position.value, 0),
      usdc: Number(usdcBalance as bigint) / 10 ** USDC_DECIMALS,
      marketClosed: market.marketClosed,
    };

    return Response.json(portfolio);
  } catch (error) {
    console.error("[portfolio] read failed", error);
    return Response.json({ error: "Could not read your positions." }, { status: 502 });
  }
}
