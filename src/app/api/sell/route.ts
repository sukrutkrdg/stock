import { encodeFunctionData, isAddress, parseAbi, type Address, type Hex } from "viem";
import { publicClient, USDC_DECIMALS } from "@/lib/chain";
import { b20AssetAbi } from "@/lib/b20";
import { readMarket } from "@/lib/market";
import { routeSwap, RouterError, type BuiltSwap } from "@/lib/router";
import { planSale, SellError, type Holding, type SellIntent, type SellLot } from "@/lib/sell";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const erc20Abi = parseAbi(["function approve(address spender, uint256 value) returns (bool)"]);

/** Selling is the thinner side of these books; 1% leaves too many legs reverting. */
const DEFAULT_SLIPPAGE_BPS = 150;
const MAX_SLIPPAGE_BPS = 500;

type Call = { to: Address; data: Hex; value: Hex };

export type SellLegQuote = {
  symbol: string;
  ticker: string;
  /** Raw token units leaving the wallet. */
  sellRaw: string;
  shares: number;
  /** USDC coming back, in base units. */
  buyUsdc: string;
  minBuyUsdc: string;
  /** Price this route pays per share. */
  effectivePrice: number;
  feedPrice: number;
  /** Negative means the route pays less than the feed. */
  premiumPercent: number;
  closesPosition: boolean;
};

export type SellQuoteResponse = {
  legs: SellLegQuote[];
  calls: Call[];
  skipped: { symbol: string; reason: string }[];
  /** Total USDC expected back, in base units. */
  proceedsUsdc: string;
  slippageBps: number;
  marketClosed: boolean;
};

/**
 * Turn "sell these positions" into one signable batch.
 *
 * The approval shape is the mirror of a buy, and it is the part that surprises.
 * Buying a basket needs a single approval, because everything is paid for in
 * USDC. Selling needs one approval per stock, because each is its own token —
 * so a six-position exit is six approvals plus six swaps. A smart wallet still
 * signs that once; it is simply a longer batch.
 *
 * Amounts are read from the chain here rather than taken from the client. A
 * sale names exact raw units, and a stale balance means either a reverted batch
 * or a position the user asked to close that quietly stays open.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const input = body as { positions?: SellIntent[]; taker?: string; slippageBps?: number };

  if (!input.taker || !isAddress(input.taker)) {
    return Response.json({ error: "A connected wallet address is required." }, { status: 400 });
  }
  const taker = input.taker as Address;

  const slippageBps = Math.min(
    MAX_SLIPPAGE_BPS,
    Math.max(1, Math.round(Number(input.slippageBps) || DEFAULT_SLIPPAGE_BPS)),
  );

  try {
    const market = await readMarket();

    if (market.marketClosed) {
      return Response.json(
        { error: "The equity market is closed. Sales resume when the Chainlink feeds do." },
        { status: 409 },
      );
    }

    const requested = (input.positions ?? []).filter((p) => p && p.symbol);
    if (requested.length === 0) {
      return Response.json({ error: "Choose at least one position to sell." }, { status: 400 });
    }

    // Balances come from the chain, never from the request.
    const wanted = market.tickers.filter((t) =>
      requested.some((p) => p.symbol.toLowerCase() === t.symbol.toLowerCase()),
    );
    if (wanted.length === 0) {
      return Response.json({ error: "None of those are tokenized stocks." }, { status: 400 });
    }

    const balances = await publicClient().multicall({
      contracts: wanted.map(
        (t) =>
          ({
            address: t.address,
            abi: b20AssetAbi,
            functionName: "balanceOf",
            args: [taker],
          }) as const,
      ),
      allowFailure: true,
    });

    const holdings = new Map<string, Holding>();
    wanted.forEach((ticker, index) => {
      const result = balances[index];
      holdings.set(ticker.symbol, {
        raw: result.status === "success" ? (result.result as bigint) : 0n,
        decimals: ticker.decimals,
        multiplier: BigInt(ticker.multiplier),
        price: ticker.price,
      });
    });

    const plan = planSale(requested, holdings);
    const bySymbol = new Map(market.tickers.map((t) => [t.symbol, t]));

    const settled = await Promise.allSettled(
      plan.lots.map((lot) =>
        routeSwap({
          sellToken: lot.stock.address,
          sellAmount: lot.rawAmount,
          taker,
          slippageBps,
        }).then((swap) => ({ lot, swap })),
      ),
    );

    const priced: { lot: SellLot; swap: BuiltSwap }[] = [];
    const skipped = [...plan.skipped];

    for (const [index, result] of settled.entries()) {
      const lot = plan.lots[index];
      if (result.status === "fulfilled") {
        priced.push(result.value);
      } else {
        const reason =
          result.reason instanceof RouterError && /no route/i.test(result.reason.message)
            ? "No liquidity to sell into."
            : "Routing failed.";
        skipped.push({ symbol: lot.stock.ticker, reason });
      }
    }

    if (priced.length === 0) {
      return Response.json(
        { error: "None of those positions can be routed right now.", skipped },
        { status: 409 },
      );
    }

    const calls: Call[] = [];

    // One approval per stock, each sized to exactly what leaves the wallet — no
    // standing allowance left on a token after the sale settles.
    for (const { lot, swap } of priced) {
      calls.push({
        to: lot.stock.address,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [swap.routerAddress, lot.rawAmount],
        }),
        value: "0x0",
      });
    }

    const legs: SellLegQuote[] = priced.map(({ lot, swap }) => {
      const ticker = bySymbol.get(lot.stock.symbol)!;
      const proceeds = Number(swap.amountOut) / 10 ** USDC_DECIMALS;
      const effectivePrice = lot.shares > 0 ? proceeds / lot.shares : 0;
      const minBuyUsdc = (BigInt(swap.amountOut) * BigInt(10_000 - slippageBps)) / 10_000n;

      calls.push({
        to: swap.routerAddress,
        data: swap.data,
        value: (swap.value && swap.value !== "0"
          ? `0x${BigInt(swap.value).toString(16)}`
          : "0x0") as Hex,
      });

      return {
        symbol: lot.stock.symbol,
        ticker: lot.stock.ticker,
        sellRaw: lot.rawAmount.toString(),
        shares: lot.shares,
        buyUsdc: swap.amountOut,
        minBuyUsdc: minBuyUsdc.toString(),
        effectivePrice,
        feedPrice: ticker.price,
        premiumPercent:
          ticker.price > 0 && effectivePrice > 0
            ? ((effectivePrice - ticker.price) / ticker.price) * 100
            : 0,
        closesPosition: lot.closesPosition,
      };
    });

    const proceeds = priced.reduce((sum, entry) => sum + BigInt(entry.swap.amountOut), 0n);

    const response: SellQuoteResponse = {
      legs,
      calls,
      skipped,
      proceedsUsdc: proceeds.toString(),
      slippageBps,
      marketClosed: market.marketClosed,
    };

    return Response.json(response);
  } catch (error) {
    if (error instanceof SellError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof RouterError) {
      console.error("[sell] router error", error.message);
      return Response.json({ error: "Routing is unavailable right now." }, { status: 502 });
    }
    console.error("[sell] failed", error);
    return Response.json({ error: "Could not price that sale." }, { status: 500 });
  }
}
