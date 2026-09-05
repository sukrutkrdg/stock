import type { Address } from "viem";
import { publicClient } from "./chain";
import { aggregatorV3Abi, toQuote, EMPTY_QUOTE, type Quote } from "./chainlink";
import { b20AssetAbi, WAD } from "./b20";
import { STOCKS, type Stock } from "./stocks";

export type Ticker = {
  symbol: string;
  ticker: string;
  name: string;
  address: Address;
  sector: Stock["sector"];
  color: string;
  decimals: number;
  /** Current B20 multiplier, WAD-scaled. */
  multiplier: string;
  /** Underlying shares one whole token currently redeems for. */
  sharesPerToken: number;
  /** Tokens in circulation, in whole units. */
  supply: number;
  /**
   * Whether Slate will route a buy into this leg. Supply is the honest signal
   * this early: a token nobody has minted yet has no pool to trade against, and
   * offering it would produce a quote that always fails.
   */
  tradable: boolean;
} & Quote;

export type Market = {
  tickers: Ticker[];
  /** True when every feed says closed — the equity market, not the app. */
  marketClosed: boolean;
  fetchedAt: number;
};

/**
 * Read every tokenized stock's price and multiplier in one multicall.
 *
 * Price comes from Chainlink rather than from the token itself: the feeds are
 * total-return, so they already fold in dividends and splits. The multiplier is
 * read alongside it only to convert token units to shares — never to adjust the
 * price, which would double-count the same corporate action.
 */
export async function readMarket(): Promise<Market> {
  const client = publicClient();

  const contracts = STOCKS.flatMap((stock) => [
    { address: stock.feed, abi: aggregatorV3Abi, functionName: "latestRoundData" } as const,
    { address: stock.address, abi: b20AssetAbi, functionName: "multiplier" } as const,
    { address: stock.address, abi: b20AssetAbi, functionName: "decimals" } as const,
    { address: stock.address, abi: b20AssetAbi, functionName: "totalSupply" } as const,
  ]);

  const STRIDE = 4;

  const results = await client.multicall({ contracts, allowFailure: true });
  const now = Date.now();

  const tickers = STOCKS.map((stock, index) => {
    const round = results[index * STRIDE];
    const multiplierResult = results[index * STRIDE + 1];
    const decimalsResult = results[index * STRIDE + 2];
    const supplyResult = results[index * STRIDE + 3];

    const multiplier =
      multiplierResult.status === "success" ? (multiplierResult.result as bigint) : WAD;
    const decimals =
      decimalsResult.status === "success" ? Number(decimalsResult.result as number) : 6;

    const rawSupply = supplyResult.status === "success" ? (supplyResult.result as bigint) : 0n;
    const supply = Number(rawSupply) / 10 ** decimals;

    let quote: Quote = EMPTY_QUOTE;
    if (round.status === "success") {
      const [, answer, , updatedAt] = round.result as readonly [bigint, bigint, bigint, bigint, bigint];
      quote = toQuote(answer, updatedAt, now);
    }

    return {
      symbol: stock.symbol,
      ticker: stock.ticker,
      name: stock.name,
      address: stock.address,
      sector: stock.sector,
      color: stock.color,
      decimals,
      multiplier: multiplier.toString(),
      sharesPerToken: Number(multiplier) / Number(WAD),
      supply,
      tradable: supply > 0,
      ...quote,
    } satisfies Ticker;
  });

  return {
    tickers,
    marketClosed: tickers.every((t) => t.closed),
    fetchedAt: now,
  };
}

/** Value of a slate's legs per $1 invested — used for the sparkline and share card. */
export function slateUnitValue(
  legs: { symbol: string; bps: number }[],
  tickers: Ticker[],
): number {
  const bySymbol = new Map(tickers.map((t) => [t.symbol, t]));
  return legs.reduce((sum, leg) => {
    const ticker = bySymbol.get(leg.symbol);
    if (!ticker || ticker.price <= 0) return sum;
    return sum + (leg.bps / 10_000) * ticker.price;
  }, 0);
}
