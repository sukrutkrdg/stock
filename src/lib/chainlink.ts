import { parseAbi } from "viem";

/**
 * Chainlink feeds for tokenized stocks report *total-return* values on a 24/5
 * schedule: the price already reflects dividends and other corporate actions,
 * so it must not be adjusted a second time by the B20 multiplier.
 */
export const aggregatorV3Abi = parseAbi([
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

/** Chainlink equity feeds carry 8 decimals. */
export const FEED_DECIMALS = 8;

/**
 * Age past which a round stops being a tradeable price.
 *
 * Sized to sit above the feeds' heartbeat rather than at it: inside market
 * hours a quiet stock can go a while without a deviation update, and treating
 * that as an outage would block perfectly good trades.
 */
export const STALE_AFTER_SECONDS = 90 * 60;

/**
 * Age past which the equity market is almost certainly closed rather than the
 * feed being broken. The feeds run 24/5, so every weekend and market holiday
 * legitimately lands here. Slate says "market closed" and keeps showing the
 * last close — it does not pretend the data is live, and it never settles a
 * trade against a frozen answer.
 */
export const CLOSED_AFTER_SECONDS = 4 * 60 * 60;

export type Quote = {
  /** Human-readable price in USD, from the most recent round. */
  price: number;
  /** Unix seconds of the round that produced `price`. */
  updatedAt: number;
  /** Seconds since that round was published. */
  ageSeconds: number;
  /** Too old to trade against. */
  stale: boolean;
  /** Old enough that the underlying market is closed. */
  closed: boolean;
};

export function toQuote(answer: bigint, updatedAt: bigint, now = Date.now()): Quote {
  const seconds = Number(updatedAt);
  const ageSeconds = Math.max(0, Math.floor(now / 1000) - seconds);
  return {
    price: Number(answer) / 10 ** FEED_DECIMALS,
    updatedAt: seconds,
    ageSeconds,
    stale: ageSeconds > STALE_AFTER_SECONDS,
    closed: ageSeconds > CLOSED_AFTER_SECONDS,
  };
}

export const EMPTY_QUOTE: Quote = {
  price: 0,
  updatedAt: 0,
  ageSeconds: Number.MAX_SAFE_INTEGER,
  stale: true,
  closed: true,
};
