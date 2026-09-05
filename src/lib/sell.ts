import type { Stock } from "./stocks";
import { stockBySymbol } from "./stocks";
import { toScaled, WAD } from "./b20";

/**
 * Planning a sale.
 *
 * Selling is not the mirror image of buying, and the difference is where the
 * money is. A buy hands over USDC and lets the router decide how many tokens
 * come back; a sale has to name an exact number of *raw* token units the wallet
 * actually holds. Get that number from a multiplier-adjusted balance and you
 * either try to sell more than exists — the whole batch reverts — or leave a
 * remainder behind on what the user asked to close completely.
 *
 * So every figure here is raw. The multiplier appears only to render shares.
 */
export const SELL_ALL_BPS = 10_000;

/** Below roughly a dollar a leg will not route, and the gas is not worth it. */
export const MIN_SELL_USD = 1;

export type SellIntent = {
  symbol: string;
  /** Portion of the holding to sell, in basis points. 10,000 sells all of it. */
  bps: number;
};

export type Holding = {
  /** `balanceOf` exactly as the chain returns it — never the scaled view. */
  raw: bigint;
  decimals: number;
  /** WAD-scaled B20 multiplier. */
  multiplier: bigint;
  price: number;
};

export type SellLot = {
  stock: Stock;
  /** The wallet's whole raw balance. */
  rawBalance: bigint;
  /** Raw units this sale will move. */
  rawAmount: bigint;
  decimals: number;
  /** Shares represented by `rawAmount`, for display only. */
  shares: number;
  /** Estimated proceeds at the feed price, before routing. */
  estimatedUsd: number;
  /** True when the whole position is being closed. */
  closesPosition: boolean;
};

export type SellPlan = {
  lots: SellLot[];
  skipped: { symbol: string; reason: string }[];
  estimatedUsd: number;
};

export class SellError extends Error {}

/**
 * How many raw units to sell for a given portion of a holding.
 *
 * Selling everything returns the balance itself rather than a computed
 * fraction. `balance * 10000 / 10000` looks like an identity and is one for
 * exact integers, but routing that through the same arithmetic as a partial
 * sale means one day someone changes the rounding and "sell all" quietly starts
 * leaving dust — or worse, rounds up past the balance. The full exit is the
 * case users care most about, so it takes no arithmetic at all.
 */
export function rawAmountFor(rawBalance: bigint, bps: number): bigint {
  if (bps >= SELL_ALL_BPS) return rawBalance;
  if (bps <= 0) return 0n;
  // Floor: never ask to move more than the wallet holds.
  return (rawBalance * BigInt(bps)) / BigInt(SELL_ALL_BPS);
}

/**
 * Turn "sell 50% of NVDA and all of MSFT" into exact raw amounts.
 *
 * Anything that cannot be sold is dropped with a reason rather than silently
 * omitted — a leg vanishing from a sale with no explanation is how someone ends
 * up believing they exited a position they still hold.
 */
export function planSale(
  intents: SellIntent[],
  holdings: Map<string, Holding>,
): SellPlan {
  if (!Array.isArray(intents) || intents.length === 0) {
    throw new SellError("Choose at least one position to sell.");
  }

  const lots: SellLot[] = [];
  const skipped: { symbol: string; reason: string }[] = [];
  const seen = new Set<string>();

  for (const intent of intents) {
    const stock = stockBySymbol(String(intent?.symbol ?? ""));
    if (!stock) {
      skipped.push({ symbol: String(intent?.symbol ?? "?"), reason: "not a tokenized stock" });
      continue;
    }
    if (seen.has(stock.symbol)) continue;
    seen.add(stock.symbol);

    const holding = holdings.get(stock.symbol);
    if (!holding || holding.raw === 0n) {
      skipped.push({ symbol: stock.ticker, reason: "nothing held" });
      continue;
    }

    const bps = Math.round(Number(intent.bps));
    if (!Number.isFinite(bps) || bps <= 0) {
      skipped.push({ symbol: stock.ticker, reason: "nothing selected" });
      continue;
    }

    const rawAmount = rawAmountFor(holding.raw, Math.min(bps, SELL_ALL_BPS));
    if (rawAmount === 0n) {
      skipped.push({ symbol: stock.ticker, reason: "amount rounds to zero" });
      continue;
    }

    const shares = Number(toScaled(rawAmount, holding.multiplier)) / 10 ** holding.decimals;
    const estimatedUsd = shares * holding.price;

    if (estimatedUsd < MIN_SELL_USD) {
      skipped.push({ symbol: stock.ticker, reason: `under $${MIN_SELL_USD}` });
      continue;
    }

    lots.push({
      stock,
      rawBalance: holding.raw,
      rawAmount,
      decimals: holding.decimals,
      shares,
      estimatedUsd,
      closesPosition: rawAmount === holding.raw,
    });
  }

  if (lots.length === 0) {
    throw new SellError("None of those positions can be sold right now.");
  }

  return {
    lots,
    skipped,
    estimatedUsd: lots.reduce((sum, lot) => sum + lot.estimatedUsd, 0),
  };
}

/** Shares a raw balance currently represents, for display. */
export function sharesOf(holding: Holding): number {
  return Number(toScaled(holding.raw, holding.multiplier || WAD)) / 10 ** holding.decimals;
}
